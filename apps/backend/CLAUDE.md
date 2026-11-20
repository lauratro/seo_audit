# apps/backend — NestJS API

Read the root `CLAUDE.md` first. This file adds API-specific rules.

## Module layout

```
src/
  config/       Zod-validated env config
  health/       GET /api/health
  fetcher/      SafeFetcher, IP policy, robots.txt
  engine/       Check contract, the checks, thresholds, engine service
    checks/     one file per check: title.check.ts, h1.check.ts, ...
  audits/       controller, service, DTOs; cache lookup; persistence
  pagespeed/    PageSpeed Insights client (phase 2)
  advisor/      Gemini AI advisor (phase 3)
  prisma/       PrismaService
test/
  unit/         mirrors src/, e.g. test/unit/fetcher/ip-policy.spec.ts
  e2e/          HTTP tests with Supertest, e.g. test/e2e/health.e2e.spec.ts
  fixtures/<checkId>/pass.html | warn.html | fail.html | info.html
```

Folder conventions inside a feature:
- NestJS classes go in subfolders by role: `module/<feature>.module.ts`, `controller/<feature>.controller.ts`, `service/<name>.service.ts`. Example: `health/module/health.module.ts`, `fetcher/service/safe-fetcher.service.ts`.
- Plain TypeScript functions and types stay flat in the feature folder: `fetcher/ip-policy.ts`, `engine/thresholds.ts`, `engine/checks/title.check.ts`.
- Create a folder or a service only when it has real content. No empty folders, no pass-through services.
- Tests live outside `src/`. `tsconfig.build.json` compiles only `src/`, `tsconfig.json` covers `src/` and `test/` for typecheck.
- ESM: relative imports end in `.js` (`import { HealthModule } from './health/module/health.module.js'`).

All routes are under the global prefix `/api`.

## Check contract

Every check implements the same interface (`CheckId` and `CheckStatus` come from `@seo-audit/shared`):

```ts
export interface CheckContext {
  requestedUrl: URL;
  finalUrl: URL;          // after redirects
  httpStatus: number;
  headers: Record<string, string>;
  html: string;
  $: CheerioAPI;          // parsed once by the engine, shared by all checks
}

export interface CheckResult {
  checkId: CheckId;
  status: CheckStatus;    // pass | warn | fail | info | not_checked | not_applicable
  measured: Record<string, unknown>;  // exact measured values, e.g. { length: 78 }
  message: string;        // short, factual, English
}

export interface Check {
  id: CheckId;
  run(ctx: CheckContext): CheckResult | Promise<CheckResult>;
}
```

*Open decision for task 1.10:* one check module (e.g. `title.check.ts`) may produce several granular results (`title_presence`, `title_length`, `title_pixel_width`). The single `id` / single `CheckResult` shape above must be adapted before the first check is written.

Status meanings (defined in `packages/shared/src/checks/check-status.ts`):
- `pass` — the check passed · `warn` — a potential issue that needs attention, possibly intentional · `fail` — a problem was detected
- `info` — a neutral observation, not an issue (e.g. no JSON-LD on the page)
- `not_checked` — the check could not run or was not executed · `not_applicable` — the check does not apply (e.g. description length when there is no description)

Rules:
- Checks are **pure** functions of the context: no network, no DB, no clock. The only exception is `broken_links`, which receives an injected `LinkChecker` so tests can replace it.
- All thresholds live in `engine/thresholds.ts`, each with a comment naming its source (e.g. Google Search Central). No magic numbers in check files.
- One check throwing must not break the audit: the engine catches it, logs it, and records its results as `not_checked`.
- Each check has tests for every status it can return (`pass`, `warn`, `fail`, `info`, `not_applicable`) using fixtures in `test/fixtures/<checkId>/`, plus edge cases (empty element, whitespace only, multiple elements).
- A technical observation is not automatically an SEO issue: `noindex`, `nofollow` and a canonical pointing elsewhere can be intentional, so they are `warn` or `info`, never an automatic `fail`.
- `structured_data_presence`: no JSON-LD → `info`. Syntax errors are `structured_data_syntax`'s job.
- `initial_render` is a heuristic on the initial HTML response, not proof of what a browser or Google renders: low text alone is `warn`, never an automatic `fail`.
- `broken_links` reports only confirmed unavailable links (e.g. 404, 410) as broken. Responses that allow no reliable conclusion (403, 429, 5xx, timeouts) are recorded separately as unverified; a 5xx is never described as permanently broken.

## SafeFetcher (security-critical)

Every outbound request to a user-supplied URL — the page, each redirect hop, robots.txt, broken-link HEAD requests — goes through `SafeFetcher`.

- Only `http:` and `https:`. Reject URLs with credentials (`user:pass@`).
- Resolve DNS and reject non-public addresses: private, loopback, link-local (incl. `169.254.169.254`), CGNAT `100.64.0.0/10`, unspecified, multicast, broadcast, IPv6 ULA `fc00::/7`, `fe80::/10`, `::1`, and IPv4-mapped IPv6 addresses pointing to any of these. Use `ipaddr.js` and allow only the `unicast` range instead of a hand-written deny list.
- **Validate the IP actually used for the connection**, not a separate earlier lookup (prevents DNS rebinding). With undici, do it in a custom `connect`/`lookup` on the dispatcher.
- Redirects are followed manually (`redirect: 'manual'`), max 5; every `Location` is resolved against the current URL and fully re-validated.
- 10 s total timeout (`AbortSignal.timeout`). 5 MB body limit enforced while streaming — never trust `Content-Length`.
- The page fetch accepts only HTML content types.
- User-Agent `SEOAuditBot/0.1 (+<project url>)` on every request.
- Typed errors (`BlockedUrlError`, `FetchTimeoutError`, `ResponseTooLargeError`, ...) mapped to HTTP 400 with a machine-readable code by an exception filter. Never leak internal IPs or stack traces.

Testability: the IP policy is a pure function with table-driven tests. Resolver and dispatcher are injected, so fetcher tests use undici `MockAgent` or a fake resolver. (A local test server on 127.0.0.1 would itself be blocked — which is correct.)

## Responsible crawling

- Check robots.txt (via SafeFetcher, parsed with `robots-parser`) for the requested page before fetching it. Disallowed → audit rejected with a clear message. robots.txt 404 → proceed.
- `broken_links`: HEAD requests (GET only on 405), max 50 links per audit, concurrency 5, same SafeFetcher rules.
- `@nestjs/throttler` on `POST /api/audits`, per IP.

## Audits API

- `POST /api/audits` `{ url }` → 201 new · 200 cached (same `normalizedUrl` within 24 h) · 400 invalid/blocked · 429 rate limited
- `GET /api/audits/:id` → audit + findings + recommendations · 404
- `GET /api/audits?domain=example.com` → last 10 audits for the domain
- `GET /api/health` → 200

The audit runs synchronously inside the POST request in the MVP. `normalizeUrl` lives in `packages/shared` with its own tests: trim, add `https://` when no scheme is given, http(s) only, lowercase scheme and host, drop default port, fragment and an empty `?`, keep path (case, trailing slash) and query as given; returns `null` when unparseable. It is not a security check — SafeFetcher's policies still apply.

## External services (phases 2–3)

- PageSpeed and Gemini are **optional enrichments**: if one fails or times out, the audit is still saved with engine findings and the response says what is missing.
- PageSpeed: mobile strategy; store Lighthouse score, LCP, INP, CLS. Missing field data is `null`, never `0`.
- Gemini: called **once** per audit. Input = only `warn`/`fail` findings + performance data, never HTML. Output validated with `AdvisorOutputSchema` (Zod). Recommendations whose `checkId` is not among this audit's findings are dropped and logged. If validation fails, save the audit without recommendations and flag it. Store the model version on each recommendation.
- In tests, PageSpeed and Gemini clients are always mocked.

## Database

Prisma schema models Audit, Finding, Recommendation; the fields are an open decision for task 2.6. Schema changes always go through `prisma migrate dev --name <change>`; never edit applied migrations.
