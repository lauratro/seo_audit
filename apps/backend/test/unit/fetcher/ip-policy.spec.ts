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

// ---------------------------------------------------------------------------
// IPv6. Sources: IANA IPv6 Special-Purpose Address Registry (updated
// 2025-10-09) and IANA IPv6 Multicast Address Space Registry (ff00::/8).
// Allowed only inside 2000::/3 and outside every blocked range. Input must be
// canonical text (RFC 5952: lowercase, no leading zeros, longest zero run
// compressed, hexadecimal only — no dotted IPv4 part, no zone ID).

// [range, name and RFC, first address, last address]
const BLOCKED_IPV6_RANGES: [string, string, string, string][] = [
  // Outside 2000::/3 (blocked by the 2000::/3 rule, listed for completeness)
  ['::/128', 'Unspecified (RFC 4291)', '::', '::'],
  ['::1/128', 'Loopback (RFC 4291)', '::1', '::1'],
  [
    '64:ff9b::/96',
    'NAT64 well-known prefix (RFC 6052)',
    '64:ff9b::',
    '64:ff9b::ffff:ffff',
  ],
  [
    '64:ff9b:1::/48',
    'NAT64 local-use prefix (RFC 8215)',
    '64:ff9b:1::',
    '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
  ],
  ['100::/64', 'Discard-Only (RFC 6666)', '100::', '100::ffff:ffff:ffff:ffff'],
  [
    '100:0:0:1::/64',
    'Dummy IPv6 Prefix (RFC 9780)',
    '100:0:0:1::',
    '100::1:ffff:ffff:ffff:ffff',
  ],
  [
    '5f00::/16',
    'Segment Routing SIDs (RFC 9602)',
    '5f00::',
    '5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    'fc00::/7',
    'Unique-Local (RFC 4193)',
    'fc00::',
    'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    'fe80::/10',
    'Link-Local Unicast (RFC 4291)',
    'fe80::',
    'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    'ff00::/8',
    'Multicast (RFC 4291)',
    'ff00::',
    'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  // Inside 2000::/3 (must be in the explicit table)
  [
    '2001::/23',
    'IETF Protocol Assignments (RFC 2928)',
    '2001::',
    '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001::/32',
    'Teredo (RFC 4380)',
    '2001::',
    '2001:0:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001:1::1/128',
    'PCP Anycast (RFC 7723), marked globally reachable',
    '2001:1::1',
    '2001:1::1',
  ],
  [
    '2001:1::2/128',
    'TURN Anycast (RFC 8155), marked globally reachable',
    '2001:1::2',
    '2001:1::2',
  ],
  [
    '2001:1::3/128',
    'DNS-SD SRP Anycast (RFC 9665), marked globally reachable',
    '2001:1::3',
    '2001:1::3',
  ],
  [
    '2001:2::/48',
    'Benchmarking (RFC 5180)',
    '2001:2::',
    '2001:2:0:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001:3::/32',
    'AMT (RFC 7450), marked globally reachable',
    '2001:3::',
    '2001:3:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001:4:112::/48',
    'AS112-v6 (RFC 7535), marked globally reachable',
    '2001:4:112::',
    '2001:4:112:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001:10::/28',
    'Deprecated ORCHID (RFC 4843)',
    '2001:10::',
    '2001:1f:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001:20::/28',
    'ORCHIDv2 (RFC 7343), marked globally reachable',
    '2001:20::',
    '2001:2f:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001:30::/28',
    'Drone Remote ID DETs (RFC 9374), marked globally reachable',
    '2001:30::',
    '2001:3f:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2001:db8::/32',
    'Documentation (RFC 3849)',
    '2001:db8::',
    '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2002::/16',
    '6to4 (RFC 3056)',
    '2002::',
    '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '2620:4f:8000::/48',
    'Direct Delegation AS112 (RFC 7534), marked globally reachable',
    '2620:4f:8000::',
    '2620:4f:8000:ffff:ffff:ffff:ffff:ffff',
  ],
  [
    '3fff::/20',
    'Documentation (RFC 9637)',
    '3fff::',
    '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
  ],
];

// Outside 2000::/3 and in no registry: blocked because the policy fails closed.
const BLOCKED_OUTSIDE_GLOBAL_UNICAST: [string, string][] = [
  ['1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'directly below 2000::/3'],
  ['4000::', 'directly above 2000::/3'],
  ['::2', 'next to loopback'],
  ['::808:808', 'deprecated IPv4-compatible form of 8.8.8.8 (RFC 4291)'],
  ['::ffff:0:808:808', 'IPv4-translated form of 8.8.8.8 (RFC 6145)'],
  ['::fffe:ffff:ffff', 'directly below the IPv4-mapped range'],
  ['::1:0:0:0', 'directly above the IPv4-mapped range'],
  ['fec0::1', 'deprecated site-local (RFC 3879)'],
  ['8000::1', 'reserved by IETF (RFC 4291)'],
];

// Addresses inside 2000::/3 that belong to no blocked range. Neighbours of
// ranges nested in 2001::/23 and of ranges outside 2000::/3 are not listed:
// they are blocked themselves. Unallocated space inside 2000::/3 (e.g.
// 2000::) is allowed by design (ADR 0002, rule 3).
const PUBLIC_IPV6: [string, string][] = [
  ['2001:4860:4860::8888', 'public (Google DNS)'],
  ['2606:4700:4700::1111', 'public (Cloudflare DNS)'],
  ['2a00:1450:4001:81c::200e', 'public, with hex letters'],
  ['2000::', 'first address of 2000::/3'],
  ['2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below 2001::/23'],
  ['2001:200::', 'above 2001::/23'],
  ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', 'below 2001:db8::/32'],
  ['2001:db9::', 'above 2001:db8::/32'],
  ['2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below 2002::/16'],
  ['2003::', 'above 2002::/16'],
  ['2620:4f:7fff:ffff:ffff:ffff:ffff:ffff', 'below 2620:4f:8000::/48'],
  ['2620:4f:8001::', 'above 2620:4f:8000::/48'],
  [
    '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    'below 3fff::/20 (last allowed address of 2000::/3)',
  ],
];

describe('isAllowedAddress — IPv6', () => {
  describe.each(BLOCKED_IPV6_RANGES)('%s — %s', (cidr, _name, first, last) => {
    // Guards the test data: boundaries are correct and in canonical form.
    it('test data: first and last are the canonical range boundaries', () => {
      expect(ipaddr.IPv6.networkAddressFromCIDR(cidr).toString()).toBe(first);
      expect(ipaddr.IPv6.broadcastAddressFromCIDR(cidr).toString()).toBe(last);
    });

    it(`blocks the first address ${first}`, () => {
      expect(isAllowedAddress(first)).toBe(false);
    });

    it(`blocks the last address ${last}`, () => {
      expect(isAllowedAddress(last)).toBe(false);
    });
  });

  it.each(BLOCKED_OUTSIDE_GLOBAL_UNICAST)('blocks %s — %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(false);
  });

  it.each(PUBLIC_IPV6)('allows %s — %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(true);
  });
});

describe('isAllowedAddress — IPv4-mapped IPv6 (::ffff:0:0/96, checked as IPv4)', () => {
  it.each([
    ['::ffff:808:808', '8.8.8.8'],
    ['::ffff:101:101', '1.1.1.1'],
  ])('allows %s — maps to public %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(true);
  });

  it.each([
    ['::ffff:0:0', '0.0.0.0, first address of the mapped range'],
    ['::ffff:ffff:ffff', '255.255.255.255, last address of the mapped range'],
    ['::ffff:7f00:1', '127.0.0.1 loopback'],
    ['::ffff:a00:1', '10.0.0.1 private'],
    ['::ffff:a9fe:a9fe', '169.254.169.254 cloud metadata'],
    ['::ffff:6440:1', '100.64.0.1 CGNAT'],
    ['::ffff:c000:201', '192.0.2.1 documentation'],
    ['::ffff:e000:0', '224.0.0.0 multicast'],
  ])('blocks %s — maps to %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(false);
  });

  // RFC 5952, section 5: "::ffff:" followed by a canonical four-part decimal
  // IPv4 address is also canonical (resolvers may format mapped addresses
  // this way). The IPv4 part is checked with the IPv4 policy.
  it.each([
    ['::ffff:8.8.8.8', '8.8.8.8'],
    ['::ffff:1.1.1.1', '1.1.1.1'],
  ])('allows %s — dotted form of public %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(true);
  });

  it.each([
    ['::ffff:0.0.0.0', '"this network", first address of the mapped range'],
    [
      '::ffff:255.255.255.255',
      'limited broadcast, last address of the mapped range',
    ],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:169.254.169.254', 'cloud metadata'],
    ['::ffff:100.64.0.1', 'CGNAT'],
    ['::ffff:224.0.0.1', 'multicast'],
  ])('blocks %s — dotted form of %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(false);
  });

  // Only the exact RFC 5952 form is accepted. Every variant below would map
  // to a public address under some parser, or is not canonical.
  it.each([
    ['::FFFF:8.8.8.8', 'uppercase prefix'],
    ['0:0:0:0:0:ffff:8.8.8.8', 'prefix not compressed'],
    ['::0:ffff:8.8.8.8', 'prefix only partly compressed'],
    ['::ffff:0808:0808', 'hex form with leading zeros'],
    ['::ffff:8.8.8.08', 'IPv4 part with a leading zero'],
    ['::ffff:010.0.0.1', 'IPv4 part with a leading zero (octal style)'],
    ['::ffff:0177.0.0.1', 'IPv4 part in octal style'],
    ['::ffff:127.1', 'IPv4 part in short form'],
    ['::ffff:8.8.8.8.8', 'IPv4 part with five parts'],
    ['::ffff:256.8.8.8', 'IPv4 part above 255'],
    ['::ffff:8.8.8.8%eth0', 'zone ID'],
    ['::ffff:8.8.8.8/128', 'CIDR notation'],
    [' ::ffff:8.8.8.8', 'leading space'],
    ['::ffff:8.8.8.8 ', 'trailing space'],
    ['::ffff:0:8.8.8.8', 'IPv4-translated, not IPv4-mapped (RFC 6145)'],
    ['::8.8.8.8', 'IPv4-compatible, not IPv4-mapped (deprecated, RFC 4291)'],
  ])('blocks %j — %s', (input) => {
    expect(isAllowedAddress(input)).toBe(false);
  });
});

describe('isAllowedAddress — IPv6 transition prefixes embedding IPv4', () => {
  // Blocked as a whole, even when the embedded IPv4 address is public.
  it.each([
    ['2002:808:808::1', '6to4 embedding public 8.8.8.8'],
    ['2002:7f00:1::1', '6to4 embedding 127.0.0.1'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo (RFC 4380 example)'],
    ['64:ff9b::808:808', 'NAT64 embedding public 8.8.8.8'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 embedding 169.254.169.254'],
    ['64:ff9b:1::808:808', 'local-use NAT64 embedding 8.8.8.8'],
  ])('blocks %s — %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(false);
  });
});

describe('isAllowedAddress — non-canonical and malformed IPv6', () => {
  it.each([
    // Valid IPv6, but not canonical text (RFC 5952)
    ['2A00:1450:4001:81C::200E', 'uppercase hex'],
    ['2a00:1450:4001:081c::200e', 'leading zero in a group'],
    ['2001:4860:4860:0:0:0:0:8888', 'zero run not compressed'],
    ['2001:4860:4860:0000:0000:0000:0000:8888', 'fully expanded'],
    ['2001:4860:4860:0::8888', 'zero run only partly compressed'],
    ['2a00::1:0:0:0:1', 'shorter zero run compressed instead of the longest'],
    // Dotted IPv4 parts outside the "::ffff:" mapped form: parsers disagree
    // on them (ipaddr.js reads "::8.8.8.8" as IPv4-mapped)
    ['::8.8.8.8', 'IPv4-compatible in dotted form'],
    ['2001:4860:4860::8.8.136.136', 'dotted suffix on a public address'],
    ['::FFFF:808:808', 'IPv4-mapped in uppercase'],
    // Zone IDs, notation around the address, whitespace
    ['fe80::1%eth0', 'zone ID'],
    ['2001:4860:4860::8888%1', 'zone ID on a public address'],
    ['[2001:4860:4860::8888]', 'in brackets'],
    ['2001:4860:4860::8888/128', 'CIDR notation'],
    [' 2001:4860:4860::8888', 'leading space'],
    ['2001:4860:4860::8888 ', 'trailing space'],
    ['2001:4860:4860::8888\n', 'trailing newline'],
    // Malformed
    [':::1', 'triple colon'],
    ['2001::4860::8888', 'two zero-run compressions'],
    ['2001:4860:4860:0:0:0:0:0:8888', 'nine groups'],
    ['2001:4860:4860:0:0:0:8888', 'seven groups without compression'],
    ['12345::1', 'group with five digits'],
    ['g::1', 'non-hex character'],
    ['2001:4860:4860::8888:', 'trailing colon'],
    [':2001:4860::8888', 'leading single colon'],
  ])('blocks %j — %s', (input) => {
    expect(isAllowedAddress(input)).toBe(false);
  });
});
