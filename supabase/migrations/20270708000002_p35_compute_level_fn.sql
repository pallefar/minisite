-- Phase 35 D-02, D-03, D-04 — Pure IMMUTABLE SQL level computation functions.
-- Pattern: supabase/migrations/20270602000011_cohort_membership_matview.sql:114-139
--          (cohort_is_member SECDEF STABLE) — adapted to IMMUTABLE + no SECDEF (pure math).
-- Named dollar-quote tags ($body$) per reference_postgres_dollar_quote_nesting_in_cron_body.
-- IMMUTABLE is load-bearing (not STABLE) per reference_supabase_migration_gotchas:
--   allows use in partial-index predicates + parallel query plans.

-- ============================================================
-- FUNCTION 1: public.compute_level(xp_total int) returns int
-- D-02: Level N requires N² × 100 XP cumulative; level = floor(sqrt(xp/100))
-- D-04: Pure function — no now(), no current_setting, no auth.uid()
-- IMMUTABLE + PARALLEL SAFE for replay tests against large ledger sequences
-- ============================================================

create or replace function public.compute_level(xp_total int)
returns int
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $body$
  -- D-02: Level N requires N² × 100 XP cumulative; level = floor(sqrt(xp/100))
  -- D-04: Pure function — no now(), no current_setting, no auth.uid().
  -- greatest(1, ...) ensures level never returns 0 (user is always at least level 1).
  -- greatest(xp_total, 0) clamps negative XP to zero (defensive; admin_adjustment
  -- could theoretically produce negative totals for heavily penalized accounts).
  select greatest(1, floor(sqrt(greatest(xp_total, 0)::float / 100))::int);
$body$;

comment on function public.compute_level(int) is
  'Phase 35 D-04 — deterministic pure SQL level computation. '
  'Level N requires N²×100 XP cumulative (D-02). '
  'Spot-check values: compute_level(0)=1, compute_level(100)=1, compute_level(400)=2, '
  'compute_level(2500)=5, compute_level(10000)=10, compute_level(40000)=20, compute_level(1000000)=100. '
  'Rollback test in supabase/tests/35_xp_ledger_replay.sql exercises with random sequences; '
  'result MUST be identical regardless of insert order (D-04 determinism contract). '
  'IMMUTABLE allows use in partial-index predicates and parallel query plans.';

revoke all on function public.compute_level(int) from public;
grant execute on function public.compute_level(int) to authenticated, service_role;

-- ============================================================
-- FUNCTION 2: public.xp_total_for(p_user uuid) returns int
-- SECDEF helper used by Plan 35-03 xp-grant + Plan 35-06 dashboard read.
-- Takes p_user as PARAMETER (NOT auth.uid()) per
--   memory feedback_rpc_auth_uid_vs_service_role_mismatch — callable from
--   both user-JWT context AND service-role Edge Fns (cron, fire-and-forget).
-- ============================================================

create or replace function public.xp_total_for(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $body$
  select coalesce(sum(xp_delta), 0)::int
    from public.xp_ledger
   where user_id = p_user;
$body$;

comment on function public.xp_total_for(uuid) is
  'Phase 35 — SECDEF helper: returns total XP for a user by summing xp_ledger.xp_delta. '
  'Takes p_user as parameter (does NOT use auth.uid()) per '
  'memory feedback_rpc_auth_uid_vs_service_role_mismatch — '
  'callable from both user-JWT context and service-role Edge Fns (cron, pg_cron). '
  'STABLE (not IMMUTABLE) because it reads the xp_ledger table. '
  'SECDEF bypasses RLS by design — caller identity verified upstream by Edge Fn auth.';

revoke all on function public.xp_total_for(uuid) from public;
grant execute on function public.xp_total_for(uuid) to authenticated, service_role;

-- ============================================================
-- FUNCTION 3: public.compute_prestige(xp_total int) returns int
-- D-03: Display caps at level 100; prestige rank = floor(level / 100)
-- IMMUTABLE + PARALLEL SAFE (calls compute_level which is also IMMUTABLE)
-- ============================================================

create or replace function public.compute_prestige(xp_total int)
returns int
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $body$
  -- D-03: Display caps at level 100; prestige rank increments at 100/200/300/...
  -- greatest(0, ...) defensive clamp (compute_level returns >= 1, so floor >= 0).
  select greatest(0, (public.compute_level(xp_total) / 100));
$body$;

comment on function public.compute_prestige(int) is
  'Phase 35 D-03 — prestige tier computation. '
  'Display caps at level 100; prestige rank = floor(compute_level(xp_total) / 100). '
  'Prestige 0 = normal play (levels 1-99); Prestige 1 = first prestige (level 100+). '
  'Example: compute_prestige(1000000) = 1 (level 100 → prestige 1).';

revoke all on function public.compute_prestige(int) from public;
grant execute on function public.compute_prestige(int) to authenticated, service_role;

-- ============================================================
-- VERIFY SPOT-CHECK VALUES (D-02 locked values)
-- These are not assertions — they document the expected contract.
-- pgTAP assertions live in supabase/tests/35_xp_ledger_replay.sql.
--
-- compute_level(0)       = 1   (always at least level 1)
-- compute_level(99)      = 1   (below level 1 boundary of 100 XP)
-- compute_level(100)     = 1   (exactly at level 1 boundary; level 2 starts at 400)
-- compute_level(400)     = 2   (D-02: 2²×100 = 400)
-- compute_level(2500)    = 5   (D-02: 5²×100 = 2500)
-- compute_level(10000)   = 10  (D-02: 10²×100 = 10000)
-- compute_level(40000)   = 20  (D-02: 20²×100 = 40000)
-- compute_level(1000000) = 100 (D-02: 100²×100 = 1000000)
-- compute_prestige(1000000) = 1 (level 100 / 100 = 1)
-- ============================================================
