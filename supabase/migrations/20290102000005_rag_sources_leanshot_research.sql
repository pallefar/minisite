-- Phase 62 Plan 01 — rag_sources.source_type ADD COLUMN + leanshot_research seed
-- =============================================================================
--
-- Context (RESEARCH.md Pitfall 1 + Open Question 2):
--   public.rag_sources was created in 20260519000002 WITHOUT source_type column.
--   The column exists on REMOTE (api.ts selects it) but is absent from tracked
--   migrations. This file adds it idempotently using ADD COLUMN IF NOT EXISTS so
--   both fresh projects and the remote project apply cleanly.
--
--   The ALTER must come BEFORE the INSERT so the seed can populate source_type.
--
-- Seed row (single canonical source for all LeanShot research publications):
--   - name:       'LeanShot Research'
--   - domain:     'research.leanshot.app'
--   - tier:       'A' (authoritative — already 2-person-reviewed at publication)
--   - source_type:'leanshot_research' (Phase 60 ingest cron uses this to skip
--                  admin review carveout; authoritative tier skips that gate)
--   - freshness:  365 days
--
--   ON CONFLICT DO NOTHING: idempotent against re-application.
--   rag_sources has UNIQUE constraint on domain (from 20260519000002).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290102+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. ADD COLUMN IF NOT EXISTS source_type
--    MUST come before INSERT so the column exists when seed runs.
--    Idempotent: no-ops on remote where column already exists.
-- ---------------------------------------------------------------------------

alter table public.rag_sources
  add column if not exists source_type text;

-- ---------------------------------------------------------------------------
-- 2. Seed: single leanshot_research row
--    This is the canonical rag_sources entry that all published research
--    papers will reference (per RESEARCH.md Open Question 2 recommendation).
--    Tier A = authoritative source; freshness_window_days = 365 (annual review).
--
--    ON CONFLICT (domain) DO NOTHING: domain has UNIQUE constraint from
--    migration 20260519000002 — safe to rely on for idempotency.
-- ---------------------------------------------------------------------------

insert into public.rag_sources (name, domain, tier, source_type, freshness_window_days)
values ('LeanShot Research', 'research.leanshot.app', 'A', 'leanshot_research', 365)
on conflict (domain) do nothing;

commit;
