import { describe, expect, it } from 'vitest';

import { normalizeUrl } from '../../src/url/normalize-url.js';

describe('normalizeUrl', () => {
  it.each([
    [
      'trims surrounding whitespace',
      '  https://example.com/a \n',
      'https://example.com/a',
    ],
    [
      'adds https:// when the scheme is missing',
      'example.com/page',
      'https://example.com/page',
    ],
    [
      'keeps an explicit http scheme',
      'http://example.com/',
      'http://example.com/',
    ],
    [
      'lowercases scheme and host',
      'HTTPS://WWW.Example.COM/',
      'https://www.example.com/',
    ],
    [
      'keeps the case of the path',
      'https://example.com/About/Team',
      'https://example.com/About/Team',
    ],
    [
      'adds "/" when the path is empty',
      'https://example.com',
      'https://example.com/',
    ],
    [
      'keeps a trailing slash as given',
      'https://example.com/blog/',
      'https://example.com/blog/',
    ],
    [
      'drops the default https port',
      'https://example.com:443/a',
      'https://example.com/a',
    ],
    [
      'drops the default http port',
      'http://example.com:80/a',
      'http://example.com/a',
    ],
    [
      'keeps a non-default port',
      'https://example.com:8443/a',
      'https://example.com:8443/a',
    ],
    [
      'drops the fragment',
      'https://example.com/page#section',
      'https://example.com/page',
    ],
    [
      'keeps query parameters and their order',
      'https://example.com/?b=2&a=1&utm_source=x',
      'https://example.com/?b=2&a=1&utm_source=x',
    ],
    [
      'drops an empty query',
      'https://example.com/page?',
      'https://example.com/page',
    ],
    [
      'resolves dot segments in the path',
      'https://example.com/a/../b',
      'https://example.com/b',
    ],
    [
      'converts an internationalised host to punycode',
      'https://bücher.example/',
      'https://xn--bcher-kva.example/',
    ],
    // Security is not this function's job: SafeFetcher rejects these later.
    ['does not block localhost', 'localhost:3000', 'https://localhost:3000/'],
    [
      'does not strip credentials',
      'https://user:pass@example.com/',
      'https://user:pass@example.com/',
    ],
  ])('%s', (_name, input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a scheme without a host', 'http://'],
    ['a host with a space', 'https://exa mple.com'],
    ['a non-http scheme', 'ftp://example.com/file'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('returns null for %s', (_name, input) => {
    expect(normalizeUrl(input)).toBeNull();
  });
});
