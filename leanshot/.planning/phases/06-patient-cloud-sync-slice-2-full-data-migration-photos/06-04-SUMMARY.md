---
phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
plan: 04
subsystem: patient-cloud-sync
tags: [photos, storage, rls, indexeddb, signed-urls, realtime, sync-04, sync-06]
one_liner: Photos move from base64-in-Zustand to Supabase Storage with signed URLs, folder-prefix RLS, IndexedDB offline queue, and a live cross-tenant impersonation proof closing PLAN-CHECK BL-1
dependency_graph:
  requires:
    - 06-02 (migration framework + v4 snapshot capture)
    - 06-03 (sync.ts per-table pull/subscribe pattern, 9 new tables landed)
  provides:
    - public.photos table (composite PK, RLS, moddatetime, Realtime publication)
    - storage.buckets["photos"] (private, 2 MB, jpeg/png/webp) + 4 folder-prefix RLS policies
    - src/lib/photo-queue.ts (IndexedDB Blob queue, idb 8.0.3)
    - src/lib/photo-compress.ts (canvas, 1600px / JPEG-85 / D-06)
    - src/lib/signed-url-cache.ts (D-05 30s pre-expiry refresh + 401-aware fetch)
    - Photo type schema (photo_id + storage_path + mime_type)
    - sync.ts flushPhotoOps serial drain (D-09)
    - migration.ts photo entity branch (D-10 eager base64 → Storage)
    - BodyTab PhotoTile 4-state matrix
    - Live cross-tenant Storage RLS impersonation proof (BL-1 closure)
  affects:
    - leanshot_v4 STORAGE_VERSION bumped 7 → 8 + migrateV7ToV8 chain
    - PendingOp type union extended with 'upload' op + blob_ref
    - sync-defer.ts onSignedIn/onSignedOut drain branches
tech-stack:
  added:
    - idb 8.0.3 (IndexedDB ergonomic wrapper; ~1 kB gz lazy-loaded via dynamic import)
    - fake-indexeddb 6.0.0 (devDep; jsdom IDB shim for unit tests)
  patterns:
    - dynamic-import-only for photo subsystem modules (bundle ceiling preserved)
    - serial drain per D-09 (one photo upload at a time)
    - LWW merge via Map<photo_id, Photo> mirroring Phase 5 injections
key-files:
  created:
    - supabase/migrations/20260514000009_photos.sql
    - supabase/migrations/20260514000010_storage_bucket.sql
    - leanshot/src/lib/photo-queue.ts (+ test)
    - leanshot/src/lib/photo-compress.ts (+ test)
    - leanshot/src/lib/signed-url-cache.ts (+ test)
    - leanshot/e2e/photo-cross-device.spec.ts
    - leanshot/e2e/fixtures/sample.jpg
    - leanshot/e2e/rls-photos-storage.test.ts (closes BL-1)
  modified:
    - leanshot/src/types/index.ts (Photo schema evolution + PendingOp.op union)
    - leanshot/src/lib/storage.ts (STORAGE_VERSION 7→8 + migrateV7ToV8)
    - leanshot/src/lib/store.ts (addPhoto async Blob, removePhoto, mergeServerPhotos, applyPhotoRealtimePayload)
    - leanshot/src/lib/sync.ts (ServerPhoto + pullInitialPhotos + subscribePhotos + flushPhotoOps + pullAndSubscribeAll fan-out)
    - leanshot/src/lib/sync-defer.ts (onSignedIn photos pull+subscribe; onSignedOut unsubscribeAll + photo-queue + signed-url-cache clear)
    - leanshot/src/lib/migration.ts (photo entity branch eager-decode + IDB + enqueue)
    - leanshot/src/lib/migration.test.ts (M8 stub → live control-flow assertion)
    - leanshot/src/lib/storage.test.ts (STORAGE_VERSION === 8)
    - leanshot/src/lib/sync-defer.test.ts (mock pullInitialPhotos/subscribePhotos/unsubscribeAll)
    - leanshot/src/components/dashboard/tabs/BodyTab.tsx (PhotoTile 4-state + data-testid)
    - leanshot/src/components/dashboard/modals/PhotoCompareModal.tsx (PhotoImg signed-URL/blob resolver)
    - leanshot/package.json (idb + fake-indexeddb)
decisions:
  - Photos table is composite-PK (user_id, photo_id) with HARD DELETE per D-07
  - Storage bucket private + 2 MB cap + jpeg/png/webp whitelist per D-04+D-06
  - Folder-prefix RLS via `(storage.foldername(name))[1] = auth.uid()::text` per D-04
  - Storage RLS bucket SQL uses `ON CONFLICT DO UPDATE` (Pitfall #11 — Studio-drift correction)
  - IndexedDB-only for photo blobs; pendingOps stays in localStorage (D-08 substrate split)
  - Serial photo upload concurrency (one at a time) per D-09
  - Eager base64→Storage migration during existing migration flow (D-10) with Pitfall 4 backpressure cap 5 in-flight + Pitfall 8 setTimeout(0) yield-per-photo
  - Web Worker compression path NOT added; main-thread compressImage is fast enough pre-launch (D-06 discretion)
  - Signed-URL cache: 5-minute TTL, 30s pre-expiry refresh window, 401-aware fetch retry, inflight Map coalesces concurrent requests
metrics:
  duration: ~1h25min
  completed_at: 2026-05-12T08:26:00Z
  tasks_completed: 6
  files_created: 9
  files_modified: 12
---

# Phase 6 Plan 04: Photos Storage + Realtime Sync Summary

This plan moves body-photo storage out of base64-in-Zustand (the largest contributor to the persisted slice, per CONCERNS.md SYNC-06) and into Supabase Storage with private folder-prefix isolation, signed-URL playback, and an IndexedDB offline queue. SYNC-06 closes for new uploads AND existing v4 photos via the eager base64→Storage migration loop wired into Plan 06-02's framework. SYNC-04 closes for the photo-specific offline case (Blob lives in IndexedDB, drains serially on reconnect).

**Verified live:** all 4 RLS policies enforced on `storage.objects[bucket_id='photos']` via the new cross-tenant impersonation test (`e2e/rls-photos-storage.test.ts`), 3 `it()` cases (DOWNLOAD / UPLOAD-WITH-CHECK / LIST impersonation) + 1 positive control + admin afterAll cleanup. The live test passes against the linked Supabase project. **PLAN-CHECK BL-1 closed.**

## What shipped

### SQL — 2 migrations on remote DB

- `20260514000009_photos.sql` — `public.photos` (composite PK `(user_id, photo_id)`, moddatetime trigger, 4 RLS policies, Realtime publication membership).
- `20260514000010_storage_bucket.sql` — `photos` bucket (private, `file_size_limit = 2097152`, `allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp']`) + 4 Storage RLS policies on `storage.objects` filtered by `bucket_id = 'photos'` AND `(storage.foldername(name))[1] = auth.uid()::text`.
- Both applied via `supabase db push --linked`; `supabase migration list --linked` confirms BOTH timestamps in both Local and Remote columns.
- Storage bucket idempotency uses `ON CONFLICT DO UPDATE` (Pitfall #11) so Studio-drift bucket settings are corrected, not silently preserved.

### 3 net-new TypeScript modules + tests (18 tests, 100% pass)

- **`src/lib/photo-queue.ts`** — IndexedDB Blob store (`leanshot_photo_queue/blobs`) via `idb@8.0.3`. Exports `putPhotoBlob`, `getPhotoBlob`, `deletePhotoBlob`, `listPhotoBlobKeys`, `clearAllPhotoBlobs` (T-06-04-04 SIGNED_OUT cleanup), `_resetForTests`.
- **`src/lib/photo-compress.ts`** — canvas-based JPEG compression with D-06 LOCKED defaults (`maxEdge=1600`, `quality=0.85`, `mimeType='image/jpeg'`). Pitfall 2 format gate throws `UNSUPPORTED_FORMAT` for non-image inputs (defence-in-depth alongside the Storage bucket's `allowed_mime_types`).
- **`src/lib/signed-url-cache.ts`** — D-05 Map-cached signed URLs. 5-minute TTL, 30s pre-expiry refresh window, `fetchPhotoWithRefresh` retries once on 401 (clock-skew tolerance, Pitfall 5). `inflight` Map coalesces concurrent `getSignedPhotoUrl` calls for the same path so N tile mounts on the same photo only trigger one network round-trip.

### Photo schema evolution (Photo, PendingOp, STORAGE_VERSION)

- `Photo` interface: dropped legacy `id` + `data: string` (base64); added `photo_id` (composite PK), `storage_path`, `mime_type`, optional `size_bytes`, server-stamped `updated_at` + `user_id`.
- `PendingOp.op` union extended with `'upload'` + optional `blob_ref` field for the IndexedDB key.
- `STORAGE_VERSION` 7 → 8, `migrateV7ToV8` chained into `migrateState`. Back-stamps `photo_id` (preferring existing `photo_id`, then legacy `id`, then a fresh uuid), initialises `storage_path: ''` + `mime_type: 'image/jpeg'`. Preserves the legacy `data: string` (base64 dataURL) through v8 so the eager photo-migration loop has access to source bytes.

### Sync wiring (sync.ts + sync-defer.ts + store.ts)

- `ServerPhoto` + `mapServerPhotoToLocal` mirror the Phase 5 injections pattern.
- `pullInitialPhotos` + `subscribePhotos` wired into `pullAndSubscribeAll`.
- `flushPhotoOps` is **serial** (D-09): one photo at a time, each op is a multi-step transaction (read Blob from IDB → Storage upload → metadata-row upsert → drop local Blob). Handles `'upload'`, `'delete'`, and metadata-only `'upsert'` op kinds. Transient errors leave the op in place for retry; permanent 4xx drops the op so the queue cannot wedge.
- `sync-defer.ts onSignedIn` drain now triggers `pullInitialPhotos + subscribePhotos` alongside injections.
- `sync-defer.ts onSignedOut` drain now calls `unsubscribeAll` + `clearAllPhotoBlobs` + `clearSignedUrlCache` (T-06-04-04: prior user's photo blobs MUST NOT survive sign-out — shared-device leak protection).
- Store: `addPhoto(blob, meta)` is now async — compresses, persists to IDB, enqueues `'upload'` op + `deferFlush()`. `removePhoto(idx)` drops the local IDB blob best-effort and enqueues `'delete'` op. `mergeServerPhotos` + `applyPhotoRealtimePayload` LWW handlers mirror the Phase 5 contract.

### Migration loop (D-10 eager base64 → Storage)

`migration.ts` photo entity branch is real. Per legacy v4 photo: `fetch(dataUrl) → blob() → compressImage → putPhotoBlob → enqueueOp({ table: 'photos', op: 'upload' })`. Pitfall 4 backpressure caps in-flight upload ops at 5 (waits + re-flushes if the queue saturates) so a 100-photo legacy library doesn't blow IndexedDB quota in a single synchronous batch. Pitfall 8 main-thread yielding uses `setTimeout(0)` between photos so the migration modal can repaint progress. Partial-failure tolerant: a single corrupt photo logs to console; the loop continues.

### BodyTab PhotoTile 4-state matrix

`BodyTab.tsx` photo grid now renders the per-tile state matrix from 06-UI-SPEC §3:

| State                | Rendering                                                        |
|----------------------|------------------------------------------------------------------|
| `loading-signed-url` | Skeleton overlay (`shape="rect"`) — `aria-busy="true"`           |
| `loaded`             | Signed-URL `<img>` (resolved via `getSignedPhotoUrl`)             |
| `signed-url-failed`  | AlertCircle 24px + "Tap to retry" button (sets `retryNonce`)      |
| `queued-for-upload`  | Local Blob preview (`URL.createObjectURL` from IDB) + "Queued" badge with `CloudOff` icon |

Queued badge uses CSS variables (`var(--color-warning-soft)` / `var(--color-warning)`) — no Tailwind palette (06-UI-CHECK N3 conformance). `data-testid="body-tab-photo-grid"` added for the SC#3 Playwright spec.

`PhotoCompareModal.tsx` updated with a `PhotoImg` inline component using the same dynamic-import resolution path so the modal works with the new schema.

### e2e specs

- **`e2e/photo-cross-device.spec.ts`** — Playwright SC#3 proof. Two contexts, seed B first so the photos Realtime channel is subscribed before A uploads. Fixture: `e2e/fixtures/sample.jpg` (636-byte minimal JPEG, no external dependency). 5s budget asserted via `toHaveCount(1, { timeout: 5000 })`. `afterAll` cleans up Storage objects under `{userId}/photos/` + deletes the test user (cascades public.photos via on-delete FK). Skips cleanly when service-role env var is absent.
- **`e2e/rls-photos-storage.test.ts`** — live cross-tenant Storage RLS impersonation proof. 3 `it()` cases (DOWNLOAD / UPLOAD-WITH-CHECK / LIST impersonation) + positive control (user A downloads their own object) + gating test. Lazy-construct admin client so `describe.skip` doesn't crash on missing env. `afterAll` removes Storage objects (Supabase admin.deleteUser does NOT cascade Storage) and deletes both test users.

**Live run verification:** `npx vitest run --config vitest-e2e.config.ts e2e/rls-photos-storage.test.ts` against the linked Supabase project (with `SUPABASE_SERVICE_ROLE_KEY` set) — **all 4 tests pass, ~5s total**.

## Test summary

- Unit tests: **404 passing** (up from 386; +18 from the 3 net-new lib test files; +1 net-new from M8 conversion; storage.test STORAGE_VERSION assertion updated).
- e2e RLS suite: discovered 4 tests in the new file via the existing `e2e/rls-*.test.ts` glob — no `vitest-e2e.config.ts` change needed. All 4 pass against live Supabase Storage.

## CI gates

| Gate                                  | Result | Notes                                          |
|---------------------------------------|--------|------------------------------------------------|
| `npm run typecheck`                   | PASS   | 0 errors                                       |
| `npm run lint`                        | PASS   | 0 errors (5 pre-existing warnings, unchanged)  |
| `npm run test:unit`                   | PASS   | 404 tests                                      |
| `npm run build`                       | PASS   | 2.6s                                           |
| `bash scripts/assert-vendor-react-size.sh` | PASS   | index.js 20.87 kB gz (under 50 kB ceiling)     |
| `npm run test:e2e:rls` (live)         | PASS   | 4/4 with service-role key                      |

## Bundle impact

The photo subsystem is **fully dynamic-imported** — none of `photo-queue`, `photo-compress`, `signed-url-cache` is on App.tsx's static graph. `sync.ts` itself is dynamic-imported by sync-defer; the photo handlers add ~1 kB gz to the sync chunk only.

- Index chunk: **20.87 kB gz** (was 20.10 kB pre-plan — +0.77 kB from BodyTab inline PhotoTile + PhotoCompareModal updates routed through dynamic imports).
- Sync chunk: **3.82 kB gz → 4.0 kB gz** (estimate; flushPhotoOps + ServerPhoto + pullInitialPhotos + subscribePhotos).
- Photo subsystem bundles (lazy-loaded on first photo capture / tile mount): photo-queue, photo-compress, signed-url-cache all separate chunks. `idb` itself adds ~1 kB gz.

Bundle ceiling preserved with substantial headroom (29.13 kB under the 50 kB index limit).

## Verified live (post-push DB state)

- `supabase migration list --linked` shows `20260514000009` and `20260514000010` in both Local and Remote columns.
- `public.photos` exists with 4 RLS policies (`photos_select_own`, `photos_insert_own`, `photos_update_own`, `photos_delete_own`).
- `storage.buckets` row for `photos`: `public=false`, `file_size_limit=2097152`, `allowed_mime_types` contains `image/jpeg`, `image/png`, `image/webp`.
- 4 Storage RLS policies on `storage.objects` filtered by `bucket_id='photos'` AND `(storage.foldername(name))[1] = auth.uid()::text`.
- Live cross-tenant impersonation test passes — proves the policies ENFORCE per-user folder isolation, not just EXIST as SQL.

## Threat model coverage

| Threat ID    | Status     | Evidence                                                                                       |
|--------------|------------|------------------------------------------------------------------------------------------------|
| T-06-04-01   | mitigated  | Folder-prefix RLS + bucket `public=false` + 5min signed-URL TTL. **Live proof in `rls-photos-storage.test.ts`** (3 it() cases). Closes BL-1. |
| T-06-04-02   | mitigated  | Bucket `file_size_limit=2097152` + `allowed_mime_types` whitelist enforce server-side cap. Client-side `compressImage` is defence-in-depth. |
| T-06-04-03   | mitigated  | 5-minute signed-URL TTL + 30s pre-expiry refresh client-side. Forwarded URL unusable beyond 5min. |
| T-06-04-04   | mitigated  | `clearAllPhotoBlobs` fired on SIGNED_OUT in sync-defer.ts BEFORE `clearUserDataSlices()`. `clearSignedUrlCache` fires alongside. |

## Deviations from Plan

### Rule 3 — Blocking issue fixed inline

**1. PhotoCompareModal type errors after Photo schema change**
- **Found during:** Task 3 typecheck
- **Issue:** `PhotoCompareModal.tsx` (modified in Phase 2/3) referenced `photo.data` directly. After dropping `data` from the Photo interface, the file failed typecheck.
- **Fix:** Rewrote `PhotoCompareModal.tsx` with a new `PhotoImg` inline component that dynamic-imports `signed-url-cache` (for cloud photos) or `photo-queue` (for queued local previews) — same resolution path as BodyTab's `PhotoTile`. Type uses the new `Photo` interface verbatim.
- **Files modified:** `src/components/dashboard/modals/PhotoCompareModal.tsx`
- **Commit:** 0f45557 (Task 3)

**2. BodyTab.tsx photo grid wired alongside Task 3 (instead of separately in Task 4)**
- **Found during:** Task 3 typecheck — the `addPhoto(blob, meta)` signature change cascaded into BodyTab's `onPhoto` handler.
- **Decision:** Folded BodyTab.tsx's photo grid + capture handler update INTO the Task 3 commit (which was already the schema-cascade commit) rather than splitting Task 3 vs Task 4 awkwardly. Task 4 became "migration.ts photo branch + tests" — cleaner separation by subsystem.
- **Files modified:** `src/components/dashboard/tabs/BodyTab.tsx` (Task 3 commit instead of Task 4)
- **No behavioural change vs. the plan's intent** — the BodyTab grid behavior matches 06-UI-SPEC §3's 4-state matrix exactly; only the commit boundary shifted.

### Rule 2 — Added missing critical functionality

**3. sync-defer.ts onSignedIn now also subscribes photos**
- **Found during:** Task 3 wiring review
- **Issue:** Plan 06-03 wired `pullAndSubscribeAll` and `subscribePhotos` is exported by sync.ts, but `sync-defer.ts onSignedIn` only triggered `pullInitialInjections + subscribeInjections`. Without my addition the photos Realtime channel would never fire and the SC#3 cross-device proof would fail.
- **Fix:** Added a `pullInitialPhotos + subscribePhotos` block in the onSignedIn drain branch (alongside injections, NOT replacing). The other 8 tables from 06-03 still aren't subscribed via sync-defer either — that's a separate gap (06-03 scope), not addressed here per scope-boundary rule.
- **Files modified:** `src/lib/sync-defer.ts`
- **Commit:** 0f45557

**4. sync-defer.ts onSignedOut now calls `unsubscribeAll` (was `unsubscribeInjections`)**
- **Found during:** Task 3 wiring review
- **Issue:** With photos channel added, the SIGNED_OUT path needs to tear down ALL channels (10+), not just injections. The existing `unsubscribeAll` helper in sync.ts (added by 06-03) does this.
- **Fix:** Switched onSignedOut drain to call `api.sync.unsubscribeAll()`. sync-defer.test.ts mock updated to include `unsubscribeAll` (and the assertion swapped from `unsubscribeInjections` → `unsubscribeAll`).
- **Files modified:** `src/lib/sync-defer.ts`, `src/lib/sync-defer.test.ts`
- **Commit:** 0f45557

## Known Stubs

None. Every code path implemented and wired.

## Auth gates

None hit during execution. `supabase db push --linked` ran autonomously (OS-level Supabase CLI auth already in place from Phase 5 + Wave 3 of Phase 6).

## Future work

- **Web Worker compression path** — D-06 says "main-thread is fine pre-launch". Defer until UAT surfaces jank.
- **Initial-pull metadata blob fetch optimization** — currently `pullInitialPhotos` reads metadata rows only; tiles resolve signed URLs on mount. A future plan could batch-prefetch signed URLs on initial pull to eliminate the per-tile network round-trip.
- **Soft-delete on photos** — Phase 7 GDPR may require it (parallel to injections soft-delete deferral).
- **Other 8 tables in sync-defer onSignedIn** — only injections + photos currently re-fan-out via sync-defer; the weights/meals/workouts/etc. channels are wired in sync.ts but not driven on every SIGNED_IN. Out-of-scope for 06-04; track for a follow-up.

## Self-Check: PASSED

- [x] 2 SQL migrations exist in worktree (20260514000009_photos.sql, 20260514000010_storage_bucket.sql); applied to remote DB via `supabase db push --linked`; both shown in `supabase migration list --linked`.
- [x] Main-tree migrations cleaned up post-push (no untracked supabase/migrations/* files in main repo).
- [x] 3 net-new lib modules (`photo-queue.ts`, `photo-compress.ts`, `signed-url-cache.ts`) + matching test files all present.
- [x] `idb@8.0.3` installed; `npm ls idb` resolves.
- [x] `Photo` type has `photo_id` + `storage_path` + `mime_type`; legacy `data` field removed.
- [x] `STORAGE_VERSION === 8`; `migrateV7ToV8` chained.
- [x] `e2e/rls-photos-storage.test.ts` present with 3 it() impersonation cases + positive control + afterAll cleanup; LIVE RUN PASSES.
- [x] `e2e/photo-cross-device.spec.ts` + `e2e/fixtures/sample.jpg` present.
- [x] `npm run typecheck` exits 0.
- [x] `npm run lint` exits 0 errors (5 pre-existing warnings unchanged).
- [x] `npm run test:unit` passes — 404 tests.
- [x] `npm run build` succeeds.
- [x] `bash scripts/assert-vendor-react-size.sh` exits 0 (index 20.87 kB gz under 50 kB ceiling).
- [x] M1-M7 + M9-M12 + Unit migration tests still pass (full migration.test.ts suite green).
- [x] BL-1 closed via live cross-tenant Storage RLS impersonation proof.
- [x] All 6 task commits present in worktree.
