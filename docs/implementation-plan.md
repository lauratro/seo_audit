# Implementation plan

MVP = phases 1–3, from 16 November to 13 December 2026 (~55 h). Each task is small enough for one Claude Code session and has an acceptance criterion. Tick a task only when lint, typecheck and tests are green and you have reviewed the diff.

Every week ends with something you can show in an interview.

**Terms.** A *check result* is the outcome of one CheckId for one audit; every audit has 16 (one per CheckId), each with one of six statuses: `pass`, `warn`, `fail`, `info`, `not_checked`, `not_applicable`. A *finding* is a check result with status `warn` or `fail` — only these represent potential SEO issues.

---

## Week 1 · 16–22 Nov · ~10 h — Foundations and safe fetching

Demo at the end: CI is green, `POST /api/audits` returns the title/description/h1 check results for a real URL, and localhost is rejected.

- [ ] **1.1 Monorepo skeleton** — npm workspaces with `apps/backend` (NestJS), `apps/frontend` (Next.js), `packages/shared`; root scripts `dev`, `lint`, `typecheck`, `test`; strict TS base config; ESLint + Prettier.
  *Done when:* `npm install && npm run lint && npm run typecheck && npm test` pass on an empty project.
- [ ] **1.2 Local database** — `docker-compose.yml` with PostgreSQL, `.env.example`, Zod-validated config module in the API, `GET /api/health`.
  *Done when:* `docker compose up -d && npm run dev` → `/api/health` returns 200.
- [ ] **1.3 CI** — GitHub Actions on every push: install with `npm ci`, lint, typecheck, test (npm cache keyed on `package-lock.json`).
  *Done when:* a failing test turns the pipeline red.
- [ ] **1.4 ADR 0001** — monorepo and stack choice (context, decision, alternatives). *You write it; Claude Code can review.*
- [ ] **1.5 Shared package** — `CheckId`, `CheckStatus`, `Priority`, `normalizeUrl()` with tests.
  *Done when:* both apps import from `@seo-audit/shared`; `normalizeUrl` has ≥ 8 test cases.
  *Pending:* the frontend integration is done in task 3.1 (URL form), with a real use rather than an artificial import.
- [x] **1.6 ADR 0002 — SafeFetcher** — decide timeouts (whole-operation deadline), error → HTTP status mapping, allowed ports. *You write it, starting from the proposals in `apps/backend/CLAUDE.md`.*
  *Status:* accepted — `docs/adr/0002-safe-fetcher.md`.

SafeFetcher is split into three tasks (design in ADR 0002, rules summarised in `apps/backend/CLAUDE.md` → "SafeFetcher"):

- [x] **1.7 IP policy** — `fetcher/ip-policy.ts`, pure, fail-closed function `isAllowedAddress(ip)`; `ipaddr.js` for parsing and matching, but an explicit range table with RFC comments, built from the IANA IPv4/IPv6 Special-Purpose Address Registries (snapshot date in the file; every entry blocked, whether or not marked "globally reachable"), instead of trusting `range() === 'unicast'` alone. IPv4 allowed only if in no table range; IPv6 allowed only inside `2000::/3` and in no table range there; IPv4-mapped IPv6 checked as IPv4; 6to4, Teredo, NAT64 blocked; only canonical text accepted.
  *Done when:* table-driven tests cover every table entry (first and last address plus a neighbouring public address), public IPv4/IPv6, IPv4-mapped and transition forms, non-canonical and unparseable input.
- [ ] **1.8 URL policy** — `fetcher/url-policy.ts`: scheme, credentials, default ports only, `localhost`/`*.localhost`/single-label hosts, IP literals checked with ip-policy; `fetcher.errors.ts` with the first typed errors.
  *Done when:* table-driven tests pass, including `http://127.0.0.1`, `http://[::ffff:7f00:1]`, `http://169.254.169.254`.
- [ ] **1.9 Safe HTTP client** — `fetcher/service/safe-fetcher.service.ts` + `fetcher/module/fetcher.module.ts`: undici Agent with checked `lookup`, manual redirects (max 5, each re-checked), whole-operation deadline, 5 MB decoded-size limit, `text/html` only on the final 2xx page response (missing Content-Type rejected), per-call limits can only tighten (max 10 s / 5 MB; robots.txt 500 KiB), User-Agent, 4xx/5xx returned as results; exception filter at the API boundary with the ADR 0002 mapping (400/422/502/504) and error codes in `packages/shared`. The relaxed test policy exists only in test code.
  *Done when:* tests with a real undici Agent and a fake resolver cover private address, DNS rebinding, mixed addresses, redirect to metadata/localhost, 6 redirects, > 5 MB (plain and gzip), slow body, missing and non-HTML Content-Type; a test proves the module wires the strict policy.
- [ ] **1.10 Engine + first checks** — `Check` contract, engine service that parses once with cheerio; checks `title_presence`, `title_length`, `title_pixel_width`, `meta_description_presence`, `meta_description_length`, `h1_presence`, `h1_multiple` with fixtures for each status they return; `thresholds.ts` with sources.
  *Open decision before this task:* one check module may produce several granular results (e.g. `title.check.ts` → three CheckIds); adapt the single-`id` contract in `apps/backend/CLAUDE.md`.
  *Resolved in 1.5:* a check that could not run is `not_checked`, distinct from `fail`. `title_pixel_width` is an approximation (at most `warn`) and the first to defer if time runs short.
- [ ] **1.11 README v1** — concept, architecture diagram, roadmap, local setup.

If week 1 runs long, 1.10 moves to the start of week 2 — don't shorten the SafeFetcher tests.

## Week 2 · 23–29 Nov · 13–18 h — Complete engine and persistence (closes phase 1)

Demo: a full audit with all 16 check results saved in PostgreSQL, retrievable by ID, cached for 24 h.

- [ ] **2.1 Checks** `heading_order`, `canonical_presence`, `canonical_validity`, `robots_directives` (meta tag + `X-Robots-Tag` header; `noindex`/`nofollow` may be intentional → never an automatic `fail`) — fixtures and tests first.
- [ ] **2.2 Checks** `img_alt_presence` (an empty `alt=""` is valid for decorative images), `structured_data_presence` (absent = `info`), `structured_data_syntax` (safe JSON-LD parsing; invalid JSON = `fail`).
- [ ] **2.3 Check** `initial_render` — heuristic on the initial HTML: visible text ratio after removing scripts/styles; threshold documented; low text = `warn`, never an automatic `fail`; fixture of a React "app shell".
- [ ] **2.4 Check** `broken_links` — injected `LinkChecker`, HEAD (GET on 405), max 50 links, concurrency 5, via SafeFetcher; only confirmed unavailable links (404, 410) count as broken, 403/429/5xx/timeouts are reported as unverified.
- [ ] **2.5 robots.txt** — `fetcher/robots-policy.ts`, fetched through `SafeFetcher`; respected for the requested page; tests for allowed, disallowed, missing, unreachable.
- [ ] **2.6 Prisma** — schema for Audit, Finding, Recommendation, first migration, `PrismaService`.
  *Open decision before this task:* the field list (start from `apps/backend/CLAUDE.md`).
- [ ] **2.7 Audits endpoints** — `POST` (201 / 200 cache / 400 / 429), `GET /:id`, `GET ?domain=`; Supertest e2e tests with mocked fetcher.
- [ ] **2.8 Phase 1 check** — go through the week 1 and week 2 demos and every *Done when* in weeks 1–2 of this plan, and tick them.

## Week 3 · 30 Nov–6 Dec · 13–18 h — Dashboard, performance, deploy (phase 2)

Demo: a live HTTPS link you can put in your CV.

- [ ] **3.1 Input page** — form with client validation, loading state, API errors shown clearly. Integrates `@seo-audit/shared` into the frontend: client validation uses `normalizeUrl()` (`null` → inline error), with no duplicated URL rules.
  *Done when:* the frontend imports and uses `@seo-audit/shared` (this completes the remaining part of 1.5).
- [ ] **3.2 Report page** — server-rendered, score, check results grouped by status, recent audits for the domain, mobile-friendly.
- [ ] **3.3 PageSpeed Insights** — client with Zod-parsed response, mobile strategy, missing field data as `null`, failure does not break the audit.
- [ ] **3.4 Performance section** in the report, "not available" states.
- [ ] **3.5 SEO of the tool** — metadata, canonical, Open Graph, `noindex` on reports, sitemap, robots, JSON-LD, Lighthouse CI.
- [ ] **3.6 ADR 0003 — AWS service** (e.g. App Runner vs ECS Fargate vs Elastic Beanstalk), linked to AWS Developer exam topics. *You decide.*
- [ ] **3.7 AWS** — budget alert first, then RDS, container deploy, HTTPS, secrets out of the repo.
- [ ] **3.8 Live link** in README, CV and LinkedIn.

## Week 4 · 7–13 Dec · 13–18 h — AI Marketing Advisor (phase 3)

Demo: report with "AI suggestion" cards tied to measured findings; the 30-second pitch.

- [ ] **4.1 Advisor schema** — `AdvisorOutputSchema` in `packages/shared`; prompt in its own file, versioned.
- [ ] **4.2 Gemini client** — one call per audit, input = findings (`warn`/`fail` check results) + performance only, structured JSON output.
- [ ] **4.3 Validation and filtering** — Zod validation, drop recommendations with unknown `checkId` (logged), tests for valid, invalid and hallucinated output.
- [ ] **4.4 Graceful degradation** — audit saved and flagged when Gemini or PageSpeed fail; tests.
- [ ] **4.5 AI section in the report** — visually distinct, labelled "AI suggestion".
- [ ] **4.6 Content** — 2 guides (`initial_render`, `meta_description_length` suggested), Search Console with sitemap, privacy-friendly analytics, one conversion (audits started from home).
- [ ] **4.7 Final README** — screenshots, live link, architectural choices, the tool's audit of its own home page.

---

## Backlog (after 13 Dec, phase 4 — do not start earlier)

Multi-page crawler · cross-page duplicates · job queue · PDF export · IT/DE reports · monitoring.

Deferred CheckIds (decided in 1.5; add an ID only when its check is built):
- `img_alt_empty` — an empty `alt` is correct for decorative images, so it could only ever be `info`; the count can go in `img_alt_presence.measured`.
- `img_dimensions` — CSS can also prevent layout shift and is invisible without rendering (false positives); PageSpeed CLS covers it.
- `structured_data_consistency` — matching JSON-LD to visible content needs rules per schema type and is close to semantic evaluation.
- `internal_links` — no threshold to judge a count against; link structure is out of scope.
- `nofollow_links` — often intentional, so only `info`; overlaps page-level `nofollow` in `robots_directives`.
- AI content checks (title relevance, clarity, keyword stuffing) — need a separate AI Content Advisor design; Gemini never creates check results or findings.

## How to give Claude Code a task

> Read `CLAUDE.md` and `docs/implementation-plan.md`. Implement task **1.7**. Restate the acceptance criteria, write the tests first, then the implementation. Stop and ask if you need a decision not covered by the project docs or an ADR.
