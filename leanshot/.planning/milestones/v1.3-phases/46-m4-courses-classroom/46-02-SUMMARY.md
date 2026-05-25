---
phase: 46
plan: 02
subsystem: courses-storage
tags: [courses, storage, rls, certificates, resources]
requires: [tier_effective (Phase 43), public.is_staff() (20261101000006_is_staff_helper.sql)]
provides:
  - "Storage bucket 'certificates' (private; own-folder SELECT; service-role-only INSERT)"
  - "Storage bucket 'course-resources' (private; tier-gated SELECT; admin-only INSERT/UPDATE/DELETE)"
affects:
  - storage.buckets
  - storage.objects RLS policies
tech-stack:
  added: []
  patterns:
    - "Private bucket + own-folder SELECT (storage.foldername(name)[1] = auth.uid()::text)"
    - "Idempotent storage policy guard via `do $$ if not exists $$` on pg_policies"
    - "MIME whitelist on bucket + boolean tier_effective gate (has_active = true)"
key-files:
  created:
    - "supabase/migrations/20270725000004_p46_certificates_bucket.sql"
    - "supabase/migrations/20270725000005_p46_course_resources_bucket.sql"
  modified: []
decisions:
  - "Used boolean `te.has_active = true` for course-resources tier gate (per plan must_haves key_links) rather than `tier_label in (...)` string list — forward-compat with tier rename"
  - "course-resources INSERT/UPDATE/DELETE all guarded by public.is_staff() — admins only upload course resources via admin UI (D-05)"
  - "certificates bucket exposes ZERO authenticated write policies — service_role (generate-course-certificate Edge Fn in Plan 46-07) is the only legitimate writer"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-24"
  tasks_completed: 2
  files_created: 2
  commits: 2
---

# Phase 46 Plan 02: Storage Buckets (certificates + course-resources) Summary

Created two private Supabase Storage buckets — `certificates` for course-completion PDF certificates (service-role writer, own-folder reader) and `course-resources` for downloadable lesson resources (admin writer, Pro/Lifetime/Trial reader) — both idempotently via `ON CONFLICT DO NOTHING` and `do $$ if not exists $$` policy guards.

## Files Created

| File | SHA-256 | Lines | Purpose |
|------|---------|-------|---------|
| `supabase/migrations/20270725000004_p46_certificates_bucket.sql` | `6581b769f4f3316c049296e932f43985d403d402915f330bd40c04d1219cb2e6` | 51 | certificates bucket + SELECT-own-folder RLS |
| `supabase/migrations/20270725000005_p46_course_resources_bucket.sql` | `deaec064e83fa8b786037446b5a1eda966ac14e30d5108b66f50764d3e26ac46` | 112 | course-resources bucket + tier-gated SELECT + admin-only writes |

Both buckets are created idempotently — re-applying the migration is a no-op via `on conflict (id) do nothing` + the `do $$ if not exists $$` policy guard.

## Commits

| Hash | Message |
|------|---------|
| `1ed6edb3` | feat(46-02): add certificates Storage bucket migration |
| `da8a838c` | feat(46-02): add course-resources Storage bucket migration |

## Decisions Made

1. **Boolean tier gate for course-resources SELECT.** Used `exists (select 1 from public.tier_effective te where te.user_id = auth.uid() and te.has_active = true)` rather than `te.tier_label in ('pro','lifetime','trial')`. Matches plan must_haves `key_links` pattern (`tier_effective.*has_active`) and is forward-compatible with future tier label renames.
2. **certificates bucket has zero authenticated write policies.** Only `service_role` (which bypasses RLS by Supabase convention) writes — the `generate-course-certificate` Edge Fn in Plan 46-07. No authenticated INSERT/UPDATE/DELETE policy is created, eliminating the user-driven path-traversal attack surface entirely (T-46-08).
3. **course-resources INSERT/UPDATE/DELETE all guarded by `public.is_staff()`.** D-05 forbids consumer uploads; admins use the admin UI. The trio of write policies all check `bucket_id = 'course-resources' and public.is_staff()` for defense-in-depth (even if service-role bypass is the operational path).
4. **MIME whitelist `[application/pdf, video/mp4, application/zip]`.** Per D-13/D-16 + T-46-06 — prevents arbitrary upload (e.g. HTML, SVG) at the bucket layer, not just the application layer.
5. **200 MB file_size_limit.** D-05 (30-min lesson cap) implies ~200 MB at 1080p — keep generous for instructor latitude.

## Verification

Per-task acceptance grep gates (from plan):

**Task 1:**
- ✅ `insert into storage.buckets ... 'certificates'`
- ✅ `storage.foldername(name)[1]`
- ✅ NO `for (insert|update|delete) to authenticated`

**Task 2:**
- ✅ `'course-resources'` bucket id
- ✅ `209715200` file size cap (200 MB)
- ✅ `application/pdf.*video/mp4.*application/zip` MIME whitelist
- ✅ `te.has_active = true` tier gate
- ✅ `public.is_staff()` admin gate
- ✅ NO `staff_users` reference

Apply-time verification deferred to Plan 46-11 (phase close-out runs `supabase db push --linked` and live-DB confirms both rows in `storage.buckets`).

## Deviations from Plan

None — plan executed exactly as written.

One minor formatting touch: collapsed the `insert into storage.buckets` statements onto single lines so the plan's exact `grep -qE "insert into storage\.buckets.*'certificates'"` verification command matches via standard line-mode grep. Functionally identical to the multi-line analog in `20270601000007_dsar_exports_storage_bucket.sql`.

## Threat Surface Scan

No new threat surface introduced beyond what the plan's `<threat_model>` declares (T-46-06 path traversal + T-46-08 URL leakage). Both mitigations implemented as declared.

## Known Stubs

None — both migrations are self-contained, do not reference unwritten future code, and either bucket can be queried/written via service_role today.

## Cross-Phase Notes

- `certificates` bucket is consumed by Plan 46-07 (`generate-course-certificate` Edge Fn) — that plan will use `admin.storage.from('certificates').upload(...)` with path `<user_id>/<course_id>-<cert_id>.pdf` and `createSignedUrl(path, 3600)` for the 60-min D-13 TTL.
- `course-resources` bucket is consumed by Plan 46-08 (consumer UI `LessonResourceList.tsx`) — `supabase.storage.from('course-resources').createSignedUrl(path, 3600)` per the shared 60-min pattern.
- No dependency on `supabase db push` from this plan; Plan 46-11 owns the phase-level push of all Phase 46 migrations.

## Self-Check: PASSED

- ✅ FOUND: `supabase/migrations/20270725000004_p46_certificates_bucket.sql`
- ✅ FOUND: `supabase/migrations/20270725000005_p46_course_resources_bucket.sql`
- ✅ FOUND commit: `1ed6edb3`
- ✅ FOUND commit: `da8a838c`
