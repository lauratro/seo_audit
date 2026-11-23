// Typed errors thrown by the fetcher. They know nothing about HTTP: the
// exception filter at the API boundary maps them to status codes
// (docs/adr/0002-safe-fetcher.md, rule 9). Messages are generic and never
// contain the URL or an IP address.

/** The input cannot be parsed as a URL. */
export class InvalidUrlError extends Error {
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

/** The URL is valid but not allowed by the URL policy. */
export class BlockedUrlError extends Error {
  readonly reason: BlockedUrlReason;

  constructor(reason: BlockedUrlReason) {
    super(BLOCKED_URL_MESSAGES[reason]);
    this.name = 'BlockedUrlError';
    this.reason = reason;
  }
}
