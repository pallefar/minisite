---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 13
subsystem: frontend-seo
tags: [rag, phase-60, public-hub, seo, react-router, react-helmet-async, knowledge-base, sitemap]

requires:
  - phase: 60-rag-knowledge-base-completion-waves-2-4
    plan: 01
    provides: "rag_chunks table + federated_sources + newsletter_subscribers"
  - phase: 60-rag-knowledge-base-completion-waves-2-4
    plan: 06
    provides: "retrieve + rerank fn"
  - phase: 60-rag-knowledge-base-completion-waves-2-4
    plan: 10
    provides: "DOMPurify config + i18n + citation UI + fda_off_label_full key (added here)"

provides:
  - "Public /knowledge root page: topic grid + featured chunk + newsletter signup"
  - "Public /knowledge/<topic> topic index: fuse.js search + tier filter pills + article grid"
  - "Public /knowledge/<topic>/<slug> article detail: MedicalWebPage JSON-LD + canonical + og:image + noindex guard"
  - "KnowledgeBreadcrumb with BreadcrumbList JSON-LD"
  - "SourcesPanel: tier (neutral) + freshness + leanshot_research amber disclosure"
  - "src/lib/knowledge/api.ts: 6 typed PostgREST queries + zod validation"
  - "src/lib/knowledge/topics.ts: RESERVED_SLUGS + TOPIC_DISPLAY_NAMES + validators"
  - "src/lib/rag/sanitize.ts: article body sanitizer (wider allowlist than verbatim-quote config)"
  - "scripts/build-sitemap.ts: build-time sitemap.xml + og card generator"
  - "public/sitemap.xml: grouped by topic (root + topics + articles)"
  - "rag_chunks.title + slug + public_visibility columns (migration 20281201000021)"
  - "selectView('/knowledge*') returns 'knowledge' before all auth/dashboard branches"

affects:
  - "60-15 close-out: new migration 20281201000021 must be included in db-push matrix"
  - "Phase 62 /research/<slug> whitepaper routes: no collision — knowledge uses /knowledge/* only"
  - "Phase 64 legal-refresh: fda_off_label_full i18n key created here; Phase 64 will audit text"
  - "Phase 67 OPS-08: rate-limit tightening for /knowledge/* (current: covered by global middleware matcher)"

tech-stack:
  added:
    - "react-helmet-async@2.0.5 — <Helmet> for per-page <head> meta on /knowledge/* pages"
    - "react-router-dom@6.30.3 — BrowserRouter scoped to /knowledge subtree"
    - "@axe-core/playwright@4.11.3 — devDep for E2E a11y assertions"
  patterns:
    - "Consumer-phase router widening: BrowserRouter basename=/knowledge in KnowledgeRoute.tsx (reference_react_router_consumer_admin_split)"
    - "view='knowledge' render branch without globalOverlays (mirrors /verify/ leaf-surface isolation)"
    - "3-layer T-60-13-INFO-1: sitemap exclusion + noindex meta + RLS public_visibility=true"
    - "DOMPurify article body sanitizer: p a ul ol li code pre strong em blockquote mark h2 h3 h4 (T-60-13-XSS-1)"
    - "Build-time sitemap.ts: non-fatal prebuild script (skips if DB unreachable)"

key-files:
  created:
    - "leanshot/src/components/knowledge/KnowledgeRoute.tsx"
    - "leanshot/src/components/knowledge/KnowledgeNotFound.tsx"
    - "leanshot/src/components/knowledge/KnowledgeRootPage.tsx"
    - "leanshot/src/components/knowledge/KnowledgeTopicIndexPage.tsx"
    - "leanshot/src/components/knowledge/KnowledgeArticleDetailPage.tsx"
    - "leanshot/src/components/knowledge/KnowledgeBreadcrumb.tsx"
    - "leanshot/src/components/knowledge/SourcesPanel.tsx"
    - "leanshot/src/components/knowledge/KnowledgeTierBadge.tsx"
    - "leanshot/src/lib/knowledge/api.ts"
    - "leanshot/src/lib/knowledge/topics.ts"
    - "leanshot/src/lib/rag/sanitize.ts"
    - "leanshot/scripts/build-sitemap.ts"
    - "leanshot/e2e/60-knowledge-hub.spec.ts"
    - "supabase/migrations/20281201000021_rag_chunks_public_hub_columns.sql"
    - "leanshot/src/lib/knowledge/__tests__/api.test.ts"
    - "leanshot/src/lib/knowledge/__tests__/select-view.test.ts"
    - "leanshot/src/components/knowledge/__tests__/KnowledgeRootPage.test.tsx"
    - "leanshot/src/components/knowledge/__tests__/KnowledgeTopicIndexPage.test.tsx"
    - "leanshot/src/components/knowledge/__tests__/KnowledgeArticleDetailPage.test.tsx"
  modified:
    - "leanshot/src/App.tsx — View type + selectView() /knowledge branch + KnowledgeRoute lazy import + render branch"
    - "leanshot/src/main.tsx — HelmetProvider wraps <App />"
    - "leanshot/src/index.css — text-heading token (28px) added to @theme"
    - "leanshot/package.json — react-helmet-async + react-router-dom + prebuild script + @axe-core/playwright"
    - "leanshot/middleware.ts — comment added documenting /knowledge/* T-60-DOS-1 coverage"
    - "leanshot/public/robots.txt — Phase 60-13 comment block added (additive)"
    - "leanshot/public/locales/en/rag.json — fda_off_label_full key added"
    - "leanshot/public/locales/es/rag.json — fda_off_label_full key added"
    - "leanshot/playwright.config.ts — P60_KNOWLEDGE_HUB_OPT_IN + testIgnore entry"

decisions:
  - "react-helmet-async installed (plan correctly identified absence at iter-1)"
  - "react-router-dom@6.30.3 installed (admin pages use custom router, not react-router; first project use of react-router-dom)"
  - "sanitize.ts ownership: 60-13 creates it (60-10 ships dompurify-config.ts with strict verbatim-quote list; this is the separate wider article-body allowlist)"
  - "rag_chunks.title column: 60-01 did NOT add it; 60-13 migration adds title + slug + public_visibility as extension"
  - "text-heading CSS token (28px): added pre-emptively to src/index.css (60-15 close-out would add it; added here since it's a load-bearing invariant for this plan)"
  - "Playwright spec location: e2e/ not tests/e2e/ (playwright testDir=./e2e; tests/e2e/ is vitest)"
  - "middleware.ts matcher: global catch-all already covers /knowledge/*; comment added per T-60-13-DOS-1; no new matcher entry needed"
  - "T-60-13-PHARMA-02: no 4th invariant layer added; 39-02 D-06 upstream layers cover; documented in component + summary"
  - "fda_off_label_full i18n key: added in this plan since 60-10 did not ship it (plan spec said '60-10 i18n' — i18n.ts exports hook, but fda_off_label_full key was absent from rag.json)"

metrics:
  duration: 25min
  completed: 2026-05-26
  tasks_completed: 5
  files_created: 19
  files_modified: 9
  tests_added: 51
---

# Phase 60 Plan 13: Public Knowledge Hub Summary

Shipped the public `/knowledge/*` SEO hub (RAG-09): three-surface consumer-facing hub backed by `public.rag_chunks`, accessible to unauthenticated visitors, with full SEO meta (MedicalWebPage JSON-LD, canonical, og:image), build-time sitemap.xml, and axe-core a11y Playwright E2E.

## Deviations from Plan

### Pre-Task Migrations (Rule 2 — Missing Critical Functionality)

**[Rule 2 - Missing] rag_chunks slug/public_visibility/title columns absent from all prior migrations**
- **Found during:** Pre-execution scan
- **Issue:** 60-01 SUMMARY confirmed it did NOT add `slug`, `public_visibility`, or `title` columns. Plan said "assume present; add via 60-01 extension". No migration existed.
- **Fix:** Created `supabase/migrations/20281201000021_rag_chunks_public_hub_columns.sql` adding all 3 columns + unique index + RLS update
- **Files modified:** `supabase/migrations/20281201000021_rag_chunks_public_hub_columns.sql`

**[Rule 2 - Missing] fda_off_label_full i18n key absent from rag.json**
- **Found during:** Pre-execution check of public/locales/en/rag.json
- **Issue:** Plan references `t('rag.fda_off_label_full')` but the key did not exist in the locale file
- **Fix:** Added the key to both en/rag.json and es/rag.json with the verbatim UI-SPEC §3 text
- **Files modified:** `public/locales/en/rag.json`, `public/locales/es/rag.json`

**[Rule 2 - Missing] text-heading CSS token (28px) absent from src/index.css**
- **Found during:** Pre-execution grep of @theme block
- **Issue:** Plan requires Fraunces H1 at `text-heading` (28px); token missing from CSS
- **Fix:** Added `--text-heading: 1.75rem` + line-height to `@theme {}` block
- **Files modified:** `src/index.css`

### Task 1 Deviations

**[Rule 3 - Routing] Playwright spec location: e2e/ vs tests/e2e/**
- **Found during:** Task 5 planning
- **Issue:** Plan specified `tests/e2e/knowledge-hub.spec.ts` but playwright.config.ts testDir is `./e2e`; `tests/e2e/` uses vitest (hitl-queue etc.)
- **Fix:** Created `e2e/60-knowledge-hub.spec.ts` under the correct playwright testDir
- **Files modified:** `e2e/60-knowledge-hub.spec.ts`, `playwright.config.ts`

### Task 4 Deviations

**[Rule 2 - No-op] middleware.ts matcher already covers /knowledge/***
- **Found during:** Task 4 middleware review
- **Issue:** Plan said "Add `/knowledge/:path*` to matcher" but existing `/((?!api|_next/static|assets|favicon).*)` global regex already covers /knowledge/* paths
- **Fix:** Added comment documenting T-60-13-DOS-1 coverage; no new matcher entry needed
- **Files modified:** `middleware.ts` (comment only)

**[Rule 2 - Scope] sanitize.ts ownership: 60-10 ships dompurify-config.ts (strict verbatim-quote)**
- **Found during:** Task 3 implementation
- **Issue:** 60-10 shipped `src/lib/rag/dompurify-config.ts` with strict `[strong em b i br]` allowlist for verbatim quotes. Plan said "reuse `sanitize.ts` if shipped in 60-10". File not found; need wider allowlist for article body.
- **Fix:** Created `src/lib/rag/sanitize.ts` with `sanitizeRagMarkdown()` (article body allowlist: `p a ul ol li code pre strong em blockquote mark h2 h3 h4`). The two files coexist: dompurify-config.ts (citation popover, strict) and sanitize.ts (article body, wider).
- **Files created:** `src/lib/rag/sanitize.ts`

## Known Stubs

None — all data paths are wired. Newsletter signup POSTs to `rag-newsletter-subscribe-public` Edge Fn (from 60-12). If 60-12's Fn is not deployed, the subscribe form shows an error state (graceful failure).

## Carry-overs

| Item | Target Phase | Reason |
|------|-------------|--------|
| Rate-limit threshold tightening for /knowledge/* | Phase 67 OPS-08 | Per CONTEXT.md; current global middleware applies |
| /research/<slug> whitepaper routes | Phase 62 | No collision; this plan only owns /knowledge/* |
| FDA disclaimer text legal audit | Phase 64 | Legal-refresh audit; fda_off_label_full key is placeholder |
| Lighthouse Indexability score UAT | Operator | Client-render bet; if <90, vite-plugin-prerender escape-hatch in Phase 64/69 |
| Spanish content for /knowledge/* | v1.5 | CONTEXT.md deferred |
| Auth-wall-after-N-visits | v1.5 | CONTEXT.md deferred |
| Semantic cache for knowledge queries | v1.5 | CONTEXT.md deferred |
| Infinite scroll on topic index | v1.5 | Current: "Load more" button stub |
| @vercel/og runtime endpoint for og cards | Phase 67 | Current: SVG placeholder; real OG images need Satori/Vercel OG |

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: info_disclosure | src/lib/rag/sanitize.ts | Article body sanitizer wider than verbatim-quote config — confirmed intentional per UI-SPEC §8 allowlist |
| threat_flag: new_endpoint | src/lib/knowledge/api.ts | New PostgREST queries from browser; anon RLS enforces public_visibility=true at DB level |

## PHARMA-02 Carveout

The 39-02 D-06 three-layer invariant (ESLint AST rule + runtime helper + CI grep) already enforces PHARMA-02 upstream. This plan does NOT add a fourth layer. The `sanitizeRagMarkdown()` function applies DOMPurify stripping only; PHARMA-02 enforcement is at content-ingestion time, not render time. Documented in `KnowledgeArticleDetailPage.tsx` inline comment and this summary.

## Test Coverage

| Category | Count | Status |
|----------|-------|--------|
| Vitest unit tests | 51 | All passing |
| Playwright E2E | 10 | Gated (PLAYWRIGHT_RUN_P60_KNOWLEDGE_HUB=1) |
| TypeScript | 0 errors | tsc --noEmit exits 0 |
| ESLint | 0 errors | eslint src/components/knowledge/ + src/lib/knowledge/ exits 0 |

## Commits

| Hash | Description |
|------|-------------|
| d2d32ecb | feat(60-13): install react-helmet-async + react-router-dom, wire HelmetProvider, extend selectView for /knowledge |
| 2afd95d0 | feat(60-13): build typed knowledge API + KnowledgeRootPage + KnowledgeTopicIndexPage |
| 91cb00d4 | feat(60-13): build KnowledgeArticleDetailPage + KnowledgeBreadcrumb + SourcesPanel |
| 4f480f41 | feat(60-13): build-sitemap.ts + robots.txt update + middleware comment + DB migration |
| 44eb0bea | test(60-13): add Playwright E2E for public knowledge hub (10 tests) |

## Self-Check: PASSED

All key files found on disk. All 5 commits verified in git log. 51 vitest tests green.
