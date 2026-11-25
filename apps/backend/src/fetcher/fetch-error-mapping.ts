import type { ApiErrorCode, ApiErrorResponse } from '@seo-audit/shared';

import {
  BlockedUrlError,
  DomainNotFoundError,
  type FetcherError,
  FetchTimeoutError,
  InvalidUrlError,
  ResponseTooLargeError,
  TooManyRedirectsError,
  UnsupportedContentEncodingError,
  UnsupportedContentTypeError,
  UpstreamUnreachableError,
} from './fetcher.errors.js';

type ErrorClass = abstract new (...args: never[]) => FetcherError;

// docs/adr/0002-safe-fetcher.md, rule 9.
const MAPPINGS: readonly [ErrorClass, number, ApiErrorCode][] = [
  [InvalidUrlError, 400, 'INVALID_URL'],
  [BlockedUrlError, 400, 'BLOCKED_URL'],
  [DomainNotFoundError, 422, 'DOMAIN_NOT_FOUND'],
  [TooManyRedirectsError, 422, 'TOO_MANY_REDIRECTS'],
  [ResponseTooLargeError, 422, 'RESPONSE_TOO_LARGE'],
  [UnsupportedContentTypeError, 422, 'UNSUPPORTED_CONTENT_TYPE'],
  [UnsupportedContentEncodingError, 422, 'UNSUPPORTED_CONTENT_ENCODING'],
  [UpstreamUnreachableError, 502, 'UPSTREAM_UNREACHABLE'],
  [FetchTimeoutError, 504, 'FETCH_TIMEOUT'],
];

/**
 * Maps a typed SafeFetcher error to its HTTP status and API body. Pure: no
 * HTTP objects involved. The body contains only the error's fixed, generic
 * message — never its cause, stack, the URL or an IP address. Returns
 * undefined for a FetcherError without a mapping.
 */
export function toApiError(error: FetcherError): ApiErrorResponse | undefined {
  const mapping = MAPPINGS.find(([errorClass]) => error instanceof errorClass);
  if (!mapping) {
    return undefined;
  }
  const [, statusCode, code] = mapping;
  return { statusCode, code, message: error.message };
}
