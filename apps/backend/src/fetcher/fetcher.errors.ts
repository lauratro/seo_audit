// Typed errors thrown by the fetcher. They know nothing about HTTP: the
// exception filter at the API boundary maps them to status codes
// (docs/adr/0002-safe-fetcher.md, rule 9). Messages are generic and never
// contain the URL or an IP address.

/** Base class of every error the fetcher throws on purpose. */
export class FetcherError extends Error {}

/** The input cannot be parsed as a URL. */
export class InvalidUrlError extends FetcherError {
  constructor(options?: ErrorOptions) {
    super('The URL is not valid.', options);
    this.name = 'InvalidUrlError';
  }
}

/** Which URL policy rule blocked the URL (ADR 0002, rules 1–3). */
export type BlockedUrlReason =
  'scheme' | 'credentials' | 'port' | 'host' | 'address';

const BLOCKED_URL_MESSAGES: Record<BlockedUrlReason, string> = {
  scheme: 'Only http and https URLs are allowed.',
  credentials: 'URLs with a username or password are not allowed.',
  port: 'Only the default port of the scheme is allowed.',
  host: 'This host is not allowed.',
  address: 'This address is not allowed.',
};

/** The domain does not exist or has no addresses (ENOTFOUND, ENODATA). */
export class DomainNotFoundError extends FetcherError {
  constructor(options?: ErrorOptions) {
    super('The domain could not be found.', options);
    this.name = 'DomainNotFoundError';
  }
}

/**
 * The target could not be reached: temporary DNS failure, connection
 * refused or reset, TLS error.
 */
export class UpstreamUnreachableError extends FetcherError {
  constructor(options?: ErrorOptions) {
    super('The website could not be reached.', options);
    this.name = 'UpstreamUnreachableError';
  }
}

/** The page redirected more often than allowed (max 5, ADR 0002 rule 4). */
export class TooManyRedirectsError extends FetcherError {
  constructor() {
    super('The page redirected too many times.');
    this.name = 'TooManyRedirectsError';
  }
}

/** The fetch did not finish within its deadline (ADR 0002 rule 5). */
export class FetchTimeoutError extends FetcherError {
  constructor(options?: ErrorOptions) {
    super('The website did not respond in time.', options);
    this.name = 'FetchTimeoutError';
  }
}

/** The decoded body is larger than the limit (ADR 0002 rule 6). */
export class ResponseTooLargeError extends FetcherError {
  constructor() {
    super('The page is too large.');
    this.name = 'ResponseTooLargeError';
  }
}

/** The final response is not text/html, or has no Content-Type (rule 7). */
export class UnsupportedContentTypeError extends FetcherError {
  constructor() {
    super('The URL does not point to an HTML page.');
    this.name = 'UnsupportedContentTypeError';
  }
}

/** The Content-Encoding is unknown or stacked (rule 6). */
export class UnsupportedContentEncodingError extends FetcherError {
  constructor() {
    super('The page uses an unsupported content encoding.');
    this.name = 'UnsupportedContentEncodingError';
  }
}

/** The URL is valid but not allowed by the URL policy. */
export class BlockedUrlError extends FetcherError {
  readonly reason: BlockedUrlReason;

  constructor(reason: BlockedUrlReason) {
    super(BLOCKED_URL_MESSAGES[reason]);
    this.name = 'BlockedUrlError';
    this.reason = reason;
  }
}
