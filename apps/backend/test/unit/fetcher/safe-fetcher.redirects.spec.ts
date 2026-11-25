import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BlockedUrlError,
  InvalidUrlError,
  TooManyRedirectsError,
} from '../../../src/fetcher/fetcher.errors.js';
import { SafeFetcherService } from '../../../src/fetcher/service/safe-fetcher.service.js';
import {
  fakeResolver,
  LOOPBACK_V4,
  LOOPBACK_V6,
  RELAXED_TEST_POLICY,
  startTestServer,
  type TestServer,
} from '../../support/fetcher-test-kit.js';

// Redirects are followed manually: at most 5, and every target passes the
// full URL policy again; a new host is resolved and checked by the safe
// lookup (docs/adr/0002-safe-fetcher.md, rule 4).

let server: TestServer;
let fetcher: SafeFetcherService;
let dns: ReturnType<typeof fakeResolver>;
/** Paths the server received, in order. */
let paths: string[];

function urlOf(path: string, host = 'site.test'): string {
  return `http://${host}:${server.port}${path}`;
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected an error, but none was thrown');
}

beforeEach(async () => {
  paths = [];
  server = await startTestServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://placeholder');
    paths.push(url.pathname + url.search);

    // /status/301 → redirects with that status to /landed
    const statusMatch = /^\/status\/(\d{3})$/.exec(url.pathname);
    if (statusMatch) {
      response.writeHead(Number(statusMatch[1]), { location: '/landed' });
      response.end('redirect body that must be discarded');
      return;
    }
    // /chain/3 → /chain/2 → /chain/1 → /chain/0 (200)
    const chainMatch = /^\/chain\/(\d+)$/.exec(url.pathname);
    if (chainMatch && Number(chainMatch[1]) > 0) {
      response.writeHead(302, {
        location: `/chain/${Number(chainMatch[1]) - 1}`,
      });
      response.end();
      return;
    }
    // /to?location=... → redirects to the given Location value as is
    if (url.pathname === '/to') {
      response.writeHead(302, {
        location: url.searchParams.get('location') ?? '',
      });
      response.end();
      return;
    }
    if (url.pathname === '/no-location') {
      response.writeHead(302);
      response.end();
      return;
    }
    if (url.pathname === '/loop') {
      response.writeHead(302, { location: '/loop' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<title>${url.pathname}</title>`);
  });
  dns = fakeResolver([LOOPBACK_V4]);
  fetcher = new SafeFetcherService(RELAXED_TEST_POLICY, dns.resolver);
});

afterEach(async () => {
  await fetcher.onModuleDestroy();
  await server.close();
});

function to(location: string): string {
  return urlOf(`/to?location=${encodeURIComponent(location)}`);
}

describe('SafeFetcherService — following redirects', () => {
  it.each([[301], [302], [303], [307], [308]])(
    'follows HTTP %i to the Location and records the hop',
    async (status) => {
      const result = await fetcher.fetchPage(urlOf(`/status/${status}`));

      expect(result.status).toBe(200);
      expect(result.body).toBe('<title>/landed</title>');
      expect(result.finalUrl.href).toBe(urlOf('/landed'));
      expect(result.redirects).toEqual([
        { url: urlOf(`/status/${status}`), status },
      ]);
      expect(paths).toEqual([`/status/${status}`, '/landed']);
    },
  );

  it.each([
    ['/landed', 'absolute path'],
    ['landed', 'relative path'],
    ['//site.test:{port}/landed', 'protocol-relative'],
    ['http://site.test:{port}/landed', 'absolute URL'],
  ])(
    'resolves a %s Location against the current URL (%s)',
    async (location) => {
      const result = await fetcher.fetchPage(
        to(location.replace('{port}', String(server.port))),
      );
      expect(result.finalUrl.href).toBe(urlOf('/landed'));
    },
  );

  it('follows exactly 5 redirects', async () => {
    const result = await fetcher.fetchPage(urlOf('/chain/5'));

    expect(result.status).toBe(200);
    expect(result.finalUrl.href).toBe(urlOf('/chain/0'));
    expect(result.redirects.map((hop) => hop.url)).toEqual(
      [5, 4, 3, 2, 1].map((n) => urlOf(`/chain/${n}`)),
    );
    expect(paths).toHaveLength(6);
  });

  it('rejects a 6th redirect without requesting its target', async () => {
    const error = await errorOf(fetcher.fetchPage(urlOf('/chain/6')));

    expect(error).toBeInstanceOf(TooManyRedirectsError);
    expect(paths).toEqual([6, 5, 4, 3, 2, 1].map((n) => `/chain/${n}`));
  });

  it('stops a redirect loop', async () => {
    const error = await errorOf(fetcher.fetchPage(urlOf('/loop')));
    expect(error).toBeInstanceOf(TooManyRedirectsError);
    expect(paths).toHaveLength(6);
  });

  it('returns a 3xx without Location as the final result', async () => {
    const result = await fetcher.fetchPage(urlOf('/no-location'));
    expect(result.status).toBe(302);
    expect(result.redirects).toEqual([]);
  });

  it('returns no redirects for a direct response', async () => {
    const result = await fetcher.fetchPage(urlOf('/page'));
    expect(result.redirects).toEqual([]);
    expect(result.finalUrl.href).toBe(urlOf('/page'));
  });
});

describe('SafeFetcherService — every redirect target is re-checked', () => {
  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'address', 'cloud metadata'],
    ['http://127.0.0.1/', 'address', 'loopback IP literal'],
    ['http://[::1]/', 'address', 'IPv6 loopback literal'],
    ['http://localhost:{port}/', 'host', 'localhost'],
    ['http://intranet:{port}/', 'host', 'single-label host'],
    ['ftp://site.test/file', 'scheme', 'non-http scheme'],
    ['file:///etc/passwd', 'scheme', 'local file'],
    ['http://user:pass@site.test:{port}/', 'credentials', 'credentials'],
  ])('blocks a redirect to %s as %s (%s)', async (location, reason) => {
    const error = await errorOf(
      fetcher.fetchPage(to(location.replace('{port}', String(server.port)))),
    );

    expect(error).toBeInstanceOf(BlockedUrlError);
    expect(error).toMatchObject({ reason });
    // Only the redirecting request reached the server.
    expect(paths).toHaveLength(1);
  });

  it('blocks a redirect to a host whose DNS answer is blocked', async () => {
    // site.test → allowed; other.test → ::1 (blocked, but reachable).
    dns = fakeResolver([LOOPBACK_V4], [LOOPBACK_V6]);
    await fetcher.onModuleDestroy();
    fetcher = new SafeFetcherService(RELAXED_TEST_POLICY, dns.resolver);

    const error = await errorOf(
      fetcher.fetchPage(to(urlOf('/landed', 'other.test'))),
    );

    expect(error).toBeInstanceOf(BlockedUrlError);
    expect(error).toMatchObject({ reason: 'address' });
    expect(dns.calls).toEqual(['site.test', 'other.test']);
    expect(paths).toHaveLength(1);
  });

  it('rejects an unparseable redirect target', async () => {
    const error = await errorOf(fetcher.fetchPage(to('http://[::1')));
    expect(error).toBeInstanceOf(InvalidUrlError);
  });
});
