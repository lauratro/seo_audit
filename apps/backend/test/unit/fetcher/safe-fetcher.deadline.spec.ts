import type { ServerResponse } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FetchTimeoutError,
  TooManyRedirectsError,
} from '../../../src/fetcher/fetcher.errors.js';
import type { Resolver } from '../../../src/fetcher/fetch-policy.js';
import {
  MAX_DEADLINE_MS,
  SafeFetcherService,
  toFetcherError,
} from '../../../src/fetcher/service/safe-fetcher.service.js';
import {
  fakeResolver,
  LOOPBACK_V4,
  RELAXED_TEST_POLICY,
  startTestServer,
  type TestServer,
} from '../../support/fetcher-test-kit.js';

// One deadline covers the whole operation: DNS, connect, every redirect hop,
// headers and body (docs/adr/0002-safe-fetcher.md, rule 5). Deadlines are
// injected small, so each test takes well under a second.

const SHORT_DEADLINE_MS = 300;

let server: TestServer;
const fetchers: SafeFetcherService[] = [];

function createFetcher(
  resolver: Resolver = fakeResolver([LOOPBACK_V4]).resolver,
) {
  const fetcher = new SafeFetcherService(RELAXED_TEST_POLICY, resolver);
  fetchers.push(fetcher);
  return fetcher;
}

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

/** Writes one byte every 50 ms and never ends the response. */
function drip(response: ServerResponse): void {
  const timer = setInterval(() => response.write('x'), 50);
  response.on('close', () => clearInterval(timer));
}

beforeEach(async () => {
  server = await startTestServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://placeholder');

    if (url.pathname === '/hang') {
      return; // never sends headers
    }
    if (url.pathname === '/drip') {
      response.writeHead(200, { 'content-type': 'text/html' });
      drip(response);
      return;
    }
    // /slow-hop/N waits 100 ms, then redirects to /slow-hop/N-1
    const slowHop = /^\/slow-hop\/(\d+)$/.exec(url.pathname);
    if (slowHop && Number(slowHop[1]) > 0) {
      setTimeout(() => {
        response.writeHead(302, {
          location: `/slow-hop/${Number(slowHop[1]) - 1}`,
        });
        response.end();
      }, 100);
      return;
    }
    // A redirect whose body never finishes.
    if (url.pathname === '/redirect-drip') {
      response.writeHead(302, { location: '/landed' });
      drip(response);
      return;
    }
    // /chain-drip/N → /chain-drip/N-1, every redirect body never finishes.
    const chainDrip = /^\/chain-drip\/(\d+)$/.exec(url.pathname);
    if (chainDrip && Number(chainDrip[1]) > 0) {
      response.writeHead(302, {
        location: `/chain-drip/${Number(chainDrip[1]) - 1}`,
      });
      drip(response);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>ok</title>');
  });
});

afterEach(async () => {
  await Promise.all(fetchers.splice(0).map((f) => f.onModuleDestroy()));
  await server.close();
});

describe('SafeFetcherService — deadline option', () => {
  it('uses 10 seconds as the default and maximum deadline', () => {
    expect(MAX_DEADLINE_MS).toBe(10_000);
  });

  it.each([[10_001], [60_000], [0], [-1], [Number.NaN], [Infinity]])(
    'rejects deadlineMs %d as a programming error',
    async (deadlineMs) => {
      const error = await errorOf(
        createFetcher().fetchPage(urlOf('/'), { deadlineMs }),
      );
      expect(error).toBeInstanceOf(RangeError);
      expect(server.requests).toEqual([]);
    },
  );

  it('accepts a shorter deadline and the maximum', async () => {
    const fetcher = createFetcher();
    await expect(
      fetcher.fetchPage(urlOf('/'), { deadlineMs: SHORT_DEADLINE_MS }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      fetcher.fetchPage(urlOf('/'), { deadlineMs: MAX_DEADLINE_MS }),
    ).resolves.toMatchObject({ status: 200 });
  });
});

describe('SafeFetcherService — the deadline covers the whole operation', () => {
  async function expectTimeout(path: string, resolver?: Resolver) {
    const started = performance.now();
    const error = await errorOf(
      createFetcher(resolver).fetchPage(urlOf(path), {
        deadlineMs: SHORT_DEADLINE_MS,
      }),
    );
    expect(error).toBeInstanceOf(FetchTimeoutError);
    // Generous upper bound: it must end near the deadline, not hang.
    expect(performance.now() - started).toBeLessThan(SHORT_DEADLINE_MS + 700);
  }

  it('times out while waiting for DNS', async () => {
    const neverResolves: Resolver = () => new Promise(() => {});
    await expectTimeout('/', neverResolves);
    expect(server.requests).toEqual([]);
  });

  it('times out while waiting for response headers', async () => {
    await expectTimeout('/hang');
  });

  it('times out while reading a slow body', async () => {
    await expectTimeout('/drip');
  });

  it('times out on a redirect chain that exceeds the total deadline', async () => {
    // 5 hops × 100 ms: every single request is well within 300 ms, but the
    // chain as a whole is not. A per-request timeout would let this pass.
    await expectTimeout('/slow-hop/5');
    expect(server.requests.length).toBeLessThan(6);
  });
});

describe('SafeFetcherService — redirect bodies are not downloaded', () => {
  it('follows a redirect whose body never finishes without waiting for it', async () => {
    const started = performance.now();
    const result = await createFetcher().fetchPage(urlOf('/redirect-drip'), {
      deadlineMs: 2_000,
    });

    expect(result.finalUrl.href).toBe(urlOf('/landed'));
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('stops at the redirect limit without waiting for the last body', async () => {
    const started = performance.now();
    const error = await errorOf(
      createFetcher().fetchPage(urlOf('/chain-drip/6'), { deadlineMs: 2_000 }),
    );

    expect(error).toBeInstanceOf(TooManyRedirectsError);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('toFetcherError — undici timeouts', () => {
  it.each([
    ['UND_ERR_CONNECT_TIMEOUT'],
    ['UND_ERR_HEADERS_TIMEOUT'],
    ['UND_ERR_BODY_TIMEOUT'],
  ])('maps %s to FetchTimeoutError', (code) => {
    const error = Object.assign(new Error('timeout'), { code });
    expect(toFetcherError(error)).toBeInstanceOf(FetchTimeoutError);
  });
});
