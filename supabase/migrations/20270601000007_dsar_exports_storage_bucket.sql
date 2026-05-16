-- Phase 22 plan 01 — D-06: private Storage bucket for DSAR export bundles + RLS.
-- Analog: supabase/migrations/20260601000014_photos_pending_shred_storage.sql (storage.objects RLS pattern)
-- Pitfalls applied: Pitfall 5 deferred (cleanup cron in v1.3 will need storage.allow_delete_query GUC).
--
-- Bucket layout: dsar-exports/<auth.uid()>/<request_id>.zip — first folder segment is the owner uid;
-- RLS scopes reads to (storage.foldername(name))[1] = auth.uid()::text.
--
-- Writers: dsar-export Edge Function (plan 22-04) uploads as service_role.
-- Readers: authenticated users via their own scoped policy + 7-day signed URLs delivered via Resend.
-- T-22-06 mitigation: authenticated INSERT/UPDATE/DELETE intentionally absent — only service_role
--                     can write objects into this bucket.

insert into storage.buckets (id, name, public)
values ('dsar-exports', 'dsar-exports', false)
on conflict (id) do nothing;

-- SELECT: own folder only.
create policy "dsar_exports_select_own_object"
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dsar-exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- NO INSERT/UPDATE/DELETE policy for authenticated. service_role bypasses RLS by Supabase convention
-- and is the only legitimate writer (dsar-export Edge Function uploads ZIP after assembly).
