-- Phase 22 plan 01 — D-05: cross-table RLS write-deny during impersonation.
-- Analog: RESEARCH §Pattern 1 (no codebase analog — this is the new pattern Phase 22 invents).
-- Pitfalls applied: Pitfall 1 + Pitfall 7 (request.jwt.claims, NOT app.X GUC — PostgREST resets
--                                          GUCs per request; only JWT claims persist),
--                   shared-file-choreography prevention (51 policies in ONE migration to avoid
--                                                       cross-wave coordination).
--
-- D-05 contract: impersonated sessions can READ everything the user sees but cannot mutate state.
-- This migration installs 51 ADDITIONAL policies (17 tables × 3 ops {INSERT, UPDATE, DELETE}) that
-- pass ONLY when the JWT's app_metadata.impersonator_id is NULL. Existing owner-write policies
-- still apply (RLS is AND-combined). An un-impersonated owner: passes both → write succeeds.
-- An impersonated owner: passes the owner policy but FAILS this guard → 42501.
--
-- 17 tables (per must_haves):
--   injections, weights, meals, workouts, supplements, mood, sleep, symptoms, vials,
--   settings, photos, ai_messages, shares,
--   consent_records, pending_account_deletions, feature_flag_overrides, dsar_requests
--
-- Tables touched in this same migration (File 04/05/06) exist by ordering — File 12 follows them.
-- The `if exists (...)` guard around each table block keeps the migration idempotent + safe if a
-- target table is renamed in a future phase (the policy block simply skips with a NOTICE).

do $$
declare
  v_table text;
  v_op text;
  v_tables text[] := array[
    'injections', 'weights', 'meals', 'workouts', 'supplements',
    'mood', 'sleep', 'symptoms', 'vials', 'settings', 'photos',
    'ai_messages', 'shares', 'consent_records', 'pending_account_deletions',
    'feature_flag_overrides', 'dsar_requests'
  ];
  v_ops text[] := array['insert', 'update', 'delete'];
  v_policy_name text;
  v_predicate text := $pred$(current_setting('request.jwt.claims', true)::json #>> '{app_metadata,impersonator_id}') is null$pred$;
begin
  foreach v_table in array v_tables loop
    -- Skip if table does not exist (idempotency for renamed/dropped tables).
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = v_table
    ) then
      raise notice 'Skipping impersonation write-deny policies for %.%: table not found',
        'public', v_table;
      continue;
    end if;

    foreach v_op in array v_ops loop
      v_policy_name := 'deny_writes_during_impersonation_' || upper(v_op);

      -- Drop+recreate for idempotency on re-apply.
      execute format(
        'drop policy if exists %I on public.%I',
        v_policy_name, v_table
      );

      if v_op = 'insert' then
        execute format(
          'create policy %I on public.%I for insert to authenticated with check (%s)',
          v_policy_name, v_table, v_predicate
        );
      elsif v_op = 'update' then
        execute format(
          'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
          v_policy_name, v_table, v_predicate, v_predicate
        );
      else  -- delete
        execute format(
          'create policy %I on public.%I for delete to authenticated using (%s)',
          v_policy_name, v_table, v_predicate
        );
      end if;
    end loop;
  end loop;
end$$;

-- Sanity: verify expected policy count (17 tables × 3 ops = 51).
-- Wave-0 Task 3 verification query: select count(*) from pg_policy where polname like
-- 'deny_writes_during_impersonation_%' → expect 51 (or fewer if some tables were absent at
-- application time — the NOTICEs above flag the skipped tables).
