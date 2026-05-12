-- Phase 7 D-04 (audit log SECURITY DEFINER trigger — the "clients cannot
-- bypass" enforcement layer).
--
-- Defines public.audit_trigger() and ATTACHes it as an AFTER INSERT OR UPDATE
-- OR DELETE row-level trigger on all 10 sync tables. Reads pre-state (OLD) and
-- post-state (NEW), sha256-hashes each via pgcrypto digest(), and inserts a
-- single row into public.audit_logs per write.
--
-- Why SECURITY DEFINER:
--   public.audit_logs has NO INSERT/UPDATE/DELETE policy for the authenticated
--   role (see 20260601000001_audit_logs.sql). A normal trigger fired by an
--   authenticated client would inherit the caller's privileges and hit RLS
--   default-deny on the insert into audit_logs — every sync write would fail.
--   SECURITY DEFINER makes the function run as the function-owner role
--   (Supabase `postgres`), which bypasses RLS by design.
--
-- STRIDE register:
--   T-07-08-02 (search_path hijack): `set search_path = public, pg_catalog`
--     hardens the function — an attacker who could create a `digest()` shim
--     in a schema earlier on their search_path can no longer fool this
--     function. Default Supabase grants prevent authenticated users from
--     CREATEing objects in `public`, closing the residual gap.
--   T-07-08-08 (elevation-of-privilege): the function-owner role on managed
--     Supabase (`postgres`) is NOT a superuser — the platform restricts it.
--     The function body performs ONE static INSERT into a table the owner
--     controls. No dynamic SQL, no `execute` of user input, no role-switching.
--   T-07-08-09 (pgcrypto shadow): pgcrypto's `digest` is created either in
--     `public` or in the `extensions` schema depending on Supabase project
--     config; the search_path hardening plus the no-CREATE-in-public default
--     grants close the shadow attack surface.
--
-- Behavioral notes:
--   - Hash determinism caveat: row_to_json() is not column-order-stable across
--     Postgres versions. Acceptable here because v1 has NO consumer that
--     compares hashes — they're tamper-evidence only ("did this row change?").
--     If a future consumer compares hashes across schema migrations, add a
--     canonical_json(row) wrapper that sorts keys (researcher §7).
--   - AFTER vs BEFORE: AFTER chosen for semantic clarity — "audit what
--     happened". Since the function does not modify OLD/NEW, BEFORE vs AFTER
--     is behaviorally equivalent here.
--   - Backfill: NOT performed. Audit history starts at trigger-attach time.
--     CONTEXT.md D-04 does not require backfilling Phase 5/6 writes.
--
-- Excluded: public.ai_messages is INTENTIONALLY NOT attached to this trigger.
-- It's the AI conversation log, not medical sync data; D-04 scopes audit_logs
-- to "every cloud write across the sync tables" of medical data.

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_before text;
  v_after text;
  v_row_id text;
  v_user_id uuid;
begin
  -- Resolve the affected user_id from NEW (insert/update) or OLD (delete).
  v_user_id := coalesce(new.user_id, old.user_id);

  -- Hash OLD on UPDATE+DELETE; hash NEW on INSERT+UPDATE.
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_before := encode(digest(row_to_json(old)::text, 'sha256'), 'hex');
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    v_after := encode(digest(row_to_json(new)::text, 'sha256'), 'hex');
  end if;

  -- Composite row_id serialization — works for the 9 composite-PK tables
  -- (e.g., (user_id, log_id) for injections, (user_id, date, supplement_name)
  -- for supplements) AND for settings (singleton, PK=user_id alone).
  v_row_id := coalesce(
    (case when tg_op = 'DELETE' then old else new end)::text,
    ''
  );

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash)
  values (
    v_user_id,
    encode(digest(v_user_id::text, 'sha256'), 'hex'),
    tg_table_name,
    v_row_id,
    lower(tg_op),
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

-- Attach the trigger to all 10 sync tables.
-- Phase 5: injections (composite PK user_id, log_id).
-- Phase 6: weights, meals, workouts, supplements, mood, sleep, symptoms, vials, settings.
-- ai_messages is intentionally EXCLUDED — see header comment.

create trigger audit_injections   after insert or update or delete on public.injections   for each row execute function public.audit_trigger();
create trigger audit_weights      after insert or update or delete on public.weights      for each row execute function public.audit_trigger();
create trigger audit_meals        after insert or update or delete on public.meals        for each row execute function public.audit_trigger();
create trigger audit_workouts     after insert or update or delete on public.workouts     for each row execute function public.audit_trigger();
create trigger audit_supplements  after insert or update or delete on public.supplements  for each row execute function public.audit_trigger();
create trigger audit_mood         after insert or update or delete on public.mood         for each row execute function public.audit_trigger();
create trigger audit_sleep        after insert or update or delete on public.sleep        for each row execute function public.audit_trigger();
create trigger audit_symptoms     after insert or update or delete on public.symptoms     for each row execute function public.audit_trigger();
create trigger audit_vials        after insert or update or delete on public.vials        for each row execute function public.audit_trigger();
create trigger audit_settings     after insert or update or delete on public.settings     for each row execute function public.audit_trigger();
