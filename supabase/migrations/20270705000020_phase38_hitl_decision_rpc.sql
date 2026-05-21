-- Phase 38 Plan 38-08 — hitl_decide RPC (RECOMMEND-07, D-12/13/14).
--
-- Super-admin-only decision RPC for the HITL admin queue. Operates on
-- `public.ai_suggestion_review` rows whose status is 'pending'.
--
-- Decision values: 'approved' | 'rejected' | 'edited'
--   - approved: set status='approved'; downstream Edge Fn (weekly-digest with
--     hitl_release_row_id payload) reads the row + sends the held email.
--   - rejected: set status='rejected'; held weekly_digest_sends row remains
--     'pending_review' (no retry); win-back send is gated off.
--   - edited:   set status='edited' and overwrite payload with edited_payload;
--     the consuming Edge Fn re-validates the payload before send.
--
-- Auth gate: project does NOT have `app.is_super_admin()` (verified 2026-05-20).
-- Use the canonical inline pattern (matches ai_suggestion_review RLS in
-- 20270705000008_phase38_ai_suggestion_review.sql):
--   EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)
--
-- T-38-34 (Elevation of Privilege): RPC re-checks the super-admin gate even
-- though `ai_suggestion_review` RLS already enforces it — Pattern S1 dual-layer.
-- T-38-36 (Repudiation): decided_by + decided_at written unconditionally.
--
-- T-38-35 (Tampering): edited_payload is stored verbatim; downstream consumer
-- (weekly-digest hitl_release_row_id path) re-runs DigestOutputSchema before
-- sending the email. No schema validation at SQL layer (jsonb is opaque here).

create or replace function public.hitl_decide(
  row_ids        uuid[],
  decision       text,
  note           text  default null,
  edited_payload jsonb default null
)
returns table (id uuid, status text)
language plpgsql
security invoker
set search_path = public, extensions
as $fn$
declare
  v_is_super boolean;
begin
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_staff = true
  )
  into v_is_super;

  if not v_is_super then
    raise exception 'super-admin only' using errcode = '42501';
  end if;

  if decision is null or decision not in ('approved','rejected','edited') then
    raise exception 'invalid decision: %', decision using errcode = '22023';
  end if;

  if row_ids is null or array_length(row_ids, 1) is null then
    raise exception 'row_ids must be a non-empty uuid[]' using errcode = '22023';
  end if;

  return query
  update public.ai_suggestion_review r
  set status        = decision,
      decided_by    = auth.uid(),
      decided_at    = now(),
      decision_note = note,
      payload       = case
                        when decision = 'edited' and edited_payload is not null
                          then edited_payload
                        else r.payload
                      end
  where r.id = any(row_ids)
    and r.status = 'pending'
  returning r.id, r.status;
end;
$fn$;

comment on function public.hitl_decide(uuid[], text, text, jsonb) is
  'Phase 38 — super-admin HITL decision RPC. Updates ai_suggestion_review rows in bulk; pending-only.';

grant execute on function public.hitl_decide(uuid[], text, text, jsonb) to authenticated;
