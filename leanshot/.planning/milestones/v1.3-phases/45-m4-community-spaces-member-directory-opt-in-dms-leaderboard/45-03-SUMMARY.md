---
phase: 45
plan: 03
subsystem: community-dm
tags: [storage, rls, dm-attachments, supabase, bucket]
requires:
  - public.dm_threads          # plan 45-01 schema
  - public.direct_messages     # plan 45-01 schema
provides:
  - storage.bucket.dm-attachments
  - getDmAttachmentSignedUrl
  - DM_ATTACHMENT_MAX_BYTES
  - DM_ATTACHMENTS_BUCKET
affects:
  - leanshot/src/lib/community/community-storage.ts
tech_stack:
  added: []
  patterns:
    - "Storage bucket + 3-policy RLS (mirrors Phase 44 community-media analog)"
    - "EXISTS dm_threads JOIN on path[0]::uuid for participant gate (RESEARCH Pattern 5)"
    - "EXISTS direct_messages JOIN on path[1]::uuid for author-only delete"
    - "Idempotent DO $$ if not exists guards around create policy"
    - "60-min signed URL TTL (3600s) reused from community-media analog"
key_files:
  created:
    - supabase/migrations/20270727000005_p45_dm_attachments_bucket.sql
  modified:
    - leanshot/src/lib/community/community-storage.ts
decisions:
  - "Path convention {thread_id}/{message_id}.{ext} chosen over {user_id}/... so participant check is JOIN-based (D-09)"
  - "5 MB per attachment cap — half of community-media 10 MB (D-09 trade-off vs DM volume)"
  - "Explicit ::uuid cast on (storage.foldername(name))[N] — RESEARCH Pitfall 3"
  - "DELETE author-only via sender_user_id (receiver cannot delete sender's attachment)"
  - "Reused COMMUNITY_MEDIA_MIMES — no separate DM MIME list (same image set per D-09)"
metrics:
  duration_minutes: 6
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  completed_at: "2026-05-24T07:20:40Z"
---

# Phase 45 Plan 45-03: dm-attachments Storage Bucket + RLS Summary

dm-attachments private Storage bucket + 3 RLS policies (thread-participant JOIN on INSERT/SELECT, author-only JOIN to direct_messages on DELETE) + getDmAttachmentSignedUrl helper exported from community-storage.ts.

## Tasks Completed

| # | Task                                                                | Commit    | Files                                                                  |
|---|---------------------------------------------------------------------|-----------|------------------------------------------------------------------------|
| 1 | dm-attachments bucket migration + 3 RLS policies (dm_threads JOIN) | 4921907e  | `supabase/migrations/20270727000005_p45_dm_attachments_bucket.sql` (new) |
| 2 | community-storage.ts — getDmAttachmentSignedUrl + DM_ATTACHMENT_MAX_BYTES | 9e0610f8  | `leanshot/src/lib/community/community-storage.ts` (modified)           |

## What Was Built

### Migration `20270727000005_p45_dm_attachments_bucket.sql`

**Bucket config:**
- `id` / `name`: `dm-attachments`
- `public`: `false` (signed-URL-only reads)
- `file_size_limit`: `5242880` (5 MB per D-09)
- `allowed_mime_types`: `['image/jpeg','image/png','image/webp']` (reuses COMMUNITY_MEDIA_MIMES set; no SVG per T-44-04)
- Idempotent via `on conflict (id) do nothing`

**Policy 1 — `objects_insert_dm_attachments` (INSERT, role=authenticated):**
```sql
bucket_id = 'dm-attachments'
AND EXISTS (SELECT 1 FROM public.dm_threads dt
  WHERE dt.id = (storage.foldername(name))[1]::uuid
    AND (dt.creator_user_id = auth.uid() OR dt.recipient_user_id = auth.uid()))
```

**Policy 2 — `objects_select_dm_attachments` (SELECT, role=authenticated):**
Same predicate as INSERT (participant gate).

**Policy 3 — `objects_delete_dm_attachments` (DELETE, role=authenticated):**
```sql
bucket_id = 'dm-attachments'
AND EXISTS (SELECT 1 FROM public.direct_messages dm
  WHERE dm.id = (storage.foldername(name))[2]::uuid
    AND dm.sender_user_id = auth.uid())
```

All 3 policies wrapped in `DO $$ if not exists ... $$` idempotency guards.

### `community-storage.ts` extensions

```typescript
export const DM_ATTACHMENTS_BUCKET = 'dm-attachments' as const;
export const DM_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB per D-09

export async function getDmAttachmentSignedUrl(
  path: string,
): Promise<{ url: string } | { error: string }>;
```

- TTL `3600s` (60 min) reused from community-media analog
- try/catch + null-data guard → consistent `{ error: 'network' }` surface
- COMMUNITY_MEDIA_MIMES reused for DM uploads (per CONTEXT D-09)

## Acceptance Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `'dm-attachments'` literal count in migration | ≥4 | 5 | OK |
| `5242880` byte literal count | =1 | 1 | OK |
| `EXISTS (SELECT 1 FROM public.dm_threads` count | ≥2 | 2 | OK |
| `(storage.foldername(name))[1]::uuid` count | ≥2 | 2 | OK |
| `(storage.foldername(name))[1] = auth.uid()` count (rejected pattern) | =0 | 0 | OK |
| `create policy objects_(insert\|select\|delete)_dm_attachments` count | =3 | 3 | OK |
| Filename regex `^[0-9]{14}_.*\.sql$` | match | match | OK |
| `DM_ATTACHMENT_MAX_BYTES` exported | yes | yes | OK |
| `getDmAttachmentSignedUrl` exported | yes | yes | OK |
| `npx tsc -p tsconfig.app.json --noEmit` | exit 0 | exit 0 | OK |

Confirmation: **`(storage.foldername(name))[1]::uuid` cast is in place** on both INSERT and SELECT policy predicates (per RESEARCH Pitfall 3 — without it, the predicate fails closed even for valid participants and returns 403 on upload).

## Key Divergence from Phase 44 community-media (documented in migration header)

| Aspect | Phase 44 community-media | Phase 45 dm-attachments |
|--------|--------------------------|--------------------------|
| Path shape | `{user_id}/{post_id}/{uuid}.{ext}` | `{thread_id}/{message_id}.{ext}` |
| INSERT predicate | `(storage.foldername(name))[1] = auth.uid()::text` | `EXISTS dm_threads JOIN on [1]::uuid` |
| DELETE predicate | `(storage.foldername(name))[1] = auth.uid()::text` | `EXISTS direct_messages JOIN on [2]::uuid` |
| File size cap | 10 MB | 5 MB |

## Deviations from Plan

None — plan executed exactly as written.

The plan tasks were marked `tdd="true"` but the verification gate is the plan's `<verify><automated>` grep + tsc check rather than a runtime test suite (no Vitest test infrastructure exists in `leanshot/src/lib/community/` for migration RLS or storage helpers, and the project convention for SQL is verification-by-grep + live db push). The MVP+TDD gate is not active for this phase. All acceptance criteria from the plan's `<acceptance_criteria>` blocks were verified before each commit.

## Authentication Gates

None — no external auth steps were required (no `supabase db push`, no Edge Fn deploy, no Function Secret set).

## Known Stubs

None — both deliverables are production-ready. The helper is callable by plan 45-07 (DMMessageComposer / DMThreadView) without further wiring; the bucket + RLS are live-ready and will apply when the orchestrator runs `supabase db push` at phase close.

## Threat Flags

None — surface stays inside the plan's `<threat_model>` (T-45-03 INSERT path-traversal and Information Disclosure mitigations are implemented as planned).

## Deferrals / Carry-Overs

- **`supabase db push`** is intentionally NOT run by this executor (per executor objective). The migration file ships; orchestrator-level Wave-0 close will run db push after all Wave-0 plan migrations land.
- **Runtime UAT (live RLS impersonation proof)** — plan does not require it; will be exercised end-to-end when plan 45-07 (DMMessageComposer attachment upload) lands and a real two-participant DM upload is attempted.

## Self-Check: PASSED

- File `supabase/migrations/20270727000005_p45_dm_attachments_bucket.sql` exists: FOUND
- File `leanshot/src/lib/community/community-storage.ts` modified: FOUND
- Commit `4921907e` exists on branch: FOUND
- Commit `9e0610f8` exists on branch: FOUND
- All plan acceptance grep checks pass (table above)
- `npx tsc -p tsconfig.app.json --noEmit` exit 0
