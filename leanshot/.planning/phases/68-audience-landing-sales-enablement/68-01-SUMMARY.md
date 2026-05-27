---
phase: 68-audience-landing-sales-enablement
plan: 1
subsystem: schema-foundation
tags: [migrations, landing-pages, utm, demo-org, sales-enablement]
requires:
  - public.organizations (Phase 28 — RECONCILE 20270601100001)
  - public.landing_pages + public.landing_page_revisions (Phase 15 — 20261101000002)
provides:
  - public.organizations.is_demo (boolean, default false)
  - public.organizations.demo_extended_until (timestamptz)
  - idx_organizations_is_demo (partial, where is_demo = true)
  - public.utm_landing_defaults (utm_source PK → landing_path)
  - 3 seed rows in utm_landing_defaults: clinic_outreach, coach_referral, doctor_referral
  - 3 seed rows in landing_pages: /for-doctors, /for-clinics, /for-coaches (status='published', seo_schema_type='Service')
  - 3 seed revisions in landing_page_revisions with page-builder block_tree
affects:
  - Phase 51 traffic-attribution-recorder (will read utm_landing_defaults)
  - Phase 68 future plans (demo-org Edge Fn, audience landing templates, sitemap)
tech-stack:
  added: []
  patterns: [drift-safe-DO-block, anchored-check-constraint, deferrable-FK-link-via-update]
key-files:
  created:
    - supabase/migrations/20290107000001_organizations_is_demo_flag.sql
    - supabase/migrations/20290107000002_utm_landing_defaults.sql
    - supabase/migrations/20290107000003_landing_pages_seed.sql
  modified: []
decisions:
  - D-04 — organizations.is_demo boolean column (NOT a separate demo_organizations table)
  - D-08 — utm_landing_defaults keyed by utm_source PK (one mapping per source)
  - D-01 — landing pages are seeded landing_pages rows (page-builder backed), not standalone components
  - LOCAL — JSON-LD payload computed at render time via Phase 15 json-ld.ts; seed sets seo_schema_type='Service' marker only
  - LOCAL — Calendly URL stored as literal '\${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}' in block_tree; runtime renderer resolves from env (Phase 70)
metrics:
  duration: ~10 minutes
  completed: 2026-05-27
  tasks: 3
  files: 3
---

# Phase 68 Plan 01: Schema Foundation Summary

**One-liner:** Ship 3 migrations adding `organizations.is_demo` flag + `utm_landing_defaults` table + 3 audience-specific `landing_pages` seed rows. All drift-safe; not yet pushed to remote (Phase 65/66/66.5 backlog).

## Tasks Completed

| # | Task                                     | Commit  | Files                                                                              |
| - | ---------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| 1 | organizations.is_demo + extended_until   | 15ba2ba7 | supabase/migrations/20290107000001_organizations_is_demo_flag.sql                  |
| 2 | utm_landing_defaults table + RLS + seed  | 166f716a | supabase/migrations/20290107000002_utm_landing_defaults.sql                        |
| 3 | landing_pages 3 audience seeds           | a5010b21 | supabase/migrations/20290107000003_landing_pages_seed.sql                          |

## Schema Divergence Discovered (Rule 1 - Bug, applied to Task 3)

**Found during:** Task 3 execution. `grep "create table.+landing_pages" supabase/migrations/` revealed the actual Phase 15 schema at `supabase/migrations/20261101000002_page_builder_tables.sql`.

**Plan assumed:** `landing_pages (slug, blocks jsonb, seo jsonb, is_public)` — four columns.

**Actual schema (Phase 15):**
- `landing_pages` columns: `id, slug, title, status ('draft'|'published'), published_revision_id (deferrable FK), seo_title, seo_description, seo_og_image, seo_canonical, seo_schema_type, created_by, created_at, updated_at`.
- `block_tree` (jsonb array of page-builder blocks) lives on a separate table `landing_page_revisions(id, page_id, block_tree, created_by, created_at)` — NOT on `landing_pages`.
- No `is_public` column — visibility is gated by `status='published'`.
- `seo` is flat (`seo_title`, `seo_description`, ...) not a single jsonb blob.

**Adjustment applied to Task 3 SQL:**
1. Insert `landing_pages` row with `status='published'`, `seo_title`, `seo_description`, `seo_schema_type='Service'`.
2. Insert `landing_page_revisions` row with the page-builder `block_tree`.
3. UPDATE the landing_pages row to set `published_revision_id` (uses the migration-03 deferrable FK from the page-builder family).
4. Per-page idempotency: `on conflict (slug) do nothing` on the page insert + `not exists (select 1 from landing_page_revisions where page_id = X)` guard on the revision insert. Partial-run scenario (page inserted but revision missed) is recoverable.

**JSON-LD payload:** the plan's `seo` jsonb included a full `json_ld` object with schema.org Service definition and per-audience `audience` differentiator. The actual schema has no field for that — Phase 15 ships `src/lib/page-builder/json-ld.ts` which builds JSON-LD AT RENDER TIME from `seo_schema_type` + block-tree content. The seed sets `seo_schema_type = 'Service'` so the renderer emits Service JSON-LD; the audience-specific differentiator is the responsibility of the renderer (or a future Phase 68 plan that extends the page-builder helper). This matches D-02 in CONTEXT.md ("Use it. Add per-audience `serviceType` + `audience` fields to the seeded page JSON; page-builder render path emits `<script>` automatically").

## Deviations from Plan

### Rule 1 - Bug (avoided plan-bug deploy)
**1. landing_pages schema mismatch** — see Schema Divergence section above. The plan-as-written would have errored at push time (`column "blocks" does not exist`).

### Rule 2 - Auto-added defensive coverage
**1. Inner DO-block guards for partial index + comments (Task 1)** — wrapping the partial-index `create index` and `comment on column` calls in DO-blocks that check `pg_class` / `information_schema.columns` first. Reason: if the outer column-add path hits `undefined_table`, the partial index would fail with `relation does not exist` and the migration would abort. Defensive idempotency, no behavior change.

**2. Anchored check constraint** (Task 2) — `landing_path ~ '^/[a-z0-9/_-]+$'` per the plan was already correctly anchored at start. Documented in commit message + comment.

### Auth gates
None — pure-SQL migration plan with no Edge Fn deploy or vendor key exchange.

## Verification Performed

- [x] 3 migration files exist at `supabase/migrations/2029010700000{1,2,3}*.sql`
- [x] All migrations use bare `create policy` (no `CREATE POLICY IF NOT EXISTS`) per [[feedback_phase_close_out_supabase_gotchas]]; drop-then-create idempotency pattern.
- [x] DO-block drift-safe wrap on every `alter table` / table-dependent operation per [[reference_postgres_do_block_drift_safe_migration]].
- [x] Migrations NOT pushed (per `<known_lessons>` 6 — Phase 65/66/66.5 already blocked on org_subscriptions drift; Phase 68 defers push to milestone close).
- [x] STATE.md / ROADMAP.md NOT modified (parallel-wave executor per `<parallel_execution>` constraint).

## Known Stubs

**Calendly URL placeholder** — `/for-clinics` block CTAs contain the literal string `${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}` (NOT a SQL interpolation — single-quoted in INSERT). The runtime page-builder renderer is expected to substitute this from `VITE_CALENDLY_BOOK_DEMO_URL` (set in Phase 70 vendor registration). This is per D-09 in CONTEXT.md and `<known_lessons>` 5. Until Phase 70 sets the env, the renderer should either grey-out the button ("Coming soon" per D-09) OR display the literal placeholder. The placeholder-string runtime guard pattern ([[feedback_placeholder_string_runtime_guard_pattern.md]]) applies to PRODUCTION-execution paths (cron-fire CAN-SPAM); a marketing CTA showing a placeholder until Phase 70 is documented intent, NOT a P1 leak, but Phase 68's later UI plan SHOULD add a render-time guard that detects unresolved `${...}` strings and renders a fallback rather than a literal `${...}` button label.

**Audience-specific JSON-LD differentiator** — `seo_schema_type='Service'` is set on all 3 pages, but the per-audience `audience` differentiator (`MedicalAudience/Physicians`, `MedicalProfessional`, `BusinessAudience/Coach`) is NOT in the seed. A future Phase 68 plan that updates `src/lib/page-builder/json-ld.ts` to derive `audience` from page slug (or a new `seo_audience` column) is required to close LAND-04 fully. Tracked as a stub for the verifier to catch — does NOT prevent the page from rendering, just emits generic Service JSON-LD.

## Self-Check

Verifying all claims before handoff:

**Files exist:**
- supabase/migrations/20290107000001_organizations_is_demo_flag.sql — FOUND
- supabase/migrations/20290107000002_utm_landing_defaults.sql — FOUND
- supabase/migrations/20290107000003_landing_pages_seed.sql — FOUND

**Commits exist:** 15ba2ba7, 166f716a, a5010b21 — verified in worktree branch `worktree-agent-a8211d773957d92c2`.

**No CREATE POLICY IF NOT EXISTS:** verified via `grep -i "create policy if not exists" supabase/migrations/2029010700000{2,3}*.sql` (no matches).

**Migrations NOT pushed:** intentional; Phase 65+ pending org_subscriptions drift resolution.

## Self-Check: PASSED
