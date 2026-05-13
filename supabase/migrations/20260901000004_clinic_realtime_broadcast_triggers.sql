-- Phase 10 Plan 10-03 — patient-signal-change broadcast triggers.
--
-- D-16 + D-17: When a patient inserts a row into injections, weights, or
-- symptoms, broadcast a `patient_signal_change` event to every org-scoped
-- Realtime channel for orgs where:
--   1. The patient has an ACTIVE membership (revoked_at IS NULL).
--   2. The patient's consent_scope for that section is explicitly TRUE.
--
-- Server-side filter means a patient who unchecked `injections` in their
-- consent settings does NOT leak injection events to any operator, even
-- if they still log a dose.
--
-- Topic format: 'org:<org_id>' — matches the 'org:%' prefix in the
-- realtime.messages RLS policy (20260801000012_realtime_messages_rls.sql)
-- which gates SUBSCRIBE on has_permission(uid, org_id, 'org.read').
-- The trigger emits; the RLS gates who can receive.
--
-- Function signature for realtime.send (confirmed on live DB):
--   realtime.send(payload jsonb, event text, topic text, private boolean)
--
-- SECURITY DEFINER is required so the trigger body can:
--   (a) READ public.memberships rows owned by other users (RLS would
--       otherwise restrict the SELECT to auth.uid() = user_id).
--   (b) CALL realtime.send() which writes to the realtime schema.
--
-- search_path = public, extensions, pg_catalog is mandatory per project
-- memory `reference_supabase_migration_gotchas.md` — SECURITY DEFINER
-- functions must declare a locked search_path to avoid schema injection.

create or replace function public.broadcast_patient_signal_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_section text := tg_argv[0];  -- 'injections' | 'weights' | 'symptoms'
  v_org_id uuid;
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'event',      'patient_signal_change',
    'user_id',    new.user_id,
    'section',    v_section,
    'changed_at', coalesce(new.created_at, now())
  );

  -- Fan out to each org where the patient is an active member AND has
  -- explicitly consented to share this section's data.
  -- COALESCE(..., false) ensures missing/null consent_scope keys default
  -- to false — broadcast is suppressed unless consent is explicitly granted.
  for v_org_id in
    select m.org_id
    from public.memberships m
    where m.user_id = new.user_id
      and m.revoked_at is null
      and coalesce((m.consent_scope ->> v_section)::bool, false) = true
  loop
    perform realtime.send(
      v_payload,
      'patient_signal_change',
      'org:' || v_org_id::text,
      true  -- private channel (broadcast)
    );
  end loop;

  return new;
end;
$$;

-- Revoke direct client invocation — the trigger system invokes this
-- automatically; clients MUST NOT call it directly.
revoke all on function public.broadcast_patient_signal_change() from public;

-- ─── AFTER INSERT triggers, one per patient-owned table ──────────────────────

drop trigger if exists injections_clinic_broadcast on public.injections;
create trigger injections_clinic_broadcast
  after insert on public.injections
  for each row execute function public.broadcast_patient_signal_change('injections');

drop trigger if exists weights_clinic_broadcast on public.weights;
create trigger weights_clinic_broadcast
  after insert on public.weights
  for each row execute function public.broadcast_patient_signal_change('weights');

drop trigger if exists symptoms_clinic_broadcast on public.symptoms;
create trigger symptoms_clinic_broadcast
  after insert on public.symptoms
  for each row execute function public.broadcast_patient_signal_change('symptoms');
