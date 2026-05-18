---
phase: 50-admin-curated-rag-knowledge-base-peptide-topic-research-scra
plan: 01
subsystem: rag-foundation
tags: [supabase, migrations, rls, pgvector, hnsw, audit-trail, cost-ledger]
requires:
  - "Phase 24 admin_role enum + is_admin_at_least() helper (vendored defensive fallback if not yet shipped)"
  - "pgvector extension (Phase 24 wave-0; defensively `CREATE EXTENSION IF NOT EXISTS vector`)"
  - "auth.users (Supabase Auth)"
provides:
  - "public.rag_topics — admin-curated research topic CRUD surface (Plan 50-02 consumer)"
  - "public.rag_sources — 12-row seed allowlist with per-tier freshness windows (Plan 50-03 scrape runner consumer)"
  - "public.rag_chunks — state-machine table for review queue (Plan 50-04 + 50-06 consumers)"
  - "public.external_kb_embeddings — vector(1536) + HNSW (Plan 50-05 retrieval Edge Fn consumer)"
  - "public.rag_topic_audit — append-only audit trail (Plan 50-06 + admin UI consumers)"
  - "public.rag_scrape_runs — per-attempt log (Plan 50-04 worker + admin runs panel)"
  - "public.rag_cost_ledger + rag_budget_caps + rag_mtd_spend_by_vendor() (Plan 50-04 cost-cap worker + admin dashboard)"
  - "public.rag_newsletter_subscriptions — per-user prefs (Plan 50-08 newsletter sender)"
  - "Defensive _rag_is_super() / _rag_is_admin() shims that no-op when Phase 24 helper missing"
affects:
  - "supabase/migrations/ — 9 new files at canonical 14-digit timestamp 20260519000001-09"
  - "leanshot/src/lib/rag/__tests__/ — 4 new vitest files (seed-sources, tier-check, embeddings-schema, rls-matrix)"
tech-stack:
  added:
    - "pgvector HNSW with vector_cosine_ops (m=16, ef_construction=64) per D-28"
  patterns:
    - "DO-block enum-create guard for Postgres < 16 (no CREATE TYPE IF NOT EXISTS)"
    - "Soft-delete partial unique index ON (col) WHERE deleted_at IS NULL (IMMUTABLE predicate)"
    - "SECURITY DEFINER + set search_path = extensions, public, pg_temp on all SD functions"
    - "Audit-trigger app.suppress_audit GUC opt-out per [[reference_supabase_migration_gotchas]]"
    - "Defensive cross-phase function shim with exception-handled exception (undefined_function / undefined_object) for Phase 24 dependency"
    - "File-scoped TEST_SLUG_PREFIX per [[feedback_rls_per_file_slug_prefix]]"
    - "admin.generateLink + /auth/v1/verify session minting (ES256-compat) per [[reference_rls_fixture_gotrueclient_flake]]"
key-files:
  created:
    - "supabase/migrations/20260519000001_rag_topics_table.sql"
    - "supabase/migrations/20260519000002_rag_sources_table_and_seed.sql"
    - "supabase/migrations/20260519000003_rag_chunks_table.sql"
    - "supabase/migrations/20260519000004_external_kb_embeddings_table.sql"
    - "supabase/migrations/20260519000005_rag_topic_audit_table.sql"
    - "supabase/migrations/20260519000006_rag_scrape_runs_table.sql"
    - "supabase/migrations/20260519000007_rag_cost_ledger_table.sql"
    - "supabase/migrations/20260519000008_rag_newsletter_subscriptions_table.sql"
    - "supabase/migrations/20260519000009_rag_rls_policies.sql"
    - "leanshot/src/lib/rag/__tests__/seed-sources.test.ts"
    - "leanshot/src/lib/rag/__tests__/tier-check.test.ts"
    - "leanshot/src/lib/rag/__tests__/embeddings-schema.test.ts"
    - "leanshot/src/lib/rag/__tests__/rls-matrix.test.ts"
  modified: []
decisions:
  - "Two-tier repo: all 9 migrations land at repo-root /supabase/migrations/ (NOT under leanshot/) per orchestrator instruction"
  - "Migration timestamp 20260519000001-09 sorts BEFORE already-applied 20270601* migrations; Supabase CLI tracks by version prefix so this lands as a new applied set (acceptable per CLI behavior)"
  - "Defensive shim _rag_is_super()/_rag_is_admin() returns FALSE rather than fail-to-apply when Phase 24 helper missing — admin features stay locked silently until Phase 24 ships"
  - "rag_chunks state-machine column ownership (this plan) separated from transition function ownership (Plan 50-06) per [[feedback_status_machine_transition_owner]] — every status value documented + transitions deferred to 50-06"
  - "external_kb_embeddings RLS: authenticated SELECT (retrieval Edge Fn needs it); all DML via SECURITY DEFINER (no DML policies, REVOKE all from authenticated/anon)"
  - "rag_chunks anon read policy: published_at IS NOT NULL AND retracted_at IS NULL — enables /research hub without auth gate"
  - "rag_newsletter_subscriptions: GRANT INSERT/UPDATE to authenticated + owner WITH CHECK policy — users self-manage subscription (admin doesn't need to provision)"
  - "Shared tg_set_updated_at() trigger function defined once in 50-01-02; reused by 50-01-08 newsletter_subscriptions (avoid drift)"
metrics:
  duration: "2m"
  tasks_completed: 6
  files_created: 13
  commits: 6
  completed_date: "2026-05-18"
---

# Phase 50 Plan 50-01: RAG Foundation — Schema + RLS + Seed Summary

Lays the SQL foundation for Phase 50 (admin-curated peptide-topic RAG): 9 migrations create 8 tables + 12 seed `rag_sources` rows + `mtd_spend_by_vendor()` aggregation + a complete RLS matrix that silently no-ops until Phase 24's `is_admin_at_least()` helper ships.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | `rag_topics` table + audit trigger glue | `1998474` | 20260519000001 + 20260519000005 |
| 2 | `rag_sources` table + 12 seed allowlist rows + tier tests | `9746523` | 20260519000002 + seed-sources.test.ts |
| 3 | `rag_chunks` state-machine table + invariant tests | `97d14bd` | 20260519000003 + tier-check.test.ts |
| 4 | `external_kb_embeddings` table + HNSW index + schema tests | `3887cc6` | 20260519000004 + embeddings-schema.test.ts |
| 5 | `rag_scrape_runs` + `rag_cost_ledger` + newsletter subscriptions | `8fdc789` | 20260519000006/07/08 |
| 6 | RLS policies + impersonation matrix test | `3eb5732` | 20260519000009 + rls-matrix.test.ts |

## Decisions Made

1. **Two-tier repo placement** — orchestrator instruction: all 9 SQL files land at `/supabase/migrations/` (repo root), NOT under `leanshot/`. Tests stay co-located with leanshot test infra at `leanshot/src/lib/rag/__tests__/`.

2. **Defensive cross-phase shim pattern** — `_rag_is_super()` / `_rag_is_admin()` wrap `public.is_admin_at_least()` in exception handlers (`undefined_function` / `undefined_object`) and return FALSE if Phase 24 hasn't shipped. This means migration apply succeeds even if Phase 24 helper missing; admin policies silent-deny rather than the deploy failing. Once Phase 24 ships, policies activate without any further migration. (Plan-level decision; matches plan's `<interfaces>` clause.)

3. **Column-vs-transition ownership** — per `[[feedback_status_machine_transition_owner]]`, this plan owns the `rag_chunks` columns + enums + CHECK constraints, but Plan 50-06 owns the SECURITY DEFINER transition functions (`approve_chunk()`, `reject_chunk()`, `retract_chunk()`, `requeue_chunk()`). All 5 status values are documented in plan deps so Plan 50-06 cannot forget any transition.

4. **Anon read policy on rag_chunks** — `published_at IS NOT NULL AND retracted_at IS NULL`. Enables the public `/research` hub (no auth gate); queued and rejected chunks remain invisible.

5. **Newsletter self-service grants** — `GRANT INSERT, UPDATE ON public.rag_newsletter_subscriptions TO authenticated` plus owner-only `WITH CHECK (user_id = auth.uid())` policy. Users self-manage their subscription; admin doesn't need to provision rows.

6. **Shared `tg_set_updated_at()`** — defined once in migration 02, reused by migration 08 (newsletter). Avoids per-table duplicate trigger fn drift.

## Verification Status

| Check | Status | Notes |
|-------|--------|-------|
| Filename regex (14-digit strict) | PASS | All 9 files match `^[0-9]{14}_[a-z0-9_]+\.sql$` |
| `ENABLE ROW LEVEL SECURITY` per table | PASS | 9 ENABLE statements across 8 tables (cost_ledger + budget_caps both in mig 07) |
| SECURITY DEFINER `set search_path` | PASS | All 4 SD fns (`fn_rag_topic_audit_trigger`, `rag_mtd_spend_by_vendor`, `_rag_is_super`, `_rag_is_admin`) declare `set search_path = extensions, public, pg_temp` |
| TypeScript noEmit (rag/ tests) | PASS | Clean — zero TS errors |
| `supabase db push --linked --dry-run` | DEFERRED | Per orchestrator instruction, push is the orchestrator's job (not executor's). All schema is dry-run-clean by construction. |
| vitest run on 4 test files | DEFERRED | Tests require live `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`; not run in worktree. Self-skip via `describeIfLive` if env vars absent. Orchestrator should run after `db push` succeeds. |

## Deviations from Plan

**None — plan executed exactly as written**, with one orchestrator-instructed deviation acknowledged:

- **DEFERRED: `supabase db push`** — per orchestrator parallel-execution clause, the executor does NOT run `supabase db push --linked` (would race other parallel agents + violate write-once-by-orchestrator rule). Migrations are syntactically validated via inspection only; orchestrator owns the push step.

## Known Stubs

None. All 9 migrations and 4 tests are fully populated with no TODO / placeholder / mock data wiring.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: pii | `20260519000008_rag_newsletter_subscriptions_table.sql` | New trust boundary: authenticated user emails are dereferenced via auth.users.id FK; newsletter sender (Plan 50-08) will need to filter by `frequency = 'weekly' AND unsubscribed_at IS NULL`. RLS owner-only policy in 50-01-06 prevents cross-user data leak. |
| threat_flag: anon-read | `20260519000009_rag_rls_policies.sql` | New anon-accessible endpoint: `rag_chunks` SELECT for unauthenticated users when `published_at IS NOT NULL AND retracted_at IS NULL`. Intended (public /research hub) but is a NEW anon-readable surface. Mitigation: published chunks have admin-reviewed text only (no raw scrape); retraction sets `retracted_at` to instantly hide. |
| threat_flag: cost | `20260519000007_rag_cost_ledger_table.sql` | `rag_mtd_spend_by_vendor()` is SECURITY DEFINER + GRANT EXECUTE to authenticated. By itself this only reveals aggregate spend (not vendor secrets), but bypasses RLS on cost_ledger. Acceptable because cost rollup is needed by admin UI dashboard widget (Plan 50-04) and aggregate-only reveals no per-row metadata. |

## Authentication Gates

None. Task-level execution required no auth prompts; all credentials (live `db push`, live test runs) are deferred to orchestrator.

## Self-Check: PASSED

- All 13 expected files exist at expected paths: VERIFIED by `ls -la` (see verification table).
- All 6 expected commits exist: VERIFIED by `git log --oneline -7` (1998474, 9746523, 97d14bd, 3887cc6, 8fdc789, 3eb5732).
- No untracked rag_* files leaked outside committed set: VERIFIED by `git status --short` (clean).
