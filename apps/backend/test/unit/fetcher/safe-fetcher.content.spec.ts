import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import {
  brotliCompressSync,
  createGzip,
  deflateSync,
  gzipSync,
} from 'node:zlib';

import { errors } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ResponseTooLargeError,
  UnsupportedContentEncodingError,
  UnsupportedContentTypeError,
  UpstreamUnreachableError,
} from '../../../src/fetcher/fetcher.errors.js';
import {
  ignoreExpectedAbort,
  MAX_BODY_BYTES,
  SafeFetcherService,
} from '../../../src/fetcher/service/safe-fetcher.service.js';
import {
  fakeResolver,
  LOOPBACK_V4,
  RELAXED_TEST_POLICY,
  startTestServer,
  type TestServer,
} from '../../support/fetcher-test-kit.js';

// Final 2xx responses: Content-Type checked before the body is read; body
// decoded (gzip, deflate, br) and counted while streaming; 5 MiB limit on
// decoded bytes; charset from the header, UTF-8 as fallback
// (docs/adr/0002-safe-fetcher.md, rules 6–8).

const HTML = 'text/html; charset=utf-8';
const PAGE = '<!doctype html><title>Ünïcödé page</title>';

type Reply = {
  status?: number;
  headers?: Record<string, string | number>;
  body?: Buffer | string;
  /** Called instead of sending `body`. */
  stream?: (response: ServerResponse) => void;
};

let server: TestServer;
let fetcher: SafeFetcherService;
/** Replies by path; each test sets the ones it needs. */
let replies: Record<string, Reply>;
/** Paths whose response was closed (finished or aborted). */
let closed: string[];

function urlOf(path: string): string {
  return `http://site.test:${server.port}${path}`;
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected an error, but none was thrown');
}

function drip(response: ServerResponse): void {
  const timer = setInterval(() => response.write('x'), 50);
  response.on('close', () => clearInterval(timer));
}

beforeEach(async () => {
  replies = {};
  closed = [];
  server = await startTestServer((request, response) => {
    const path = request.url ?? '/';
    response.on('close', () => closed.push(path));
    if (path === '/reset') {
      request.socket.destroy();
      return;
    }
    const reply = replies[path] ?? {
      headers: { 'content-type': HTML },
      body: PAGE,
    };
    response.writeHead(reply.status ?? 200, reply.headers ?? {});
    if (reply.stream) {
      reply.stream(response);
    } else {
      response.end(reply.body ?? '');
    }
  });
  fetcher = new SafeFetcherService(
    RELAXED_TEST_POLICY,
    fakeResolver([LOOPBACK_V4]).resolver,
  );
});

afterEach(async () => {
  await fetcher.onModuleDestroy();
  await server.close();
});

describe('Content-Type of the final 2xx response', () => {
  it.each([
    ['text/html'],
    ['text/html; charset=utf-8'],
    ['TEXT/HTML'],
    [' text/html ;charset=UTF-8'],
  ])('accepts %j', async (contentType) => {
    replies['/'] = { headers: { 'content-type': contentType }, body: PAGE };
    const result = await fetcher.fetchPage(urlOf('/'));
    expect(result.body).toBe(PAGE);
  });

  it.each([
    [undefined, 'missing'],
    ['', 'empty'],
    ['application/json', 'JSON'],
    ['text/plain', 'plain text'],
    ['application/xhtml+xml', 'XHTML (rejected in the MVP)'],
    ['image/png', 'image'],
    ['text/htmlx', 'similar, but not text/html'],
  ] as [string | undefined, string][])(
    'rejects %j (%s)',
    async (contentType) => {
      replies['/'] = {
        headers:
          contentType === undefined ? {} : { 'content-type': contentType },
        body: PAGE,
      };
      const error = await errorOf(fetcher.fetchPage(urlOf('/')));
      expect(error).toBeInstanceOf(UnsupportedContentTypeError);
    },
  );

  it('rejects before reading the body', async () => {
    replies['/'] = {
      headers: { 'content-type': 'application/pdf' },
      stream: drip,
    };
    const started = performance.now();
    const error = await errorOf(
      fetcher.fetchPage(urlOf('/'), { deadlineMs: 2_000 }),
    );
    expect(error).toBeInstanceOf(UnsupportedContentTypeError);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('Non-2xx responses are results without a body', () => {
  it.each([
    [404, { 'content-type': 'text/plain' }],
    [404, {}],
    [500, { 'content-type': 'application/json' }],
    [503, { 'content-type': 'text/html' }],
  ])('returns HTTP %i with headers %j and no body', async (status, headers) => {
    replies['/'] = { status, headers, body: 'error page' };
    const result = await fetcher.fetchPage(urlOf('/'));
    expect(result.status).toBe(status);
    expect(result.body).toBeNull();
  });

  it('does not wait for the body of an error response', async () => {
    replies['/'] = {
      status: 500,
      headers: { 'content-type': HTML },
      stream: drip,
    };
    const started = performance.now();
    const result = await fetcher.fetchPage(urlOf('/'), { deadlineMs: 2_000 });
    expect(result.status).toBe(500);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('returns a 3xx without Location without a body', async () => {
    replies['/'] = { status: 302, headers: {}, body: 'moved' };
    const result = await fetcher.fetchPage(urlOf('/'));
    expect(result).toMatchObject({ status: 302, body: null });
  });
});

describe('Content-Encoding', () => {
  const encoded = Buffer.from(PAGE);

  it.each([
    ['gzip', gzipSync(encoded)],
    ['x-gzip', gzipSync(encoded)],
    ['GZIP', gzipSync(encoded)],
    ['deflate', deflateSync(encoded)],
    ['br', brotliCompressSync(encoded)],
    ['identity', encoded],
  ])('decodes %s', async (encoding, body) => {
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-encoding': encoding },
      body,
    };
    const result = await fetcher.fetchPage(urlOf('/'));
    expect(result.body).toBe(PAGE);
  });

  it.each([
    ['compress', 'unknown'],
    ['zstd', 'not in the allowed list'],
    ['constructor', 'object prototype name'],
    ['toString', 'object prototype name'],
    ['gzip, br', 'stacked'],
    ['gzip,gzip', 'stacked twice'],
  ])('rejects %j (%s)', async (encoding) => {
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-encoding': encoding },
      body: encoded,
    };
    const error = await errorOf(fetcher.fetchPage(urlOf('/')));
    expect(error).toBeInstanceOf(UnsupportedContentEncodingError);
  });

  it('maps a corrupt compressed body to UpstreamUnreachableError', async () => {
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-encoding': 'gzip' },
      body: Buffer.from('this is not gzip data'),
    };
    const error = await errorOf(fetcher.fetchPage(urlOf('/')));
    expect(error).toBeInstanceOf(UpstreamUnreachableError);
  });
});

describe('Decoded body size limit (5 MiB)', () => {
  const atLimit = Buffer.alloc(MAX_BODY_BYTES, 'a');
  const overLimit = Buffer.alloc(MAX_BODY_BYTES + 1, 'a');

  it('is 5 MiB', () => {
    expect(MAX_BODY_BYTES).toBe(5 * 1024 * 1024);
  });

  it.each([
    ['plain', 'identity', atLimit],
    ['gzip', 'gzip', gzipSync(atLimit)],
  ])('accepts a %s body of exactly 5 MiB', async (_label, encoding, body) => {
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-encoding': encoding },
      body,
    };
    const result = await fetcher.fetchPage(urlOf('/'));
    expect(result.body).toHaveLength(MAX_BODY_BYTES);
  });

  it.each([
    ['plain', 'identity', overLimit],
    ['gzip', 'gzip', gzipSync(overLimit)],
    ['brotli', 'br', brotliCompressSync(overLimit)],
    ['deflate', 'deflate', deflateSync(overLimit)],
  ])('rejects a %s body of 5 MiB + 1 byte', async (_label, encoding, body) => {
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-encoding': encoding },
      body,
    };
    const error = await errorOf(fetcher.fetchPage(urlOf('/')));
    expect(error).toBeInstanceOf(ResponseTooLargeError);
  });

  it('rejects a small gzip body that expands far beyond 5 MiB', async () => {
    const bomb = gzipSync(Buffer.alloc(50 * 1024 * 1024)); // ~50 KiB
    expect(bomb.length).toBeLessThan(100 * 1024);
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-encoding': 'gzip' },
      body: bomb,
    };
    const error = await errorOf(fetcher.fetchPage(urlOf('/')));
    expect(error).toBeInstanceOf(ResponseTooLargeError);
  });

  it('stops an endless compressed stream while streaming, not at its end', async () => {
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-encoding': 'gzip' },
      stream: (response) => {
        const zeros = Readable.from(
          (function* () {
            for (;;) yield Buffer.alloc(64 * 1024);
          })(),
        );
        zeros.pipe(createGzip()).pipe(response);
        response.on('close', () => zeros.destroy());
      },
    };
    const error = await errorOf(
      fetcher.fetchPage(urlOf('/'), { deadlineMs: 5_000 }),
    );
    expect(error).toBeInstanceOf(ResponseTooLargeError);
  });

  it('counts a chunked body without Content-Length', async () => {
    replies['/'] = {
      headers: { 'content-type': HTML },
      stream: (response) => {
        // Chunked transfer: no Content-Length header at all.
        for (let i = 0; i < 6; i++) response.write(Buffer.alloc(1024 * 1024));
        response.end();
      },
    };
    const error = await errorOf(fetcher.fetchPage(urlOf('/')));
    expect(error).toBeInstanceOf(ResponseTooLargeError);
  });

  it('rejects early when Content-Length already exceeds the limit', async () => {
    replies['/'] = {
      headers: { 'content-type': HTML, 'content-length': 10 * 1024 * 1024 },
      stream: drip,
    };
    const started = performance.now();
    const error = await errorOf(
      fetcher.fetchPage(urlOf('/'), { deadlineMs: 2_000 }),
    );
    expect(error).toBeInstanceOf(ResponseTooLargeError);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('maxBytes option', () => {
  it('applies a smaller limit', async () => {
    replies['/'] = { headers: { 'content-type': HTML }, body: 'x'.repeat(101) };
    await expect(
      fetcher.fetchPage(urlOf('/'), { maxBytes: 101 }),
    ).resolves.toMatchObject({ status: 200 });
    const error = await errorOf(
      fetcher.fetchPage(urlOf('/'), { maxBytes: 100 }),
    );
    expect(error).toBeInstanceOf(ResponseTooLargeError);
  });

  it.each([[MAX_BODY_BYTES + 1], [0], [-1], [1.5], [Number.NaN], [Infinity]])(
    'rejects maxBytes %d as a programming error',
    async (maxBytes) => {
      const error = await errorOf(fetcher.fetchPage(urlOf('/'), { maxBytes }));
      expect(error).toBeInstanceOf(RangeError);
      expect(server.requests).toEqual([]);
    },
  );
});

describe('Charset', () => {
  it('decodes the charset from the Content-Type header', async () => {
    replies['/'] = {
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      body: Buffer.from([0x63, 0x61, 0x66, 0xe9]), // "café" in Latin-1
    };
    const result = await fetcher.fetchPage(urlOf('/'));
    expect(result.body).toBe('café');
  });

  it.each([
    ['text/html; charset="UTF-8"', 'quoted label'],
    ['text/html', 'no charset'],
    ['text/html; charset=x-unknown-label', 'unknown label → UTF-8'],
  ])('decodes UTF-8 for %j (%s)', async (contentType) => {
    replies['/'] = { headers: { 'content-type': contentType }, body: PAGE };
    const result = await fetcher.fetchPage(urlOf('/'));
    expect(result.body).toBe(PAGE);
  });
});

describe('Aborting a redirect body', () => {
  it('closes the redirect connection and the next request still works', async () => {
    replies['/start'] = {
      status: 302,
      headers: { location: '/landed' },
      stream: drip,
    };
    replies['/landed'] = { headers: { 'content-type': HTML }, body: PAGE };

    const result = await fetcher.fetchPage(urlOf('/start'), {
      deadlineMs: 2_000,
    });
    expect(result.body).toBe(PAGE);
    await vi.waitFor(() => expect(closed).toContain('/start'));

    await expect(fetcher.fetchPage(urlOf('/landed'))).resolves.toMatchObject({
      status: 200,
    });
  });

  it('does not mask an error of the next hop', async () => {
    replies['/start'] = {
      status: 302,
      headers: { location: '/reset' },
      stream: drip,
    };
    const error = await errorOf(fetcher.fetchPage(urlOf('/start')));
    expect(error).toBeInstanceOf(UpstreamUnreachableError);
  });

  it('ignores only the expected abort error of a destroyed body', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      ignoreExpectedAbort(new errors.RequestAbortedError());
      expect(warn).not.toHaveBeenCalled();

      const unexpected = new Error('unexpected');
      ignoreExpectedAbort(unexpected);
      expect(warn).toHaveBeenCalledWith(unexpected);
    } finally {
      warn.mockRestore();
    }
  });
});
