import { lookup } from 'node:dns/promises';

import { isAllowedAddress } from './ip-policy.js';
import { parseAllowedUrl } from './url-policy.js';

/** The IP version of an address. */
export type IpFamily = 4 | 6;

/** One address returned by DNS resolution. */
export type ResolvedAddress = { address: string; family: IpFamily };

/** Resolves a hostname to all of its addresses. Injected so tests never use real DNS. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/**
 * The security rules SafeFetcher applies. Production always uses
 * STRICT_FETCH_POLICY (docs/adr/0002-safe-fetcher.md, rule 10). A relaxed
 * policy for local integration tests exists only in test code.
 */
export interface FetchPolicy {
  /** Parses a URL (or a redirect target against `base`) and applies the URL policy. */
  readonly checkUrl: (input: string, base?: URL) => URL;
  /** Decides whether a resolved address may be connected to. */
  readonly isAllowedAddress: (ip: string) => boolean;
}

export const STRICT_FETCH_POLICY: FetchPolicy = Object.freeze({
  checkUrl: parseAllowedUrl,
  isAllowedAddress,
});

/** The operating system resolver, as used by Node's own connections. */
export const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, order: 'verbatim' });
  return answers.map(({ address, family }) => {
    // Fail closed: an unknown family is an error, never guessed as IPv4.
    if (!isIpFamily(family)) {
      throw new Error(`Unexpected address family: ${family}`);
    }
    return { address, family };
  });
};

function isIpFamily(value: number): value is IpFamily {
  return value === 4 || value === 6;
}

/** Injection tokens for FetcherModule. */
export const FETCH_POLICY = Symbol('FETCH_POLICY');
export const DNS_RESOLVER = Symbol('DNS_RESOLVER');
