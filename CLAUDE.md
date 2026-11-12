# SEO Audit Tool

Single-page technical SEO audit. A user submits a URL → the **audit engine** runs deterministic checks → **PageSpeed Insights** adds performance data → **Gemini** turns failing findings into prioritised, business-language recommendations. Each audit gets a public, shareable link. No user accounts.

Portfolio project for a Full Stack Developer role. Hard deadline for the MVP (phases 1–3): **29 Nov 2026**.

- Full specification (Italian): `docs/spec.md` — source of truth for scope, checks, thresholds, data model, API.
- Current plan and task list: `docs/implementation-plan.md`
- Architecture decisions: `docs/adr/` — follow them; do not contradict an ADR without asking.
- Package-specific rules: `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`

## Non-negotiable principles

1. **The engine produces facts; AI only interprets.** Findings come only from engine checks. Gemini never creates findings, never sees raw page HTML, and every recommendation must reference an existing `checkId` of the same audit. Anything else is discarded and logged.
2. **Security is phase 1, not later.** Every request to a user-supplied URL (page, redirects, robots.txt, links) goes through the API's `SafeFetcher`. Never call `fetch`, `undici` or any HTTP client directly on a user-supplied URL.
3. **MVP scope only.** If a task would add anything from "Out of scope" below, stop and say so instead of building it.
4. **Tests first for engine checks**, with local HTML fixtures. Unit tests never touch the network.
5. **Small, explainable diffs.** The author must be able to explain every line in an interview. Prefer plain, readable code over clever abstractions.

## Repository layout

```
apps/
  api/        NestJS API: engine, fetcher, PageSpeed client, AI advisor, Prisma
  web/        Next.js (App Router) frontend, server-rendered report
packages/
  shared/     Types and Zod schemas shared by api and web (@seo-audit/shared)
docs/
  spec.md
  implementation-plan.md
  adr/        NNNN-short-title.md, one decision per file
.github/workflows/ci.yml
docker-compose.yml   PostgreSQL for local development
```

## Stack

- npm workspaces monorepo, TypeScript (strict) everywhere, Node 24 LTS
- API: NestJS, cheerio (no headless browser), Prisma + PostgreSQL, Zod, undici, `@nestjs/throttler`
- Web: Next.js App Router, Tailwind CSS, server components by default
- AI: Google Gen AI SDK (Gemini), structured JSON output
- Tests: Vitest (+ Supertest for HTTP); CI: GitHub Actions
- Deploy (week 3): AWS container service + RDS PostgreSQL, chosen in an ADR

Use the latest stable version of each dependency and check its current docs when an API looks unfamiliar; do not rely on remembered APIs for Next.js, Prisma or the Gen AI SDK.

## Commands

Run from the repo root. Keep this section updated when scripts change.

```bash
npm install
docker compose up -d                 # PostgreSQL on localhost:5432
npm run dev                          # api + web in parallel
npm run lint
npm run typecheck
npm test                             # all packages
npm test -w apps/api -- <pattern>    # single test file / pattern
npm exec -w apps/api -- prisma migrate dev
```

## Conventions

- **Language:** code, comments, identifiers, UI text, README and commit messages in English.
- **TypeScript:** `strict: true`, no `any`. External or unknown data is `unknown` until parsed with Zod.
- **Zod at every boundary:** API request bodies, PageSpeed responses, Gemini responses, env variables.
- **Shared contract:** API response types and the `CheckId` / `CheckStatus` / `Priority` enums live in `packages/shared`. Both apps import from `@seo-audit/shared`; never duplicate these types.
- **Check IDs are stable and snake_case**, exactly as in the spec: `title`, `meta_description`, `h1`, `heading_order`, `canonical`, `meta_robots`, `img_alt`, `structured_data`, `broken_links`, `initial_render`. Never rename one.
- **Config:** read env vars only through a validated config module. `.env.example` lists every variable; real `.env` files are never committed.
- **Commits:** Conventional Commits (`feat(api): add h1 check`), one logical change per commit.
- **Dependencies:** don't add one without stating why in your summary. Prefer what is listed above.

## How to work on a task

1. Take one task from `docs/implementation-plan.md`. Restate its acceptance criteria before writing code.
2. If the task needs a decision not covered by the spec or an ADR (library, data shape, threshold, folder structure), **propose 2–3 options with trade-offs and wait**. Don't decide silently.
3. For checks and security code: write fixtures and failing tests first, then implement.
4. Before saying a task is done, run `npm run lint`, `npm run typecheck` and `npm test`, and report the results.
5. End with a short summary: what changed, which files, anything the author should review carefully or explain in an interview.

Don't edit `docs/spec.md` or existing ADRs unless asked. Never touch `.env` files or print secrets.

## Out of scope before 29 Nov (backlog only)

Multi-page crawler, cross-page duplicate titles/descriptions, site link structure and orphan pages, scheduled monitoring and email notifications, competitor comparison, login/accounts/paid plans, job queue (BullMQ/Redis), PDF export, Italian/German report translations.
