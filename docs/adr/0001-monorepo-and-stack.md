# 0001 — Monorepo and Technology Stack

- **Status:** accepted
- **Date:** 2026-11-19

## Context

The SEO Audit Tool requires a backend to fetch and analyze web pages and a frontend to display SEO audit reports.

Both applications need to share consistent data types and API contracts.

As a solo developer building an MVP, I want an architecture that is easy to maintain, supports independent frontend and backend development, and provides opportunities to strengthen my technical skills.

## Decision

We chose a TypeScript monorepo with npm workspaces, Next.js for the frontend, NestJS for the backend, and a shared package for TypeScript types, constants, API contracts and small pure utilities.

**NestJS** was chosen to organize SEO audit logic into modular, testable services and to strengthen practical experience with Node.js and NestJS.

**Next.js** was chosen to gain experience with a new React framework and because its server-side rendering and file-based routing are well suited to SEO-friendly pages and shareable audit reports.

**Monorepo** was chosen to maintain a single source of truth for shared types and API contracts, and to centralize CI/CD workflows while allowing independent builds and deployments.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Monorepo with npm workspaces | Shared types, centralized CI/CD, single repository | More complex code reviews when changes span multiple applications |
| Separate repositories | Clearer boundaries and more focused pull requests | Duplicated configuration and additional effort to synchronize shared contracts |
| pnpm workspaces, Turborepo or Nx | Task caching, builds and tests only for affected packages | Extra tooling and configuration to learn and maintain for three packages |
| NestJS backend | Modular architecture, dependency injection, testable services | Requires maintaining a separate backend application; NestJS 12 is ESM-only, so relative imports need `.js` extensions, and Vitest needs SWC (`unplugin-swc`) to emit the decorator metadata NestJS relies on |
| Next.js Route Handlers for APIs | Fewer applications to manage | Tighter coupling between frontend and backend, less opportunity to practice NestJS |
| Next.js frontend | Server-side rendering, integrated routing, opportunity to learn a new framework | More framework complexity |
| React with Vite | Familiar development environment, simple setup | Additional solutions needed for server-side rendering and routing |

## Consequences

The monorepo allows frontend and backend to share TypeScript contracts and simplifies managing automated checks.

The shared package is compiled with `tsc` into `dist/`, and both apps import that build output. It must therefore be built before the apps can run, typecheck or be tested; the root `pre*` scripts do this automatically.

Plain npm workspaces have no task caching or "affected packages only" builds, so CI runs every check on every push.

NestJS provides a clear structure for implementing and testing the SEO audit logic, while Next.js supports server-rendered reports.

However, maintaining two applications introduces additional configuration and deployment responsibilities.

Changes affecting multiple packages can also make pull requests and code reviews more complex.

As the project grows, we may need more targeted CI workflows and independent deployment processes.