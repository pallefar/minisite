-- Phase 66.5 SEC-03: function_search_path_mutable remediation
--
-- Source: Supabase database advisor (lint=0011_function_search_path_mutable)
-- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
--
-- Adds `SET search_path = public, pg_temp` to 16 functions identified by the
-- advisor as having a mutable search_path. With a fixed search_path, the
-- function body can no longer be hijacked by a malicious schema temporarily
-- shadowing `public` (e.g. `pg_temp.now()` masking the builtin).
--
-- Each ALTER is wrapped in a DO-block with `exception when undefined_function`
-- to keep the migration drift-safe — if a function has been removed from the
-- remote DB by a later phase or hot-patch, the migration still applies cleanly
-- and emits a NOTICE rather than aborting (mirrors 66-5-01 pattern).
--
-- 15 are trigger functions (returns trigger, no-arg signature).
-- 1 is a regular function (increment_rate_limit) with full signature.

-- 1. increment_rate_limit(uuid, text, timestamptz) — regular function
do $$
begin
  alter function public.increment_rate_limit(uuid, text, timestamptz) set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.increment_rate_limit(uuid, text, timestamptz) does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 2. landing_pages_set_updated_at — trigger
do $$
begin
  alter function public.landing_pages_set_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.landing_pages_set_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 3. locale_overrides_set_updated_at — trigger
do $$
begin
  alter function public.locale_overrides_set_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.locale_overrides_set_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 4. _user_changelog_dismissed_touch_updated_at — trigger
do $$
begin
  alter function public._user_changelog_dismissed_touch_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public._user_changelog_dismissed_touch_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 5. set_feature_flags_updated_at — trigger
do $$
begin
  alter function public.set_feature_flags_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.set_feature_flags_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 6. set_affiliates_updated_at — trigger
do $$
begin
  alter function public.set_affiliates_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.set_affiliates_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 7. cohort_definitions_updated_at — trigger
do $$
begin
  alter function public.cohort_definitions_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.cohort_definitions_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 8. block_landing_page_revisions_delete — trigger
do $$
begin
  alter function public.block_landing_page_revisions_delete() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.block_landing_page_revisions_delete() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 9. save_offer_rules_updated_at — trigger
do $$
begin
  alter function public.save_offer_rules_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.save_offer_rules_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 10. vendor_baa_chain_set_updated_at — trigger
do $$
begin
  alter function public.vendor_baa_chain_set_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.vendor_baa_chain_set_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 11. tg_set_updated_at — trigger
do $$
begin
  alter function public.tg_set_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.tg_set_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 12. set_payouts_updated_at — trigger
do $$
begin
  alter function public.set_payouts_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.set_payouts_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 13. _changelog_entries_touch_updated_at — trigger
do $$
begin
  alter function public._changelog_entries_touch_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public._changelog_entries_touch_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 14. site_settings_set_updated_at — trigger
do $$
begin
  alter function public.site_settings_set_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.site_settings_set_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 15. tg_rag_topics_updated_at — trigger
do $$
begin
  alter function public.tg_rag_topics_updated_at() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.tg_rag_topics_updated_at() does not exist on remote; skipping search_path fix (drift)';
end $$;

-- 16. block_landing_page_revisions_update — trigger
do $$
begin
  alter function public.block_landing_page_revisions_update() set search_path = public, pg_temp;
exception when undefined_function then
  raise notice 'public.block_landing_page_revisions_update() does not exist on remote; skipping search_path fix (drift)';
end $$;
