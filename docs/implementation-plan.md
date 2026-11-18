# Implementation plan

MVP = phases 1–3, from 2 to 29 November 2026 (~55 h). Each task is small enough for one Claude Code session and has an acceptance criterion. Tick a task only when lint, typecheck and tests are green and you have reviewed the diff.

Every week ends with something you can show in an interview.

---

## Week 1 · 2–8 Nov · ~10 h — Foundations and safe fetching

Demo at the end: CI is green, `POST /api/audits` returns the title/description/h1 findings for a real URL, and localhost is rejected.

- [ ] **1.1 Monorepo skeleton** — npm workspaces with `apps/backend` (NestJS), `apps/frontend` (Next.js), `packages/shared`; root scripts `dev`, `lint`, `typecheck`, `test`; strict TS base config; ESLint + Prettier.
  *Done when:* `npm install && npm run lint && npm run typecheck && npm test` pass on an empty project.
- [ ] **1.2 Local database** — `docker-compose.yml` with PostgreSQL, `.env.example`, Zod-validated config module in the API, `GET /api/health`.
  *Done when:* `docker compose up -d && npm run dev` → `/api/health` returns 200.
- [ ] **1.3 CI** — GitHub Actions on every push: install with `npm ci`, lint, typecheck, test (npm cache keyed on `package-lock.json`).
  *Done when:* a failing test turns the pipeline red.
- [ ] **1.4 ADR 0001** — monorepo and stack choice (context, decision, alternatives). *You write it; Claude Code can review.*
- [ ] **1.5 Shared package** — `CheckId`, `CheckStatus`, `Priority`, `normalizeUrl()` with tests.
  *Done when:* both apps import from `@seo-audit/shared`; `normalizeUrl` has ≥ 8 test cases.
- [ ] **1.6 ADR 0002 — SafeFetcher** — decide timeouts (whole-operation deadline), error → HTTP status mapping, allowed ports. *You write it, starting from the proposals in `apps/backend/CLAUDE.md`.*

SafeFetcher is split into three tasks (rules in `apps/backend/CLAUDE.md` → "SafeFetcher"):

- [ ] **1.7 IP policy** — `fetcher/ip-policy.ts`, pure function `isAllowedAddress(ip)`; explicit range list with RFC comments; IPv4-mapped normalisation.
  *Done when:* table-driven tests cover every blocked range, public IPv4/IPv6, IPv4-mapped forms and unparseable input.
- [ ] **1.8 URL policy** — `fetcher/url-policy.ts`: scheme, credentials, default ports only, `localhost`/single-label hosts, IP literals checked with ip-policy; `fetcher.errors.ts` with the first typed errors.
  *Done when:* table-driven tests pass, including `http://127.0.0.1`, `http://[::ffff:7f00:1]`, `http://169.254.169.254`.
- [ ] **1.9 Safe HTTP client** — `fetcher/service/safe-fetcher.service.ts` + `fetcher/module/fetcher.module.ts`: undici Agent with checked `lookup`, manual redirects (max 5, each re-checked), whole-operation deadline, 5 MB decoded-size limit, HTML only, User-Agent, 4xx/5xx returned as results; exception filter for the typed errors.
  *Done when:* tests with a real undici Agent and a fake resolver cover private address, DNS rebinding, mixed addresses, redirect to metadata/localhost, 6 redirects, > 5 MB (plain and gzip), slow body; a test proves the module wires the strict policy.
- [ ] **1.10 Engine + first checks** — `Check` contract, engine service that parses once with cheerio; checks `title`, `meta_description`, `h1` with pass/warning/fail fixtures; `thresholds.ts` with sources.
  *Open decision before this task:* how to represent a check that could not run without confusing it with a real SEO failure.
- [ ] **1.11 README v1** — concept, architecture diagram, roadmap, local setup.

If week 1 runs long, 1.10 moves to the start of week 2 — don't shorten the SafeFetcher tests.

## Week 2 · 9–15 Nov · 13–18 h — Complete engine and persistence (closes phase 1)

Demo: a full audit with 10 findings saved in PostgreSQL, retrievable by ID, cached for 24 h.

- [ ] **2.1 Checks** `heading_order`, `canonical`, `meta_robots` (meta tag + `X-Robots-Tag` header) — fixtures and tests first.
- [ ] **2.2 Checks** `img_alt`, `structured_data` (safe JSON-LD parsing; invalid JSON = FAIL, absent = INFO).
- [ ] **2.3 Check** `initial_render` — visible text ratio after removing scripts/styles; threshold documented; fixture of a React "app shell".
- [ ] **2.4 Check** `broken_links` — injected `LinkChecker`, HEAD (GET on 405), max 50 links, concurrency 5, via SafeFetcher.
- [ ] **2.5 robots.txt** — `fetcher/robots-policy.ts`, fetched through `SafeFetcher`; respected for the requested page; tests for allowed, disallowed, missing, unreachable.
- [ ] **2.6 Prisma** — schema for Audit, Finding, Recommendation, first migration, `PrismaService`.
  *Open decision before this task:* the field list (start from `apps/backend/CLAUDE.md`).
- [ ] **2.7 Audits endpoints** — `POST` (201 / 200 cache / 400 / 429), `GET /:id`, `GET ?domain=`; Supertest e2e tests with mocked fetcher.
- [ ] **2.8 Phase 1 check** — go through the week 1 and week 2 demos and every *Done when* in weeks 1–2 of this plan, and tick them.

## Week 3 · 16–22 Nov · 13–18 h — Dashboard, performance, deploy (phase 2)

Demo: a live HTTPS link you can put in your CV.

- [ ] **3.1 Input page** — form with client validation, loading state, API errors shown clearly.
- [ ] **3.2 Report page** — server-rendered, score, findings grouped by status, recent audits for the domain, mobile-friendly.
- [ ] **3.3 PageSpeed Insights** — client with Zod-parsed response, mobile strategy, missing field data as `null`, failure does not break the audit.
- [ ] **3.4 Performance section** in the report, "not available" states.
- [ ] **3.5 SEO of the tool** — metadata, canonical, Open Graph, `noindex` on reports, sitemap, robots, JSON-LD, Lighthouse CI.
- [ ] **3.6 ADR 0003 — AWS service** (e.g. App Runner vs ECS Fargate vs Elastic Beanstalk), linked to AWS Developer exam topics. *You decide.*
- [ ] **3.7 AWS** — budget alert first, then RDS, container deploy, HTTPS, secrets out of the repo.
- [ ] **3.8 Live link** in README, CV and LinkedIn.

## Week 4 · 23–29 Nov · 13–18 h — AI Marketing Advisor (phase 3)

Demo: report with "AI suggestion" cards tied to measured findings; the 30-second pitch.

- [ ] **4.1 Advisor schema** — `AdvisorOutputSchema` in `packages/shared`; prompt in its own file, versioned.
- [ ] **4.2 Gemini client** — one call per audit, input = WARNING/FAIL findings + performance only, structured JSON output.
- [ ] **4.3 Validation and filtering** — Zod validation, drop recommendations with unknown `checkId` (logged), tests for valid, invalid and hallucinated output.
- [ ] **4.4 Graceful degradation** — audit saved and flagged when Gemini or PageSpeed fail; tests.
- [ ] **4.5 AI section in the report** — visually distinct, labelled "AI suggestion".
- [ ] **4.6 Content** — 2 guides (`initial_render`, `meta_description` suggested), Search Console with sitemap, privacy-friendly analytics, one conversion (audits started from home).
- [ ] **4.7 Final README** — screenshots, live link, architectural choices, the tool's audit of its own home page.

---

## Backlog (after 29 Nov, phase 4 — do not start earlier)

Multi-page crawler · cross-page duplicates · job queue · PDF export · IT/DE reports · monitoring.

## How to give Claude Code a task

> Read `CLAUDE.md` and `docs/implementation-plan.md`. Implement task **1.7**. Restate the acceptance criteria, write the tests first, then the implementation. Stop and ask if you need a decision not covered by the project docs or an ADR.
