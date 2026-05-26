---
phase: 62-insights-research-engine
plan: 06
subsystem: research-public-hub
tags: [public-hub, seo, research, rss, sitemap, scholarly-article, dp-methods]
status: complete

dependency-graph:
  requires: [62-01, 62-05]
  provides: [public-research-hub, rss-feed, sitemap-extension, dp-methods-footer]
  affects: [App.tsx, vite.config.ts, src/index.css]

tech-stack:
  added: []
  patterns:
    - BrowserRouter scoped to /research/* (mirrors KnowledgeRoute.tsx)
    - ScholarlyArticle JSON-LD (schema.org) — not MedicalWebPage
    - RFC 822 pubDate RSS 2.0 feed (build-time generated)
    - Vite buildStart plugin hook for prebuild scripts
    - DOMPurify sanitizeRagMarkdown (reused from Phase 60-13)
    - fetchResearchMarkdown via static /research-content/<slug>.md files

key-files:
  created:
    - leanshot/src/types/research.ts
    - leanshot/src/components/research/DpMethodsFooter.tsx
    - leanshot/src/components/research/ResearchRoute.tsx
    - leanshot/src/components/research/ResearchIndexPage.tsx
    - leanshot/src/components/research/ResearchArticlePage.tsx
    - leanshot/src/components/research/ResearchNotFound.tsx
    - leanshot/src/lib/research/api.ts
    - leanshot/src/lib/research/rss.ts
    - leanshot/src/lib/research/__tests__/rss.test.ts
    - leanshot/scripts/build-research-rss.mjs
    - leanshot/scripts/build-research-sitemap.mjs
  modified:
    - leanshot/src/App.tsx (ResearchRoute lazy + View union + selectView + render case)
    - leanshot/vite.config.ts (leanshot-research-prebuild plugin)
    - leanshot/.gitignore (public/research/rss.xml + public/research-content/)

decisions:
  - ScholarlyArticle JSON-LD (not MedicalWebPage) — research papers are scholarly, not clinical
  - robots=index on all /research/* — inverts Phase 60-13 noindex decision for knowledge hub
  - Markdown body served via /research-content/<slug>.md static files (copied at build time by build-research-rss.mjs from content/research/ at git root)
  - DpMethodsFooter unconditionally rendered in ResearchArticlePage (T-62-06-04)
  - RSS feed generated at build time (no runtime DB exposure) with graceful empty-feed fallback when env vars missing
  - types/research.ts created in this plan (Rule 3 deviation — 62-05 Task 0 dependency was missing; 62-05 not yet executed)

metrics:
  duration: 11 minutes
  completed: 2026-05-26
  tasks: 3
  files_created: 11
  files_modified: 3
---

# Phase 62 Plan 06: Public /research/* Hub Summary

**One-liner:** Public research hub with ScholarlyArticle JSON-LD, RSS feed, DpMethodsFooter, and sitemap extension — all SEO-indexed.

## What Was Built

### Task 1: Core Utilities + DpMethodsFooter

- **`src/types/research.ts`** — Canonical `ResearchPublication` + `ResearchPublicationStatus` types (Rule 3 deviation: created because 62-05 Task 0 was not executed)
- **`src/components/research/DpMethodsFooter.tsx`** — Mandatory DP disclosure footer with 4-row `<dl>` (sr-only dt, font-mono tabular-nums dd), `aria-label="Differential privacy disclosure"` container
- **`src/lib/research/api.ts`** — `fetchPublishedResearch`, `fetchResearchBySlug`, `fetchResearchMarkdown` helpers; imports `ResearchPublication` from `@/types/research`
- **`src/lib/research/rss.ts`** — Pure `buildRssXml` + `toRfc822` functions with XML escaping
- **`src/lib/research/__tests__/rss.test.ts`** — 5 Vitest tests all passing

**Test results:** 5/5 passed

### Task 2: Route Components + App.tsx Wiring

- **`ResearchRoute.tsx`** — BrowserRouter scoped to `/research` (mirrors KnowledgeRoute.tsx); routes index + `:slug` + 404
- **`ResearchIndexPage.tsx`** — Public index with `text-heading font-display italic` H1, RSS link, publication card grid, Helmet SEO (NO noindex)
- **`ResearchArticlePage.tsx`** — 223 lines: ScholarlyArticle JSON-LD, ReactMarkdown + DOMPurify sanitization, unconditional DpMethodsFooter, Helmet with `og:*` meta (NO noindex)
- **`ResearchNotFound.tsx`** — 404 fallback with "Browse all research →" link
- **`App.tsx`** — Added:
  - `const ResearchRoute = lazy(() => import('@/components/research/ResearchRoute'))`
  - `'research'` to `View` type union
  - `if (opts.pathname.startsWith('/research')) return 'research'` in `selectView` (BEFORE marketing fallback, AFTER /knowledge and /protocols)
  - `if (view === 'research') return (<Suspense fallback={<FullPageLoader />}><ResearchRoute /></Suspense>)`

**App.tsx selectView diff:**
```typescript
// After /knowledge branch:
if (opts.pathname.startsWith('/research')) return 'research';
// After /protocols branch, before marketing fallback
```

### Task 3: Build Scripts + vite.config.ts

- **`scripts/build-research-rss.mjs`** — Copies 3 markdown files from `content/research/` to `public/research-content/`; fetches published publications; writes `public/research/rss.xml`; graceful empty-feed fallback when env vars missing
- **`scripts/build-research-sitemap.mjs`** — Appends `/research` + `/research/<slug>` URLs to `public/sitemap.xml`; deduplicates on re-run
- **`vite.config.ts`** — `leanshot-research-prebuild` plugin with `buildStart` hook calling both scripts; `SKIP_RESEARCH_PREBUILD=1` escape hatch

**Build script verification output:**
```
[build-research-rss] Copied 3 markdown file(s) to public/research-content/
[build-research-rss] VITE_SUPABASE_URL not set — generating empty RSS feed.
[build-research-rss] Wrote public/research/rss.xml (432 bytes, 0 items).
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>LeanShot Research</title>
    ...
```

## ScholarlyArticle JSON-LD Confirmation

```json
{
  "@context": "https://schema.org",
  "@type": "ScholarlyArticle",
  "headline": "{publication.title}",
  "description": "{publication.abstract, 160 chars}",
  "datePublished": "{publication.published_at}",
  "dateModified": "{publication.updated_at}",
  "author": { "@type": "Organization", "name": "LeanShot Research" },
  "publisher": {
    "@type": "Organization",
    "name": "LeanShot",
    "logo": { "@type": "ImageObject", "url": "https://app.leanshot.app/og-image.png" }
  },
  "mainEntityOfPage": "https://app.leanshot.app/research/{slug}"
}
```

## @theme Tokens Added

None — all required tokens already defined in `src/index.css`:
- `--color-border`, `--color-surface-elevated`, `--color-text`, `--color-text-secondary`, `--color-text-tertiary` (pre-existing)
- `--color-primary`, `--color-surface`, `--color-admin-table-row-hover` (pre-existing)

## DpMethodsFooter Render Confirmation

`DpMethodsFooter` is unconditionally rendered in `ResearchArticlePage.tsx` at the end of the article body, outside any conditional branches:

```tsx
{/* ── DP Methods Footer (MANDATORY — T-62-06-04) ─────────── */}
<DpMethodsFooter
  epsilon={publication.epsilon ?? 0.5}
  cohortSize={publication.cohort_size ?? 0}
  suppressedBuckets={publication.suppressed_buckets ?? 0}
/>
```

## Markdown Content Strategy

Content markdown files (`content/research/*.md`) are copied to `public/research-content/` at build time by `build-research-rss.mjs`. At runtime, `fetchResearchMarkdown(slug)` fetches `/research-content/${slug}.md`. This avoids bundling markdown into the SPA chunk while keeping the content statically served.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] types/research.ts created inline (62-05 Task 0 dependency missing)**
- **Found during:** Task 1 setup
- **Issue:** Plan 62-05 (admin publication UI) had not been executed, so `src/types/research.ts` was missing. Plan 62-06 depends on 62-05 for this type.
- **Fix:** Created `src/types/research.ts` with the exact interface shape from Plan 62-05 Task 0 spec: `ResearchPublication` + `ResearchPublicationStatus`
- **Files modified:** `leanshot/src/types/research.ts` (created)
- **Commit:** 4c2ca4cb

## Commits

| Hash | Description |
|------|-------------|
| 4c2ca4cb | feat(62-06): DpMethodsFooter + lib/research/api.ts + rss.ts + types/research.ts |
| bbf3eac4 | feat(62-06): ResearchRoute + IndexPage + ArticlePage + NotFound + App.tsx wiring |
| f54f1dc1 | feat(62-06): build-research-rss.mjs + build-research-sitemap.mjs + vite.config.ts |

## Self-Check: PASSED

- [x] All 11 created files exist on disk
- [x] All 3 modified files updated
- [x] ScholarlyArticle JSON-LD present in ResearchArticlePage.tsx
- [x] DpMethodsFooter unconditionally rendered
- [x] NO noindex directive in /research/* pages (only in comments explaining its absence)
- [x] startsWith('/research') in App.tsx selectView
- [x] RSS script runs without error (empty feed + warning when DB unreachable)
- [x] build-research-rss.mjs writes public/research/rss.xml
- [x] 5 Vitest tests all passing
- [x] All @theme tokens defined in index.css
- [x] Commits 4c2ca4cb, bbf3eac4, f54f1dc1 exist in git log
