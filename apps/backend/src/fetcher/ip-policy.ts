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

const BLOCKED_IPV4 = BLOCKED_IPV4_RANGES.map((cidr) =>
  ipaddr.IPv4.parseCIDR(cidr),
);

/**
 * Returns true only if `ip` is a canonical public address that SafeFetcher
 * may connect to. Fails closed: anything not positively allowed is blocked.
 */
export function isAllowedAddress(ip: string): boolean {
  // Canonical four-part decimal only. ipaddr.IPv4.parse would also accept
  // "127.1", "0x7f.0.0.1" or "010.0.0.1" (octal → 8.0.0.1).
  if (!ipaddr.IPv4.isValidFourPartDecimal(ip)) {
    // IPv6 is not supported yet, so it is blocked like any other input.
    return false;
  }

  const address = ipaddr.IPv4.parse(ip);
  return !BLOCKED_IPV4.some((range) => address.match(range));
}
