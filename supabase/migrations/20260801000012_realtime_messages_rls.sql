-- Phase 9 Plan 09-01 — RLS on realtime.messages for cross-tenant subscribe.
--
-- D-10 Layer 1 (Realtime broadcast). The broadcast trigger
-- (20260801000013) calls realtime.broadcast_changes() with topic
-- prefixes 'org:<org_id>' and 'user:<user_id>'. Without RLS on
-- realtime.messages, ANY authenticated subscriber could listen to any
-- topic and receive cross-tenant payloads.
--
-- This policy gates SELECT (subscribe) on realtime.messages by parsing
-- the topic prefix:
--   - 'org:<uuid>'  → has_permission(uid, parsed_uuid, 'org.read')
--   - 'user:<uuid>' → uid = parsed_uuid
--   - anything else → false (deny)
--
-- The substring(topic from N) extracts the uuid portion. We cast to
-- uuid; if the cast fails (malformed topic), the policy raises and
-- the SELECT is denied.

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname = 'clinic_org_topic_select'
  ) then
    drop policy clinic_org_topic_select on realtime.messages;
  end if;
end $$;

create policy clinic_org_topic_select on realtime.messages
  for select to authenticated
  using (
    case
      when topic like 'org:%' then
        public.has_permission(
          auth.uid(),
          substring(topic from 5)::uuid,
          'org.read'
        )
      when topic like 'user:%' then
        auth.uid() = substring(topic from 6)::uuid
      else false
    end
  );
