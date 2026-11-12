# apps/web — Next.js frontend

Read the root `CLAUDE.md` first. This file adds frontend-specific rules.

## Pages

| Route | Rendering | Indexed | Notes |
|---|---|---|---|
| `/` | server component + small client form | yes | URL input, validation, loading state |
| `/audits/[id]` | server-rendered | **noindex** | report: score, findings by status, performance, AI suggestions |
| `/guides/[check]` | static | yes | one short guide per check (2–3 in the MVP) |

## Rules

- **Server components by default.** Use `"use client"` only for interactivity (the URL form, toggles). The report must be fully present in the initial HTML — the tool's own `initial_render` check has to pass on its own pages.
- Data comes from the API through one typed client in `src/lib/api.ts`; response types come from `@seo-audit/shared`. Never call `fetch` to the API from scattered components.
- API base URL from a validated env variable; never hard-code it.
- **Measured vs AI must look different.** Measured findings show the exact value (`78 characters`). AI recommendations sit in their own section, labelled "AI suggestion", visually distinct. Never mix them in one list.
- Missing performance data is shown as "not available" with a short reason, never as `0`.
- Each finding links to its guide (`/guides/<checkId>`) when one exists.
- Mobile-first with Tailwind; check every page at 375 px width.
- Accessibility: one `h1` per page, ordered headings, `alt` on images, visible focus states, form errors announced (`aria-live`). Status is never shown by colour alone — add an icon or text.

## SEO of the tool itself

- Metadata API: `metadata` for static pages, `generateMetadata` for reports and guides. Title, description, canonical (production base URL from env) and Open Graph on every page.
- `/audits/[id]`: `robots: { index: false, follow: true }`, but keep title and Open Graph so link previews work.
- `app/sitemap.ts` (home + guides) and `app/robots.ts` (block `/api/`, link the sitemap).
- Open Graph image per report via `opengraph-image.tsx` showing URL and score.
- JSON-LD: `WebApplication` on the home, `Article` on guides.
- Lighthouse CI in GitHub Actions on `/` and one guide, with minimum scores for SEO, performance and accessibility.

## Tests

- Unit tests for pure helpers (score formatting, grouping findings by status).
- Component tests only where logic exists; no snapshot tests.
