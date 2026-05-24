-- Phase 46 Plan 02 — D-13: private Storage bucket for course-completion certificate PDFs + RLS.
-- Analog: supabase/migrations/20270601000007_dsar_exports_storage_bucket.sql (same private-bucket
--         + own-folder SELECT + service-role-only writer pattern).
--
-- Decisions implemented:
--   D-13: Cert PDFs reachable only via 60-min signed URLs (3600s TTL) issued by Edge Fn.
--   T-46-06 (Information Disclosure / path traversal): RLS uses
--          (storage.foldername(name))[1] = auth.uid()::text — user_id prefix is the only key.
--   T-46-08 (Information Disclosure / URL leakage beyond TTL): bucket is PRIVATE (`public=false`);
--          all reads require a signed URL; TTL is enforced by the issuing Edge Fn
--          (generate-course-certificate in Plan 46-07). User re-fetches after expiry.
--
-- Bucket layout: certificates/<auth.uid()>/<course_id>-<cert_id>.pdf — first folder segment is the
-- owner uid. Writers: generate-course-certificate Edge Fn (Plan 46-07) uploads as service_role.
-- Readers: authenticated users via their own scoped policy + 60-min signed URLs.
--
-- T-46-08 mitigation: authenticated INSERT/UPDATE/DELETE intentionally absent — only service_role
--                     (Edge Fn) can write objects into this bucket. service_role bypasses RLS by
--                     Supabase convention.

begin;

-- 1. Insert bucket — idempotent via ON CONFLICT DO NOTHING. Private (public=false).
insert into storage.buckets (id, name, public) values ('certificates', 'certificates', false) on conflict (id) do nothing;

-- 2. SELECT: own folder only — (storage.foldername(name))[1] = auth.uid()::text
--    Object name is BUCKET-RELATIVE (e.g. "abc123.../course-cert.pdf"), NOT "certificates/...".
--    foldername returns ["abc123..."] for a single-segment prefix; [1] is the user_id segment.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'certificates_select_own_object'
  ) then
    create policy "certificates_select_own_object"
      on storage.objects
      for select to authenticated
      using (
        bucket_id = 'certificates'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;

-- 3. NO authenticated INSERT/UPDATE/DELETE policies.
--    service_role bypasses RLS by Supabase convention and is the only legitimate writer
--    (generate-course-certificate Edge Fn in Plan 46-07 uploads cert PDF after rendering).
--    T-46-08: no authenticated write surface = no user-driven path traversal on write.

commit;
