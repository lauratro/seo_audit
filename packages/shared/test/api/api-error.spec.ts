import { describe, expect, it } from 'vitest';

import { API_ERROR_CODES } from '../../src/api/api-error.js';

describe('API_ERROR_CODES', () => {
  it('contains the SafeFetcher error codes of ADR 0002', () => {
    expect([...API_ERROR_CODES].sort()).toEqual(
      [
        'BLOCKED_URL',
        'DOMAIN_NOT_FOUND',
        'FETCH_TIMEOUT',
        'INVALID_URL',
        'RESPONSE_TOO_LARGE',
        'TOO_MANY_REDIRECTS',
        'UNSUPPORTED_CONTENT_ENCODING',
        'UNSUPPORTED_CONTENT_TYPE',
        'UPSTREAM_UNREACHABLE',
      ].sort(),
    );
  });

  it('contains no duplicates', () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it('uses UPPER_SNAKE_CASE codes only', () => {
    for (const code of API_ERROR_CODES) {
      expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });
});
