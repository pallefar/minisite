---
phase: 62-insights-research-engine
plan: "01"
subsystem: database
tags: [migrations, matviews, research, privacy, k-anonymity, rag]
dependency_graph:
  requires: [20290101000001_protocol_tables.sql, 20261101000006_is_staff_helper.sql]
  provides:
    - research_publications table
    - research_review_log table
    - research_publication_status ENUM
    - 5 insights_*_rollup matviews
    - profiles.research_consent + consent_revoked_at + last_purged_at
    - pending_rag_ingest table + tg_enqueue_rag_ingest trigger
    - rag_sources.source_type column + leanshot_research seed row
  affects:
    - supabase/migrations/ (5 new files)
    - public.profiles (3 columns added)
    - public.rag_sources (1 column added, 1 seed row)
tech_stack:
  added: []
  patterns:
    - DO-block pg_type guard for ENUM idempotency
    - DO-block pg_trigger guard for trigger idempotency
    - DROP POLICY IF EXISTS + bare CREATE POLICY (no IF NOT EXISTS)
    - HAVING count(distinct user_id) >= 5 for k-anonymity
    - CREATE MATERIALIZED VIEW ... WITH NO DATA (refreshed by cron)
    - UNIQUE INDEX on natural key (required for REFRESH CONCURRENTLY)
key_files:
  created:
    - supabase/migrations/20290102000001_insights_schema.sql
    - supabase/migrations/20290102000002_insights_matviews.sql
    - supabase/migrations/20290102000003_research_consent_columns.sql
    - supabase/migrations/20290102000004_pending_rag_ingest_queue.sql
    - supabase/migrations/20290102000005_rag_sources_leanshot_research.sql
  modified: []
decisions:
  - "profiles.primary_goal (not goal_type) is the audience_segment source — verified from 20270706000003_p34_profiles_primary_goal.sql"
  - "injections uses medication text (not medication_id) and dose text (not dose_mg) — matview casts dose text to numeric with regex guard"
  - "weights uses weight numeric (not weight_kg) and date text (not logged_at) — matview casts date::date for week_bin"
  - "ai_messages uses model text (not model_used) — matview uses coalesce(am.model, 'unknown') as model_bucket"
  - "community_engagement does NOT exist in tracked migrations — insights_engagement_rollup falls back to ai_messages as engagement proxy with comment noting the absence"
  - "INSERT into pending_rag_ingest uses ON CONFLICT DO NOTHING for idempotency against accidental double-publish"
metrics:
  duration: "4m 23s"
  completed_date: "2026-05-26"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 0
---

# Phase 62 Plan 01: DB Schema Foundation Summary

5 idempotent migration files ship the full DB foundation for the LeanShot insights + research publishing pipeline: ENUM + 2 core tables + 5 aggregate matviews + 3 consent columns + 1 queue table + trigger + rag_sources column + seed.

## Migration Inventory

| File | What it ships | Idempotency guards |
|------|--------------|-------------------|
| `20290102000001_insights_schema.sql` | `research_publication_status` ENUM, `research_publications` table (with DP fields), `research_review_log` audit table, RLS policies (2 on publications, 1 on review_log), `set_updated_at_research_publications` trigger | DO-block for ENUM + trigger; DROP IF EXISTS + bare CREATE POLICY |
| `20290102000002_insights_matviews.sql` | 5 `insights_*_rollup` matviews + 5 UNIQUE indexes per natural key, all WITH NO DATA | IF NOT EXISTS on each CREATE MATERIALIZED VIEW + UNIQUE INDEX |
| `20290102000003_research_consent_columns.sql` | `profiles.research_consent` (default false), `consent_revoked_at`, `last_purged_at` + partial index for purge cron | ADD COLUMN IF NOT EXISTS on all 3 columns |
| `20290102000004_pending_rag_ingest_queue.sql` | `pending_rag_ingest` queue table + partial index, `tg_enqueue_rag_ingest()` trigger function, `enqueue_rag_ingest_on_publish` trigger, RLS policy | IF NOT EXISTS on table + index; DO-block for trigger; DROP IF EXISTS + bare CREATE POLICY |
| `20290102000005_rag_sources_leanshot_research.sql` | `rag_sources.source_type` ADD COLUMN IF NOT EXISTS (BEFORE seed), `leanshot_research` seed row | ADD COLUMN IF NOT EXISTS; ON CONFLICT (domain) DO NOTHING |

## Matview Detail

| Matview | Source Tables | Natural Key | k-floor HAVING |
|---------|--------------|-------------|----------------|
| `insights_dose_rollup` | injections + profiles | (week_bin, compound, tenure_bucket, audience_segment) | count(distinct i.user_id) >= 5 |
| `insights_body_metrics_rollup` | weights + profiles | (week_bin, tenure_bucket, audience_segment) | count(distinct w.user_id) >= 5 |
| `insights_retention_rollup` | profiles + injections (subquery) | (cohort_week, audience_segment, tenure_bucket) | count(distinct p.id) >= 5 |
| `insights_engagement_rollup` | ai_messages + profiles (see Deviations) | (week_bin, audience_segment, tenure_bucket, kind) | count(distinct am.user_id) >= 5 |
| `insights_ai_interaction_rollup` | ai_messages + profiles | (week_bin, audience_segment, tenure_bucket, role, model_bucket) | count(distinct am.user_id) >= 5 |

## Key Links Verified

- `research_publications.status = 'published'` → `tg_enqueue_rag_ingest` trigger → INSERT `pending_rag_ingest` (async RAG feedback loop)
- `profiles.research_consent = true` → WHERE clause on every matview (opt-in consent enforced at DB layer)
- `profiles.research_consent = false AND consent_revoked_at IS NOT NULL` → partial index → nightly purge cron (62-08)

## PHI Gate Status

PASS — no raw PHI columns (`user_id`, `email`, `phone`, `address`) in any matview SELECT list. PHI identifiers appear only in: `JOIN ON` clauses, `WHERE` clauses, and inside `count(distinct ...)` aggregate expressions.

## Deviations from Plan

### Auto-fixed — Rule 1 (Schema Column Corrections)

**1. [Rule 1 - Bug] public.injections actual column names differ from plan assumptions**
- **Found during:** Task 2 (matview authoring)
- **Issue:** Plan specified `medication_id` and `dose_mg numeric`. Actual schema (verified from 20260513000000_injections.sql) uses `medication text` and `dose text` + `unit text`. No standalone `id` column exists (composite PK is `user_id, log_id`).
- **Fix:** `insights_dose_rollup` uses `medication` as compound column; uses regex guard `dose ~ '^[0-9]+(\.[0-9]+)?$'` before casting to numeric for avg/stddev. Uses `count(*)` for injection_count (no standalone id column).
- **Files modified:** 20290102000002_insights_matviews.sql
- **Commit:** d41e56c8

**2. [Rule 1 - Bug] public.weights actual column names differ from plan assumptions**
- **Found during:** Task 2
- **Issue:** Plan specified `weight_kg` and `logged_at`. Actual schema uses `weight numeric` and `date text` (YYYY-MM-DD string).
- **Fix:** `insights_body_metrics_rollup` uses `w.weight` and `w.date::date` for week_bin truncation.
- **Files modified:** 20290102000002_insights_matviews.sql
- **Commit:** d41e56c8

**3. [Rule 1 - Bug] public.profiles column is primary_goal not goal_type**
- **Found during:** Task 2
- **Issue:** Plan specified `p.goal_type`. Actual schema (20270706000003_p34_profiles_primary_goal.sql) uses `primary_goal text`.
- **Fix:** All matviews use `p.primary_goal` as audience_segment.
- **Files modified:** 20290102000002_insights_matviews.sql
- **Commit:** d41e56c8

**4. [Rule 1 - Bug] public.ai_messages column is model not model_used**
- **Found during:** Task 2
- **Issue:** Plan specified `am.model_used`. Actual schema (20260512000000_ai_messages.sql) uses `model text`.
- **Fix:** `insights_ai_interaction_rollup` uses `coalesce(am.model, 'unknown')` as model_bucket.
- **Files modified:** 20290102000002_insights_matviews.sql
- **Commit:** d41e56c8

**5. [Rule 1 - Documented Absence] public.community_engagement table does not exist**
- **Found during:** Task 2
- **Issue:** Plan listed `public.community_engagement` as the source for insights_engagement_rollup. No migration creates this table (Phase 41 community schema does NOT include a community_engagement table — community tables are community_posts, community_comments, community_reactions, etc.).
- **Fix:** Per plan instruction ("fall back to ai_messages alone with a comment noting the absence"), `insights_engagement_rollup` sources from `ai_messages` with `role` as the `kind` column. Comment in migration documents this for future replacement.
- **Files modified:** 20290102000002_insights_matviews.sql
- **Commit:** d41e56c8

### None — Implementation followed plan otherwise exactly.

## Known Stubs

None. All migrations are complete SQL with no hardcoded empty values or placeholder text.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes at trust boundaries beyond what the plan's threat model covers.

## Self-Check: PASSED

All 5 migration files exist on disk. All 3 task commits exist in git log (5c00b0e4, d41e56c8, facf75b0). SUMMARY.md exists. PHI gate: 5 HAVING count(distinct ...) >= 5 clauses — one per matview.

Note: supabase db push deliberately excluded per plan — close-out plan 62-08 owns push ordering per [[feedback_fn_deploy_before_cron_db_push]].
