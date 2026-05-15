-- Phase 15 Plan 01 — `page-assets` Storage bucket.
--
-- D-13: Asset library / picker — one shared bucket; upload-once, pick-from-grid
-- across pages.
--
-- public = false: RLS-gated (per migration 09). The renderer serves images
-- via the Storage public URL (CDN cache-friendly); the SELECT policy in
-- migration 09 is permissive on the LIST surface so a published page's images
-- always load (analog: org_logos_storage).
--
-- 10 MB cap balances quality (modern hero images can be ~3-5 MB) with bucket
-- abuse risk (no operator should upload an unprocessed 30 MB camera dump).
--
-- Allowed MIMEs (image/jpeg, image/png, image/webp, image/gif): JPG/PNG cover
-- 99% of marketing imagery; webp is the modern compressed format; gif is the
-- legacy animated format. SVG is intentionally EXCLUDED — operator-uploaded
-- SVG could carry XSS via inline scripts (same threat the org-logos bucket
-- mitigates).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'page-assets',
  'page-assets',
  false,
  10485760,                                              -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = excluded.public;
