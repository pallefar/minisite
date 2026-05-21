-- Phase 37 Plan 01 Task 4 — Helpdesk seed (vault HMAC + storage bucket + SLA tiers + starter macros)
-- Idempotent: re-runnable against an already-bootstrapped instance.
-- Per CONTEXT D-19: helpdesk_hmac_secret is a vault secret (NEVER read in app code).

begin;

-- ============================================================
-- 1. Vault HMAC secret (D-19)
-- ============================================================
do $seed$
begin
  if not exists (select 1 from vault.secrets where name = 'helpdesk_hmac_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'helpdesk_hmac_secret',
      'HMAC-SHA256 secret for reply+<token>@app.leanshot.app reply-threading (Phase 37 D-19). Rotation invalidates all outstanding reply tokens.'
    );
  end if;
end
$seed$;

-- ============================================================
-- 2. Default SLA tiers for every existing org
--    p1: 4h first-response / 24h resolution
--    p2: 24h first-response / 72h resolution
--    p3: 72h first-response / 7d resolution
-- ============================================================
insert into public.sla_targets (org_id, tier, first_response_minutes, resolution_minutes)
  select o.id, 'p1', 240, 1440 from public.organizations o
  on conflict (org_id, tier) do nothing;

insert into public.sla_targets (org_id, tier, first_response_minutes, resolution_minutes)
  select o.id, 'p2', 1440, 4320 from public.organizations o
  on conflict (org_id, tier) do nothing;

insert into public.sla_targets (org_id, tier, first_response_minutes, resolution_minutes)
  select o.id, 'p3', 4320, 10080 from public.organizations o
  on conflict (org_id, tier) do nothing;

-- ============================================================
-- 3. Default starter macros (only if zero macros currently exist anywhere)
--    Per plan: insert only if zero rows yet — admin UI in Plan 08 owns
--    per-org ongoing creation. We seed into the FIRST org as a template.
-- ============================================================
do $macros$
declare
  v_org uuid;
begin
  if (select count(*) from public.agent_macros) = 0 then
    select id into v_org from public.organizations order by created_at asc limit 1;
    if v_org is not null then
      insert into public.agent_macros (org_id, name, shortcut, body)
        values
          (v_org, 'Thanks for reaching out', 'thanks',
           'Thanks for reaching out! We''ll look into this and get back to you within {sla.first_response}. — LeanShot Support'),
          (v_org, 'Closing — resolved', 'closing',
           'Marking this as resolved. If anything changes, just reply to this email and we''ll reopen it.'),
          (v_org, 'Escalating to engineering', 'escalate',
           'Escalating this to our engineering team. You''ll hear back within 24 hours.')
      on conflict (org_id, shortcut) do nothing;
    end if;
  end if;
end
$macros$;

-- ============================================================
-- 4. Storage bucket `ticket-attachments` (private — PHI risk)
--    MIME allowlist matches ticket_attachments.mime_type CHECK constraint.
--    10 MB cap matches ticket_attachments.byte_size CHECK constraint.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'ticket-attachments',
    'ticket-attachments',
    false,
    10485760,
    array['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','text/csv']
  )
on conflict (id) do nothing;

-- ============================================================
-- 5. storage.objects RLS for ticket-attachments
--    Object path convention: <ticket_id>/<filename>
--    Visibility = parent ticket visibility (owner OR org member).
-- ============================================================

-- SELECT: parent ticket owner OR org member
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_ticket_attachments'
  ) then
    create policy objects_select_ticket_attachments on storage.objects
      for select to authenticated
      using (
        bucket_id = 'ticket-attachments'
        and exists (
          select 1 from public.tickets t
          where t.id = ((storage.foldername(name))[1])::uuid
            and (
              t.user_id = auth.uid()
              or exists (
                select 1 from public.org_members om
                where om.org_id = t.org_id and om.user_id = auth.uid()
              )
            )
        )
      );
  end if;
end $$;

-- INSERT: ticket owner OR org member of parent ticket
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_insert_ticket_attachments'
  ) then
    create policy objects_insert_ticket_attachments on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'ticket-attachments'
        and exists (
          select 1 from public.tickets t
          where t.id = ((storage.foldername(name))[1])::uuid
            and (
              t.user_id = auth.uid()
              or exists (
                select 1 from public.org_members om
                where om.org_id = t.org_id and om.user_id = auth.uid()
              )
            )
        )
      );
  end if;
end $$;

-- DELETE: agent-side only (org member of parent ticket)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_delete_ticket_attachments'
  ) then
    create policy objects_delete_ticket_attachments on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'ticket-attachments'
        and exists (
          select 1 from public.tickets t
          join public.org_members om on om.org_id = t.org_id
          where t.id = ((storage.foldername(name))[1])::uuid
            and om.user_id = auth.uid()
        )
      );
  end if;
end $$;

commit;
