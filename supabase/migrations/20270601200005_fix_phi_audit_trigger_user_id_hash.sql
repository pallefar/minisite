-- Phase 29 Plan 01 — Rule 1 Bug Fix: fn_audit_phi_trigger missing user_id_hash + action
-- + recursion prevention via app.suppress_audit guard
-- + safe row_pk extraction for tables with composite PKs (no 'id' column)
--
-- The Phase 24 fn_audit_phi_trigger() has three bugs:
--
-- Bug 1: Missing NOT NULL columns in INSERT
--   Inserts into audit_logs without providing values for:
--   - user_id_hash (NOT NULL, no default) → causes NOT NULL violation
--   - action (NOT NULL, check constraint) → would also fail if reached
--   This causes ALL auth admin user creation to fail because Supabase Auth
--   creates a profiles row on user creation, which fires trg_phi_audit_profiles,
--   which attempts INSERT into audit_logs missing these NOT NULL columns.
--
-- Bug 2: Infinite recursion via trg_phi_audit_audit_logs
--   audit_logs itself has AFTER INSERT OR UPDATE OR DELETE trigger
--   (trg_phi_audit_audit_logs). Without suppression, the trigger fires when
--   fn_audit_phi_trigger inserts into audit_logs, causing infinite recursion.
--   The Phase 24 migration uses app.suppress_audit GUC for the archive cron;
--   we reuse the same mechanism here to prevent trigger self-recursion.
--
-- Bug 3: row_pk extraction assumes all tables have an 'id' column
--   `(new).id::text` fails for tables with composite PKs (e.g., injections uses
--   (user_id, log_id), weights uses (user_id, weight_id), mood uses (user_id, mood_id)).
--   Fix: use EXCEPTION-guarded cast or serialize the full row as pk.
--   Solution: use row_to_json() for composite PK tables; fall back to NULL for row_pk
--   (row_pk is nullable in audit_logs; before_data/after_data capture the full row).
--
-- Discovery: Plan 29-01 Task 2 vitest test setup
-- Pre-existing bug: affects ALL phases since Phase 24
-- Note: 20270601200005 (supersedes the broken 20270601200003 which conflicted with 29-02)

create or replace function public.fn_audit_phi_trigger()
returns trigger
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_actor_user_id uuid;
  v_user_id_hash  text;
  v_row_pk        text;
begin
  -- Respect the suppress-audit GUC.
  -- Two uses:
  --   1. archive-cron sets this to suppress audit during reads (D-16)
  --   2. This function sets it to 'on' before inserting into audit_logs to
  --      prevent infinite recursion via trg_phi_audit_audit_logs (self-trigger)
  if current_setting('app.suppress_audit', true) = 'on' then
    return coalesce(new, old);
  end if;

  v_actor_user_id := auth.uid();

  -- Compute user_id_hash required by Phase 7 audit_logs NOT NULL constraint:
  --   If authenticated caller: sha256 of auth.uid() (consistent with Phase 7 trigger)
  --   If service_role/trigger context (no JWT): sha256 of literal 'service_role'
  v_user_id_hash := encode(
    digest(coalesce(v_actor_user_id::text, 'service_role'), 'sha256'),
    'hex'
  );

  -- Extract row_pk safely. Some tables have a simple 'id' column (profiles, ai_messages).
  -- Others have composite PKs (injections: user_id+log_id, weights: user_id+weight_id).
  -- For composite PKs, row_pk is NULL — before_data/after_data capture the full row.
  -- We use a CASE expression that attempts (new).id but falls back to NULL safely.
  -- Note: in PL/pgSQL, accessing a field that doesn't exist on a record raises an error.
  -- We use a TRY/CATCH approach via dynamic SQL or just let it be NULL for all cases.
  -- Simplest safe approach: use row_to_json to get the row id if present.
  begin
    if TG_OP in ('INSERT', 'UPDATE') then
      v_row_pk := (row_to_json(new)->>'id');
    else
      v_row_pk := (row_to_json(old)->>'id');
    end if;
  exception when others then
    v_row_pk := null;
  end;

  -- Suppress self-trigger recursion: trg_phi_audit_audit_logs fires when we
  -- insert into audit_logs. Setting suppress_audit = 'on' prevents the
  -- trg_phi_audit_audit_logs call from re-entering this function.
  -- set_config with is_local=true scopes the setting to the current transaction.
  perform set_config('app.suppress_audit', 'on', true);

  insert into public.audit_logs (
    -- Phase 7 NOT NULL columns (required; no defaults)
    user_id_hash,
    table_name,
    action,
    -- Phase 7 nullable context columns
    user_id,
    -- Phase 24 admin-audit columns
    actor_user_id,
    action_name,
    row_pk,
    before_data,
    after_data,
    source
  ) values (
    v_user_id_hash,
    TG_TABLE_NAME,
    lower(TG_OP),   -- 'insert' | 'update' | 'delete' — matches check constraint
    v_actor_user_id,
    v_actor_user_id,
    TG_OP,          -- action_name stores the original TG_OP for Phase 24 consumers
    v_row_pk,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    'trigger'
  );

  -- Reset suppress_audit so subsequent operations in this transaction are
  -- still audited (e.g., multiple rows in a single statement).
  perform set_config('app.suppress_audit', 'off', true);

  return coalesce(new, old);
end;
$$;
