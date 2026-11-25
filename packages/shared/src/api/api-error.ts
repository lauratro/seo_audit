/**
 * Machine-readable codes of API error responses. The frontend shows a
 * message per code (docs/adr/0002-safe-fetcher.md, rule 9).
 */
export const API_ERROR_CODES = [
  // 400 — the URL is invalid or blocked by the URL / IP policy
  'INVALID_URL',
  'BLOCKED_URL',
  // 422 — the URL is valid, but the page cannot be audited
  'DOMAIN_NOT_FOUND',
  'TOO_MANY_REDIRECTS',
  'RESPONSE_TOO_LARGE',
  'UNSUPPORTED_CONTENT_TYPE',
  'UNSUPPORTED_CONTENT_ENCODING',
  // 502 — the website could not be reached
  'UPSTREAM_UNREACHABLE',
  // 504 — the website did not respond in time
  'FETCH_TIMEOUT',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Body of every API error response with a code. */
export interface ApiErrorResponse {
  statusCode: number;
  code: ApiErrorCode;
  /** Short, generic, safe to show; never contains URLs or IP addresses. */
  message: string;
}
