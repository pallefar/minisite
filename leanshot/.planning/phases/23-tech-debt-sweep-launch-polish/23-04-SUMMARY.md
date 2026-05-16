---
phase: 23-tech-debt-sweep-launch-polish
plan: "04"
subsystem: photos
tags: [photos, soft-delete, edge-function, cron, rls, vertical-slice]
dependency_graph:
  requires: [23-01, 23-02, 23-03]
  provides: [photo-trash-flow, photos-trash-purge-edge-function, photos-trashed-at-column]
  affects: [BodyTab, photos-bucket, audit_logs, cron.job]
tech_stack:
  added:
    - "photos-trash-purge Edge Function (Deno, esm.sh @supabase/supabase-js@2.105.0)"
    - "photos.trashed_at timestamptz column + 2 partial indexes"
    - "pg_cron job: photos-trash-purge at 03:15 UTC daily"
    - "photo-trash.ts: softDeletePhoto / restorePhoto / deletePhotoPermanently RPC helpers"
    - "PhotoTrashView.tsx: lazy-loaded trash modal"
  patterns:
    - "Optimistic UI hide (locallyTrashed Set) on soft-delete"
    - "Storage-best-effort + DB-authoritative delete order (Phase 19 cascade pattern)"
    - "vendor-gated-send-health-check for Vault service_role_key dependency"
    - "vi.hoisted() for vitest mocks of chainable supabase client"
    - "getUserAccessToken (admin.generateLink ES256 flow) for RLS fixtures"
key_files:
  created:
    - supabase/migrations/20270601000024_photos_trashed_at.sql
    - supabase/migrations/20270601000025_photos_trash_purge_cron.sql
    - supabase/functions/photos-trash-purge/index.ts
    - supabase/functions/photos-trash-purge/index.test.ts
    - supabase/functions/photos-trash-purge/deno.json
    - leanshot/src/lib/photo-trash.ts
    - leanshot/src/lib/photo-trash.test.ts
    - leanshot/src/components/dashboard/photos/PhotoTrashView.tsx
    - leanshot/src/components/dashboard/photos/PhotoTrashView.test.tsx
    - leanshot/tests/rls/photo-trash-rls.test.ts
  modified:
    - leanshot/src/components/dashboard/tabs/BodyTab.tsx
    - leanshot/src/types/index.ts
decisions:
  - "Storage-before-DB delete order in deletePhotoPermanently (storage failure best-effort, DB authoritative)"
  - "Cron is SOURCE OF TRUTH for permanent delete (D-09); no Storage lifecycle rules configured"
  - "Optimistic locallyTrashed Set on BodyTab for immediate UX feedback on soft-delete"
  - "PHOTO_TRASH_PREFIX='phototrash-' file-scoped; photo_ids are UUIDs (fixed seed UUID format)"
  - "Vault service_role_key is known-pending; cron no-ops with 401 until loaded"
metrics:
  duration: "~15 minutes wall clock"
  completed: "2026-05-16"
  tasks_completed: 5
  files_created: 10
  files_modified: 2
---

# Phase 23 Plan 04: Photo Trash Flow Summary

Vertical-slice implementation of DEBT-03: soft-delete with 30-day restore window + permanent-delete cron Edge Function.

## What Was Built

**Migration `20270601000024_photos_trashed_at.sql` (T1)**
- `ALTER TABLE public.photos ADD COLUMN trashed_at timestamptz NULL`
- Dropped old `photos_user_date_idx` (replaced by partial below)
- `photos_user_date_active_idx` — partial `WHERE trashed_at IS NULL` (main-grid hot path)
- `photos_user_trashed_idx` — partial `WHERE trashed_at IS NOT NULL` (Trash view + cron scan)
- Dry-run confirmed 0 skipped migrations; live push applied successfully

**photo-trash.ts helpers (T2) — 7 tests, all green**
- `softDeletePhoto(photo_id)` — `update({ trashed_at: NOW() }).eq('photo_id', id)`
- `restorePhoto(photo_id)` — `update({ trashed_at: null }).eq('photo_id', id)`
- `deletePhotoPermanently(photo_id, storage_path)` — storage.remove THEN db.delete; storage failure logged+swallowed, DB delete authoritative

**PhotoTrashView.tsx + BodyTab.tsx wire-up (T3) — 5 component tests, all green**
- `PhotoTrashView`: lazy-loaded `React.lazy()` modal; fetches `WHERE trashed_at IS NOT NULL`; per-photo Restore + Delete-now + "auto-deletes in N days" countdown label; empty state
- `BodyTab`: overflow (3-dot) menu per photo tile; "View Trash" text-link in section header; `locallyTrashed` Set for optimistic hide; `SwipeToDelete` now soft-deletes instead of hard-deletes
- Bundle delta: `PhotoTrashView` chunk 1.67 kB gz (new); index gz 19.72 kB (no regression, under 24.5 kB ceiling)

**photos-trash-purge Edge Function (T4) — 5 Deno tests, all green**
- Auth gate (service-role Bearer), health-check (500 if `SUPABASE_SERVICE_ROLE_KEY` absent)
- Queries `trashed_at < NOW() - INTERVAL '30 days'`, limit 500
- Per-row: `storage.from('photos').remove([path])` (best-effort) then `from('photos').delete()` (authoritative)
- Single `audit_logs` INSERT per non-empty batch with action `photos_trash_purge`
- `deno.json` uses `deno test --allow-all` (no `--import-map` per W-1 fix)
- Deployed ACTIVE on `ytnsipxxmzgaebkqmokp` (script 59.45 kB)

**Cron migration `20270601000025_photos_trash_purge_cron.sql` (T5)**
- `cron.schedule('photos-trash-purge', '15 3 * * *', ...)` — daily at 03:15 UTC
- `net.http_post` to `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/photos-trash-purge`
- Authorization header sourced from `vault.decrypted_secrets WHERE name = 'service_role_key'`

**Live RLS cross-tenant test (T5) — 5/5 pass live against ytnsipxxmzgaebkqmokp**
- T-23-04-01: main-grid SELECT (`IS NULL`) excludes trashed photo
- T-23-04-02: trash-view SELECT (`IS NOT NULL`) returns trashed photo
- T-23-04-03: user B SELECT on user A's photos → 0 rows
- T-23-04-04: user B UPDATE (`trashed_at = NULL`) on user A's photo → 0 rows affected, photo still trashed
- T-23-04-05: user B DELETE on user A's photo → 0 rows affected, photo still exists

## Verification Results

| Check | Result |
|-------|--------|
| Migration dry-run skip count | 0 |
| Migration applied live | Yes |
| photo-trash.ts vitest | 7/7 pass |
| PhotoTrashView.test.tsx vitest | 5/5 pass |
| Deno test suite | 5/5 pass |
| Edge Function deployed | ACTIVE (`edcd58f5`) |
| pg_cron job live | `photos-trash-purge` @ `15 3 * * *` |
| RLS live tests | 5/5 pass |
| Bundle index gz | 19.72 kB (ceiling 24.5 kB) |
| PhotoTrashView chunk | 1.67 kB gz (lazy, own chunk) |
| assert-clinic-bundle-budget.sh | All OK |

## supabase db query confirmation
```json
{
  "rows": [
    {
      "jobname": "photos-trash-purge",
      "schedule": "15 3 * * *"
    }
  ]
}
```

## supabase functions list confirmation
```
photos-trash-purge | ACTIVE | 2026-05-16 13:18:30
```

## Known Pending Dependency

**Vault `service_role_key` entry (inherited from Phase 19)**
The pg_cron job uses `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'` to authorise the Edge Function call. This Vault entry was flagged as pending setup in Phase 19. Until it is loaded:
- The cron fires daily but the HTTP POST carries a `null` Bearer → Edge Function returns 500 with `service_role_key_missing` (health-check pattern per `reference_vendor_gated_send_health_check`)
- No photos are permanently deleted until the Vault entry is in place
- Loading the entry requires no code changes — cron auto-heals on next tick

**Mitigation:** `deletePhotoPermanently` (client-side, in `photo-trash.ts`) works independently of the cron — users can permanently delete individual photos immediately via the "Delete now" button in the Trash view. The cron handles the 30-day auto-purge batch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing type field] Added `trashed_at` to Photo type**
- **Found during:** Task 3 (TypeScript strict mode compile)
- **Issue:** `Photo` interface in `src/types/index.ts` lacked `trashed_at` field; `PhotoTrashView.tsx` referenced `photo.trashed_at` which would fail typecheck
- **Fix:** Added `trashed_at?: string | null` with doc comment to `Photo` interface
- **Files modified:** `leanshot/src/types/index.ts`
- **Commit:** `eb67be8`

**2. [Rule 1 - Bug] Fixed photo_id UUID format in RLS test seed**
- **Found during:** Task 5 first live run
- **Issue:** Test used `${PHOTO_TRASH_PREFIX}active-photo` as photo_id but `photos.photo_id` is `uuid` type — caused `invalid input syntax for type uuid` error
- **Fix:** Changed test to generate UUIDs via `crypto.randomUUID()` per-run; cleanup adapted to delete by UUID list
- **Files modified:** `leanshot/tests/rls/photo-trash-rls.test.ts`
- **Commit:** `5545fef` (fixed in same commit)

**3. [Rule 1 - Bug] Removed unused `removePhoto` + `realIdx` references in BodyTab**
- **Found during:** Task 3 TypeScript build
- **Issue:** `removePhoto` store selector became unused after SwipeToDelete was wired to `handleSoftDelete`; `realIdx` was computed but never used
- **Fix:** Removed both declarations
- **Files modified:** `leanshot/src/components/dashboard/tabs/BodyTab.tsx`
- **Commit:** `eb67be8`

## Threat Flags

None. The new `trashed_at` column is on the existing `photos` table already covered by `auth.uid() = user_id` RLS policies. The Edge Function requires service-role Bearer (no new network endpoint accessible to end users). No new trust boundaries introduced.

## Known Stubs

None. All data paths are wired:
- `softDeletePhoto` → live Supabase RPC
- `restorePhoto` → live Supabase RPC
- `deletePhotoPermanently` → live Supabase Storage + DB
- `PhotoTrashView` fetch → live Supabase query
- pg_cron → Edge Function → live DB scan + Storage delete

## Self-Check: PASSED
