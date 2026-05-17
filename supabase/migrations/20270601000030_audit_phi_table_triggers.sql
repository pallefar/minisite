-- Phase 24: PHI-table audit trigger function + per-table AFTER trigger attachments
-- Decision ref: D-14
--
-- Defines fn_audit_phi_trigger() — a SECURITY DEFINER trigger function that fires
-- on INSERT/UPDATE/DELETE on the curated PHI table list, writing full before/after
-- JSONB to the new Phase 24 audit_logs columns.
--
-- The existing Phase 7 audit_trigger() continues to write hash-based rows for the
-- Phase 7 columns (user_id_hash, before_hash, after_hash). This is an additive
-- SECOND trigger for the Phase 24 JSONB columns — they are separate write paths
-- on the same table.
--
-- IMPORTANT: The existing Phase 7 trigger is named trg_audit_<table> on the tables
-- it covers. Phase 24 triggers use trg_phi_audit_<table> to avoid collision.
--
-- app.suppress_audit GUC:
--   Setting `app.suppress_audit` to 'on' suppresses this trigger.
--   Used by the audit-archive Edge Function cron when it reads rows.
--   Per [[reference_supabase_migration_gotchas]]: value MUST be 'on' (not 'true').
--
-- Tables attached (confirmed existing as of Phase 24):
--   injections, weights, meals, workouts, vials, mood, sleep, photos,
--   shares, profiles, payouts, audit_logs (tamper-detection)
--
-- Tables guarded (created by later phases — trigger added when table exists):
--   costs, clinic_patients, conversations
--
-- SECURITY DEFINER requires `set search_path = extensions, public, pg_temp`
-- per [[reference_supabase_migration_gotchas]].

-- -----------------------------------------------------------------------
-- 1. Trigger function
-- -----------------------------------------------------------------------
create or replace function public.fn_audit_phi_trigger()
returns trigger
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  -- Respect the suppress-audit GUC (used by audit-archive cron, D-16)
  if current_setting('app.suppress_audit', true) = 'on' then
    return coalesce(new, old);
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action_name,
    table_name,
    row_pk,
    before_data,
    after_data,
    source
  ) values (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    coalesce(
      case when TG_OP in ('INSERT', 'UPDATE') then (new).id::text else null end,
      case when TG_OP = 'DELETE' then (old).id::text else null end
    ),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    'trigger'
  );

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------
-- 2. Attach to confirmed-existing PHI tables (11 tables)
-- -----------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_injections') then
    create trigger trg_phi_audit_injections
      after insert or update or delete on public.injections
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_weights') then
    create trigger trg_phi_audit_weights
      after insert or update or delete on public.weights
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_meals') then
    create trigger trg_phi_audit_meals
      after insert or update or delete on public.meals
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_workouts') then
    create trigger trg_phi_audit_workouts
      after insert or update or delete on public.workouts
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_vials') then
    create trigger trg_phi_audit_vials
      after insert or update or delete on public.vials
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_mood') then
    create trigger trg_phi_audit_mood
      after insert or update or delete on public.mood
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_sleep') then
    create trigger trg_phi_audit_sleep
      after insert or update or delete on public.sleep
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_photos') then
    create trigger trg_phi_audit_photos
      after insert or update or delete on public.photos
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_shares') then
    create trigger trg_phi_audit_shares
      after insert or update or delete on public.shares
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_profiles') then
    create trigger trg_phi_audit_profiles
      after insert or update or delete on public.profiles
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_payouts') then
    create trigger trg_phi_audit_payouts
      after insert or update or delete on public.payouts
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

-- audit_logs self-trigger for tamper detection (fires on unexpected deletes
-- that bypass RLS — should never fire if RLS is correct per D-17)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_audit_logs') then
    create trigger trg_phi_audit_audit_logs
      after insert or update or delete on public.audit_logs
      for each row execute function public.fn_audit_phi_trigger();
  end if;
end $$;

-- -----------------------------------------------------------------------
-- 3. Future-table guards: attach only if the table exists at this point
--    (will no-op on Phase 24 deploy; later phases that create these tables
--    should also run a migration to attach the trigger or rely on this being
--    re-run via supabase db reset on the target env)
-- -----------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'costs') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_costs') then
      create trigger trg_phi_audit_costs
        after insert or update or delete on public.costs
        for each row execute function public.fn_audit_phi_trigger();
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'clinic_patients') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_clinic_patients') then
      create trigger trg_phi_audit_clinic_patients
        after insert or update or delete on public.clinic_patients
        for each row execute function public.fn_audit_phi_trigger();
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'conversations') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_phi_audit_conversations') then
      create trigger trg_phi_audit_conversations
        after insert or update or delete on public.conversations
        for each row execute function public.fn_audit_phi_trigger();
    end if;
  end if;
end $$;
