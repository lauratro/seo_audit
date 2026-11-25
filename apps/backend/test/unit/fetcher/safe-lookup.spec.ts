import type { LookupAddress, LookupOptions } from 'node:dns';

import { describe, expect, it } from 'vitest';

import {
  BlockedUrlError,
  DomainNotFoundError,
  UpstreamUnreachableError,
} from '../../../src/fetcher/fetcher.errors.js';
import {
  type ResolvedAddress,
  type Resolver,
  STRICT_FETCH_POLICY,
} from '../../../src/fetcher/fetch-policy.js';
import { createSafeLookup } from '../../../src/fetcher/safe-lookup.js';

// The lookup that undici's connector hands to net.connect / tls.connect.
// It must resolve once, check every address, and only pass checked
// addresses to the socket (docs/adr/0002-safe-fetcher.md, rule 3).

type LookupResult =
  | { error: Error }
  | { address: string; family: number }
  | { addresses: LookupAddress[] };

/** Calls the lookup like Node's net module does and records the callback. */
function runLookup(
  addresses: ResolvedAddress[] | (() => Promise<ResolvedAddress[]>),
  options: LookupOptions = {},
): Promise<LookupResult & { calls: number; resolverCalls: string[] }> {
  const resolverCalls: string[] = [];
  const resolver: Resolver = (hostname) => {
    resolverCalls.push(hostname);
    return typeof addresses === 'function'
      ? addresses()
      : Promise.resolve(addresses);
  };
  const lookup = createSafeLookup(
    resolver,
    STRICT_FETCH_POLICY.isAllowedAddress,
  );

  return new Promise((resolvePromise) => {
    let calls = 0;
    lookup('example.com', options, (error, address, family) => {
      calls += 1;
      // Give a second (wrong) callback call the chance to be counted.
      setImmediate(() => {
        if (error) {
          resolvePromise({ error, calls, resolverCalls });
        } else if (Array.isArray(address)) {
          resolvePromise({ addresses: address, calls, resolverCalls });
        } else {
          resolvePromise({
            address,
            family: family ?? 0,
            calls,
            resolverCalls,
          });
        }
      });
    });
  });
}

function dnsError(code: string): Error {
  return Object.assign(new Error(`queryA ${code} example.com`), { code });
}

const PUBLIC_V4: ResolvedAddress = { address: '8.8.8.8', family: 4 };
const PUBLIC_V4_B: ResolvedAddress = { address: '1.1.1.1', family: 4 };
const PUBLIC_V6: ResolvedAddress = {
  address: '2001:4860:4860::8888',
  family: 6,
};

describe('createSafeLookup — allowed addresses', () => {
  it('returns the first address for a single-address lookup', async () => {
    const result = await runLookup([PUBLIC_V4, PUBLIC_V4_B]);
    expect(result).toMatchObject({ address: '8.8.8.8', family: 4, calls: 1 });
  });

  it('returns every address for an all-addresses lookup (happy eyeballs)', async () => {
    const result = await runLookup([PUBLIC_V6, PUBLIC_V4], { all: true });
    expect(result).toMatchObject({
      addresses: [PUBLIC_V6, PUBLIC_V4],
      calls: 1,
    });
  });

  it('allows an IPv4-mapped address of a public IPv4 address', async () => {
    const result = await runLookup([{ address: '::ffff:8.8.8.8', family: 6 }]);
    expect(result).toMatchObject({ address: '::ffff:8.8.8.8', family: 6 });
  });

  it('resolves the hostname exactly once', async () => {
    const result = await runLookup([PUBLIC_V4], { all: true });
    expect(result.resolverCalls).toEqual(['example.com']);
  });

  it('only returns addresses of the requested family', async () => {
    const v4 = await runLookup([PUBLIC_V6, PUBLIC_V4], { family: 4 });
    expect(v4).toMatchObject({ address: '8.8.8.8', family: 4 });

    const v6 = await runLookup([PUBLIC_V4, PUBLIC_V6], {
      family: 6,
      all: true,
    });
    expect(v6).toMatchObject({ addresses: [PUBLIC_V6] });
  });
});

describe('createSafeLookup — blocked addresses', () => {
  it.each([
    [[{ address: '10.0.0.1', family: 4 }], 'private IPv4'],
    [[{ address: '127.0.0.1', family: 4 }], 'loopback'],
    [[{ address: '169.254.169.254', family: 4 }], 'cloud metadata'],
    [[{ address: '::1', family: 6 }], 'IPv6 loopback'],
    [[{ address: 'fd00:ec2::254', family: 6 }], 'AWS IPv6 metadata'],
    [
      [{ address: '::ffff:127.0.0.1', family: 6 }],
      'IPv4-mapped loopback (dotted)',
    ],
    [[{ address: '::ffff:7f00:1', family: 6 }], 'IPv4-mapped loopback (hex)'],
    [
      [PUBLIC_V4, { address: '10.0.0.1', family: 4 }],
      'public first, then private',
    ],
    [
      [{ address: '10.0.0.1', family: 4 }, PUBLIC_V4],
      'private first, then public',
    ],
    [[PUBLIC_V6, { address: '::1', family: 6 }], 'public IPv6, then loopback'],
  ] as [ResolvedAddress[], string][])('rejects %j — %s', async (addresses) => {
    for (const options of [{}, { all: true }]) {
      const result = await runLookup(addresses, options);
      expect(result).toHaveProperty('error');
      expect('error' in result && result.error).toBeInstanceOf(BlockedUrlError);
      expect('error' in result && result.error).toMatchObject({
        reason: 'address',
      });
      expect(result.calls).toBe(1);
    }
  });

  it('checks the whole answer before filtering by family', async () => {
    // A blocked IPv6 address must not be ignored because IPv4 was requested.
    const result = await runLookup([PUBLIC_V4, { address: '::1', family: 6 }], {
      family: 4,
    });
    expect('error' in result && result.error).toBeInstanceOf(BlockedUrlError);
  });

  it('does not reveal the address in the error message', async () => {
    const result = await runLookup([{ address: '169.254.169.254', family: 4 }]);
    expect('error' in result && result.error.message).not.toContain('169.254');
  });
});

describe('createSafeLookup — DNS failures', () => {
  it.each([['ENOTFOUND'], ['ENODATA']])(
    'maps %s to DomainNotFoundError',
    async (code) => {
      const result = await runLookup(() => Promise.reject(dnsError(code)));
      expect('error' in result && result.error).toBeInstanceOf(
        DomainNotFoundError,
      );
      expect(result.calls).toBe(1);
    },
  );

  it.each([['EAI_AGAIN'], ['ESERVFAIL'], ['ETIMEOUT'], ['ECONNREFUSED']])(
    'maps %s to UpstreamUnreachableError',
    async (code) => {
      const result = await runLookup(() => Promise.reject(dnsError(code)));
      expect('error' in result && result.error).toBeInstanceOf(
        UpstreamUnreachableError,
      );
    },
  );

  it('treats an empty answer as domain not found', async () => {
    const result = await runLookup([]);
    expect('error' in result && result.error).toBeInstanceOf(
      DomainNotFoundError,
    );
  });

  it('treats an answer without the requested family as domain not found', async () => {
    const result = await runLookup([PUBLIC_V4], { family: 6 });
    expect('error' in result && result.error).toBeInstanceOf(
      DomainNotFoundError,
    );
  });

  it('handles a resolver that throws synchronously', async () => {
    const result = await runLookup(() => {
      throw dnsError('ENOTFOUND');
    });
    expect('error' in result && result.error).toBeInstanceOf(
      DomainNotFoundError,
    );
    expect(result.calls).toBe(1);
  });

  it('keeps the original DNS error as the cause', async () => {
    const original = dnsError('ENOTFOUND');
    const result = await runLookup(() => Promise.reject(original));
    expect('error' in result && result.error.cause).toBe(original);
  });
});
