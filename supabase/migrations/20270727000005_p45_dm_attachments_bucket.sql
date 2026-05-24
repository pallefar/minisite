-- Phase 45 Plan 45-03 — `dm-attachments` Storage bucket + per-object RLS policies.
--
-- Decisions implemented:
--   D-09: 5 MB cap per attachment, 60-min signed URLs, private bucket (no public list)
--   MIME whitelist {image/jpeg, image/png, image/webp} — reuses COMMUNITY_MEDIA_MIMES
--                                                       (NO SVG, T-44-04 XSS rule applies here too)
--
-- Path convention: {thread_id}/{message_id}.{ext}
--   - Leading segment = dm_threads.id (UUID)         → INSERT/SELECT RLS JOINs dm_threads
--   - Second segment  = direct_messages.id (UUID)    → DELETE RLS JOINs direct_messages (sender)
--
-- KEY DIVERGENCE FROM PHASE 44 community-media:
--   community-media used the simple foldername-equals-uid pattern — works because the leading
--   segment in that bucket IS the user_id. For dm-attachments the leading segment is the
--   thread_id, so a participant check requires an EXISTS JOIN to dm_threads.
--   Per RESEARCH §Pattern 5 + RESEARCH Pitfall 3: explicit `::uuid` cast on path[N] is required
--   because `storage.foldername(name)` returns text[], and dm_threads.id / direct_messages.id
--   are typed uuid — without the cast the predicate silently fails closed (403 for valid
--   participants).
--
-- Per reference_supabase_migration_gotchas: storage.objects DELETE needs allow_delete_query
-- GUC for the operator UI path; this policy covers the standard authenticated-user delete.
-- Service-role admin deletes (future phases) bypass RLS entirely.
--
-- Bucket is PRIVATE (public=false): all reads require a signed URL (60-min TTL per D-09).
-- File size limit per D-09 is 5 MB (five megabytes — see VALUES clause for the byte literal).
--
-- Depends on plan 45-01 having created public.dm_threads + public.direct_messages. Since both
-- are Wave 0 plans, supabase db push applies migrations in timestamp order:
--   20270727000001 (schema) → ... → 20270727000005 (this) — dm_threads exists by then.

-- 1. Insert bucket — idempotent via ON CONFLICT DO NOTHING
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-attachments',
  'dm-attachments',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- 2. Storage RLS policies — `do $$ if not exists ... $$` guard for idempotency
-- (mirrors Phase 44 community-media-bucket.sql pattern lines 40-96)

-- INSERT: authenticated user must be a participant (creator OR recipient) in the thread
-- referenced by path segment [1]. Explicit ::uuid cast (RESEARCH Pitfall 3).
-- Path: {thread_id}/{message_id}.{ext} — segment [1] is the thread_id text.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_insert_dm_attachments'
  ) then
    create policy objects_insert_dm_attachments on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'dm-attachments'
        AND EXISTS (SELECT 1 FROM public.dm_threads dt
          WHERE dt.id = (storage.foldername(name))[1]::uuid
            AND (dt.creator_user_id = auth.uid() OR dt.recipient_user_id = auth.uid())
        )
      );
  end if;
end $$;

comment on policy objects_insert_dm_attachments on storage.objects is
  'Phase 45 Plan 45-03 — thread-participant gate via dm_threads JOIN; path[0] is thread_id (uuid)';

-- SELECT: same predicate as INSERT — any thread participant may download attachments.
-- Bucket is private + signed-URL TTL (60 min) bounds replay window. (T-45-03 mitigation.)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_dm_attachments'
  ) then
    create policy objects_select_dm_attachments on storage.objects
      for select to authenticated
      using (
        bucket_id = 'dm-attachments'
        AND EXISTS (SELECT 1 FROM public.dm_threads dt
          WHERE dt.id = (storage.foldername(name))[1]::uuid
            AND (dt.creator_user_id = auth.uid() OR dt.recipient_user_id = auth.uid())
        )
      );
  end if;
end $$;

comment on policy objects_select_dm_attachments on storage.objects is
  'Phase 45 Plan 45-03 — thread-participant read gate via dm_threads JOIN; signed-URL TTL bounds replay';

-- DELETE: author-only — only the message sender (direct_messages.sender_user_id = auth.uid())
-- may delete the attachment. Uses path segment [2] = message_id JOINed to direct_messages.
-- D-09 implication: receiver cannot delete attachments the sender uploaded.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_delete_dm_attachments'
  ) then
    create policy objects_delete_dm_attachments on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'dm-attachments'
        AND EXISTS (SELECT 1 FROM public.direct_messages dm
          WHERE dm.id = (storage.foldername(name))[2]::uuid
            AND dm.sender_user_id = auth.uid()
        )
      );
  end if;
end $$;

comment on policy objects_delete_dm_attachments on storage.objects is
  'Phase 45 Plan 45-03 — author-only delete via direct_messages.sender_user_id; path[1] is message_id (uuid)';
