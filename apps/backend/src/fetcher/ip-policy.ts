import ipaddr from 'ipaddr.js';

// Blocked IPv4 ranges. Sources (read 2026-11-20):
// - IANA IPv4 Special-Purpose Address Registry (last updated 2025-10-09),
//   https://www.iana.org/assignments/iana-ipv4-special-registry/
// - IANA IPv4 Multicast Address Space Registry (last updated 2026-11-06),
//   https://www.iana.org/assignments/multicast-addresses/
// Every entry is blocked, whether or not IANA marks it "globally reachable".
// Registry entries nested inside a listed range are named in its comment.
// See docs/adr/0002-safe-fetcher.md, rule 3.
const BLOCKED_IPV4_RANGES: readonly string[] = [
  '0.0.0.0/8', // "This network" — RFC 791, Section 3.2 (incl. 0.0.0.0/32, RFC 1122)
  '10.0.0.0/8', // Private-Use — RFC 1918
  '100.64.0.0/10', // Shared Address Space (CGNAT) — RFC 6598
  '127.0.0.0/8', // Loopback — RFC 1122, Section 3.2.1.3
  '169.254.0.0/16', // Link Local, incl. cloud metadata 169.254.169.254 — RFC 3927
  '172.16.0.0/12', // Private-Use — RFC 1918
  // IETF Protocol Assignments — RFC 6890, Section 2.1. Includes
  // 192.0.0.0/29 (RFC 7335), .8 (RFC 7600), .9 (RFC 7723), .10 (RFC 8155),
  // .170 and .171 (RFC 8880, RFC 7050).
  '192.0.0.0/24',
  '192.0.2.0/24', // Documentation (TEST-NET-1) — RFC 5737
  '192.31.196.0/24', // AS112-v4 — RFC 7535
  '192.52.193.0/24', // AMT — RFC 7450
  '192.88.99.0/24', // Deprecated 6to4 Relay Anycast — RFC 7526 (incl. 192.88.99.2/32, RFC 6751)
  '192.168.0.0/16', // Private-Use — RFC 1918
  '192.175.48.0/24', // Direct Delegation AS112 Service — RFC 7534
  '198.18.0.0/15', // Benchmarking — RFC 2544
  '198.51.100.0/24', // Documentation (TEST-NET-2) — RFC 5737
  '203.0.113.0/24', // Documentation (TEST-NET-3) — RFC 5737
  '224.0.0.0/4', // Multicast — RFC 1112, RFC 5771 (IPv4 Multicast Address Space Registry)
  '240.0.0.0/4', // Reserved — RFC 1112, Section 4 (incl. 255.255.255.255/32, RFC 8190, RFC 919)
];

// IPv6 is allowed only inside global unicast 2000::/3 (RFC 4291). Everything
// outside it is blocked without a table entry, including these registry
// entries: ::/128, ::1/128, 64:ff9b::/96, 64:ff9b:1::/48, 100::/64,
// 100:0:0:1::/64, 5f00::/16, fc00::/7, fe80::/10 and multicast ff00::/8
// (IPv6 Multicast Address Space Registry). IPv4-mapped ::ffff:0:0/96 is
// checked as IPv4.
const GLOBAL_UNICAST_IPV6 = ipaddr.IPv6.parseCIDR('2000::/3');

// Blocked IPv6 ranges inside 2000::/3. Source (read 2026-11-20): IANA IPv6
// Special-Purpose Address Registry (last updated 2025-10-09),
// https://www.iana.org/assignments/iana-ipv6-special-registry/
// Every entry is blocked, whether or not IANA marks it "globally reachable".
const BLOCKED_IPV6_RANGES: readonly string[] = [
  // IETF Protocol Assignments — RFC 2928. Includes Teredo 2001::/32
  // (RFC 4380), 2001:1::1/128 (RFC 7723), 2001:1::2/128 (RFC 8155),
  // 2001:1::3/128 (RFC 9665), 2001:2::/48 (RFC 5180), 2001:3::/32 (RFC 7450),
  // 2001:4:112::/48 (RFC 7535), 2001:10::/28 (RFC 4843),
  // 2001:20::/28 (RFC 7343) and 2001:30::/28 (RFC 9374).
  '2001::/23',
  '2001:db8::/32', // Documentation — RFC 3849
  '2002::/16', // 6to4 — RFC 3056
  '2620:4f:8000::/48', // Direct Delegation AS112 Service — RFC 7534
  '3fff::/20', // Documentation — RFC 9637
];

const BLOCKED_IPV4 = BLOCKED_IPV4_RANGES.map((cidr) =>
  ipaddr.IPv4.parseCIDR(cidr),
);
const BLOCKED_IPV6 = BLOCKED_IPV6_RANGES.map((cidr) =>
  ipaddr.IPv6.parseCIDR(cidr),
);

// RFC 5952, section 5: IPv4-mapped addresses may be written "::ffff:a.b.c.d".
const IPV4_MAPPED_DOTTED_PREFIX = '::ffff:';

/**
 * Returns true only if `ip` is a canonical public address that SafeFetcher
 * may connect to. Fails closed: anything not positively allowed is blocked.
 *
 * Accepted text forms (anything else is blocked):
 * - IPv4 in canonical four-part decimal, e.g. "8.8.8.8"
 * - IPv6 in canonical RFC 5952 text, e.g. "2001:4860:4860::8888"
 * - IPv4-mapped IPv6 as "::ffff:808:808" or "::ffff:8.8.8.8", checked as IPv4
 */
export function isAllowedAddress(ip: string): boolean {
  if (ipaddr.IPv4.isValidFourPartDecimal(ip)) {
    return isAllowedIPv4(ip);
  }

  if (ip.startsWith(IPV4_MAPPED_DOTTED_PREFIX)) {
    const embedded = ip.slice(IPV4_MAPPED_DOTTED_PREFIX.length);
    if (ipaddr.IPv4.isValidFourPartDecimal(embedded)) {
      return isAllowedIPv4(embedded);
    }
  }

  return isAllowedIPv6(ip);
}

/** `ip` must already be canonical four-part decimal. */
function isAllowedIPv4(ip: string): boolean {
  // Safe to parse: four-part decimal without leading zeros is unambiguous.
  // (On other forms, ipaddr.IPv4.parse would accept "127.1", "0x7f.0.0.1"
  // or "010.0.0.1", which is octal → 8.0.0.1.)
  const address = ipaddr.IPv4.parse(ip);
  return !BLOCKED_IPV4.some((range) => address.match(range));
}

function isAllowedIPv6(ip: string): boolean {
  // A zone ID ("fe80::1%eth0") is accepted by ipaddr.js and survives the
  // round-trip below, so it is rejected explicitly.
  if (ip.includes('%') || !ipaddr.IPv6.isValid(ip)) {
    return false;
  }

  // Canonical text only: the input must equal its own RFC 5952
  // serialisation, so the parsed address is exactly what the text says.
  // This also rejects every dotted form here: ipaddr.js serialises in hex
  // and reads "::8.8.8.8" (IPv4-compatible) as "::ffff:808:808".
  const address = ipaddr.IPv6.parse(ip);
  if (address.toString() !== ip) {
    return false;
  }

  if (address.isIPv4MappedAddress()) {
    return isAllowedIPv4(address.toIPv4Address().toString());
  }

  return (
    address.match(GLOBAL_UNICAST_IPV6) &&
    !BLOCKED_IPV6.some((range) => address.match(range))
  );
}
