import type { ApiErrorCode } from '@seo-audit/shared';
import { describe, expect, it } from 'vitest';

import { toApiError } from '../../../src/fetcher/fetch-error-mapping.js';
import * as fetcherErrors from '../../../src/fetcher/fetcher.errors.js';
import {
  BlockedUrlError,
  DomainNotFoundError,
  FetcherError,
  FetchTimeoutError,
  InvalidUrlError,
  ResponseTooLargeError,
  TooManyRedirectsError,
  UnsupportedContentEncodingError,
  UnsupportedContentTypeError,
  UpstreamUnreachableError,
} from '../../../src/fetcher/fetcher.errors.js';

// Typed SafeFetcher errors → HTTP status and API body, following the table
// in docs/adr/0002-safe-fetcher.md, rule 9.

// A cause containing an internal address, as a real network error would.
const internalCause = new Error('connect ECONNREFUSED 10.0.0.5:80');

const CASES: [FetcherError, number, ApiErrorCode][] = [
  [new InvalidUrlError({ cause: internalCause }), 400, 'INVALID_URL'],
  [new BlockedUrlError('scheme'), 400, 'BLOCKED_URL'],
  [new BlockedUrlError('credentials'), 400, 'BLOCKED_URL'],
  [new BlockedUrlError('port'), 400, 'BLOCKED_URL'],
  [new BlockedUrlError('host'), 400, 'BLOCKED_URL'],
  [new BlockedUrlError('address'), 400, 'BLOCKED_URL'],
  [new DomainNotFoundError({ cause: internalCause }), 422, 'DOMAIN_NOT_FOUND'],
  [new TooManyRedirectsError(), 422, 'TOO_MANY_REDIRECTS'],
  [new ResponseTooLargeError(), 422, 'RESPONSE_TOO_LARGE'],
  [new UnsupportedContentTypeError(), 422, 'UNSUPPORTED_CONTENT_TYPE'],
  [new UnsupportedContentEncodingError(), 422, 'UNSUPPORTED_CONTENT_ENCODING'],
  [
    new UpstreamUnreachableError({ cause: internalCause }),
    502,
    'UPSTREAM_UNREACHABLE',
  ],
  [new FetchTimeoutError({ cause: internalCause }), 504, 'FETCH_TIMEOUT'],
];

describe('toApiError', () => {
  it.each(CASES)('maps %s to HTTP %i %s', (error, statusCode, code) => {
    expect(toApiError(error)).toEqual({
      statusCode,
      code,
      message: error.message,
    });
  });

  it.each(CASES)('reveals no internal details for %s', (error) => {
    const body = JSON.stringify(toApiError(error));
    expect(body).not.toContain('10.0.0.5');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toMatch(/stack|cause/i);
    expect(Object.keys(toApiError(error) ?? {}).sort()).toEqual([
      'code',
      'message',
      'statusCode',
    ]);
  });

  it('gives each blocked-URL reason its own generic message', () => {
    const messages = new Set(
      (['scheme', 'credentials', 'port', 'host', 'address'] as const).map(
        (reason) => toApiError(new BlockedUrlError(reason))?.message,
      ),
    );
    expect(messages.size).toBe(5);
  });

  it('maps every exported FetcherError subclass', () => {
    // Guards future additions: a new error class must get a mapping.
    const subclasses = Object.values(fetcherErrors).filter(
      (value) =>
        typeof value === 'function' &&
        value !== FetcherError &&
        value.prototype instanceof FetcherError,
    ) as (typeof FetcherError)[];
    expect(subclasses.length).toBeGreaterThanOrEqual(9);
    for (const subclass of subclasses) {
      const error = Object.create(subclass.prototype) as FetcherError;
      expect(toApiError(error), subclass.name).toBeDefined();
    }
  });

  it('returns undefined for an unknown FetcherError', () => {
    class UnknownFetcherError extends FetcherError {}
    expect(toApiError(new UnknownFetcherError('x'))).toBeUndefined();
  });
});
