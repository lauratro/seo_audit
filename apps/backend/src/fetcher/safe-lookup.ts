import type { LookupFunction } from 'node:net';

import type { IpFamily, ResolvedAddress, Resolver } from './fetch-policy.js';
import {
  BlockedUrlError,
  DomainNotFoundError,
  UpstreamUnreachableError,
} from './fetcher.errors.js';

const NOT_FOUND_CODES: ReadonlySet<string> = new Set(['ENOTFOUND', 'ENODATA']);

/**
 * Creates the `lookup` function that undici's connector passes to
 * net.connect / tls.connect. Node calls it to get the address of the socket,
 * so the address that is checked here is the address that is connected to:
 * there is no second resolution an attacker could change (DNS rebinding).
 * See docs/adr/0002-safe-fetcher.md, rule 3.
 *
 * The whole DNS answer is checked: if any address is blocked, the request
 * fails, even if other addresses are public.
 */
export function createSafeLookup(
  resolve: Resolver,
  isAllowedAddress: (ip: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    resolveAllowed(hostname, resolve, isAllowedAddress, options.family).then(
      (addresses) => {
        if (options.all) {
          callback(null, addresses);
        } else {
          const [first] = addresses;
          callback(null, first.address, first.family);
        }
      },
      (error: Error) => {
        callback(error, '', 0);
      },
    );
  };
}

async function resolveAllowed(
  hostname: string,
  resolve: Resolver,
  isAllowedAddress: (ip: string) => boolean,
  family: number | string | undefined,
): Promise<[ResolvedAddress, ...ResolvedAddress[]]> {
  // Validated before DNS: an unsupported family fails without a lookup.
  const wanted = toFamily(family);

  let answer: ResolvedAddress[];
  try {
    answer = await resolve(hostname);
  } catch (error) {
    throw toDnsError(error);
  }

  // Check the whole answer before filtering by family, so a blocked address
  // can't hide behind a family the current connection attempt doesn't use.
  if (answer.some(({ address }) => !isAllowedAddress(address))) {
    throw new BlockedUrlError('address');
  }

  const addresses = wanted
    ? answer.filter((entry) => entry.family === wanted)
    : answer;

  const [first, ...rest] = addresses;
  if (!first) {
    throw new DomainNotFoundError();
  }
  return [first, ...rest];
}

/**
 * The family values dns.lookup supports: 0 or undefined (any family), 4, 6,
 * and 'IPv4' / 'IPv6' for backward compatibility. net.connect passes any
 * other value through unchanged, so it is rejected here instead of being
 * read as "any family". It is a programming error, hence a RangeError.
 */
function toFamily(family: number | string | undefined): IpFamily | undefined {
  if (family === undefined || family === 0) return undefined;
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  throw new RangeError(`Unsupported address family: ${String(family)}`);
}

function toDnsError(
  error: unknown,
): DomainNotFoundError | UpstreamUnreachableError {
  const code =
    error instanceof Error && 'code' in error ? String(error.code) : '';
  return NOT_FOUND_CODES.has(code)
    ? new DomainNotFoundError({ cause: error })
    : new UpstreamUnreachableError({ cause: error });
}
