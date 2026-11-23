import { describe, expect, it } from 'vitest';

import {
  BlockedUrlError,
  type BlockedUrlReason,
  InvalidUrlError,
} from '../../../src/fetcher/fetcher.errors.js';
import { parseAllowedUrl } from '../../../src/fetcher/url-policy.js';

// Rules: docs/adr/0002-safe-fetcher.md, rules 1–3. Checks run in this order
// and the first failing rule is the reason: scheme → credentials → port →
// host → address.

function errorOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error, but none was thrown');
}

function expectBlocked(
  input: string,
  reason: BlockedUrlReason,
  base?: URL,
): BlockedUrlError {
  const error = errorOf(() => parseAllowedUrl(input, base));
  expect(error).toBeInstanceOf(BlockedUrlError);
  expect(error).toMatchObject({ reason });
  return error as BlockedUrlError;
}

describe('parseAllowedUrl — allowed URLs', () => {
  it.each([
    ['https://example.com/', 'https://example.com/', 'plain https'],
    [
      'http://example.com/page?q=1',
      'http://example.com/page?q=1',
      'plain http with path and query',
    ],
    [
      'https://example.com:443/',
      'https://example.com/',
      'explicit default https port',
    ],
    [
      'http://example.com:80/',
      'http://example.com/',
      'explicit default http port',
    ],
    [
      'https://www.example.co.uk/',
      'https://www.example.co.uk/',
      'several labels',
    ],
    [
      'https://example.com./',
      'https://example.com./',
      'fully qualified name with trailing dot',
    ],
    [
      'https://bücher.example/',
      'https://xn--bcher-kva.example/',
      'internationalised name (punycode)',
    ],
    [
      'https://localhost.example.com/',
      'https://localhost.example.com/',
      '"localhost" as a label, not the suffix',
    ],
    [
      'https://notlocalhost.com/',
      'https://notlocalhost.com/',
      'name ending in "localhost" without a dot before it',
    ],
    [
      'https://site.test/',
      'https://site.test/',
      '.test (used by the SafeFetcher tests)',
    ],
    [
      'https://:@example.com/',
      'https://example.com/',
      'empty credentials (dropped by the URL parser)',
    ],
    ['http://8.8.8.8/', 'http://8.8.8.8/', 'public IPv4 literal'],
    [
      'http://[2001:4860:4860::8888]/',
      'http://[2001:4860:4860::8888]/',
      'public IPv6 literal',
    ],
    [
      'http://[::ffff:8.8.8.8]/',
      'http://[::ffff:808:808]/',
      'IPv4-mapped literal of a public address',
    ],
  ])('allows %s — %s', (input, expectedHref) => {
    expect(parseAllowedUrl(input).href).toBe(expectedHref);
  });
});

describe('parseAllowedUrl — blocked scheme', () => {
  it.each([
    ['ftp://example.com/file'],
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['mailto:a@example.com'],
    ['ws://example.com/'],
    ['gopher://example.com/'],
  ])('blocks %s', (input) => {
    expectBlocked(input, 'scheme');
  });
});

describe('parseAllowedUrl — blocked credentials', () => {
  it.each([
    ['https://user:pass@example.com/'],
    ['https://user@example.com/'],
    ['https://:pass@example.com/'],
  ])('blocks %s', (input) => {
    expectBlocked(input, 'credentials');
  });
});

describe('parseAllowedUrl — blocked port (only the scheme default)', () => {
  it.each([
    ['http://example.com:8080/', 'non-default port'],
    ['https://example.com:8443/', 'non-default port'],
    ['http://example.com:443/', 'https port on http'],
    ['https://example.com:80/', 'http port on https'],
    ['http://example.com:22/', 'SSH port'],
    ['http://example.com:0/', 'port 0'],
    ['http://example.com:65535/', 'highest port'],
  ])('blocks %s — %s', (input) => {
    expectBlocked(input, 'port');
  });
});

describe('parseAllowedUrl — blocked host', () => {
  it.each([
    ['http://localhost/', 'localhost'],
    ['http://LOCALHOST/', 'localhost in uppercase'],
    ['http://localhost./', 'localhost with trailing dot'],
    ['http://foo.localhost/', '*.localhost'],
    ['http://a.b.localhost./', '*.localhost with trailing dot'],
    ['http://intranet/', 'single label'],
    ['http://intranet./', 'single label with trailing dot'],
    ['http://com/', 'single label (a top-level domain)'],
    ['http://./', 'only a dot'],
    // The URL parser keeps empty labels; without a rule for them these
    // would slip past the localhost and single-label checks.
    ['http://localhost../', 'localhost with two trailing dots'],
    ['http://foo.localhost../', '*.localhost with two trailing dots'],
    ['http://intranet../', 'single label with two trailing dots'],
    ['http://a..example.com/', 'empty label in the middle'],
    ['http://.example.com/', 'empty first label'],
  ])('blocks %s — %s', (input) => {
    expectBlocked(input, 'host');
  });
});

describe('parseAllowedUrl — blocked IP literal (checked with the IP policy)', () => {
  it.each([
    ['http://127.0.0.1/', 'loopback'],
    ['http://[::ffff:7f00:1]/', 'IPv4-mapped loopback'],
    ['http://169.254.169.254/', 'cloud metadata'],
    ['http://10.0.0.1/', 'private'],
    ['http://0.0.0.0/', '"this network"'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://[fd00:ec2::254]/', 'AWS IPv6 metadata (unique-local)'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback in dotted form'],
    ['http://[::ffff:a9fe:a9fe]/', 'IPv4-mapped cloud metadata'],
    ['http://[64:ff9b::a9fe:a9fe]/', 'NAT64 embedding cloud metadata'],
    ['http://[2002:7f00:1::1]/', '6to4 embedding loopback'],
    ['http://0x7f.1/', 'hex short form (parsed to 127.0.0.1)'],
    ['http://2130706433/', 'single number (parsed to 127.0.0.1)'],
    ['http://017700000001/', 'octal number (parsed to 127.0.0.1)'],
    ['http://127.0.0.1:80/', 'loopback with explicit default port'],
  ])('blocks %s — %s', (input) => {
    expectBlocked(input, 'address');
  });

  it('does not reveal the address in the error message', () => {
    const error = expectBlocked('http://169.254.169.254/', 'address');
    expect(error.message).not.toContain('169.254');
  });
});

describe('parseAllowedUrl — order of checks', () => {
  it.each([
    ['ftp://user@127.0.0.1:21/', 'scheme' as const],
    ['http://user@localhost:8080/', 'credentials' as const],
    ['http://localhost:8080/', 'port' as const],
    ['http://127.0.0.1:8080/', 'port' as const],
  ])('reports %s as %s', (input, reason) => {
    expectBlocked(input, reason);
  });
});

describe('parseAllowedUrl — invalid input', () => {
  it.each([
    ['', 'empty string'],
    ['not a url', 'not a URL'],
    ['example.com', 'no scheme (normalizeUrl adds one before this point)'],
    ['http://', 'no host'],
    ['https://exa mple.com/', 'space in the host'],
    ['http://[::1/', 'unclosed IPv6 bracket'],
    ['http://256.0.0.1/', 'IPv4 part above 255'],
    ['http://1.2.3.4.5/', 'five numeric parts'],
    ['http://[fe80::1%25eth0]/', 'IPv6 zone ID'],
  ])('rejects %j — %s', (input) => {
    expect(errorOf(() => parseAllowedUrl(input))).toBeInstanceOf(
      InvalidUrlError,
    );
  });
});

describe('parseAllowedUrl — relative input against a base (redirects)', () => {
  const base = new URL('https://example.com/a/b');

  it.each([
    ['/next', 'https://example.com/next', 'absolute path'],
    ['../x', 'https://example.com/x', 'relative path'],
    ['?page=2', 'https://example.com/a/b?page=2', 'query only'],
    ['//other.example/x', 'https://other.example/x', 'protocol-relative'],
    ['https://other.example/', 'https://other.example/', 'absolute URL'],
  ])('resolves %s to %s — %s', (location, expectedHref) => {
    expect(parseAllowedUrl(location, base).href).toBe(expectedHref);
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'address' as const],
    ['//localhost/', 'host' as const],
    ['//127.0.0.1/', 'address' as const],
    ['https://example.com:8443/', 'port' as const],
    ['ftp://example.com/', 'scheme' as const],
    ['https://user@example.com/', 'credentials' as const],
  ])('blocks redirect to %s as %s', (location, reason) => {
    expectBlocked(location, reason, base);
  });

  it('rejects an unparseable redirect target', () => {
    expect(errorOf(() => parseAllowedUrl('http://[::1', base))).toBeInstanceOf(
      InvalidUrlError,
    );
  });
});
