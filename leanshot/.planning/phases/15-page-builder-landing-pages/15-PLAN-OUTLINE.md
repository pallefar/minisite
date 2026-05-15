---
phase: 15
slug: page-builder-landing-pages
mode: mvp
granularity: fine
created: 2026-05-14
plan_count: 10
wave_count: 4
blocking_db_push_owner: 15-01
---

# Phase 15 — Plan Outline: Page Builder + Landing Pages

> Chunked-mode outline. MVP vertical-slice structuring: Wave 2 delivers the thinnest end-to-end slice
> (staff creates a page → saves → it renders publicly at `/{slug}`). Waves 3–4 thicken with the
> remaining blocks, SEO, versioning, assets, embeds, lead capture, and the `/pricing` wire-up.
>
> **`[BLOCKING]` `supabase db push` is owned by Plan 15-01** — it runs after all Wave 1 schema
> files are written and before any verification. Waves 2+ depend on the live schema.

## Phase Goal (user story)

**As a** LeanShot staff member, **I want to** build, preview, version, SEO-tune, and publish
landing pages through an in-house drag-and-drop editor, **so that** marketing pages (starting with
`/pricing`) ship without engineering and load fast for visitors with zero editor bundle.

## MVP Slice Ordering

- **Slice 1 (Wave 2):** thinnest end-to-end — schema is live → `page-render` serves HTML for a
  published slug → a minimal editor can scaffold + save a page with 2–3 core blocks → publish
  re-points + revalidates. After this slice a staff user can create a page and a visitor sees it.
- **Slice 2 (Wave 3):** thicken — all 12 blocks, property editors, templates, asset library, SEO
  panel + JSON-LD, version history/restore, embeds, native lead form + `lead-capture`, sitemap.
- **Slice 3 (Wave 4):** `/pricing` real customer wired to live Stripe Checkout + full E2E +
  Lighthouse/SEO verification.

## Plan Table

| Plan ID | Objective | Wave | Depends On | Requirements |
|---------|-----------|------|------------|--------------|
| 15-01 | **Schema + RLS + `[BLOCKING]` db push.** Migrations for `landing_pages`, `landing_page_revisions` (append-only, deferred circular FK per Pitfall 6), `leads`, `site_settings` config row, `profiles.is_staff` column; `page-assets` Storage bucket + listing RLS; `is_staff()` SQL helper + RLS policies on all 4 tables + bucket (split enum/forward-ref DDL into separate migration files per anti-pattern memo). Runs `supabase db push` as the `[BLOCKING]` task. Wave 0 RLS cross-tenant impersonation proof tests for all 4 surfaces + append-only revision invariant test. | 1 | — | PAGE-01, PAGE-07 |
| 15-02 | **Bundle chunks + CSP + routing config.** `vite.config.ts` `manualChunks` for `admin-bundle` / `page-builder-runtime` / `vendor-dnd-kit`; `assert-clinic-bundle-budget.sh` `PAGE_BUILDER_RUNTIME_CEILING=25000` + `ADMIN_BUNDLE_CEILING` + index-chunk no-dnd-kit-leak assertion; `vercel.json` `/{slug}` rewrite ordered AFTER protected path prefixes + rendered-page `frame-src` widening (calendly / youtube-nocookie / tally); `tests/csp/csp-snapshot.txt` updated in same commit. Install `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` + `@dnd-kit/utilities@3.2.2`. | 1 | — | PAGE-02, PAGE-06 |
| 15-03 | **`page-render` Edge Function + recursive renderer + block schema (Slice 1 backend).** `src/lib/page-builder/block-schema.ts` (`BlockType`, `BlockNode`, `BlockStyle`, `RESERVED_SLUGS` per D-10); `supabase/functions/page-render/{index.ts,render.ts,deno.json}` — public `verify_jwt=false`, queries published revision, `renderBlock()` switch producing static HTML for the core blocks, SEO head injection, `Cache-Control: s-maxage=60, stale-while-revalidate=86400`, 404 copy. `config.toml` `[functions.page-render] verify_jwt=false`. | 2 | 15-01, 15-02 | PAGE-06, PAGE-03 |
| 15-04 | **`page-save` + `page-publish` Edge Functions + minimal editor shell (Slice 1 — completes thinnest end-to-end).** `page-save` (JWT + `is_staff` gate, appends `landing_page_revisions` row, reserved-slug denylist enforcement) + `page-publish` (re-points `published_revision_id`, `x-prerender-revalidate` bypass HEAD per D-09) at repo-root `supabase/functions/`; `App.tsx` lazy `/admin/pages/*` route branch; `PageEditorView` 3-panel shell + `PageListView`; `BlockTreePanel` with dnd-kit sortable (D-04); 2–3 core blocks (Hero, CTA, Footer) editable via `PropertyPanel` with token-bounded style fields (D-05); save/publish wired. Delivers: staff scaffolds a page → saves → publishes → visitor loads `/{slug}`. | 2 | 15-01, 15-02, 15-03 | PAGE-02, PAGE-03, PAGE-07 |
| 15-05 | **Remaining 5 core blocks + PreviewPane live-preview.** FAQ, Pricing (incl. Checkout-button styling), Testimonial, Feature grid, Image+text block components + their `renderBlock()` branches in `page-render` + property editors; `PreviewPane` embedding real `page-render` output via iframe with viewport toggle (D-04/D-06); FAQ accordion a11y (`aria-expanded`/`role=region`). | 3 | 15-03, 15-04 | PAGE-03, PAGE-06 |
| 15-06 | **3 embed blocks (Calendly / YouTube / Tally).** `CalendlyBlock`, `YouTubeBlock`, `TallyBlock` components (D-01/D-02 — 3 separate draggable blocks, each tailored property editor) + `renderBlock()` iframe branches with sandboxed attrs + required `title` + loading skeleton; relies on the Wave 1 CSP `frame-src` widening. | 3 | 15-03, 15-04 | PAGE-03 |
| 15-07 | **Native lead-form block + `lead-capture` Edge Function + `leads` writes.** `LeadFormBlock` component + `renderBlock()` `<form>` branch with honeypot field; `supabase/functions/lead-capture/{index.ts,deno.json}` — public `verify_jwt=false`, body validation, honeypot check, Postgres per-IP rate-limit, `leads` insert via service role, optional Resend notification; `config.toml` `[functions.lead-capture] verify_jwt=false`. Implements the lead-magnet template's end-to-end flow (D-12). | 3 | 15-03, 15-04 | PAGE-03, PAGE-04 |
| 15-08 | **SEO panel + JSON-LD + sitemap/robots + global `site_settings`.** `src/lib/page-builder/json-ld.ts` auto-generator + schema-type override (D-16); `SEOPanel` per-page fields + `SiteSettingsPanel` at `/admin` (D-15); `page-render` head injection consumes per-page SEO cascading over `site_settings`; `supabase/functions/sitemap/{index.ts,deno.json}` public `verify_jwt=false` regenerating on publish + static `robots.txt`; `page-publish` also revalidates `/sitemap.xml`. | 3 | 15-03, 15-04 | PAGE-05, PAGE-08 |
| 15-09 | **Version history + restore + asset library + 5 templates.** `VersionHistoryPanel` (Sheet) listing `landing_page_revisions` + restore-with-confirm re-pointing `published_revision_id` (D-07); `AssetLibraryPicker` (Modal + grid) uploading to `page-assets` bucket with required alt-text + `buildImageUrl()` tier-conditional helper (Pitfall 3); `src/lib/page-builder/templates.ts` 5 code-defined templates + `TemplatePicker` one-time scaffold copy (D-14). | 3 | 15-04 | PAGE-04, PAGE-07, PAGE-01 |
| 15-10 | **`/pricing` page wired to live Stripe Checkout + phase E2E + Lighthouse/SEO verification.** Author the `pricing` builder page from the Pricing template with the Checkout-button block calling the deployed `stripe-checkout` Edge Function with live price IDs (`VITE_STRIPE_PRICE_PLUS_MONTHLY`/`_YEARLY`) per D-10/PAGE-09; full Playwright E2E across the editor→publish→render→checkout-redirect happy path; checkpoint for manual Lighthouse Perf ≥90 / a11y ≥95 / SEO + Network-tab "no admin bundle on `/{slug}`" verification. | 4 | 15-05, 15-06, 15-07, 15-08, 15-09 | PAGE-09, PAGE-06, PAGE-05 |

## Coverage Audit

### Requirements (PAGE-01..09)

| REQ | Covered By |
|-----|-----------|
| PAGE-01 (tables + `page-assets` bucket) | 15-01 (tables + bucket + RLS), 15-09 (asset library UI on bucket) |
| PAGE-02 (dnd-kit editor, lazy `admin-bundle`) | 15-02 (chunk config), 15-04 (editor + dnd-kit BlockTreePanel) |
| PAGE-03 (12 semantic blocks + property editors) | 15-03 (schema + core renderer), 15-04 (Hero/CTA/Footer), 15-05 (FAQ/Pricing/Testimonial/Feature grid/Image+text), 15-06 (3 embeds), 15-07 (lead-form) = 12 blocks |
| PAGE-04 (5 templates, one-time scaffold) | 15-07 (lead-magnet flow), 15-09 (templates.ts + TemplatePicker) |
| PAGE-05 (per-page SEO + JSON-LD) | 15-08 (SEOPanel + json-ld), 15-10 (verification) |
| PAGE-06 (static HTML via `page-render` + ISR, Lighthouse) | 15-02 (routing), 15-03 (page-render + Cache-Control), 15-05 (preview), 15-10 (Lighthouse) |
| PAGE-07 (version history + restore, append-only) | 15-01 (append-only schema + invariant test), 15-04 (save appends revision), 15-09 (history + restore) |
| PAGE-08 (sitemap.xml + robots.txt + global SEO defaults) | 15-08 (sitemap fn + robots + site_settings) |
| PAGE-09 (`/pricing` wired to Stripe Checkout) | 15-10 (pricing page + Checkout-button → stripe-checkout) |

### Decisions (D-01..D-17)

| D | Covered By |
|---|-----------|
| D-01 (3 embeds ship in v1.2) | 15-06 + 15-02 (CSP `frame-src` widening) |
| D-02 (3 separate draggable embed blocks) | 15-06 |
| D-03 (8→12 block types) | 15-03/04/05/06/07 (12 blocks total) |
| D-04 (tree + live preview pane) | 15-04 (3-panel shell + BlockTreePanel), 15-05 (PreviewPane real page-render output) |
| D-05 (token-bounded styling) | 15-04 (PropertyPanel token-bounded fields), 15-05/06/07 (block style props) |
| D-06 (auto-responsive + viewport toggle + hide-on-mobile) | 15-05 (PreviewPane viewport toggle), 15-03 (`hideOnMobile` in schema + renderer) |
| D-07 (published-pointer + draft revisions) | 15-01 (schema), 15-04 (save appends), 15-09 (restore re-points) |
| D-08 (no shareable draft-preview URL) | excluded by design — no plan implements it (deferred) |
| D-09 (on-demand revalidation, feel-instant) | 15-04 (page-publish bypass HEAD), 15-08 (sitemap revalidation) |
| D-10 (root `/{slug}` + reserved-slug denylist) | 15-02 (vercel.json routing), 15-03 (`RESERVED_SLUGS`), 15-04 (page-save enforcement), 15-10 (`pricing` as normal page) |
| D-11 (thin `is_staff` gate) | 15-01 (`profiles.is_staff` column + `is_staff()` helper + RLS), 15-04 (page-save/publish gate + route guard) |
| D-12 (native lead form → `lead-capture` → `leads`) | 15-07 |
| D-13 (asset library/picker + listing RLS + required alt-text) | 15-01 (bucket + listing RLS), 15-09 (AssetLibraryPicker) |
| D-14 (template one-time scaffold) | 15-09 |
| D-15 (global SEO in `site_settings` + `/admin` panel) | 15-01 (`site_settings` row), 15-08 (SiteSettingsPanel) |
| D-16 (JSON-LD auto-generated + schema-type dropdown) | 15-08 |
| D-17 (no analytics on published pages) | excluded by design — no plan adds analytics (deferred to Phase 20) |

## Wave Structure

| Wave | Plans | Parallel? | Notes |
|------|-------|-----------|-------|
| 1 | 15-01, 15-02 | Yes (no `files_modified` overlap — 15-01 owns `supabase/migrations/*` + RLS tests; 15-02 owns `vite.config.ts` / `vercel.json` / bundle script / CSP). 15-01 owns the `[BLOCKING]` `supabase db push`. |
| 2 | 15-03, then 15-04 | Sequential within wave — 15-04's editor PreviewPane wiring + page-save/publish depend on `page-render` + `block-schema.ts` existing. Both depend on Wave 1. Completes the thinnest end-to-end MVP slice. |
| 3 | 15-05, 15-06, 15-07, 15-08, 15-09 | Yes — five parallel thickening slices. 15-05/06/07 each add distinct block files + distinct `renderBlock()` branches (orchestrator sequences shared `page-render/render.ts` + `vercel`-adjacent edits via pathspec commits per `feedback_parallel_executor_git_isolation.md`); 15-08 + 15-09 touch separate editor/Edge-Function files. All depend on the Wave 2 slice. |
| 4 | 15-10 | Solo — `/pricing` wire-up + full E2E + Lighthouse checkpoint. Depends on all Wave 3 plans (needs Pricing block, SEO, sitemap, templates all present). |

## Cross-Plan Contract Notes (for per-plan planners)

- **`page-render/render.ts` is a shared seam.** 15-03 creates it with core-block branches; 15-05/06/07 each add branches. Per-plan planners must specify exact `block.type` case names and the `BlockNode.content` field shapes in `<interfaces>` so parallel executors do not drift. Orchestrator owns merge sequencing.
- **`block-schema.ts` is the contract file.** 15-03 defines `BlockType` union, `BlockNode`, `BlockStyle`, `RESERVED_SLUGS`. Every later plan imports from it — no redefinition.
- **`config.toml` `[functions.*]` blocks** are added by 15-03 (`page-render`), 15-07 (`lead-capture`), 15-08 (`sitemap`) — each plan adds only its own block; orchestrator pathspec-commits.
- **CSP is two-sided:** 15-02 widens rendered-page `frame-src` AND updates `tests/csp/csp-snapshot.txt` in the same commit (Pitfall 5). 15-06 relies on it but must not re-touch CSP.
- **Append-only invariant:** 15-01 writes the invariant test; 15-04's `page-save` must INSERT (never UPDATE) revisions; 15-09's restore re-points the pointer (never mutates a revision row).
- **`supabase db push` is `[BLOCKING]` in 15-01** — runs after both Wave 1 schema migration files are written, before 15-01's verification. Build/type checks pass without it (false-positive guard).

## OUTLINE COMPLETE — 10 plans across 4 waves
