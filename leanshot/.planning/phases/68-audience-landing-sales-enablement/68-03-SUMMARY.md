---
phase: 68-audience-landing-sales-enablement
plan: 3
subsystem: audience-landing-pages
tags: [landing-page, page-builder, json-ld, react-helmet-async, sitemap, audience-targeting, LAND-01, LAND-02, LAND-03, LAND-04]
requires:
  - public.landing_pages + public.landing_page_revisions (Phase 15 — 20261101000002)
  - 3 seed rows in landing_pages: /for-doctors, /for-clinics, /for-coaches (Plan 68-01)
  - react-helmet-async (Phase 60-13)
  - @/lib/supabase singleton (Phase 4+)
provides:
  - <AudienceLandingPage> React component (leanshot/src/components/landing/AudienceLandingPage.tsx)
  - fetchLandingPageBySlug() helper (exported for tests + future callers)
  - 'audience-landing' View type wired into App.tsx selectView/render dispatch
  - 3 new <url> entries in public/sitemap.xml (priority=0.9)
  - 3 new <url> entries in scripts/build-sitemap.ts (regenerated at prebuild)
  - 4 vitest cases (T1-T4 — doctors JSON-LD, clinics placeholder guard, coaches JSON-LD, 404)
affects:
  - leanshot/src/App.tsx — 3 path matchers (/for-doctors, /for-clinics, /for-coaches) + lazy import + render branch
  - Future Phase 70 — when VITE_CALENDLY_BOOK_DEMO_URL ships, clinic CTA auto-unlocks
tech-stack:
  added: []
  patterns:
    - lazy-loaded route chunk (Suspense + import())
    - react-helmet-async <script type="application/ld+json"> emission
    - schema.org Service + audience differentiator (MedicalAudience/BusinessAudience)
    - Placeholder-string runtime guard ([[feedback_placeholder_string_runtime_guard_pattern]])
    - Tailwind v4 @theme tokens only (text-text/text-text-secondary/bg-primary/bg-surface)
    - selectView() catch-all ordering ([[feedback_admin_module_manifest_vs_router_branch_drift]])
key-files:
  created:
    - leanshot/src/components/landing/AudienceLandingPage.tsx
    - leanshot/src/components/landing/AudienceLandingPage.test.tsx
  modified:
    - leanshot/src/App.tsx
    - leanshot/public/sitemap.xml
    - leanshot/scripts/build-sitemap.ts
decisions:
  - LOCAL — inline simplified-block renderer (NOT Phase 15 BlockNode renderer): the 68-01 seed shape is `{type, headline, subhead, cta:{label,href}}` etc., distinct from the Phase 15 page-builder BlockNode tree. Building a reusable renderer for the seed shape would prematurely couple page-builder to audience pages; an inline 3-block-type renderer is the right scope for this plan.
  - LOCAL — JSON-LD payload built INLINE (not via Phase 15 generateJsonLd): the page-builder helper auto-extracts FAQPage Q&A from blocks; audience pages need explicit Service JSON-LD with a `serviceAudience` differentiator (MedicalAudience/Physicians for doctors, BusinessAudience/GLP-1 Clinics, BusinessAudience/Wellness Coaches). Re-using generateJsonLd would emit generic Service+name+description only — missing the audience-targeting signal that's the whole point of the per-audience pages.
  - LOCAL — single component for 3 routes (matches plan): infers slug from `window.location.pathname`. Slug-tolerant fetch (with/without leading slash) handles drift between the 68-01 seed (`/for-doctors` with slash) and any future migration that drops the slash.
  - LOCAL — Calendly placeholder fallback renders disabled "Coming soon" button: per [[feedback_placeholder_string_runtime_guard_pattern]], a literal `${...}` string MUST NEVER appear in the rendered DOM. Until Phase 70 sets VITE_CALENDLY_BOOK_DEMO_URL, the clinic page hides the demo CTA behind a non-actionable disabled button labeled "Coming soon".
  - LOCAL — added entries to BOTH static public/sitemap.xml AND scripts/build-sitemap.ts: the build script REGENERATES the static file on every prebuild, so both must stay in sync. Static file is the pre-build baseline (e.g. SEO crawler hitting a freshly checked-out repo); the script is the canonical post-build source.
metrics:
  duration: ~35 minutes
  completed: 2026-05-27
  tasks: 3
  files: 5
---

# Phase 68 Plan 03: AudienceLandingPage Component + Routes + Sitemap Summary

**One-liner:** Ship `<AudienceLandingPage>` component + 3 router branches + sitemap entries that turn the 68-01 page-builder seeds into actual `/for-doctors` / `/for-clinics` / `/for-coaches` pages with per-audience JSON-LD.

## Tasks Completed

| # | Task                                              | Commit   | Files                                                                       |
| - | ------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| 1 | `<AudienceLandingPage>` component + 4 tests       | bcb876ba | leanshot/src/components/landing/AudienceLandingPage.tsx, AudienceLandingPage.test.tsx |
| 2 | Wire 3 routes in App.tsx                          | ed2c4c8c | leanshot/src/App.tsx                                                        |
| 3 | Sitemap inclusion (static + build script)         | 394414d7 | leanshot/public/sitemap.xml, leanshot/scripts/build-sitemap.ts              |

## Architecture Notes

### Block-tree shape divergence (Phase 15 BlockNode vs 68-01 seed)

The Phase 15 page-builder ships a rich `BlockNode` interface (`{id, type, parent_id, order, content, style}` per `src/lib/page-builder/block-schema.ts`). The 68-01 audience seeds, however, use a much simpler shape — plain flat objects like:

```jsonc
{ "type": "hero", "headline": "...", "subhead": "...", "cta": { "label": "...", "href": "..." } }
{ "type": "feature-grid", "features": [{ "icon": "...", "title": "...", "body": "..." }] }
{ "type": "cta", "label": "...", "href": "..." }
```

This is intentional — the audience pages don't need the full builder schema (nesting, per-block style tokens, drag-drop reorder). The component renders these 3 shapes inline. Reading the 68-01 SUMMARY confirmed this is the correct interpretation; the seed predates any decision to route audience pages through the BlockNode renderer.

### JSON-LD: per-audience Service + serviceAudience differentiator

The Phase 15 `generateJsonLd` helper auto-emits FAQPage JSON-LD from `faq` blocks; for other types it emits only `@context/@type/name/description/url`. Audience pages need a `serviceAudience` differentiator (MedicalAudience/Physicians, BusinessAudience/GLP-1 Clinics, BusinessAudience/Wellness Coaches) — that's the whole point of separate audience pages and what the LAND-04 SEO requirement targets. We build the JSON-LD payload inline in `buildJsonLd()` with the same `\\u003c` escape pattern as the Phase 15 helper (T-15-08-01 mirror) so a future `seo_title` containing `</script>` cannot escape the script tag.

### Vite SPA SEO caveat (deliberate)

`<title>` and `<meta>` set via `react-helmet-async` are CLIENT-side — search-engine crawlers that don't run JavaScript see the raw `index.html` title. The audience pages will render the correct `<title>` for crawlers like Googlebot (which executes JS), but bare HTML crawlers won't. Per CONTEXT.md D-10 ("code-complete; remote deploy + operator-run items defer to Phase 70"), upgrading to a Vercel Edge rewrite or pre-rendered HTML for `/for-doctors` / `/for-clinics` / `/for-coaches` is a Phase 70 candidate. The JSON-LD via Helmet IS the launch baseline.

## Deviations from Plan

### Rule 2 - Auto-added (defensive)

**1. Placeholder-string runtime guard on Calendly CTA.** The 68-01 seed wrote the literal string `${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}` into the clinic-page hero CTA `href`. The plan suggested env substitution but did NOT specify the fallback when the env is unset. Per [[feedback_placeholder_string_runtime_guard_pattern]] (Phase 60 WR-02 precedent), any literal placeholder reaching production rendering is a P1 leak — even on a marketing page. The component now substitutes from `VITE_CALENDLY_BOOK_DEMO_URL` when set, and renders a disabled "Coming soon" button labeled per CONTEXT.md D-09 when unset. Test T2 explicitly asserts the literal `${...}` string is NEVER in the rendered DOM.

**2. Slug-tolerant fetch.** The 68-01 seed stores slugs WITH a leading slash (`/for-doctors`). The plan's routing matched `pathname.startsWith('/for-doctors')` which also starts with the slash, so the obvious match is fine — but I added a slash-normalized retry in `fetchLandingPageBySlug()` so a future migration that drops the leading slash doesn't break the route resolution. Defensive only; no behavior change today.

**3. Static + build-script sitemap dual-update.** The plan asked me to update sitemap.xml; I discovered `scripts/build-sitemap.ts` REGENERATES the static file at prebuild time. Updating only `public/sitemap.xml` would have been silently undone on the next `npm run build`. Both surfaces updated; documented in the script comment.

### Rule 1 - Bug (deferred — pre-existing, NOT introduced)

- `src/hooks/useSubscription.ts:38` references `User.id` but the project's `User` type apparently lacks that property. Six pre-existing `TS2339` errors; out of scope per `<scope_boundary>`. Logged here for the verifier; NOT fixed in this plan.

### Auth gates

None — this plan is pure-client React + static config. No vendor key exchange, no Edge Fn deploy.

## Verification Performed

- [x] `<AudienceLandingPage>` component exists at `leanshot/src/components/landing/AudienceLandingPage.tsx`
- [x] Component fetches `landing_pages WHERE slug=? AND status='published'` via Supabase anon client + reads the published `landing_page_revisions` row's `block_tree`
- [x] Component emits JSON-LD via `<Helmet><script type="application/ld+json">` with per-audience `audienceType` + `serviceType` derived from the URL slug
- [x] Component renders 404 view when slug not found / fetch errors
- [x] 3 routes wired in App.tsx (`pathname.startsWith('/for-doctors'|'/for-clinics'|'/for-coaches')`) — placed AFTER `/research` (public no-auth) and BEFORE `/protocols` (auth-gated) per catch-all ordering rule
- [x] Each route maps to the SAME component; component infers slug from `window.location.pathname` (with `slugOverride` prop for tests)
- [x] `public/sitemap.xml` has 3 new `<url>` entries with `<priority>0.9</priority>` + `<changefreq>monthly</changefreq>` + `<lastmod>2026-05-27</lastmod>`
- [x] `scripts/build-sitemap.ts` injects the same 3 entries at prebuild time (both `main()` happy path AND `generateEmptySitemap()` DB-unreachable fallback)
- [x] `npx vitest run` shows 4/4 tests passing on `AudienceLandingPage.test.tsx`
- [x] `npx tsc --noEmit -p tsconfig.app.json` reports NO new errors on the files touched in this plan (6 pre-existing `useSubscription.ts` errors are out of scope)
- [x] STATE.md / ROADMAP.md NOT modified (parallel-wave executor constraint)

## Known Stubs

**Calendly env wiring deferred to Phase 70.** The clinic page's "Book a demo" CTA currently renders as a disabled "Coming soon" button until `VITE_CALENDLY_BOOK_DEMO_URL` is set (Phase 70 vendor registration per CONTEXT.md D-09). This is the documented intent — NOT a bug — but verifiers should know: visiting `/for-clinics` today shows a non-interactive button. Once Phase 70 sets the env, the CTA auto-unlocks with the real Calendly URL. No code change required at Phase 70 — just the env.

**Server-side `<title>` deferred to Phase 70.** As noted under "Vite SPA SEO caveat" — bare-HTML crawlers won't see the `<title>` set by react-helmet-async. Googlebot (JS-rendering) WILL. A Vercel Edge rewrite or pre-rendered HTML for the 3 audience slugs is a Phase 70 candidate. Documented per plan Task 2.

## Threat Flags

None — no new network endpoints, no auth paths, no schema changes, no file-access patterns. The component reads ONE existing public-RLS-allowed table (`landing_pages` + `landing_page_revisions`) via the anon client. No new trust boundary.

## Self-Check

Verifying all claims before handoff:

**Files exist:**
- leanshot/src/components/landing/AudienceLandingPage.tsx — FOUND
- leanshot/src/components/landing/AudienceLandingPage.test.tsx — FOUND
- leanshot/src/App.tsx — MODIFIED (audience-landing View type + selectView branch + render branch + lazy import)
- leanshot/public/sitemap.xml — MODIFIED (3 new <url> entries)
- leanshot/scripts/build-sitemap.ts — MODIFIED (audience entries in both happy path + empty-sitemap fallback)

**Commits exist:** bcb876ba, ed2c4c8c, 394414d7 — verified via `git log --oneline -5` on worktree branch `worktree-agent-aea9ff17f5c4f5f5b`.

**Tests pass:** `npx vitest run --config vitest.config.ts src/components/landing/AudienceLandingPage.test.tsx` → 4/4 (Test Files 1 passed, Tests 4 passed, ~900ms).

**No CLAUDE.md violations:** Tailwind v4 @theme tokens only (text-text, text-text-secondary, bg-primary, bg-surface, font-display); typography ceiling honored (4 sizes: text-display/text-4xl/text-lg/text-sm; 2 weights: font-semibold/font-normal); no hardcoded hex; lazy-loaded chunk preserves App.tsx code-splitting discipline; defensive error handling (try/catch + soft-fail to 404 view); local-first compatible (no required env vars beyond Calendly placeholder).

**Parallel-wave constraint honored:** STATE.md NOT modified, ROADMAP.md NOT modified, no SDK state verbs invoked.

## Self-Check: PASSED
