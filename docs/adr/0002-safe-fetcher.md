# 0002 — SafeFetcher: outbound requests to user-supplied URLs

- **Status:** accepted
- **Date:** 2026-11-20

## Context

The API fetches URLs chosen by anonymous users: the audited page, every redirect hop, robots.txt and the links checked by `broken_links`. Without controls this is a Server-Side Request Forgery (SSRF) vector: a user could make our server call internal services, the cloud metadata endpoint (`169.254.169.254`) or non-HTTP ports, or exhaust memory and time with huge, compressed or slow responses. Checking a hostname once is not enough: DNS can answer differently at connection time (DNS rebinding), and a public URL can redirect to a private one.

## Decision

Every outbound request to a user-supplied URL goes through one `SafeFetcher` built on an undici `Agent` whose `connect.lookup` validates every resolved address, with redirects followed manually and every hop re-validated. SafeFetcher enforces the rules below and throws typed domain errors; it knows nothing about HTTP status codes, which are mapped at the API boundary.

1. **Schemes and hosts:** `http:` and `https:` only; URLs with credentials are rejected. The hostnames `localhost` and `*.localhost` (with or without a trailing dot) and single-label hostnames (no dot, e.g. `intranet`) are rejected before any DNS lookup.
2. **Ports:** the scheme's default port only (after WHATWG parsing, `url.port === ''`).
3. **Addresses:** `isAllowedAddress(ip)` in `fetcher/ip-policy.ts` is a pure function and **fails closed**: any input that is not a canonical address, or that falls in a blocked range, is rejected. `ipaddr.js` is used to parse and match addresses, but its `range()` label is not trusted on its own; the policy is an explicit range table in `ip-policy.ts`, each range with its RFC citation, built from the IANA IPv4 and IPv6 Special-Purpose Address Registries (RFC 6890 and updates) and, for multicast `224.0.0.0/4`, the separate IANA IPv4 Multicast Address Space Registry (RFC 1112, RFC 5771). The snapshot date of the registries is recorded in the file.
   - **Input format:** only canonical text is accepted. IPv4: four-part decimal without leading zeros. IPv6: the exact RFC 5952 text (section 4: lowercase, no leading zeros, longest zero run compressed, hexadecimal only) — the input must equal its own serialisation. The one exception is RFC 5952 section 5: an IPv4-mapped address may also be written `::ffff:a.b.c.d`, where `a.b.c.d` is canonical four-part decimal, because resolvers may format mapped addresses this way. Anything else — short or hex IPv4 forms, uppercase or uncompressed IPv6, any other dotted IPv6 form (e.g. IPv4-compatible `::8.8.8.8`), zone IDs (`fe80::1%eth0`), brackets, empty strings — is blocked. The URL policy removes brackets from IPv6 literals and relies on WHATWG URL parsing to normalise IPv4 literals before calling the IP policy.
   - **IPv4-mapped IPv6** (`::ffff:0:0/96`) is converted to IPv4 and checked with the IPv4 rule. Other IPv6 forms that embed IPv4 (6to4 `2002::/16`, Teredo `2001::/32`, NAT64 `64:ff9b::/96`, `64:ff9b:1::/48`) are blocked.
   - **IPv4:** an address is allowed only if it belongs to **no** range in the table. Every entry of the IANA IPv4 registry is covered by a table range (entries nested inside a listed range are named in its comment), whether or not the registry marks it "globally reachable": "this network" (`0.0.0.0/8`), private (RFC 1918), shared/CGNAT, loopback, link-local (incl. `169.254.169.254`), IETF protocol assignments, documentation (TEST-NET-1/2/3), 6to4 relay anycast, benchmarking, reserved (`240.0.0.0/4`) and limited broadcast — plus multicast (`224.0.0.0/4`) from the IPv4 Multicast Address Space Registry.
   - **IPv6:** an address is allowed only if it is inside global unicast `2000::/3` **and** belongs to no range in the table. Every entry of the IANA IPv6 registry inside `2000::/3` is covered by a table range (entries nested inside a listed range are named in its comment), whether or not it is marked "globally reachable" (e.g. IETF protocol assignments `2001::/23`, documentation `2001:db8::/32` and `3fff::/20`, 6to4 `2002::/16`). Everything outside `2000::/3` is blocked, including `::`, `::1`, ULA `fc00::/7` (incl. the AWS metadata address `fd00:ec2::254`), link-local `fe80::/10` and multicast `ff00::/8`.
   - **Unallocated space inside `2000::/3`** (prefixes IANA has not yet assigned to a regional registry) is not listed separately: no public route reaches it, so a request can only get there through a route on our own network, which the infrastructure layer controls (ADR 0003). Allow-listing only assigned blocks was rejected (see Alternatives).
   - Task 1.7 tests every table entry (first and last address, plus a neighbouring allowed address where one exists), public IPv4/IPv6, IPv4-mapped forms, transition forms and non-canonical or unparseable input.

   The lookup resolves with `all: true` and rejects the request if *any* address is not allowed. IP literals in the URL never reach `lookup`, so the URL policy checks them with the same IP policy. No proxy agent is used.
4. **Redirects:** followed manually, at most 5 (6 requests). Each `Location` is resolved against the current URL and passes the full URL policy again. The redirect chain is returned with the result.
5. **Deadline:** one `AbortSignal.timeout` covers DNS, connect, all hops and the body read. 10 s for the page. Per-call options can only **tighten** limits, never loosen them: a deadline above 10 s or a size limit above 5 MB is rejected as a programming error. robots.txt and link checks use shorter deadlines (about 5 s).
6. **Size:** the body is counted while streaming, *after* decompression (gzip, deflate, br via `zlib`), and the request is aborted when the limit is exceeded. 5 MB for the page, 500 KiB for robots.txt; link checks never read a body. `Content-Length` is used only to reject early, never trusted. An unknown or stacked `Content-Encoding` (e.g. `gzip, br`) is an error.
7. **Content-Type (final 2xx page response only):** validated from the headers *before* reading the body, and only on the final 2xx response of an HTML page fetch — not on redirect hops, non-2xx responses, robots.txt or link checks. `text/html` is accepted. A missing `Content-Type` and any other type are rejected. `application/xhtml+xml` is rejected in the MVP: Cheerio parses HTML with parse5 and XML with htmlparser2, which applies no HTML parsing rules and whose error correction does not match browsers, and the docs do not cover XHTML. Content-Type validation is a resource and correctness guard, not a security boundary: rules 1–6 always apply.
8. **Upstream responses:** 4xx/5xx from the target are returned as results (`status`, `headers`, `finalUrl`, `redirects`), not thrown, whatever their Content-Type; for non-2xx the body is discarded. Exceptions mean SafeFetcher could not complete the fetch.
9. **Errors and HTTP mapping** (exception filter at the API boundary, response `{ statusCode, code, message }`, machine-readable codes in `packages/shared`; messages never contain resolved IPs or stack traces):

| Error | HTTP |
|---|---|
| Invalid URL, blocked scheme/port/credentials/host/address (also after a redirect) | 400 |
| Domain not found (`ENOTFOUND`) or without addresses (`ENODATA`), too many redirects, response too large, unsupported or missing Content-Type, unknown or stacked Content-Encoding, disallowed by robots.txt | 422 |
| Temporary DNS failure, connection refused/reset, TLS error | 502 |
| Deadline exceeded | 504 |

Callers other than the API (robots.txt, `LinkChecker`) handle the typed errors themselves; e.g. a link that times out is *unverified*, never a 504.

10. **No relaxed policy in production:** `FetcherModule` always wires the strict IP, URL and port policy and the system resolver. No environment variable (including `NODE_ENV`), config option or flag can relax them or switch to another policy, and `src/` exports no relaxed variant. The relaxed policy that local integration tests need (loopback and any port, for a test server on `127.0.0.1`) is defined only in test code under `test/`. A module test proves the production wiring uses the strict policy.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Validate the hostname once, then use any HTTP client | Little code | Bypassed by DNS rebinding and by redirects to private addresses |
| Resolve first, connect to the IP with a `Host` header | Explicit | Breaks TLS SNI and certificate checks unless rewritten by hand; still two code paths |
| Trust `ipaddr.js` `range() === 'unicast'` alone | One line of code | Depends on the library's labels and version; a range missing from its list would silently be allowed (fail-open) |
| IPv6: allow only blocks IANA has assigned to regional registries | Also blocks unallocated space inside `2000::/3` | 30+ extra entries to keep in sync with IANA; unallocated space has no public route anyway |
| Client's automatic redirect following | Less code | Hops skip the scheme, port and credentials checks |
| Per-request timeouts only | Built into undici | Add up across redirects; `bodyTimeout` resets per chunk, so a slow-drip body never times out |
| Limit on compressed bytes or `Content-Length` | Simple | Decompression bombs and lying or missing headers bypass it |
| undici `fetch` with a custom dispatcher | Decompresses automatically, less code | Errors arrive as `TypeError: fetch failed` with nested causes, harder to map to typed errors |
| Sniff the body when Content-Type is missing or wrong | Audits more misconfigured sites | Reads untrusted bytes before deciding; more code and edge cases |
| All errors as HTTP 400 with a `code` | One status to handle | A timeout or unreachable site reported as a client error is misleading |
| Egress firewall / proxy only (infrastructure) | Independent of application code | Not available locally or in tests; kept as an additional layer for ADR 0003 |

## Consequences

- Easier: one place to review for SSRF; every rule is testable without external network access. Tests use a fake resolver, `.test` hostnames (RFC 6761), a local server on `127.0.0.1` with the test-only relaxed policy from rule 10 (it allows loopback and any port; metadata and private ranges stay blocked), and injected short deadlines. undici `MockAgent` bypasses `lookup`, so it is not used for SSRF tests.
- Harder: some legitimate pages cannot be audited — sites on non-default ports, servers with a missing or wrong `Content-Type`, XHTML served as `application/xhtml+xml`, pages over 5 MB or slower than 10 s, and sites with invalid TLS certificates.
- More code than a plain client: manual redirect loop and streaming decompression with a byte counter.
- IP filtering alone cannot protect resources reachable through public IP addresses, including our own infrastructure (e.g. public endpoints of our services or VPC IPv6 addresses, which are globally unique). Network-level egress restrictions, IMDSv2 and related AWS protections are deferred to ADR 0003.
- To revisit: the total time budget of a synchronous audit (page + robots.txt + up to 50 links) in task 2.4; XHTML support with fixtures.
- The explicit range table must be kept up to date with the IANA registries; new special-use ranges are added as new table entries with tests, and the snapshot date is updated.
