import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BlockedUrlError,
  DomainNotFoundError,
  UpstreamUnreachableError,
} from '../../../src/fetcher/fetcher.errors.js';
import {
  type FetchPolicy,
  type Resolver,
  STRICT_FETCH_POLICY,
} from '../../../src/fetcher/fetch-policy.js';
import {
  SafeFetcherService,
  USER_AGENT,
} from '../../../src/fetcher/service/safe-fetcher.service.js';
import {
  fakeResolver,
  LOOPBACK_V4,
  LOOPBACK_V6,
  RELAXED_TEST_POLICY,
  startTestServer,
  STRICT_ADDRESS_TEST_POLICY,
  type TestServer,
} from '../../support/fetcher-test-kit.js';

// Integration tests with the real undici Agent, a fake resolver and a local
// server. No request leaves the machine: hostnames are .test (RFC 6761) and
// the fake resolver never calls real DNS.

let server: TestServer;
const fetchers: SafeFetcherService[] = [];

function createFetcher(policy: FetchPolicy, resolver: Resolver) {
  const fetcher = new SafeFetcherService(policy, resolver);
  fetchers.push(fetcher);
  return fetcher;
}

function urlOf(path = '/', host = 'site.test'): string {
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
  server = await startTestServer((request, response) => {
    if (request.url === '/not-found') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('missing');
      return;
    }
    if (request.url === '/server-error') {
      response.writeHead(500, { 'content-type': 'text/html' });
      response.end('<h1>error</h1>');
      return;
    }
    // Close after each response, so every request needs a new connection
    // and therefore a new DNS lookup (needed for the rebinding test).
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'x-test': 'yes',
      connection: 'close',
      'user-agent-seen': request.headers['user-agent'] ?? '',
    });
    response.end('<!doctype html><title>Test page</title>');
  });
});

afterEach(async () => {
  await Promise.all(fetchers.splice(0).map((f) => f.onModuleDestroy()));
  await server.close();
});

describe('SafeFetcherService — allowed request', () => {
  it('fetches a page through the address returned by the safe lookup', async () => {
    const dns = fakeResolver([LOOPBACK_V4]);
    const fetcher = createFetcher(RELAXED_TEST_POLICY, dns.resolver);

    const result = await fetcher.fetchPage(urlOf('/page'));

    expect(result.status).toBe(200);
    expect(result.body).toBe('<!doctype html><title>Test page</title>');
    expect(result.headers['x-test']).toBe('yes');
    expect(result.finalUrl.href).toBe(urlOf('/page'));
    // "site.test" exists in no real DNS: reaching the server proves the
    // socket used the address our lookup returned.
    expect(dns.calls).toEqual(['site.test']);
    expect(server.requests).toEqual(['::ffff:127.0.0.1']);
  });

  it('sends the identifiable User-Agent', async () => {
    const fetcher = createFetcher(
      RELAXED_TEST_POLICY,
      fakeResolver([LOOPBACK_V4]).resolver,
    );
    const result = await fetcher.fetchPage(urlOf());
    expect(USER_AGENT).toBe(
      'SEOAuditTool/0.1 (+https://github.com/lauratro/seo_audit)',
    );
    expect(result.headers['user-agent-seen']).toBe(USER_AGENT);
  });

  it.each([
    ['/not-found', 404],
    ['/server-error', 500],
  ])('returns %s (HTTP %i) as a result, not an error', async (path, status) => {
    const fetcher = createFetcher(
      RELAXED_TEST_POLICY,
      fakeResolver([LOOPBACK_V4]).resolver,
    );
    const result = await fetcher.fetchPage(urlOf(path));
    expect(result.status).toBe(status);
  });
});

describe('SafeFetcherService — blocked addresses never reach the server', () => {
  it.each([
    [
      [LOOPBACK_V4],
      STRICT_ADDRESS_TEST_POLICY,
      'loopback under the strict address policy',
    ],
    [
      [LOOPBACK_V6],
      RELAXED_TEST_POLICY,
      'IPv6 loopback (blocked, but reachable)',
    ],
    [
      [{ address: '10.0.0.1', family: 4 as const }],
      RELAXED_TEST_POLICY,
      'private address',
    ],
    [
      [{ address: '169.254.169.254', family: 4 as const }],
      RELAXED_TEST_POLICY,
      'cloud metadata',
    ],
    [
      [LOOPBACK_V4, LOOPBACK_V6],
      RELAXED_TEST_POLICY,
      'mixed: allowed first, then blocked',
    ],
    [
      [LOOPBACK_V6, LOOPBACK_V4],
      RELAXED_TEST_POLICY,
      'mixed: blocked first, then allowed',
    ],
  ])('blocks %j — %s', async (answer, policy) => {
    const dns = fakeResolver(answer);
    const fetcher = createFetcher(policy, dns.resolver);

    const error = await errorOf(fetcher.fetchPage(urlOf()));

    expect(error).toBeInstanceOf(BlockedUrlError);
    expect(error).toMatchObject({ reason: 'address' });
    expect(dns.calls).toEqual(['site.test']);
    expect(server.requests).toEqual([]);
  });

  it('blocks DNS rebinding: a new connection re-checks the new answer', async () => {
    // Same hostname, first answer allowed, second answer blocked but reachable.
    const dns = fakeResolver([LOOPBACK_V4], [LOOPBACK_V6]);
    const fetcher = createFetcher(RELAXED_TEST_POLICY, dns.resolver);

    const first = await fetcher.fetchPage(urlOf('/first'));
    const second = await errorOf(fetcher.fetchPage(urlOf('/second')));

    expect(first.status).toBe(200);
    expect(second).toBeInstanceOf(BlockedUrlError);
    expect(dns.calls).toEqual(['site.test', 'site.test']);
    expect(server.requests).toEqual(['::ffff:127.0.0.1']);
  });
});

describe('SafeFetcherService — URL policy runs before DNS', () => {
  it.each([
    ['http://localhost:{port}/', 'host'],
    ['ftp://site.test/', 'scheme'],
    ['http://user@site.test:{port}/', 'credentials'],
    ['http://127.0.0.1:{port}/', 'address'],
  ])('blocks %s as %s without resolving', async (template, reason) => {
    const dns = fakeResolver([LOOPBACK_V4]);
    const fetcher = createFetcher(RELAXED_TEST_POLICY, dns.resolver);
    const url = template.replace('{port}', String(server.port));

    const error = await errorOf(fetcher.fetchPage(url));

    expect(error).toBeInstanceOf(BlockedUrlError);
    expect(error).toMatchObject({ reason });
    expect(dns.calls).toEqual([]);
    expect(server.requests).toEqual([]);
  });

  it('the strict production policy cannot reach the test server', async () => {
    const dns = fakeResolver([LOOPBACK_V4]);
    const fetcher = createFetcher(STRICT_FETCH_POLICY, dns.resolver);

    const error = await errorOf(fetcher.fetchPage(urlOf()));

    expect(error).toBeInstanceOf(BlockedUrlError);
    expect(error).toMatchObject({ reason: 'port' });
    expect(server.requests).toEqual([]);
  });
});

describe('SafeFetcherService — connection failures', () => {
  it('maps a domain that does not exist to DomainNotFoundError', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    });
    const fetcher = createFetcher(
      RELAXED_TEST_POLICY,
      fakeResolver(notFound).resolver,
    );
    const error = await errorOf(fetcher.fetchPage(urlOf()));
    expect(error).toBeInstanceOf(DomainNotFoundError);
  });

  it('maps a refused connection to UpstreamUnreachableError', async () => {
    const port = server.port;
    await server.close();
    server = await startTestServer(); // replaced so afterEach can close it
    const fetcher = createFetcher(
      RELAXED_TEST_POLICY,
      fakeResolver([LOOPBACK_V4]).resolver,
    );

    const error = await errorOf(fetcher.fetchPage(`http://site.test:${port}/`));

    expect(error).toBeInstanceOf(UpstreamUnreachableError);
  });
});
