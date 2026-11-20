import ipaddr from 'ipaddr.js';
import { describe, expect, it } from 'vitest';

import { isAllowedAddress } from '../../../src/fetcher/ip-policy.js';

// Rules: docs/adr/0002-safe-fetcher.md, rule 3. The policy fails closed:
// an address is allowed only if it is canonical and in no blocked range.
//
// Sources: IANA IPv4 Special-Purpose Address Registry (updated 2025-10-09)
// and IANA IPv4 Multicast Address Space Registry (updated 2026-11-06).

// [range, name and RFC, first address, last address]
const BLOCKED_IPV4_RANGES: [string, string, string, string][] = [
  ['0.0.0.0/8', '"This network" (RFC 791)', '0.0.0.0', '0.255.255.255'],
  ['10.0.0.0/8', 'Private-Use (RFC 1918)', '10.0.0.0', '10.255.255.255'],
  [
    '100.64.0.0/10',
    'Shared Address Space / CGNAT (RFC 6598)',
    '100.64.0.0',
    '100.127.255.255',
  ],
  ['127.0.0.0/8', 'Loopback (RFC 1122)', '127.0.0.0', '127.255.255.255'],
  ['169.254.0.0/16', 'Link Local (RFC 3927)', '169.254.0.0', '169.254.255.255'],
  ['172.16.0.0/12', 'Private-Use (RFC 1918)', '172.16.0.0', '172.31.255.255'],
  [
    '192.0.0.0/24',
    'IETF Protocol Assignments (RFC 6890)',
    '192.0.0.0',
    '192.0.0.255',
  ],
  [
    '192.0.2.0/24',
    'Documentation TEST-NET-1 (RFC 5737)',
    '192.0.2.0',
    '192.0.2.255',
  ],
  ['192.31.196.0/24', 'AS112-v4 (RFC 7535)', '192.31.196.0', '192.31.196.255'],
  ['192.52.193.0/24', 'AMT (RFC 7450)', '192.52.193.0', '192.52.193.255'],
  [
    '192.88.99.0/24',
    'Deprecated 6to4 Relay Anycast (RFC 7526)',
    '192.88.99.0',
    '192.88.99.255',
  ],
  [
    '192.168.0.0/16',
    'Private-Use (RFC 1918)',
    '192.168.0.0',
    '192.168.255.255',
  ],
  [
    '192.175.48.0/24',
    'Direct Delegation AS112 (RFC 7534)',
    '192.175.48.0',
    '192.175.48.255',
  ],
  ['198.18.0.0/15', 'Benchmarking (RFC 2544)', '198.18.0.0', '198.19.255.255'],
  [
    '198.51.100.0/24',
    'Documentation TEST-NET-2 (RFC 5737)',
    '198.51.100.0',
    '198.51.100.255',
  ],
  [
    '203.0.113.0/24',
    'Documentation TEST-NET-3 (RFC 5737)',
    '203.0.113.0',
    '203.0.113.255',
  ],
  [
    '224.0.0.0/4',
    'Multicast (RFC 1112, RFC 5771)',
    '224.0.0.0',
    '239.255.255.255',
  ],
  ['240.0.0.0/4', 'Reserved (RFC 1112)', '240.0.0.0', '255.255.255.255'],
];

// Registry entries nested inside a range above. They are blocked by the
// covering range; tested individually so every registry entry has a case.
const NESTED_REGISTRY_ENTRIES: [string, string][] = [
  ['0.0.0.0', '"This host on this network" 0.0.0.0/32 (RFC 1122)'],
  [
    '192.0.0.0',
    'IPv4 Service Continuity Prefix 192.0.0.0/29 (RFC 7335), first',
  ],
  ['192.0.0.7', 'IPv4 Service Continuity Prefix 192.0.0.0/29 (RFC 7335), last'],
  ['192.0.0.8', 'IPv4 dummy address (RFC 7600)'],
  ['192.0.0.9', 'PCP Anycast (RFC 7723), marked globally reachable'],
  ['192.0.0.10', 'TURN Anycast (RFC 8155), marked globally reachable'],
  ['192.0.0.170', 'NAT64/DNS64 Discovery (RFC 8880)'],
  ['192.0.0.171', 'NAT64/DNS64 Discovery (RFC 8880)'],
  ['192.88.99.2', '6a44-relay anycast (RFC 6751)'],
  ['255.255.255.255', 'Limited Broadcast (RFC 8190)'],
];

// Addresses directly outside a range boundary that belong to no blocked
// range. Not listed because the neighbour is itself blocked:
// below 0.0.0.0 (none), 239.255.255.255 / 240.0.0.0 (multicast and reserved
// are adjacent) and above 255.255.255.255 (none).
const PUBLIC_NEIGHBOURS: [string, string][] = [
  ['1.0.0.0', 'above 0.0.0.0/8'],
  ['9.255.255.255', 'below 10.0.0.0/8'],
  ['11.0.0.0', 'above 10.0.0.0/8'],
  ['100.63.255.255', 'below 100.64.0.0/10'],
  ['100.128.0.0', 'above 100.64.0.0/10'],
  ['126.255.255.255', 'below 127.0.0.0/8'],
  ['128.0.0.0', 'above 127.0.0.0/8'],
  ['169.253.255.255', 'below 169.254.0.0/16'],
  ['169.255.0.0', 'above 169.254.0.0/16'],
  ['172.15.255.255', 'below 172.16.0.0/12'],
  ['172.32.0.0', 'above 172.16.0.0/12'],
  ['191.255.255.255', 'below 192.0.0.0/24'],
  ['192.0.1.0', 'above 192.0.0.0/24'],
  ['192.0.1.255', 'below 192.0.2.0/24'],
  ['192.0.3.0', 'above 192.0.2.0/24'],
  ['192.31.195.255', 'below 192.31.196.0/24'],
  ['192.31.197.0', 'above 192.31.196.0/24'],
  ['192.52.192.255', 'below 192.52.193.0/24'],
  ['192.52.194.0', 'above 192.52.193.0/24'],
  ['192.88.98.255', 'below 192.88.99.0/24'],
  ['192.88.100.0', 'above 192.88.99.0/24'],
  ['192.167.255.255', 'below 192.168.0.0/16'],
  ['192.169.0.0', 'above 192.168.0.0/16'],
  ['192.175.47.255', 'below 192.175.48.0/24'],
  ['192.175.49.0', 'above 192.175.48.0/24'],
  ['198.17.255.255', 'below 198.18.0.0/15'],
  ['198.20.0.0', 'above 198.18.0.0/15'],
  ['198.51.99.255', 'below 198.51.100.0/24'],
  ['198.51.101.0', 'above 198.51.100.0/24'],
  ['203.0.112.255', 'below 203.0.113.0/24'],
  ['203.0.114.0', 'above 203.0.113.0/24'],
  ['223.255.255.255', 'below 224.0.0.0/4'],
];

describe('isAllowedAddress — IPv4', () => {
  it.each([
    ['8.8.8.8', 'public (Google DNS)'],
    ['1.1.1.1', 'public (Cloudflare DNS)'],
  ])('allows %s — %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(true);
  });

  describe.each(BLOCKED_IPV4_RANGES)('%s — %s', (cidr, _name, first, last) => {
    // Guards the test data itself against typos in the boundaries.
    it('test data: first and last are the range boundaries', () => {
      expect(ipaddr.IPv4.networkAddressFromCIDR(cidr).toString()).toBe(first);
      expect(ipaddr.IPv4.broadcastAddressFromCIDR(cidr).toString()).toBe(last);
    });

    it(`blocks the first address ${first}`, () => {
      expect(isAllowedAddress(first)).toBe(false);
    });

    it(`blocks the last address ${last}`, () => {
      expect(isAllowedAddress(last)).toBe(false);
    });
  });

  it.each(NESTED_REGISTRY_ENTRIES)('blocks %s — %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(false);
  });

  it.each(PUBLIC_NEIGHBOURS)('allows %s — %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(true);
  });
});

describe('isAllowedAddress — non-canonical and malformed input', () => {
  // ipaddr.IPv4.parse accepts several of these and maps them to a different
  // address (e.g. "010.0.0.1" is octal → 8.0.0.1). All must be blocked.
  it.each([
    ['invalid-ip', 'not an IP address'],
    ['', 'empty string'],
    ['127.1', 'short form (→ 127.0.0.1)'],
    ['1.2.3', 'three parts'],
    ['2130706433', 'single 32-bit number (→ 127.0.0.1)'],
    ['0x7f.0.0.1', 'hexadecimal part'],
    ['0x08080808', 'hexadecimal number'],
    ['0177.0.0.1', 'octal part (→ 127.0.0.1)'],
    ['010.0.0.1', 'leading zero, parsed as octal (→ 8.0.0.1)'],
    ['08.8.8.8', 'leading zero'],
    ['8.8.8.08', 'leading zero in the last part'],
    ['1.2.3.4.5', 'five parts'],
    ['256.0.0.1', 'part above 255'],
    ['8.8.8.256', 'last part above 255'],
    ['1.2.3.-1', 'negative part'],
    ['+8.8.8.8', 'sign'],
    ['8.8.8.8.', 'trailing dot'],
    [' 8.8.8.8', 'leading space'],
    ['8.8.8.8 ', 'trailing space'],
    ['8.8.8.8\n', 'trailing newline'],
    ['８.８.８.８', 'full-width digits'],
    ['8.8.8.8/32', 'CIDR notation'],
    ['8.8.8.8:80', 'with a port'],
    ['[8.8.8.8]', 'in brackets'],
  ])('blocks %j — %s', (input) => {
    expect(isAllowedAddress(input)).toBe(false);
  });
});
