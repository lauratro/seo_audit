import type { ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FetchTimeoutError,
  ResponseTooLargeError,
  TooManyRedirectsError,
  UnsupportedContentEncodingError,
  UnsupportedContentTypeError,
  UpstreamUnreachableError,
} from '../../../src/fetcher/fetcher.errors.js';
import { SafeFetcherService } from '../../../src/fetcher/service/safe-fetcher.service.js';
import {
  fakeResolver,
  LOOPBACK_V4,
  RELAXED_TEST_POLICY,
  startTestServer,
  type TestServer,
} from '../../support/fetcher-test-kit.js';

// Every failure must release its response stream and close the connection:
// no socket may stay open waiting for a body nobody reads. Each response
// below would keep its connection open forever (it drips and never ends),
// so a connection that closes proves the stream was cleaned up.

const HTML = 'text/html';

let server: TestServer;
let fetcher: SafeFetcherService;

function urlOf(path: string): string {
  return `http://site.test:${server.port}${path}`;
}

/** Sends headers, then one byte every 50 ms, and never ends. */
function dripAfter(
  status: number,
  headers: Record<string, string | number>,
  first: Buffer | string = 'x',
) {
  return (response: ServerResponse) => {
    response.writeHead(status, headers);
    response.write(first);
    const timer = setInterval(() => response.write('x'), 50);
    response.on('close', () => clearInterval(timer));
  };
}

const routes: Record<string, (response: ServerResponse) => void> = {
  '/wrong-type': dripAfter(200, { 'content-type': 'application/pdf' }),
  '/wrong-encoding': dripAfter(200, {
    'content-type': HTML,
    'content-encoding': 'compress',
  }),
  '/too-long': dripAfter(200, {
    'content-type': HTML,
    'content-length': 10 * 1024 * 1024,
  }),
  '/corrupt-gzip': dripAfter(
    200,
    { 'content-type': HTML, 'content-encoding': 'gzip' },
    'not gzip data at all',
  ),
  '/too-large': dripAfter(
    200,
    { 'content-type': HTML },
    Buffer.alloc(64 * 1024, 'a'),
  ),
  '/slow-body': dripAfter(200, { 'content-type': HTML }),
  '/hang': () => {
    // never sends headers
  },
  '/error-status': dripAfter(500, { 'content-type': HTML }),
  '/redirect-loop': dripAfter(302, { location: '/redirect-loop' }),
};

beforeEach(async () => {
  server = await startTestServer((request, response) => {
    const route = routes[request.url ?? ''];
    if (route) {
      route(response);
      return;
    }
    response.writeHead(200, { 'content-type': HTML });
    response.end(gzipSync('unused'));
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

async function expectConnectionsClosed(): Promise<void> {
  await vi.waitFor(() => expect(server.openConnections()).toBe(0), {
    timeout: 1_000,
  });
}

describe('SafeFetcherService — streams are cleaned up after failures', () => {
  it.each([
    ['/wrong-type', UnsupportedContentTypeError, {}],
    ['/wrong-encoding', UnsupportedContentEncodingError, {}],
    ['/too-long', ResponseTooLargeError, {}],
    ['/corrupt-gzip', UpstreamUnreachableError, {}],
    ['/too-large', ResponseTooLargeError, { maxBytes: 1024 }],
    ['/slow-body', FetchTimeoutError, { deadlineMs: 300 }],
    ['/hang', FetchTimeoutError, { deadlineMs: 300 }],
    ['/redirect-loop', TooManyRedirectsError, {}],
  ])('closes the connection after %s', async (path, errorClass, options) => {
    await expect(
      fetcher.fetchPage(urlOf(path), options),
    ).rejects.toBeInstanceOf(errorClass);
    await expectConnectionsClosed();
  });

  it('closes the connection after a non-2xx result', async () => {
    const result = await fetcher.fetchPage(urlOf('/error-status'));
    expect(result).toMatchObject({ status: 500, body: null });
    await expectConnectionsClosed();
  });

  it('closes every connection of a redirect chain', async () => {
    await expect(
      fetcher.fetchPage(urlOf('/redirect-loop')),
    ).rejects.toBeInstanceOf(TooManyRedirectsError);
    // 6 requests, each with a body that never ends.
    expect(server.requests).toHaveLength(6);
    await expectConnectionsClosed();
  });
});
