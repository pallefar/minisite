-- Phase 28 Plan 01 — SQL schema-shape assertions (UNION ALL for single result set).
-- Run via: supabase db query --linked --file tests/sql/p28-schema-shape.test.sql
--
-- Returns all assertions as a single result set.
-- Verification: no 'FAIL' rows in output.

select 'organizations RLS' as assertion,
  case
    when (select relrowsecurity from pg_class where relname = 'organizations' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: organizations RLS not enabled'
  end as result

union all

select 'organizations P28 columns',
  case
    when (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'organizations'
        and column_name in ('id', 'slug', 'name', 'created_at', 'created_by', 'status', 'is_public_listing', 'current_rank_weights_version')
    ) >= 7
    then 'OK'
    else 'FAIL: organizations missing P28 columns'
  end

union all

select 'org_members RLS',
  case
    when (select relrowsecurity from pg_class where relname = 'org_members' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: org_members RLS not enabled'
  end

union all

select 'org_members columns',
  case
    when (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'org_members'
        and column_name in ('id', 'org_id', 'user_id', 'role', 'joined_at', 'last_active_at')
    ) = 6
    then 'OK'
    else 'FAIL: org_members missing required columns'
  end

union all

select 'org_invites RLS',
  case
    when (select relrowsecurity from pg_class where relname = 'org_invites' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: org_invites RLS not enabled'
  end

union all

select 'org_invites invite_token_hash',
  case
    when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'org_invites' and column_name = 'invite_token_hash')
    then 'OK'
    else 'FAIL: org_invites missing invite_token_hash'
  end

union all

select 'org_subscriptions RLS',
  case
    when (select relrowsecurity from pg_class where relname = 'org_subscriptions' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: org_subscriptions RLS not enabled'
  end

union all

select 'org_settings RLS',
  case
    when (select relrowsecurity from pg_class where relname = 'org_settings' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: org_settings RLS not enabled'
  end

union all

select 'org_settings enforce_clinician_mfa',
  case
    when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'org_settings' and column_name = 'enforce_clinician_mfa')
    then 'OK'
    else 'FAIL: org_settings missing enforce_clinician_mfa'
  end

union all

select 'org_branding RLS',
  case
    when (select relrowsecurity from pg_class where relname = 'org_branding' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: org_branding RLS not enabled'
  end

union all

select 'org_patient_links RLS',
  case
    when (select relrowsecurity from pg_class where relname = 'org_patient_links' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: org_patient_links RLS not enabled'
  end

union all

select 'org_consent_grants RLS',
  case
    when (select relrowsecurity from pg_class where relname = 'org_consent_grants' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
    then 'OK'
    else 'FAIL: org_consent_grants RLS not enabled'
  end

union all

select 'org_consent_grants scope_check trigger',
  case
    when exists (
      select 1 from pg_trigger
      where tgrelid = 'public.org_consent_grants'::regclass and tgname = 'org_consent_grants_scope_check'
    )
    then 'OK'
    else 'FAIL: org_consent_grants missing scope_check trigger'
  end

union all

select '4 SECDEF RPCs',
  case
    when (
      select count(*) from pg_proc
      where proname in ('send_org_invite', 'revoke_org_invite', 'accept_org_invite', 'link_org_patient')
        and prosecdef = true
        and pronamespace = (select oid from pg_namespace where nspname = 'public')
    ) = 4
    then 'OK'
    else 'FAIL: missing SECDEF RPCs'
  end

union all

select 'pg_cron expiry purge 04:00',
  case
    when exists (select 1 from cron.job where jobname = 'p28_org_invites_expiry_purge' and schedule = '0 4 * * *')
    then 'OK'
    else 'FAIL: org_invites_expiry_purge cron missing or wrong schedule'
  end

union all

select 'org_members_user_id_idx',
  case
    when exists (select 1 from pg_indexes where tablename = 'org_members' and indexname = 'org_members_user_id_idx')
    then 'OK'
    else 'FAIL: org_members_user_id_idx missing (Pitfall 4)'
  end

order by 1;
