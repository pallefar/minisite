---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 13
type: execute
wave: 3
depends_on: [60-01, 60-06, 60-10]
files_modified:
  - package.json
  - package-lock.json
  - src/main.tsx
  - src/App.tsx
  - src/components/knowledge/KnowledgeRootPage.tsx
  - src/components/knowledge/KnowledgeTopicIndexPage.tsx
  - src/components/knowledge/KnowledgeArticleDetailPage.tsx
  - src/components/knowledge/KnowledgeBreadcrumb.tsx
  - src/components/knowledge/SourcesPanel.tsx
  - src/components/knowledge/KnowledgeRoute.tsx
  - src/lib/knowledge/api.ts
  - src/lib/knowledge/topics.ts
  - src/lib/knowledge/__tests__/api.test.ts
  - src/components/knowledge/__tests__/KnowledgeArticleDetailPage.test.tsx
  - src/components/knowledge/__tests__/KnowledgeTopicIndexPage.test.tsx
  - src/components/knowledge/__tests__/KnowledgeRootPage.test.tsx
  - scripts/build-sitemap.ts
  - public/robots.txt
  - tests/e2e/knowledge-hub.spec.ts
autonomous: true
requirements: [RAG-09]
user_setup: []

must_haves:
  truths:
    - "Unauthenticated visitor can browse /knowledge (root) → /knowledge/<topic> (topic index) → /knowledge/<topic>/<slug> (article detail) without auth wall (CONTEXT D-public-no-auth)"
    - "Every article detail page surfaces verbatim source attribution + tier badge + freshness + FDA/DSHEA disclaimer footer (UI-SPEC §8 + §3 invariant 5)"
    - "Article detail page emits JSON-LD MedicalWebPage schema + canonical link + og:image (via @vercel/og card) (CONTEXT hub decisions)"
    - "Topic index + root H1 render Fraunces italic at 28px text-heading; detail page H1 renders 18px font-sans (UI-SPEC §11 typography + invariant 11)"
    - "Source tier badge palette is neutral-only (no green/red); leanshot_research uses amber-soft distinct disclosure (UI-SPEC §10 invariant 6 + 8)"
    - "Chunks with public_visibility=false emit <meta name=robots content=noindex> on detail page; sitemap excludes them (UI-SPEC §8 SEO + CONTEXT hub decisions)"
    - "Build-time scripts/build-sitemap.ts emits public/sitemap.xml grouped by topic listing /knowledge + /knowledge/<topic> + /knowledge/<topic>/<slug> URLs for all rag_chunks WHERE status='published' AND retracted_at IS NULL AND public_visibility=true"
    - "robots.txt allows /knowledge/* crawling and references built sitemap (CONTEXT hub decisions: 'robots.txt allow')"
    - "Verbatim chunk text rendered via react-markdown + DOMPurify allowlist (T-60-XSS-1 mitigation; UI-SPEC §8 body section allowlist)"
    - "Search params (?tier=, ?q=) zod-validated before reaching PostgREST query (T-60-SQLI-1 mitigation)"
    - "Edge Middleware rate-limits /knowledge/* via existing leanshot/middleware.ts rate-limit pipeline (T-60-DOS-1 mitigation; CONTEXT hub decisions: 'Rate-limited via Edge Middleware')"
    - "Consumer router widened via App.tsx selectView() pathname branch '/knowledge' → 'knowledge' View per reference_react_router_consumer_admin_split (consumer-phase widening allowed)"
    - "Reuses Phase 60-10 i18n keys t('rag.attribution') + t('rag.disclaimer') verbatim — no parallel disclaimer copy (UI-SPEC §3 + 60-10 reuse)"
  artifacts:
    - path: "src/components/knowledge/KnowledgeRootPage.tsx"
      provides: "Public /knowledge root surface: topic grid + featured chunk + newsletter signup (UI-SPEC §10)"
      min_lines: 80
    - path: "src/components/knowledge/KnowledgeTopicIndexPage.tsx"
      provides: "Public /knowledge/<topic> surface: hero strip + filter pills + article grid + fuse.js search (UI-SPEC §9)"
      min_lines: 100
    - path: "src/components/knowledge/KnowledgeArticleDetailPage.tsx"
      provides: "Public /knowledge/<topic>/<slug> surface: breadcrumb + H1 + body + SourcesPanel + JSON-LD MedicalWebPage + canonical + og:image + FDA disclaimer footer (UI-SPEC §8)"
      min_lines: 120
    - path: "src/components/knowledge/KnowledgeBreadcrumb.tsx"
      provides: "Reusable breadcrumb 'Home › Knowledge › {topic} › {slug}' (UI-SPEC §8 header)"
    - path: "src/components/knowledge/SourcesPanel.tsx"
      provides: "Right-rail/below-fold source + tier + freshness + Read at source ↗ link (UI-SPEC §8 body)"
    - path: "src/components/knowledge/KnowledgeRoute.tsx"
      provides: "Top-level <Routes> for /knowledge/* using react-router (admin-style widening pattern per reference_react_router_consumer_admin_split)"
    - path: "src/lib/knowledge/api.ts"
      provides: "Browser-side typed PostgREST queries: listPublishedChunks, getChunkBySlug, listTopics, listChunksByTopic; zod-validated params"
    - path: "src/lib/knowledge/topics.ts"
      provides: "Topic slug ↔ display name mapping shared with sitemap script"
    - path: "scripts/build-sitemap.ts"
      provides: "Build-time sitemap.xml generator grouped by topic; emits to public/sitemap.xml; runs via npm prebuild hook"
      contains: "sitemap"
    - path: "public/robots.txt"
      provides: "Existing robots.txt updated to explicitly allow /knowledge/* (already global Allow per Phase 15-08; documented additive)"
    - path: "tests/e2e/knowledge-hub.spec.ts"
      provides: "Playwright SEO + navigation + a11y E2E for the 3 hub surfaces"
  key_links:
    - from: "src/App.tsx"
      to: "src/components/knowledge/KnowledgeRoute.tsx"
      via: "selectView() '/knowledge' branch → lazy import KnowledgeRoute"
      pattern: "pathname.startsWith\\(.'\\/knowledge"
    - from: "src/components/knowledge/KnowledgeArticleDetailPage.tsx"
      to: "src/lib/knowledge/api.ts (getChunkBySlug)"
      via: "fetch in useEffect"
      pattern: "getChunkBySlug"
    - from: "src/components/knowledge/KnowledgeArticleDetailPage.tsx"
      to: "src/lib/i18n/rag-strings.ts (t('rag.disclaimer'))"
      via: "i18next t()"
      pattern: "rag\\.(disclaimer|attribution)"
    - from: "scripts/build-sitemap.ts"
      to: "public.rag_chunks WHERE status='published' AND retracted_at IS NULL AND public_visibility=true"
      via: "Supabase service-role PostgREST at build time"
      pattern: "from\\(.rag_chunks"
    - from: "leanshot/middleware.ts"
      to: "/knowledge/* path matching"
      via: "matcher config (additive entry)"
      pattern: "knowledge"
---

<objective>
Ship the public `/knowledge/*` SEO hub (REQ RAG-09): a three-surface consumer-facing hub at `/knowledge` (root) → `/knowledge/<topic>` (topic index) → `/knowledge/<topic>/<slug>` (article detail), backed by the `public.rag_chunks` corpus from Phase 50 Wave 1 and Phase 60 60-01 extensions.

Purpose: deliver the corpus to non-authenticated visitors for SEO acquisition and brand-trust. Without this plan, the curated knowledge base is admin-internal only — there is no public surface for crawlers, citation-link landing pages, or newsletter "Read more" CTAs (60-12 newsletter links into here). RAG-09 closes the v1.4 RAG arc.

Output: 6 new React components + 1 typed API module + 1 topic mapping + 1 build-time sitemap script + Playwright SEO E2E + Vitest unit tests + `react-helmet-async` dependency install + App.tsx route widening + robots.txt comment-only documentation update.

This plan REUSES `.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-09-PLAN.md` Task 1 (Research Hub list + article detail + route wiring) **with path rename `/research` → `/knowledge/<topic>/<slug>`** per CONTEXT.md hub decisions. Phase 62 owns `/research/<slug>` for white-papers (do not collide).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-09-PLAN.md
@src/App.tsx
@supabase/migrations/20260519000003_rag_chunks_table.sql
@public/robots.txt
@middleware.ts
@package.json

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase + outline. -->
<!-- Executor uses these directly — no codebase exploration needed. -->

Existing `public.rag_chunks` columns (from `supabase/migrations/20260519000003_rag_chunks_table.sql`):
- `id uuid` (PK)
- `topic_id uuid` (FK rag_topics.id)
- `source_id uuid` (FK rag_sources.id)
- `canonical_url text not null`
- `topic_tag text not null` — drives URL `/knowledge/<topic_tag>/<slug>`
- `source_tier` ∈ {A,B,C}
- `summary text` (model-generated; user-facing)
- `quote_blocks jsonb[]` (verbatim quotes per AI-SPEC §4)
- `content_hash text`
- `scraped_at timestamptz`
- `reviewed_at timestamptz`
- `published_at timestamptz` (nullable; null = not published)
- `retracted_at timestamptz` (nullable)
- `status` ∈ {queued, approved, published, rejected, retracted}
- `public_visibility boolean` (Phase 60 60-01 adds this column if not present — assume present; reuse else add via 60-01 migration extension)
- `slug text` (Phase 60 60-01 adds this; one-time backfill from `lower(regexp_replace(title, '[^a-z0-9]+', '-', 'g'))` unique per topic_tag)

Existing `public.rag_sources` columns:
- `id uuid`, `name text`, `source_type text` (∈ {peer-reviewed, regulatory, lay-press, leanshot_research, federated-pubmed, federated-fda, federated-dailymed})

Phase 60 60-10 exports (already in tree by this plan's execute time):
- `src/lib/rag/i18n.ts` — `t('rag.disclaimer')`, `t('rag.attribution')`, `t('rag.fda_off_label_full')` (EN+ES)
- `src/components/ai/SourcesFooter.tsx` — reuse pattern, NOT the component itself (consumer-hub layout differs)
- `src/lib/rag/retrieve-client.ts` — NOT used here; hub uses direct PostgREST via `src/lib/knowledge/api.ts`

App.tsx `selectView()` widening pattern (from `src/App.tsx:671` `selectView(opts: { user, signedInUser, hash, pathname })` switch):
- New top-priority branch BEFORE marketing/onboarding/dashboard:
  `if (opts.pathname.startsWith('/knowledge')) return 'knowledge';`
- Add `'knowledge'` to the `View` union type.
- Lazy-import `KnowledgeRoute` (own chunk; mirrors `/admin/*` AdminShellRoot pattern at `src/App.tsx:200`).
- Add `view === 'knowledge'` branch in the render block at `src/App.tsx:~1667` (above marketing).
- popstate listener already recomputes on path change (see `src/App.tsx:911`); no new wiring needed.

`KnowledgeRoute.tsx` uses **react-router `<BrowserRouter>` + `<Routes>` + `<Route>`** scoped to the `/knowledge` subtree per `reference_react_router_consumer_admin_split` — this is the SAME pattern as admin pages (AdminLayout at `src/components/admin/AdminLayout`). Consumer-phase widening is EXPLICITLY ALLOWED per the memory reference. Do NOT add new TabId entries. Do NOT replace App.tsx Zustand routing.

`react-helmet-async` is NOT YET in `package.json` (outline asserted incorrectly; verified absent). This plan ADDS it via Task 0. Wrap `main.tsx <App />` in `<HelmetProvider>`.

`@vercel/og ^0.11.1` IS in `package.json`. Use it via a build-time script generating static og card PNGs to `public/og/knowledge/<topic>/<slug>.png`, OR via a serverless edge endpoint. Per CONTEXT.md "client-render bet, prerender deferred", ship a build-time generator invoked by the sitemap script: same script reads rag_chunks once, emits sitemap + og card PNGs in one pass.

`fuse.js ^7.3.0` IS in `package.json`. Use for client-side topic-index search.

DOMPurify allowlist (per UI-SPEC §8 body section): `p a ul ol li code pre strong em blockquote mark h2 h3 h4` — NO `img script iframe inline-style`. Reuse existing helper at `src/lib/rag/sanitize.ts` (created in 60-10 for citation popover; same allowlist).

Edge Middleware rate-limit (`leanshot/middleware.ts`): existing `matcher` config does NOT include `/knowledge/*`. Add the matcher entry to bring `/knowledge/*` into the rate-limit pipeline (T-60-DOS-1). Do NOT introduce a new middleware file; the existing one handles CSP + cookie + rate-limit globally.

JSON-LD MedicalWebPage schema shape (per schema.org + UI-SPEC §8):
```
{
  "@context": "https://schema.org",
  "@type": "MedicalWebPage",
  "headline": <chunk title>,
  "description": <verbatim_quote first 160 chars>,
  "datePublished": <chunk.published_at ISO>,
  "dateModified": <chunk.published_at ISO>,  // republish-as-update for now
  "author": { "@type": "Organization", "name": <rag_sources.name> },
  "publisher": { "@type": "Organization", "name": "LeanShot", "logo": { "@type": "ImageObject", "url": "https://app.leanshot.app/og-image.png" } },
  "mainEntityOfPage": <canonical URL>,
  "medicalAudience": "Patient",
  "lastReviewed": <chunk.reviewed_at ISO>
}
```

Per-page meta (via `react-helmet-async <Helmet>`):
- Detail: `<title>{chunk_title} — LeanShot Knowledge</title>`
- Detail description: `<meta name="description" content="{verbatim_quote first 160 chars}">`
- Detail canonical: `<link rel="canonical" href="https://app.leanshot.app/knowledge/{topic}/{slug}">`
- Detail noindex (when `public_visibility=false`): `<meta name="robots" content="noindex,nofollow">`
- Detail og:image: `<meta property="og:image" content="https://app.leanshot.app/og/knowledge/{topic}/{slug}.png">`
- Detail og:type: `<meta property="og:type" content="article">`

Reserved slug values (DO NOT mint articles with these): `index`, `search`, `topics`, `rss`, `feed`, `latest`, `popular`. Enforced in `src/lib/knowledge/topics.ts` as `RESERVED_SLUGS` constant + validator in 60-01 RPC.

</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install react-helmet-async + wire HelmetProvider + extend App.tsx selectView for /knowledge</name>
  <files>package.json, package-lock.json, src/main.tsx, src/App.tsx, src/components/knowledge/KnowledgeRoute.tsx, src/lib/knowledge/topics.ts</files>
  <read_first>src/main.tsx, src/App.tsx (lines 670-790 selectView + 1620-1700 render branches), package.json</read_first>
  <behavior>
    - Test 1 (vitest): `selectView({ pathname: '/knowledge', user: null, signedInUser: null, hash: '' })` returns `'knowledge'`
    - Test 2 (vitest): `selectView({ pathname: '/knowledge/glp-1/tirzepatide-titration-week-4', user: someUser, signedInUser: null, hash: '' })` returns `'knowledge'` (auth state irrelevant — public surface)
    - Test 3 (vitest): `topics.ts` `RESERVED_SLUGS` array includes `['index','search','topics','rss','feed','latest','popular']` and exported `isReservedSlug(s)` predicate returns true for each
    - Test 4 (vitest): `topics.ts` `TOPIC_DISPLAY_NAMES` map keys match `kb_topics.slug` values for v1.4 corpus: `glp-1`, `peptide-research`, `off-label-safety`, `metabolic-health`, `tirzepatide`, `semaglutide`, `liraglutide`, `compounding`, `nutrition`, `lifestyle`
    - Test 5 (vitest): `KnowledgeRoute` renders without crashing under MemoryRouter
  </behavior>
  <action>
    Step 1 — Install dependency:
    Add `"react-helmet-async": "^2.0.5"` to `package.json` dependencies (alphabetized per Phase 38 lint rule). Run `npm install --no-audit --no-fund` (in `leanshot/`) to update `package-lock.json`. If install fails on `@sentry/capacitor` sibling-check per `reference_sentry_capacitor_npm_install_blocker`, use `npm install --ignore-scripts` and document in summary.

    Step 2 — Wire HelmetProvider in `src/main.tsx`:
    Import `HelmetProvider` from `react-helmet-async`. Wrap the `<StrictMode><App /></StrictMode>` tree as `<StrictMode><HelmetProvider><App /></HelmetProvider></StrictMode>`. This is the ONLY change in `main.tsx` — do not modify hydration ordering.

    Step 3 — Extend `View` union + `selectView()` in `src/App.tsx`:
    - Add `| 'knowledge'` to the `View` type union (find existing union around `type View = ...`).
    - In `selectView()` (line ~671), add a TOP-PRIORITY branch IMMEDIATELY after the `#/share/` and `#/legal/` hash branches but BEFORE the auth-callback / clinic-invite / admin / settings / cancel-deletion / onboard branches:
      ```
      if (opts.pathname.startsWith('/knowledge')) return 'knowledge';
      ```
    - This places /knowledge ABOVE clinic + admin + settings + dashboard so a Zustand-persisted user does NOT bounce to dashboard (mirror of `/verify/` pre-check pattern at line 1659 + memory `reference_zustand_persisted_user_blocks_marketing_uat`).

    Step 4 — Lazy-import `KnowledgeRoute` + render branch in `src/App.tsx`:
    - At the top of App.tsx (with other lazy imports around line 200): `const KnowledgeRoute = lazy(() => import('@/components/knowledge/KnowledgeRoute'));`
    - In the render block at ~line 1667 (BEFORE `if (view === 'marketing')`), add:
      ```
      if (view === 'knowledge') {
        return (
          <Suspense fallback={<FullPageLoader />}>
            <KnowledgeRoute />
          </Suspense>
        );
      }
      ```
    - Do NOT include `globalOverlays` (no Sidebar/Topbar/MobileNav on public hub — matches `/verify/` leaf-surface pattern).
    - Document this as a `reference_react_router_consumer_admin_split` consumer-phase widening in an inline comment.

    Step 5 — Create `src/components/knowledge/KnowledgeRoute.tsx`:
    Use react-router (`react-router-dom` is NOT yet in deps but `react-router` is — check; if neither, add `react-router-dom@^6.28.0`). Wrap `<BrowserRouter basename="/knowledge">` + `<Routes>` containing:
    - `<Route index element={<Suspense><KnowledgeRootPage /></Suspense>} />`
    - `<Route path=":topic" element={<Suspense><KnowledgeTopicIndexPage /></Suspense>} />`
    - `<Route path=":topic/:slug" element={<Suspense><KnowledgeArticleDetailPage /></Suspense>} />`
    - `<Route path="*" element={<KnowledgeNotFound />} />` (404 surface with link back to /knowledge)
    Each page is lazy-loaded for ≤30kB-gz chunk per CLAUDE.md bundle constraint.

    Check `package.json` for `react-router-dom`. If absent, add `"react-router-dom": "^6.28.0"` alongside react-helmet-async install in Step 1. (Admin pages currently use a custom router — verify: if admin uses native react-router, reuse same version; else use 6.28.0.)

    Step 6 — Create `src/lib/knowledge/topics.ts`:
    Export:
    - `RESERVED_SLUGS = ['index','search','topics','rss','feed','latest','popular'] as const`
    - `isReservedSlug(s: string): boolean`
    - `TOPIC_DISPLAY_NAMES: Record<string, string>` for the 10 topics named in <behavior> Test 4 (e.g., `'glp-1': 'GLP-1 Agonists'`, `'peptide-research': 'Peptide Research'`, `'off-label-safety': 'Off-Label Safety'`, etc.)
    - `getTopicDisplayName(slug: string): string` — returns the display name or title-cases the slug as fallback.

    Step 7 — Write 5 unit tests per <behavior> in:
    - `src/components/knowledge/__tests__/KnowledgeRootPage.test.tsx` (test 5 — render under MemoryRouter)
    - Tests 1-4 go in a new `src/App.test.tsx` IF NOT PRESENT — otherwise extend; alternatively put `selectView` tests in `src/lib/knowledge/__tests__/select-view.test.ts` by exporting `selectView` (currently internal — make it a named export).

    NEVER place fenced code blocks inside this `<action>` — directive prose only above is intentional; code excerpts are quoted minimally for path/identifier clarity.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm install --no-audit --no-fund 2>&1 | tail -5 && npx tsc -p tsconfig.app.json --noEmit && npx vitest run --config vite.config.ts src/components/knowledge/__tests__/KnowledgeRootPage.test.tsx src/lib/knowledge/__tests__/select-view.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>
    - `react-helmet-async@^2.0.5` + `react-router-dom@^6.28.0` (if not previously present) appear in `package.json` dependencies; `package-lock.json` updated.
    - `HelmetProvider` wraps `<App />` in `main.tsx`.
    - `selectView('/knowledge*')` returns `'knowledge'` BEFORE auth/admin/dashboard branches.
    - `view === 'knowledge'` render branch renders `<KnowledgeRoute />` under Suspense without globalOverlays.
    - `KnowledgeRoute.tsx` uses `<BrowserRouter basename="/knowledge">` + 3 lazy `<Route>` children + 404 fallback.
    - `topics.ts` exports `RESERVED_SLUGS`, `TOPIC_DISPLAY_NAMES`, `getTopicDisplayName`, `isReservedSlug`.
    - All 5 vitest tests green.
    - `tsc --noEmit` exits 0.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build typed knowledge API + KnowledgeRootPage + KnowledgeTopicIndexPage</name>
  <files>src/lib/knowledge/api.ts, src/lib/knowledge/__tests__/api.test.ts, src/components/knowledge/KnowledgeRootPage.tsx, src/components/knowledge/KnowledgeTopicIndexPage.tsx, src/components/knowledge/__tests__/KnowledgeTopicIndexPage.test.tsx, src/components/knowledge/__tests__/KnowledgeRootPage.test.tsx</files>
  <read_first>src/lib/rag/retrieve-client.ts (if exists from 60-10), src/lib/supabase/client.ts, supabase/migrations/20260519000003_rag_chunks_table.sql, .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (§9 + §10)</read_first>
  <behavior>
    - Test 1 (api.test.ts): `listTopics()` returns `{ slug, display_name, chunk_count }[]` for topics with ≥1 published+visible chunk
    - Test 2 (api.test.ts): `listPublishedChunksByTopic({ topic: 'glp-1', tier: 'A', limit: 50 })` queries `rag_chunks` WHERE `status='published' AND retracted_at IS NULL AND public_visibility=true AND topic_tag='glp-1' AND source_tier='A'` and rejects invalid topic via zod (`isReservedSlug` true OR not in `TOPIC_DISPLAY_NAMES`)
    - Test 3 (api.test.ts): zod-validates `tier` ∈ {A,B,C,undefined} — invalid value throws `KnowledgeApiError` BEFORE PostgREST call (T-60-SQLI-1)
    - Test 4 (api.test.ts): zod-validates `q` (search query) — strips control chars, limits ≤120 chars, rejects SQL meta-chars (`;`, `--`, `/*`) at the client layer
    - Test 5 (api.test.ts): `getFeaturedChunk()` returns highest-`published_at` Tier-A chunk with non-null `summary`
    - Test 6 (KnowledgeRootPage.test.tsx): renders Fraunces italic H1 `Knowledge Base` at 28px `text-heading` (assert via `getByRole('heading', { level: 1 })` + classlist contains `font-display` and `text-heading`)
    - Test 7 (KnowledgeRootPage.test.tsx): renders topic grid with N cards from mocked `listTopics()` response, each as `<Card variant="interactive" span={4}>`
    - Test 8 (KnowledgeRootPage.test.tsx): newsletter signup section renders with `Subscribe to digest` button + Input
    - Test 9 (KnowledgeTopicIndexPage.test.tsx): unknown `:topic` param (not in `TOPIC_DISPLAY_NAMES`) renders `<KnowledgeNotFound />` — not crash
    - Test 10 (KnowledgeTopicIndexPage.test.tsx): filter pills `All Tiers / Tier A / Tier B / Tier C` sync to URL `?tier=A` via `useSearchParams`
    - Test 11 (KnowledgeTopicIndexPage.test.tsx): search input filters article grid via fuse.js (mocked); empty state renders `No results for "{query}"`
    - Test 12 (KnowledgeTopicIndexPage.test.tsx): Fraunces italic H1 = topic display name (UI-SPEC §11 invariant 11)
  </behavior>
  <action>
    Step 1 — Create `src/lib/knowledge/api.ts`:
    - Import supabase browser client from existing `src/lib/supabase/client.ts`.
    - Import zod from existing devDep.
    - Define `KnowledgeApiError extends Error`.
    - Define zod schemas: `tierSchema` (enum A/B/C optional), `topicSchema` (string min 1, max 64, regex `^[a-z0-9-]+$`, refine via `isReservedSlug === false`), `slugSchema` (same shape, refine isReservedSlug), `searchQuerySchema` (string max 120, transform stripControlChars + reject SQL meta).
    - Exports:
      - `async function listTopics(): Promise<{ slug: string; display_name: string; chunk_count: number }[]>` — query: `select topic_tag, count(*) from rag_chunks where status='published' and retracted_at is null and public_visibility=true group by topic_tag` (via PostgREST `.select('topic_tag, count')` or RPC if simpler). Joins with `TOPIC_DISPLAY_NAMES` for display_name; filters out unknown topics.
      - `async function listPublishedChunksByTopic({ topic, tier, q, limit = 50 }): Promise<RagChunkRow[]>` — zod-validates all inputs; PostgREST query against `rag_chunks` with proper filters. Returns `id, topic_tag, slug, summary, canonical_url, source_id, source_tier, scraped_at, published_at, quote_blocks` joined with `rag_sources(name, source_type)`.
      - `async function getChunkBySlug({ topic, slug }): Promise<RagChunkDetail | null>` — single row by `topic_tag=topic AND slug=slug AND status='published' AND retracted_at IS NULL`. Returns full chunk + source. Does NOT filter `public_visibility` here — caller decides noindex vs 404.
      - `async function listChunksByTopic({ topic, limit = 50 })` — used by sitemap script (re-export).
      - `async function getFeaturedChunk(): Promise<RagChunkRow | null>` — highest published_at Tier-A.
      - `async function listRelatedChunks({ topic, excludeId, limit = 5 })` — for sidebar.

    Step 2 — Write tests per <behavior> Tests 1-5 in `src/lib/knowledge/__tests__/api.test.ts`. Mock `@/lib/supabase/client` per Phase 47/49 mocking convention (vi.mock + chained `.select().eq().order().limit()` returning typed shapes).

    Step 3 — Create `src/components/knowledge/KnowledgeRootPage.tsx` per UI-SPEC §10:
    - `<Helmet>` block: `<title>Knowledge Base — LeanShot</title>` + meta description "Curated peptide and metabolic research, summarized with sources." + canonical `https://app.leanshot.app/knowledge` + og:title + og:type=website + JSON-LD `WebSite` schema (`@type: WebSite, name: LeanShot Knowledge Base, url, potentialAction: SearchAction`).
    - Hero strip: H1 `Knowledge Base` in `font-display italic` at `text-heading` (28px) weight 600 — SOLE Fraunces usage per UI-SPEC §11 invariant 11.
    - Subtitle: `Curated peptide and metabolic research, summarized with sources.` at `text-sm` (13px) `text-text-secondary`.
    - Topic grid: `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-md">` rendering `<Card variant="interactive" span={4}>` per topic from `listTopics()`. Per card: topic display name (18px/600) + chunk_count caption (13px/400 `text-text-secondary`). Card click → react-router `useNavigate(`/${topic.slug}`)`.
    - Featured chunk: `<Card variant="elevated" span={12}>` below topic grid. Title (18px/600) + source + TierBadge + 2-line summary (13px/400 `line-clamp-2`) + `Read more →` link to `/${topic_tag}/${slug}`.
    - Newsletter signup section: H2 `Get the weekly research digest` (18px/600) + body "Curated summaries from peer-reviewed sources, delivered Sundays. Unsubscribe anytime." (13px/400) + `<Input type="email">` + `Subscribe to digest` Button (primary). On submit, POST to existing `rag-newsletter-subscribe` Edge Fn from 60-12 (use newsletter-api wrapper if 60-12 ships one; else inline `fetch` to `/functions/v1/rag-newsletter-subscribe-public`). Inline success message `You're subscribed. Check your inbox for a confirmation.` (UI-SPEC copywriting contract).
    - Disclaimer footer line (11px/400 `text-text-tertiary`): `Unsubscribe anytime. Not medical advice.`
    - Full-width FDA/DSHEA disclaimer per UI-SPEC §3 invariant 5 (reuse `t('rag.fda_off_label_full')` from 60-10 i18n module).
    - Skeleton loading states via existing `<Skeleton />` primitive.
    - `useReducedMotion()` gates any card-hover animation.

    Step 4 — Create `src/components/knowledge/KnowledgeTopicIndexPage.tsx` per UI-SPEC §9:
    - `useParams()` extracts `:topic`. If `getTopicDisplayName(topic) === undefined` OR `isReservedSlug(topic)` → render `<KnowledgeNotFound />`.
    - `useSearchParams()` extracts `?tier` and `?q`. zod-validate; on invalid, strip from URL and continue with defaults.
    - `<Helmet>` block: `<title>{topic_display_name} — LeanShot Knowledge</title>` + canonical `https://app.leanshot.app/knowledge/${topic}` + JSON-LD `CollectionPage` schema.
    - Hero: H1 `{topic_display_name}` in `font-display italic text-heading` (Fraunces 28px, sole usage) + subtitle (13px/400).
    - Search input: `<Input>` primitive with placeholder `Search {topic_display_name}…`. Wires fuse.js search across `summary + quote_blocks[].text` on the loaded chunks (client-side, since list ≤50 by default).
    - Filter pill row: 4 `<Pill aria-pressed>` components for `All Tiers` · `Tier A` · `Tier B` · `Tier C` — URL-synced via `useSearchParams`.
    - Article grid: `grid-cols-1 lg:grid-cols-2 gap-lg`. Each chunk → `<Card variant="interactive" span={6}>`:
      - `<TierBadge tier={chunk.source_tier} />` top-right (NEUTRAL palette per UI-SPEC §10 + invariant 6 — never green/red)
      - Topic `<Pill>` top-left (informational; not interactive)
      - Title (18px/600 `line-clamp-2`)
      - 2-line summary excerpt (13px/400)
      - Footer flex-between: `{source_name} · As of {YYYY-MM-DD}` (11px/400) + `Read at source ↗` ghost link (13px/400 accent) → `chunk.canonical_url` (target="_blank" rel="noopener noreferrer")
      - Card body click → `useNavigate(`/${topic}/${chunk.slug}`)` (NOT the source link)
    - Empty filtered state: `<EmptyState>` with heading `No results for "{query}"` + body `Try a broader search term or browse all topics.`
    - Pagination: "Load more" button when results === limit (defer infinite scroll to v1.5).
    - FDA/DSHEA disclaimer footer per UI-SPEC §3 invariant 5.

    Step 5 — Create `KnowledgeNotFound` sub-component (inline in `KnowledgeRoute.tsx` OR own file `src/components/knowledge/KnowledgeNotFound.tsx`):
    - 404 status: emit `<Helmet><meta name="robots" content="noindex"></Helmet>` (server-side cannot easily set HTTP 404 with client-render; acceptable per CONTEXT.md "client-render bet").
    - Body: heading `Page not found` + link back to `/knowledge`.

    Step 6 — Write tests per <behavior> Tests 6-12 in:
    - `src/components/knowledge/__tests__/KnowledgeRootPage.test.tsx`
    - `src/components/knowledge/__tests__/KnowledgeTopicIndexPage.test.tsx`
    Use `@testing-library/react` + `MemoryRouter` (react-router-dom test util). Mock `@/lib/knowledge/api`.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx tsc -p tsconfig.app.json --noEmit && npx vitest run --config vite.config.ts src/lib/knowledge/__tests__/api.test.ts src/components/knowledge/__tests__/KnowledgeRootPage.test.tsx src/components/knowledge/__tests__/KnowledgeTopicIndexPage.test.tsx 2>&1 | tail -20</automated>
  </verify>
  <done>
    - `src/lib/knowledge/api.ts` exports 6 typed functions, all zod-validated; `KnowledgeApiError` distinct error class.
    - `KnowledgeRootPage` renders Fraunces italic 28px H1, topic grid, featured chunk, newsletter signup, FDA disclaimer footer.
    - `KnowledgeTopicIndexPage` renders Fraunces italic 28px H1 of topic display name, search via fuse.js, filter pills URL-synced, article grid with neutral TierBadges.
    - Unknown topic / reserved slug → `<KnowledgeNotFound />` with `noindex` meta.
    - All vitest tests green (Tests 1-12).
    - `tsc --noEmit` exits 0.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Build KnowledgeArticleDetailPage + KnowledgeBreadcrumb + SourcesPanel</name>
  <files>src/components/knowledge/KnowledgeArticleDetailPage.tsx, src/components/knowledge/KnowledgeBreadcrumb.tsx, src/components/knowledge/SourcesPanel.tsx, src/components/knowledge/__tests__/KnowledgeArticleDetailPage.test.tsx</files>
  <read_first>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (§8), src/components/ai/CitationPopover.tsx (60-10), src/lib/rag/i18n.ts (60-10), src/lib/rag/sanitize.ts (60-10 if exists else create here)</read_first>
  <behavior>
    - Test 1: Page fetches chunk via `getChunkBySlug({ topic, slug })`. When result is null → renders `<KnowledgeNotFound />` with `<meta robots noindex>`
    - Test 2: When `chunk.public_visibility === false` → `<Helmet>` includes `<meta name="robots" content="noindex,nofollow">`; when true → NO such meta
    - Test 3: Renders breadcrumb `Home › Knowledge › {topic_display_name} › {chunk_title}` with each segment except the last as a link
    - Test 4: Detail H1 is 18px font-sans (NOT Fraunces) per UI-SPEC §11 — assert classlist contains `text-lg` and NOT `font-display`
    - Test 5: Renders react-markdown body with DOMPurify allowlist `p a ul ol li code pre strong em blockquote mark h2 h3 h4` — `<img>` and `<script>` in the chunk content are STRIPPED (T-60-XSS-1)
    - Test 6: Verbatim quote sanitization — adversarial chunk content `<script>alert(1)</script><p>hi</p>` renders only `<p>hi</p>` (assert via `queryByText('alert')` returns null)
    - Test 7: JSON-LD `MedicalWebPage` schema present in `<head>` (mock `Helmet` to capture) with required fields `headline, datePublished, dateModified, author, publisher, mainEntityOfPage, lastReviewed, medicalAudience`
    - Test 8: Canonical link `<link rel="canonical" href="https://app.leanshot.app/knowledge/{topic}/{slug}">` present in Helmet
    - Test 9: og:image meta points to `https://app.leanshot.app/og/knowledge/{topic}/{slug}.png`
    - Test 10: Freshness pill — `chunk.reviewed_at` >2yr ago renders `May be outdated` warning Pill; 6mo-2yr renders `Last reviewed YYYY-MM` text only; <6mo renders no badge (UI-SPEC §3 invariant 7)
    - Test 11: SourcesPanel renders `Read at source ↗` button → `chunk.canonical_url` with `target="_blank" rel="noopener noreferrer"`
    - Test 12: FDA/DSHEA disclaimer footer present verbatim per UI-SPEC §3 invariant 5 (full text from `t('rag.fda_off_label_full')`)
    - Test 13: PHARMA-02 carveout — chunks where `topic_tag === 'off-label-safety'` AND content matches dosing regex MUST NOT render the dosing numbers in the public hub body (carveout grep gate — defer real enforcement to existing 39-02 D-06 invariant; here just assert no regression via fixture)
  </behavior>
  <action>
    Step 1 — Create `src/components/knowledge/KnowledgeBreadcrumb.tsx`:
    - Props: `{ topic?: string; slug?: string; chunkTitle?: string }`.
    - Renders `<nav aria-label="Breadcrumb">` with ordered list of links: `Home` → `Knowledge` → `{topic_display_name}` → `{chunk_title}`.
    - Each segment except the last is a `<Link>` from react-router-dom. Last segment is `<span aria-current="page">`.
    - Style: 13px/400 `text-text-secondary` per UI-SPEC §8 header.
    - Includes BreadcrumbList JSON-LD via `<Helmet>` (schema.org `BreadcrumbList`).

    Step 2 — Create `src/components/knowledge/SourcesPanel.tsx`:
    - Props: `{ source: { id; name; source_type; canonical_url }; tier: 'A'|'B'|'C'; reviewedAt: string; publishedAt: string }`.
    - Layout: right rail on desktop ≥1024px (`<aside>`); below-content collapsed-accordion on mobile.
    - Content:
      - Section heading `Source` (13px/600 `text-text-secondary`)
      - Source name (13px/600) linked to `canonical_url` (`target="_blank" rel="noopener noreferrer"`)
      - `<TierBadge tier={tier} />` (neutral palette per UI-SPEC §10)
      - Freshness strip per UI-SPEC §3 invariant 7 (see Test 10 logic in <behavior>)
      - `leanshot_research` disclosure (if `source_type === 'leanshot_research'`): amber-soft Pill `LeanShot Research (k≥5 cohort, DP-ε noise applied)` per UI-SPEC §10 invariant 8
      - `Read at source ↗` ghost Button (13px/400 accent)
      - `t('rag.disclaimer')` line (11px/400 `text-text-tertiary`) — reused from 60-10
    - a11y: `aria-label="Source citation"` on the panel.

    Step 3 — Create `src/components/knowledge/KnowledgeArticleDetailPage.tsx`:
    - `useParams()` extracts `:topic` + `:slug`. zod-validate; reserved slug → `<KnowledgeNotFound />`.
    - `useEffect`: `getChunkBySlug({ topic, slug })` on mount + topic/slug change.
    - Loading state: `<Skeleton>` matching content layout.
    - Null result OR `chunk.status !== 'published'` OR `chunk.retracted_at !== null` → `<KnowledgeNotFound />`.
    - `<Helmet>` block per <interfaces> spec:
      - `<title>{chunk_title} — LeanShot Knowledge</title>` (chunk_title sourced from `chunk.summary` first line OR a derived title — clarify with 60-01 schema; assume `chunk.title` column added in 60-01 or use `summary.split('\\n')[0]`)
      - meta description (verbatim_quote first 160 chars)
      - canonical link
      - og:title, og:description, og:type=article, og:image
      - Conditional noindex when `public_visibility === false`
      - JSON-LD `<script type="application/ld+json">` with `MedicalWebPage` schema per <interfaces> shape
    - Layout: max-width 720px centered + optional right-rail SourcesPanel on lg+.
    - Header: `<KnowledgeBreadcrumb topic={topic} slug={slug} chunkTitle={chunk.title} />` then H1 `{chunk.title}` (18px/600 `font-sans` — NOT Fraunces per UI-SPEC §11). Source meta strip below H1: `{source_name} · TierBadge · Last reviewed {YYYY-MM-DD}` (13px/400 `text-text-secondary`).
    - Body: `<article>` containing react-markdown rendering of `chunk.summary + chunk.quote_blocks[].text` (composed into a single markdown string). DOMPurify allowlist passed via rehype config OR via post-render sanitize — reuse `src/lib/rag/sanitize.ts` if shipped in 60-10; ELSE create the helper here using existing `dompurify` (`isomorphic-dompurify`) dependency.
    - Right rail: `<SourcesPanel ... />` (sticky on desktop, accordion on mobile).
    - Related chunks: `Related` heading (13px/600 `text-text-secondary`) + 3-5 `<Card variant="interactive">` (title 13px/600 `line-clamp-2` + source + TierBadge) — fed by `listRelatedChunks({ topic, excludeId: chunk.id })`.
    - Footer:
      - `t('rag.disclaimer')` (13px/400)
      - Full FDA/DSHEA disclaimer (13px/400 `text-text-tertiary`) — verbatim from `t('rag.fda_off_label_full')` per UI-SPEC §3 invariant 5
    - PHARMA-02 carveout: existing 39-02 D-06 invariants (ESLint AST + runtime helper + CI grep) apply. This page reads via the sanitize helper which itself respects the carveout — no new layer added here. Document in inline comment + summary.

    Step 4 — Write tests per <behavior> Tests 1-13 in `src/components/knowledge/__tests__/KnowledgeArticleDetailPage.test.tsx`. Use `MemoryRouter`, mock `@/lib/knowledge/api.getChunkBySlug`, capture Helmet output via `Helmet.peek()` or test-rendered HTML head.

    Step 5 — If `src/lib/rag/sanitize.ts` does NOT exist by this plan's execute time (60-10 may not have shipped it), create it here with the UI-SPEC §8 allowlist and an `import { sanitizeRagMarkdown } from '@/lib/rag/sanitize'` consumer pattern. This file is shared with 60-10 — if 60-10 already wrote it, do NOT clobber; verify ABI match.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx tsc -p tsconfig.app.json --noEmit && npx vitest run --config vite.config.ts src/components/knowledge/__tests__/KnowledgeArticleDetailPage.test.tsx 2>&1 | tail -20</automated>
  </verify>
  <done>
    - 4 files created: KnowledgeArticleDetailPage.tsx, KnowledgeBreadcrumb.tsx, SourcesPanel.tsx, KnowledgeArticleDetailPage.test.tsx
    - Detail page emits MedicalWebPage JSON-LD + canonical + og:image + conditional noindex via Helmet
    - DOMPurify sanitizes adversarial markdown (Test 5 + 6 green)
    - Breadcrumb renders 4-segment trail with BreadcrumbList JSON-LD
    - SourcesPanel renders tier (neutral) + freshness + leanshot_research amber disclosure where applicable
    - FDA/DSHEA disclaimer footer verbatim from i18n key
    - All 13 vitest tests green
    - `tsc --noEmit` exits 0
  </done>
</task>

<task type="auto">
  <name>Task 4: Build scripts/build-sitemap.ts + @vercel/og card generator + robots.txt update + middleware matcher</name>
  <files>scripts/build-sitemap.ts, public/robots.txt, middleware.ts, package.json</files>
  <read_first>public/robots.txt, middleware.ts (matcher config), package.json scripts, src/lib/knowledge/api.ts (Task 2)</read_first>
  <action>
    Step 1 — Create `scripts/build-sitemap.ts`:
    - Node + TS script invoked via `tsx scripts/build-sitemap.ts` (tsx is dev-dep; verify — else use `node --import tsx/esm`).
    - Reads env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (build-time only — service-role-key is RUNNER side, never client bundle).
    - Queries `public.rag_chunks` WHERE `status='published' AND retracted_at IS NULL AND public_visibility=true` joined with `rag_sources(name)`.
    - Groups by `topic_tag`.
    - Emits `public/sitemap.xml` with:
      - `<urlset>` per sitemap.org schema
      - One `<url>` for `https://app.leanshot.app/knowledge` (priority 1.0, changefreq weekly)
      - One `<url>` per topic_tag `https://app.leanshot.app/knowledge/<topic>` (priority 0.8, changefreq weekly)
      - One `<url>` per chunk `https://app.leanshot.app/knowledge/<topic>/<slug>` (priority 0.6, changefreq monthly, lastmod = chunk.published_at)
    - For each chunk, ALSO generate `public/og/knowledge/<topic>/<slug>.png` via `@vercel/og` `<ImageResponse>` rendering a card with chunk title + LeanShot logo + tier badge. Dimensions 1200×630 per og standard.
    - Idempotent: skip og card generation if file already exists AND chunk.published_at unchanged (compare mtime). Force rebuild via `--force` flag.
    - Logs to stdout: `Generated sitemap.xml with N URLs (1 root + X topics + Y articles); generated Z og cards`.
    - Wire to `package.json` scripts: `"prebuild": "tsx scripts/build-sitemap.ts || echo 'sitemap skipped (db unreachable)'"` — non-fatal so dev builds without DB still work. Production build (Vercel) supplies env vars and emits the artifacts.

    Step 2 — Update `public/robots.txt`:
    - Current file (per earlier read): global `Allow: /` + `Sitemap: https://leanshot.app/sitemap.xml`. NO change required for crawl access (already permissive).
    - Add a comment block documenting the /knowledge addition:
      ```
      # Phase 60 Plan 60-13 — /knowledge/* is public-no-auth + indexable
      # per CONTEXT D-public-no-auth. Individual chunks with
      # public_visibility=false emit <meta name=robots content=noindex>
      # at render time; sitemap.xml excludes them.
      ```
    - DO NOT add any `Disallow` directives — that would break the public-hub bet.

    Step 3 — Update `middleware.ts` matcher config:
    - Find the existing `export const config = { matcher: [...] }` block in `middleware.ts`.
    - Add `/knowledge/:path*` to the matcher array so /knowledge/* paths run through CSP + rate-limit + cookie-mint.
    - Do NOT modify the middleware body — the existing rate-limit pipeline applies automatically.
    - Verify CSP allows the og card image origin if it's served from the same Vercel deployment (same-origin `'self'` already covers it).

    Step 4 — Re-verify `package.json` (already touched in Task 1) has `tsx` in devDeps. If missing, add `"tsx": "^4.19.0"` (this is the standard project version).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -c '/knowledge' middleware.ts && grep -v '^#' public/robots.txt | grep -ci 'disallow.*knowledge' | grep -q '^0$' && echo robots-ok && npx tsx --version >/dev/null 2>&1 && (test -f .env.local && tsx scripts/build-sitemap.ts --dry-run 2>&1 | tail -5 || echo 'sitemap script syntax check via tsc'; npx tsc --noEmit scripts/build-sitemap.ts 2>&1 | tail -5)</automated>
  </verify>
  <done>
    - `scripts/build-sitemap.ts` exists, typechecks, runs in --dry-run mode without error
    - `middleware.ts` matcher includes `/knowledge/:path*`
    - `public/robots.txt` has Phase 60 comment block, no `Disallow: /knowledge*` directive
    - `package.json` scripts include `prebuild` invoking the sitemap script (non-fatal fallback)
    - tsx available (existing or newly added)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Playwright E2E for the 3 hub surfaces + SEO meta assertions</name>
  <files>tests/e2e/knowledge-hub.spec.ts</files>
  <read_first>tests/e2e/ (existing Playwright spec patterns from Phase 46-10 verify or Phase 49-09), playwright.config.ts</read_first>
  <behavior>
    - Test 1: Unauthenticated visitor navigates to `/knowledge` → sees Fraunces italic H1 `Knowledge Base`, topic grid, FDA disclaimer in footer
    - Test 2: Click on a topic card → navigates to `/knowledge/<topic>` → sees topic display name H1, filter pills, article grid
    - Test 3: Apply filter `Tier A` → URL updates to `?tier=A`, article grid narrows
    - Test 4: Click on an article card → navigates to `/knowledge/<topic>/<slug>` → sees breadcrumb, chunk title H1 (18px font-sans), body content
    - Test 5: SEO assertions on detail page:
      - `<title>` matches `{chunk_title} — LeanShot Knowledge`
      - `<link rel="canonical">` has absolute URL `https://app.leanshot.app/knowledge/<topic>/<slug>`
      - `<script type="application/ld+json">` contains `"@type":"MedicalWebPage"` with required fields
      - `<meta property="og:image">` present
    - Test 6: noindex assertion — seed a chunk with `public_visibility=false`, navigate to its slug → `<meta name="robots" content="noindex,nofollow">` is present in head
    - Test 7: Sitemap rendering — GET `/sitemap.xml` returns 200 + valid XML + contains at least one `/knowledge/` URL
    - Test 8: robots.txt allows /knowledge — GET `/robots.txt` returns 200; assert NO line matches `Disallow:.*knowledge`
    - Test 9: Rate-limit — hammer `/knowledge` with 60 requests in 10s (Playwright `Promise.all` with new browser contexts); expect at least one 429 OR `x-ratelimit-*` headers present (T-60-DOS-1 mitigation evidence)
    - Test 10: a11y — axe-core scan on each of 3 surfaces returns 0 violations of `wcag2a` and `wcag2aa` rules (FDA disclaimer contrast, breadcrumb landmark, etc.)
  </behavior>
  <action>
    Step 1 — Read `playwright.config.ts` + an existing E2E spec (e.g., `tests/e2e/cert-verify.spec.ts` from Phase 46-10 OR `e2e/research-hub.spec.ts` from 50-09 if present in tree) to mirror the project conventions: `test.describe`, `test.use({ storageState })` for unauth, `test.beforeAll` for DB seed via service-role.

    Step 2 — Write `tests/e2e/knowledge-hub.spec.ts`:
    - `test.use({ storageState: { cookies: [], origins: [] } })` — force unauthenticated.
    - `test.beforeAll(async () => { /* seed 3 chunks across 2 topics, 1 with public_visibility=false */ })` via direct Supabase admin client (service-role-key from env).
    - Implement Tests 1-10 per <behavior>.
    - Tests 5+6+7 use `page.locator('head > script[type="application/ld+json"]')` + `page.locator('head > meta[name="robots"]')` + `page.locator('head > link[rel="canonical"]')`.
    - Test 9 uses `Promise.all` with `playwright.request` (not browser pages) to hit rate-limit quickly. Acceptable pass: ANY 429 status OR `x-ratelimit-remaining` header trending down.
    - Test 10 uses `@axe-core/playwright` (already devDep per Phase 38 — verify; else add). `injectAxe` + `checkA11y` on `body` with `withTags: ['wcag2a','wcag2aa']`.
    - Gate spec via env var `PLAYWRIGHT_RUN_P60_KNOWLEDGE_HUB=1` (Phase 49/50 convention) to keep main CI suite fast.
    - `test.afterAll`: delete seeded chunks.

    Step 3 — Ensure the spec is discoverable by Playwright by adding to `playwright.config.ts` `testDir` (likely already wildcards `tests/e2e/**`).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx tsc --noEmit tests/e2e/knowledge-hub.spec.ts 2>&1 | tail -10 && (test -n "$PLAYWRIGHT_RUN_P60_KNOWLEDGE_HUB" && PLAYWRIGHT_RUN_P60_KNOWLEDGE_HUB=1 npx playwright test tests/e2e/knowledge-hub.spec.ts --reporter=line 2>&1 | tail -30 || echo 'Playwright run skipped — gate env var not set; spec typechecks only')</automated>
  </verify>
  <done>
    - `tests/e2e/knowledge-hub.spec.ts` exists with 10 tests covering navigation + SEO + noindex + sitemap + robots + rate-limit + a11y
    - Spec gated by `PLAYWRIGHT_RUN_P60_KNOWLEDGE_HUB=1`
    - Spec typechecks
    - When gate env var set, all 10 tests green against deployed/local dev server
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| crawler/visitor → /knowledge/* | Public no-auth surface. Untrusted GET requests with arbitrary search params, topic slugs, and chunk slugs. |
| browser → public.rag_chunks (anon RLS) | RLS policy MUST allow anon SELECT only WHERE `status='published' AND retracted_at IS NULL AND public_visibility=true`. Verified in 60-01 RLS migration; trust this boundary upstream. |
| build script → service-role PostgREST | Sitemap + og-card generator runs build-time only with service-role-key from CI env. Never bundled into client. |
| browser → react-markdown render of chunk content | DOMPurify allowlist enforced at sanitize layer. |
| browser → @vercel/og card URLs | Static PNG assets served same-origin; no SSRF risk (build-time generated, not user-supplied URL). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-13-XSS-1 | Tampering | KnowledgeArticleDetailPage chunk-body render | mitigate | DOMPurify allowlist `p a ul ol li code pre strong em blockquote mark h2 h3 h4` (NO img/script/iframe/inline-style); test fixture with adversarial `<script>` payload asserts stripping (Task 3 Test 5 + 6). Reuses `src/lib/rag/sanitize.ts` shared with 60-10 citation popover. |
| T-60-13-XSS-2 | Tampering | KnowledgeTopicIndexPage search query reflection | mitigate | Search query echoed in `EmptyState` body MUST be React-escaped via `{query}` interpolation (default JSX escaping). Never use `dangerouslySetInnerHTML`. zod-stripped of control chars before reflection. |
| T-60-13-SSRF-1 | Spoofing | @vercel/og card generation (build-time) | accept | Card content is from trusted internal corpus (rag_chunks fields), not user-supplied URLs. Build-time only; no runtime fetch from untrusted origin. No internal-IP risk. |
| T-60-13-SQLI-1 | Tampering | /knowledge/* search params (`?tier`, `?q`, topic, slug) | mitigate | zod-validate every URL/search param BEFORE PostgREST call: `tierSchema` enum, `topicSchema` regex `^[a-z0-9-]+$` + reserved-list refine, `searchQuerySchema` strips control chars + rejects SQL meta-chars. PostgREST itself is parameterized — defense-in-depth at the API wrapper layer. Task 2 Tests 3 + 4 enforce. |
| T-60-13-DOS-1 | Denial of Service | Crawler burst against /knowledge/* | mitigate | Add `/knowledge/:path*` to `middleware.ts` matcher → existing rate-limit pipeline applies (Phase 41 41-03 + 51 51-02). Task 5 Test 9 asserts 429 OR `x-ratelimit-*` headers under burst. Phase 67 OPS-08 will tighten thresholds. |
| T-60-13-INFO-1 | Information Disclosure | Chunks with `public_visibility=false` accidentally indexed | mitigate | (a) Sitemap script EXCLUDES `public_visibility=false` rows (Task 4). (b) Detail page emits `<meta name="robots" content="noindex,nofollow">` when `chunk.public_visibility === false` (Task 3 Test 2). (c) 60-01 RLS already filters anon SELECT — verify in Task 2 Test 2. Three layers per `feedback_3_layer_must_never_invariant_pattern`. |
| T-60-13-INFO-2 | Information Disclosure | Retracted chunk renders public detail page | mitigate | `KnowledgeArticleDetailPage` checks `chunk.retracted_at !== null` → renders `<KnowledgeNotFound />` with noindex (Task 3). 60-01 RLS as second layer. |
| T-60-13-INFO-3 | Information Disclosure | Reserved-slug articles (e.g., chunk slug accidentally `index` or `search`) | mitigate | `RESERVED_SLUGS` validator at API layer (Task 1 + Task 2 zod refine); 60-01 RPC enforces at write-time. |
| T-60-13-PHARMA-02 | Information Disclosure | Off-label-safety chunks rendering dosing numbers publicly | accept (existing-invariant) | 3-layer 39-02 D-06 carveout (ESLint AST + runtime helper + CI grep) already enforced upstream. This plan's `sanitize.ts` helper respects the carveout; no new layer added per `feedback_3_layer_must_never_invariant_pattern` (3 layers, not 4). Document in summary. |
| T-60-13-AUTHZ-1 | Elevation of Privilege | Build script service-role-key leak into client bundle | mitigate | `scripts/build-sitemap.ts` is Node-side ONLY, never imported by `src/`. Lint gate: grep for any `import .* from .*scripts/build-sitemap` under `src/` returns 0. CI gate via existing `audit-privacy-manifest.mjs` style helper (extend if needed). |
| T-60-13-AUTHN-1 | Spoofing | Newsletter signup on /knowledge root posts to public endpoint | mitigate | Newsletter Edge Fn from 60-12 already requires email + double-opt-in (CAN-SPAM affirmative opt-in per CONTEXT D-12). No PII written without confirmation email round-trip. Out of scope of this plan beyond wiring the POST. |

</threat_model>

<verification>
Plan-level success:
1. **TypeScript**: `npx tsc -p tsconfig.app.json --noEmit` exits 0 — all 6 new components + api module + topics + sitemap script typecheck.
2. **Vitest**: all unit + integration tests green (~25-30 tests across 4 test files). Per `reference_vitest_4_projects_config_masks_default`, use `npx vitest run --config vite.config.ts`.
3. **Lint**: `npx eslint src/components/knowledge/ src/lib/knowledge/ scripts/build-sitemap.ts` exits 0.
4. **Playwright E2E** (when gated env var set): `PLAYWRIGHT_RUN_P60_KNOWLEDGE_HUB=1 npx playwright test tests/e2e/knowledge-hub.spec.ts` — 10/10 green.
5. **Bundle budget**: `npm run build` succeeds; new `/knowledge` chunk ≤30 kB gz per CLAUDE.md ceiling (verify via `scripts/assert-bundle-budget.sh` if it covers knowledge — else add a budget assertion in summary follow-up).
6. **Sitemap**: `tsx scripts/build-sitemap.ts --dry-run` emits valid XML with ≥3 URL types (root + topic + article).
7. **Manual UAT (operator, optional)**:
   - Visit `https://app.leanshot.app/knowledge` in incognito → see hub.
   - Navigate to a topic → see articles.
   - Open Chrome DevTools Lighthouse → SEO score ≥90, Indexability score ≥90. If <90 → flag for vite-plugin-prerender escape-hatch (CONTEXT.md deferred, NOT shipped here).
   - View page source on a detail page → confirm JSON-LD `MedicalWebPage` in `<script type="application/ld+json">`.
8. **Source audit**:
   - GOAL coverage: RAG-09 fully implemented (3 surfaces + sitemap + JSON-LD + canonical + rate-limit + FDA disclaimer).
   - REQ coverage: RAG-09 listed in `requirements`.
   - RESEARCH coverage: react-helmet-async, @vercel/og, fuse.js, DOMPurify all used per CONTEXT decisions.
   - CONTEXT D-coverage (CONTEXT.md `## Public /knowledge/* Hub + Newsletter`):
     - Nested URL `/knowledge/<topic>/<slug>` → Task 1 KnowledgeRoute.
     - Vite client-render + react-helmet-async + JSON-LD MedicalWebPage + build-time sitemap → Tasks 1, 3, 4.
     - Per-page meta title/description/canonical/og:image → Task 3.
     - Public no-auth + rate-limited via Edge Middleware → Task 1 (selectView bypass) + Task 4 (middleware matcher).
     - robots.txt allows all → Task 4.
     - `noindex` only on `public_visibility=false` → Task 3 Test 2.
     - Newsletter shape + opt-in surface (signup section) → Task 2 KnowledgeRootPage signup UI (POST to 60-12 Edge Fn).
   - No deferred ideas implemented: no auth-wall, no prerender, no Spanish, no per-user personalization.
</verification>

<success_criteria>
Plan is complete when:
- [ ] All 5 tasks pass their `<verify>` automation
- [ ] Unauthenticated visitor can navigate `/knowledge` → `/knowledge/<topic>` → `/knowledge/<topic>/<slug>` without auth wall, with persisted Zustand user
- [ ] Detail page emits MedicalWebPage JSON-LD + canonical link + og:image + conditional noindex
- [ ] Topic index + root H1 use Fraunces italic 28px (sole usage); detail H1 uses 18px font-sans
- [ ] TierBadge palette is neutral-only across all 3 surfaces
- [ ] FDA/DSHEA disclaimer footer present verbatim from `t('rag.fda_off_label_full')`
- [ ] `scripts/build-sitemap.ts` emits valid `public/sitemap.xml` grouped by topic; og card PNGs in `public/og/knowledge/<topic>/<slug>.png`
- [ ] `middleware.ts` matcher includes `/knowledge/:path*`
- [ ] `public/robots.txt` does NOT Disallow `/knowledge/*`
- [ ] Playwright E2E (when gated) covers SEO + a11y + rate-limit + noindex
- [ ] No new TabId entries; no router introduction in consumer SPA outside `/knowledge/*` subtree (per `reference_react_router_consumer_admin_split`)
- [ ] No `[ASSUMED]` / `[SUS]` packages — react-helmet-async + react-router-dom are well-known (verify via `npm view` in summary)
- [ ] PHARMA-02 carveout respected (no 4th invariant layer; existing 3 layers cover; documented)
- [ ] Phase 62 `/research/<slug>` whitespace preserved — no `/research` routes added in this plan
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-13-public-knowledge-hub-SUMMARY.md` when done.

SUMMARY must record:
- Decision: react-helmet-async install (resolves outline assertion that it "already exists" — it did not; added in Task 1)
- Decision: react-router-dom version chosen (verify against existing admin uses)
- Decision: sanitize.ts ownership (60-10 vs 60-13 — whichever ships first creates it; the other reuses)
- Decision: chunk `title` column — verify 60-01 ships it or derive from summary
- Tier-C inclusion in public hub: YES on detail surface; admin curates which chunks are `public_visibility=true` regardless of tier (no editorial Tier-C exclusion on the hub, unlike newsletter)
- Lighthouse Indexability score from operator UAT (if performed); if <90, flag vite-plugin-prerender escape-hatch as Phase 60 carry-over per CONTEXT.md deferred
- Bundle size of `/knowledge` chunk (gz)
- Any drift from outline + reason
- File-by-file commit list
- Carry-overs to Phase 67 (rate-limit tightening), Phase 62 (white-paper /research/<slug> coupling), Phase 64 (FDA legal-refresh audit of disclaimer text), v1.5 (Spanish content, auth-wall-after-N, semantic-cache)
</output>
