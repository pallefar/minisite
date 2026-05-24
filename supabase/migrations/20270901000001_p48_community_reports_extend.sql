-- Phase 48 Plan 48-01 — community_reports triage widening + dedup UNIQUEs.
--
-- Widens the Phase 45 `community_reports` row to support the M4 moderation
-- workflow:
--   D-01 (triage workflow) — status CHECK widened from ('open') to
--     ('open','triaged','resolved','dismissed') plus 3 nullable triage
--     audit columns (triaged_by, triaged_at, dismissed_reason).
--   D-02 (cooldown) — partial UNIQUE on (reporter_user_id, target_type,
--     target_id) WHERE status IN ('open','triaged'). Plan 48-02's
--     `report_content` RPC catches 23505 to enforce the per-reporter cooldown
--     atomically (no SELECT-then-INSERT race).
--   D-11 (banned-word idempotent sweep) — partial UNIQUE on (target_type,
--     target_id) WHERE reason->>'source' = 'banned_word'. Plan 48-08's
--     trigger and the Wave 1 sweep Fn rely on this for `on conflict do
--     nothing` semantics so the sweep is safe to re-invoke.
--
-- Header style forked from supabase/migrations/20270720000004_p44_notification_community.sql.
--
-- Per memory `feedback_planner_missed_status_enum_widening`: status CHECK
-- DROP+ADD lives in the SAME begin/commit as the new columns and indexes.
--
-- Per memory `reference_supabase_migration_gotchas`: both partial UNIQUE
-- predicates are IMMUTABLE (literal status set + literal jsonb arrow text).
--
-- Threat model:
--   T-48-01 (D, report-flood from one reporter) — mitigated by
--     community_reports_active_dedup_uniq partial UNIQUE.
--   T-48-11 (T, sweep Fn re-invoked → duplicate banned-word reports) —
--     mitigated by community_reports_banned_word_dedup_uniq partial UNIQUE.

begin;

-- D-01 status CHECK widen (DROP+ADD in same txn).
alter table public.community_reports
  drop constraint if exists community_reports_status_chk,
  add  constraint community_reports_status_chk
    check (status in ('open','triaged','resolved','dismissed'));

-- D-01 triage audit columns (nullable; safe on existing rows).
alter table public.community_reports
  add column if not exists triaged_by       uuid        references auth.users(id),
  add column if not exists triaged_at       timestamptz,
  add column if not exists dismissed_reason text;

-- D-02 cooldown partial UNIQUE — one active report per (reporter, target).
create unique index if not exists community_reports_active_dedup_uniq
  on public.community_reports (reporter_user_id, target_type, target_id)
  where status in ('open','triaged');

-- D-11 banned-word idempotency partial UNIQUE — one banned-word report per target.
create unique index if not exists community_reports_banned_word_dedup_uniq
  on public.community_reports (target_type, target_id)
  where reason->>'source' = 'banned_word';

commit;
