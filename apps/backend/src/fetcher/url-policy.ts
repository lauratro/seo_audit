import { isIPv4 } from 'node:net';

import { BlockedUrlError, InvalidUrlError } from './fetcher.errors.js';
import { isAllowedAddress } from './ip-policy.js';

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Parses `input` (resolved against `base` for redirect targets) and applies
 * the URL policy of docs/adr/0002-safe-fetcher.md, rules 1–3. Rules run in
 * this order and the first failing one is the reason:
 * scheme → credentials → port → host → address.
 *
 * Relies on WHATWG URL parsing for normalisation: lowercase, punycode host;
 * canonical IPv4 ("0x7f.1" → "127.0.0.1"); bracketed canonical IPv6; default
 * port dropped. DNS is not resolved here: resolved addresses are checked at
 * connection time.
 *
 * @throws InvalidUrlError if the input cannot be parsed
 * @throws BlockedUrlError if a policy rule rejects the URL
 */
export function parseAllowedUrl(input: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch (error) {
    throw new InvalidUrlError({ cause: error });
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError('scheme');
  }

  // Limitation: empty credentials ("https://:@example.com/") are dropped by
  // the URL parser, so they never reach this check and the URL is accepted.
  // That is harmless: no credentials are sent with the request.
  if (url.username !== '' || url.password !== '') {
    throw new BlockedUrlError('credentials');
  }

  // The parser drops the scheme's default port, so any port left is non-default.
  if (url.port !== '') {
    throw new BlockedUrlError('port');
  }

  const host = url.hostname;

  // IP literals: "[...]" for IPv6, canonical dotted decimal for IPv4.
  if (host.startsWith('[') || isIPv4(host)) {
    const address = host.startsWith('[') ? host.slice(1, -1) : host;
    if (!isAllowedAddress(address)) {
      throw new BlockedUrlError('address');
    }
    return url;
  }

  if (!isAllowedHostname(host)) {
    throw new BlockedUrlError('host');
  }

  return url;
}

/**
 * Rejects localhost, *.localhost and single-label names (ADR 0002, rule 1),
 * and names with an empty label, which the URL parser keeps
 * ("localhost..", "a..example.com") and which could otherwise slip past
 * the other two rules.
 */
function isAllowedHostname(hostname: string): boolean {
  // One trailing dot marks a fully qualified name: "localhost." is localhost.
  const name = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  const labels = name.split('.');

  if (labels.some((label) => label === '')) {
    return false;
  }

  if (name === 'localhost' || name.endsWith('.localhost')) {
    return false;
  }

  return labels.length > 1;
}
