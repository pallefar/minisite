# Phase 6: Patient Cloud Sync Slice 2 — Full Data + Migration + Photos — Research

**Researched:** 2026-05-12
**Domain:** Supabase Postgres schema fan-out + Supabase Storage + IndexedDB blob queue + one-shot leanshot_v4 → cloud migration + Realtime channel topology
**Confidence:** HIGH on schema/storage/realtime/migration matrix (mechanical extension of Phase 5 + Context7-verified Supabase docs); MEDIUM on IndexedDB-quota edge cases and exact Web Worker breakeven (browser-runtime dependent).

---

## Summary

Phase 6 is a **mechanical fan-out of Phase 5's injection-sync template** across 8 structurally identical tables (weights, meals, workouts, supplements, mood, sleep, symptoms, vials) + 1 asymmetric singleton table (settings) + a new substrate (Supabase Storage + IndexedDB) for photos. Phase 5 already shipped the generic plumbing (`subscribeToTable<T>`, `pendingOps` slice, `flushSyncQueue`'s structure, `createNamespacedStorage`, RLS pattern, moddatetime trigger, Realtime publication, LWW merge by server `updated_at`). Phase 6 instantiates the pattern 8 more times, adds Storage + IndexedDB plumbing for photos, and wraps everything in a foreground one-shot migration UI with a 90-day backup snapshot.

**Two structural delicate spots that need careful research:**
1. **`supplements`** — the only existing table whose Zustand shape (`Record<dateString, Record<supplementName, boolean>>`) does not map cleanly to a row-per-event table. Two flattening options compared below.
2. **Photos** — net-new substrate (Supabase Storage + IndexedDB Blob queue + client-side compression + signed-URL refresh-on-401). Largest delta from Phase 5; everything else is mechanical.

**Primary recommendation:** Plan 06-01 = CI hardening (D-12 explicit, blocking prerequisite). Then 1 SQL migration per new table (8 mechanical copies + 1 settings-singleton), then sync.ts fan-out, then Photo substrate + Storage bucket + signed URL cache, then migration UI + backup snapshot, then conflict toast. The path is well-grooved by Phase 5 — the main risks are at the photo substrate and the supplements flattening choice.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 .. D-14 — verbatim from 06-CONTEXT.md)

**Migration UX & failure recovery:**

- **D-01:** First sign-in for an existing `leanshot_v4` user opens a blocking foreground modal with per-entity counter rows. Dashboard gated behind modal completion (or "Continue with sync running" escape hatch — Claude's discretion). Cloud-with-prior conflicts resolve via Phase 5 LWW (server `updated_at` wins) — no per-row prompt. Counter order size-descending.
- **D-02:** Migration is idempotent and resumable. A `migration_state` slice tracks per-entity progress (`{ injections: 'complete', weights: 'in-progress', photos: 'pending', ... }`). Persisted via Zustand partialize bump. On sign-in if `migration_state.complete !== true`, modal resumes mid-flight.
- **D-03:** Before any cloud write, snapshot `localStorage.getItem('leanshot_v4')` into `localStorage.setItem('leanshot_v4_pre_cloud_backup', { state, version: 7, snapshotAt: ISO })`. Retained 90 days. After 90 days a periodic cleanup removes it. Read-only to the app — no in-app restore affordance in this phase.

**Photo storage architecture:**

- **D-04:** Storage path convention `{userId}/photos/{photoId}.jpg` (actual extension from compression output). Bucket scoped under user UUID at path-prefix level for `(storage.foldername(name))[1] = auth.uid()::text` RLS.
- **D-05:** Client-side cache signed URLs (`Map<photoId, {url, expiresAt}>`) with refresh-on-401. Default signed-URL TTL 5 minutes (per Phase 5 Pitfall #7). Cache in-memory (NOT persisted); cross-device sign-out clears implicitly.
- **D-06:** Client-side compression on upload via canvas: max 1600px longest edge, JPEG quality 85, target < 1 MB. Web Worker if possible (Claude's discretion). Original full-res NOT retained.
- **D-07:** Hard-delete on row delete — Storage object removed when photo row is deleted (cascade trigger OR client-side `.remove([path])` after table delete — Claude's discretion). No soft-delete.

**Offline queue substrate:**

- **D-08:** Hybrid substrate. `pendingOps` slice stays in localStorage (small JSON, 16 passing tests). NEW IndexedDB store `leanshot_photo_queue` holds Blob payloads keyed by `upload-op-id`. A pendingOps photo entry: `{ table: 'photos', op: 'upload', key: photoId, blob_ref: <indexeddb-key> }`. Sync engine resolves `blob_ref` from IDB before invoking `supabase.storage.from('photos').upload(...)`.
- **D-09:** Photo upload concurrency = serial 1-at-a-time. Avoids Storage rate limits during migration, gives deterministic progress, simplifies IDB transactions. Non-photo ops keep Phase 5's existing serial drain.

**Existing-base64 photo migration:**

- **D-10:** Existing v2 users' base64 photos migrated EAGERLY during leanshot_v4 → cloud migration. Per-photo: decode base64 → canvas-compress per D-06 → upload to Storage at D-04 path → replace `photo.dataUrl` with `photo.storage_path` in per-user namespaced Zustand state. Post-migration the Zustand-persisted slice is lean.

**Conflict UX:**

- **D-11:** Non-blocking info-kind toast on the losing device — "We kept your most recent edit." Duration ~5s, dismissible, no recovery affordance (Phase 7 audit log + export handles "show me what was overwritten"). Wording is Claude's discretion to refine matching the existing Toast tone.

**CI hardening:**

- **D-12:** Plan 06-01 = explicit CI hardening, blocking prerequisite (`depends_on: []` for itself; ALL other Phase 6 plans `depends_on: ['06-01']`). Three tasks:
  1. `npm run format -- --write` across 18 files Prettier flagged after Phase 5 ship, single commit.
  2. Extract eager imports of `@/lib/sync`, `@/lib/auth-migration`, and (transitively) `@supabase/supabase-js` out of `src/App.tsx`'s static graph. Introduce `src/lib/sync-defer.ts` modeled on Phase 2.1's `src/lib/telemetry-defer.ts`. Re-prove bundle-size guard green via `npm run build` + `dist/index-*.js gzip ≤ 50 kB` CI assertion.
  3. Fold in the `MedLevelChart.tsx:13` 1-line null-guard fix (`useStore((s) => s.user!)` → nullable selector + early-return).

**Per-table schema notes:**

- **D-13:** 8 of 9 new tables structurally similar to `public.injections` — composite PK `(user_id, <entity>_id)`, server-authoritative `updated_at` via moddatetime, default-deny RLS with 4 policies, Realtime publication. Researcher proposes:
  - `vials` + `supplements` — discrete-vs-daily identity. `vials` discrete (composite PK fits). `supplements` flattening — researcher recommends, planner picks.
  - `settings` — per-user singleton, PK = `user_id`, no `entity_id`. Realtime SELECT/UPDATE only (no INSERT/DELETE in normal flow). Researcher acknowledges asymmetry vs other 8 tables.

**Realtime channel topology:**

- **D-14:** One channel per table named `{table}:{userId}` with one `postgres_changes` binding filtered on `user_id=eq.<uid>`. Total 9 channels per signed-in client. Researcher to validate Supabase doesn't impose a < 9 channels-per-connection cap on Tier 1 / free tier.

### Claude's Discretion (researcher proposes, planner picks)

- Counter order specifics in D-01 (size-descending heuristic; refine if UX research surfaces something better).
- Conflict-toast exact wording in D-11 (match existing Toast tone).
- IndexedDB store schema details in D-08 (object store name, indexes, version bump).
- Web Worker vs main-thread for canvas compression in D-06 (latency budget driven).
- `migration_state` corruption detection rule in D-02 (JSON parse fail? missing keys? researcher recommends below).
- `supplements` schema flattening choice in D-13 (researcher recommends below).
- Photo `storage.foldername` RLS policy SQL in D-04 (planner writes from researcher template).
- Bucket name (`photos` vs `patient-photos`) in D-04.
- Periodic `leanshot_v4_pre_cloud_backup` cleanup trigger in D-03.

### Deferred Ideas (OUT OF SCOPE — verbatim from CONTEXT.md)

- Photo soft-delete / trash bin — Phase 7 GDPR unifies deletion semantics.
- In-app "restore from backup" UI — Phase 7 owns user-facing data recovery.
- Per-row "what was overwritten?" recovery — Phase 7 audit log + export covers this.
- Codebase-wide `s.user!` audit — only `MedLevelChart.tsx:13` folded in (06-01 D-12).
- Phase 4 Deno test resurrection — /gsd-debug separately.
- HIPAA Storage BAA — Phase 7 Supabase Team-tier upgrade decision.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-02 | Existing local-only `leanshot_v4` user can sign in and have their localStorage data uploaded into their account on first sync, with no data loss | §1 Schema design + §4 Migration test matrix + §5 Migration UX + §10 (eager base64 photo handling) |
| SYNC-03 | Pre-cloud `leanshot_v4` snapshot preserved as `leanshot_v4_pre_cloud_backup` for at least 90 days post-migration | §5 Backup snapshot mechanics + §6 Pitfalls (cleanup trigger) |
| SYNC-04 | Mutations made offline queued in IndexedDB and replayed on reconnect; conflicts resolve last-writer-wins with clear UI | §3 IndexedDB library choice + §7 Photo upload queue draining + §6 LWW conflict-toast UX + Phase 5 LWW already in place |
| SYNC-06 | Photos move from base64-in-Zustand to Supabase Storage with signed URLs, keeping the Zustand-persisted slice lean | §2 Supabase Storage architecture + §3 IndexedDB schema + §6 Pitfalls (signed-URL race) |

---

## Project Constraints (from CLAUDE.md)

| Constraint | Source | Implication for Phase 6 |
|-----------|--------|------------------------|
| GSD workflow before file edits | CLAUDE.md "GSD Workflow Enforcement" | All Phase 6 work routes through `/gsd-execute-phase` |
| TS strict, no `as never`, no `eslint-disable` without doc | tsconfig.app.json | New sync helpers must typecheck under strict — generic types in `subscribeToTable<T>` already prove the pattern |
| Tailwind v4 beta tokens via `@theme` | CLAUDE.md "Frameworks" | All MigrationModal + ConflictToast surfaces must use existing tokens; UI-SPEC §New Design Tokens explicitly "None" |
| `prefers-reduced-motion` honored | CLAUDE.md "Accessibility Conventions" | MigrationModal progress bar + Skeleton shimmer (UI-SPEC N5 fix) must respect; existing `useReducedMotion()` hook is the seam |
| Lazy-loaded route-equivalents preserved | CLAUDE.md "Architectural Constraints" | MigrationModal MUST ship behind a dynamic import (UI-SPEC §1 Bundle-size note). `sync-defer.ts` is the substrate. |
| Single Zustand store + persist | CLAUDE.md "State Management" | New `migration_state` + photo signed-URL cache + IndexedDB-keyed photo refs all integrate via the existing store; no parallel state container |
| Synchronous hydration before first render | CLAUDE.md "Bootstrap" | `migrateV6ToV7` precedent — any v7→v8 storage migration runs synchronously in `hydrate()` |
| All dates as ISO strings or `YYYY-MM-DD` | CLAUDE.md "Patterns" | New `migration_state.startedAt`/`snapshotAt` MUST be ISO strings; never `Date` objects (breaks JSON round-trip) |
| Bundle aggressive code-split | CLAUDE.md "Constraints" | D-12 sync-defer.ts is the load-bearing implementation of this constraint for Phase 6 surfaces |
| Local-first must keep working | CLAUDE.md "Architecture" + project pattern | Photo capture offline must enqueue Blob → IDB → drain on reconnect. NOT a sync-or-fail flow. |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|-----------|-------------|----------------|-----------|
| 8 new table schemas + RLS + Realtime publication | Database / Storage | — | SQL migrations + Postgres `moddatetime` + `auth.uid() = user_id` RLS |
| `settings` singleton schema (PK = user_id, no entity_id) | Database / Storage | — | Asymmetric variant of the 8-table pattern |
| Per-table sync subscription (9 Realtime channels) | API / Backend (Supabase Realtime broker) | Browser (channel handle) | Phase 5's `subscribeToTable<T>` already exists; Phase 6 instantiates 8 wrappers + photo channel |
| Photo blob storage | Database / Storage (Supabase Storage) | — | Out-of-band bucket; not in Postgres |
| Photo metadata row | Database / Storage (Postgres `photos` table) | — | The `photos` table is one of the 9 sync'd tables; stores `storage_path` not the Blob |
| Signed-URL minting | API / Backend (Supabase Storage) | Browser (cache, refresh-on-401) | `createSignedUrl({expiresIn: 300})` + client Map cache |
| Client-side photo compression | Browser (Canvas API) | Optionally Web Worker (OffscreenCanvas) | Pure client transform; max 1600px JPEG-85 |
| Offline mutation queue (non-photo) | Browser (localStorage `pendingOps`) | — | Phase 5 substrate, unchanged |
| Offline photo Blob queue | Browser (IndexedDB `leanshot_photo_queue`) | — | New substrate per D-08; Blob payloads too large for localStorage |
| Migration progress UI | Browser (React MigrationModal) | — | Foreground modal; gates dashboard until complete OR escape hatch |
| Migration backup snapshot | Browser (localStorage `leanshot_v4_pre_cloud_backup`) | — | Pre-migration JSON snapshot; 90-day retention; cleanup on next sign-in |
| Migration resume state | Browser (Zustand `migration_state`, persist allowlist) | — | Per-entity status map; survives reload |
| LWW conflict resolution | API / Backend (Postgres `updated_at` via moddatetime) | Browser (`applyRealtimePayload` LWW guard) | Server is authoritative; client defers via timestamp compare |
| Conflict notification | Browser (existing `Toast` primitive) | — | Existing component, info kind, optional duration override |
| CI bundle-size guard | CI (GitHub Actions npm script) | Build pipeline (Vite emits chunks) | Phase 2.1 / Phase 5 existing 50 kB gzip ceiling on `dist/index-*.js` |
| Deferred sync init | Browser (`sync-defer.ts` `requestIdleCallback` + dynamic import) | — | New module modeled on Phase 2.1's `telemetry-defer.ts` |

---

## Standard Stack

### Core (existing — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | `^2.105.4` `[VERIFIED: leanshot/package.json]` | Postgres + Storage + Realtime + Auth client | Phase 4/5 substrate; storage + signed URL APIs already on the same client |
| `zustand` | `^5.0.1` `[VERIFIED: leanshot/package.json]` | Single source of truth; persist middleware drives the Zustand-namespaced storage adapter | Phase 5 shipped per-user namespaced adapter (`createNamespacedStorage`) — Phase 6 inherits the guarantee for free across all new slices |
| `vitest` | `2.x` (Phase 1) `[VERIFIED: 312 tests passing post-Phase 5]` | Unit tests + RLS integration test | Existing test runner; no change |
| `@playwright/test` | (Phase 1) `[VERIFIED: existing e2e/*.spec.ts]` | Multi-context e2e | Phase 5's `cross-device-sync.spec.ts` is the template for the photo + migration e2e |

### Net-new dependency (one)

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `idb` | `8.0.3` (latest) `[VERIFIED: npm view idb version 2026-05-12]` | Promise wrapper around IndexedDB | Jake Archibald's reference Promise wrapper; ~1 kB gz; no schema DSL; widely used; no API surface to mislearn |

**Why `idb` and not `dexie`:** `dexie` (4.4.2 current `[VERIFIED: npm view dexie version 2026-05-12]`) is a richer schema-DSL + indexed-query library at ~30 kB gz. Phase 6 has ONE object store (`leanshot_photo_queue`) with ONE access pattern (`get(key)` / `put(key, blob)` / `delete(key)` / `keys()`). Dexie's query API and reactive `liveQuery` are unused. `idb` is the right size and surface for the job. `[CITED: github.com/jakearchibald/idb]`

### Supporting (browser-native — no new dependencies)

| API | Phase 6 usage |
|-----|---------------|
| `IndexedDB` (via `idb` wrapper) | `leanshot_photo_queue` object store for Blob payloads keyed by `upload-op-id` |
| `crypto.randomUUID()` | `photo_id` PK generation (mirrors Phase 5 `log_id` pattern) |
| `crypto.subtle.digest('SHA-256')` | namespaced-key hash (already used in `namespacedKey()` from Phase 5) |
| `Canvas` 2D context | Client-side compression: `drawImage` to a sized canvas + `toBlob(type, quality)` |
| `OffscreenCanvas` + `Worker` (optional) | Web Worker compression path if main-thread jank is observed in migration of >20 photos |
| `URL.createObjectURL(blob)` | Local-preview of queued-but-not-uploaded photos in BodyTab |
| `FileReader.readAsArrayBuffer()` | Decode base64 dataURL → ArrayBuffer → Blob for D-10 eager migration |
| `fetch()` + 401 detection | Signed-URL refresh-on-401 (D-05) |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Tradeoff | Decision |
|------------|-----------|----------|----------|
| `idb` | `dexie` | Richer query DSL, ~30 kB gz | `idb` wins on size — one object store, no indexes needed |
| `idb` | Hand-rolled raw IndexedDB | Zero deps | The IDB transactional API is notoriously easy to misuse (request handles, version events). The `idb` Promise wrapper has been the de-facto standard since 2017. ~1 kB tradeoff for correctness. |
| Bucket per user | Single shared bucket + RLS by path prefix | Bucket-per-user requires runtime bucket creation (admin RPC) and complicates rate limits | Single bucket `photos` with `(storage.foldername(name))[1] = auth.uid()::text` RLS — Supabase's documented pattern `[CITED: supabase.com/docs/guides/storage/security/access-control]` |
| Server-side compression (Edge Function) | Client-side compression | Eliminates client CPU; centralized policy | Client is doing the right job here — saves upload bandwidth, the patient's data stays on their device until they explicitly upload, no Function cold-start cost. Phase 6 keeps it client. |
| `supplements` as row-per-event (3-column PK) | `supplements` as one row per day with `payload jsonb` | See §1.B below | Researcher RECOMMENDS row-per-event — better Realtime fanout, simpler LWW |
| 9 Realtime channels (one per table) | 1 Realtime channel, 9 postgres_changes bindings | Could consolidate per Phase 5 Hand-off Note #6 | D-14 is LOCKED on 1-per-table; researcher validates this is well within Supabase limits (§5 below) |
| Photo soft-delete | Hard-delete (D-07) | Soft-delete preserves audit; hard-delete simpler | D-07 locked hard-delete; Phase 7 GDPR work owns the unified deletion semantics |

**Installation:**

```bash
cd leanshot
npm install idb@8.0.3
```

**Version verification (executor runs):**

```bash
npm view idb version    # Expect 8.0.3 or newer in the 8.x line (semver: ^8.0.3 is safe)
npm view idb time --json | head -5  # Confirm publish date is within 12 months
```

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (signed-in patient)                      │
│                                                                            │
│  Tab/Card UI ──── addX/editX/removeX ─► Zustand store                     │
│                                          │  (persist via                  │
│                                          │   createNamespacedStorage)     │
│                                          │                                 │
│                                          ▼                                 │
│                                    ┌────────────────┐                     │
│                                    │  pendingOps[]  │  (localStorage,     │
│                                    │  signedIn      │   partialize)       │
│                                    │  migration_    │                     │
│                                    │    state       │                     │
│                                    │  (8 entities)  │                     │
│                                    └───────┬────────┘                     │
│                                            │                              │
│  Photo capture ──► canvas-compress ──► Blob ─► IDB(leanshot_photo_queue) │
│  (mobile camera)   (D-06, 1600px,         │     keyed by upload-op-id    │
│                     JPEG-85, <1MB)        │                              │
│                                           │                              │
│                                  pendingOps entry:                       │
│                                  {table:'photos',                        │
│                                   op:'upload',                           │
│                                   key:photoId,                           │
│                                   blob_ref:<idbKey>}                     │
│                                                                            │
│  signed-URL cache (Map<photoId,{url,expiresAt}>, in-memory, NOT persist) │
│                                            │                              │
│                                            │ flushSyncQueue (serial)      │
│                                            ▼                              │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  src/lib/sync.ts (extended Phase 6)                                │  │
│  │  ─ pullInitial(table, userId) × 9                                  │  │
│  │  ─ subscribe(table, userId) × 9 (postgres_changes filter)          │  │
│  │  ─ flushSyncQueue — dispatches by op.table:                        │  │
│  │      upsert → supabase.from(table).upsert(...)                     │  │
│  │      delete → supabase.from(table).delete()....                    │  │
│  │      upload (NEW)                                                   │  │
│  │        → idb.get(blob_ref)                                          │  │
│  │        → supabase.storage.from('photos').upload(path, blob)        │  │
│  │        → supabase.from('photos').upsert({...row, storage_path})    │  │
│  │        → idb.delete(blob_ref)                                       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                            │                              │
│  src/lib/sync-defer.ts (NEW, D-12)        │                              │
│   ─ requestIdleCallback init               │                              │
│   ─ dynamic import('@/lib/sync')           │                              │
│   ─ pre-init buffer (FIFO, cap 64)         │                              │
└────────────────────────────────────────────┼──────────────────────────────┘
                                             │
                       HTTPS (supabase-js)   │
                                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE (project ytnsipxxmzgaebkqmokp)          │
│                                                                            │
│  ┌─────────────────────────┐  ┌────────────────────────────────────────┐ │
│  │  Postgres (RLS, 9 new   │  │  Realtime broker                       │ │
│  │  tables + injections):  │  │   ─ supabase_realtime publication      │ │
│  │   - weights             │  │     (10 tables: injections + 9 new)    │ │
│  │   - meals               │  │   ─ 9 channels per signed-in client    │ │
│  │   - workouts            │  │     ({table}:{userId})                 │ │
│  │   - supplements         │  │   ─ RLS-gated fanout                   │ │
│  │   - mood                │  │   - 100 channels/conn cap (free tier — │ │
│  │   - sleep               │  │     well above the 9 we use)           │ │
│  │   - symptoms            │  └────────────────────────────────────────┘ │
│  │   - vials               │                                              │
│  │   - settings (singleton)│  ┌────────────────────────────────────────┐ │
│  │   - photos              │  │  Storage (bucket: 'photos')            │ │
│  │   (composite PK,        │  │   ─ private (public=false)             │ │
│  │    moddatetime          │  │   ─ allowedMimeTypes: image/jpeg,      │ │
│  │    trigger,             │  │       image/png, image/webp            │ │
│  │    4 RLS policies)      │  │   ─ fileSizeLimit: 2 MB (D-06 < 1 MB   │ │
│  └─────────────────────────┘  │       client-target + headroom)         │ │
│                                │   ─ RLS via storage.objects policies   │ │
│                                │     (auth.uid()::text =                 │ │
│                                │      (storage.foldername(name))[1])    │ │
│                                │   ─ signed URLs via                     │ │
│                                │     createSignedUrl(path, 300)         │ │
│                                │     (5 min TTL per D-05)               │ │
│                                │   ─ Free tier: 1 GB total storage      │ │
│                                │     (see §2.5 capacity projection)     │ │
│                                └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
leanshot/
├── src/
│   ├── lib/
│   │   ├── sync.ts             # EXTEND — add subscribeWeights/Meals/.../Photos + dispatch in flushSyncQueue
│   │   ├── sync-defer.ts       # NEW (D-12) — requestIdleCallback + dynamic import wrapper
│   │   ├── photo-queue.ts      # NEW — idb-backed photo Blob queue (open/put/get/delete/keys)
│   │   ├── photo-compress.ts   # NEW — canvas-based compress(File|Blob → Blob, max1600, JPEG-85)
│   │   ├── signed-url-cache.ts # NEW — Map<photoId,{url,expiresAt}> + refresh-on-401
│   │   ├── migration.ts        # NEW — runMigration({snapshot, onProgress}) state machine
│   │   ├── storage.ts          # EXTEND — STORAGE_VERSION 7 → 8 (add migration_state to allowlist)
│   │   ├── store.ts            # EXTEND — migration_state slice + addPhoto-with-blob action +
│   │   │                       #          applyRealtimePayload generalized per-table
│   │   └── auth-migration.ts   # EXTEND — enqueueLocalDataForSync (8 tables + photos)
│   ├── components/
│   │   ├── sync/
│   │   │   ├── MigrationModal.tsx        # NEW (UI-SPEC §1) — foreground modal
│   │   │   └── MigrationEntityRow.tsx    # NEW (UI-SPEC §1) — per-entity row
│   │   └── dashboard/tabs/
│   │       └── BodyTab.tsx               # MODIFY (UI-SPEC §3) — signed-URL fetch + queued badge
├── supabase/
│   └── migrations/
│       ├── 20260514000000_weights.sql        # NEW
│       ├── 20260514000001_meals.sql          # NEW
│       ├── 20260514000002_workouts.sql       # NEW
│       ├── 20260514000003_supplements.sql    # NEW
│       ├── 20260514000004_mood.sql           # NEW
│       ├── 20260514000005_sleep.sql          # NEW
│       ├── 20260514000006_symptoms.sql       # NEW
│       ├── 20260514000007_vials.sql          # NEW
│       ├── 20260514000008_settings.sql       # NEW — singleton variant
│       ├── 20260514000009_photos.sql         # NEW — table for photo metadata
│       └── 20260514000010_storage_bucket.sql # NEW — create bucket + RLS policies
└── e2e/
    ├── rls-all-tables.test.ts      # NEW — parameterized cross-tenant RLS for 9 new tables
    ├── migration-v4-to-cloud.spec.ts  # NEW — covers SC#1 + key SC#2 scenarios
    ├── photo-upload-signed-url.spec.ts # NEW — covers SC#3
    └── conflict-lww-toast.spec.ts  # NEW — covers SC#4
```

### Pattern 1: Mechanical schema template for 8 of the 9 new tables

**Lifted verbatim from Phase 5's `20260513000000_injections.sql`** — every new SQL file is a search-and-replace of `injections` → `<table>` and `log_id` → `<entity>_id`. Each table also gets a per-table secondary index on `(user_id, date)` or `(user_id, ts)` for the listing path.

Per-entity composite PK proposal (column name, recommended secondary index):

| Table | PK column | Secondary index | Rationale |
|-------|-----------|-----------------|-----------|
| `weights` | `weight_id uuid` | `(user_id, date desc)` | List ordered by date (BodyTab weight history) |
| `meals` | `meal_id uuid` | `(user_id, date desc, ts desc)` | NutritionTab is day-grouped; `ts` is the intraday ordering |
| `workouts` | `workout_id uuid` | `(user_id, date desc)` | ActivityTab list |
| `mood` | `mood_id uuid` | `(user_id, date desc)` | MoodTab list (one entry per day typically; PK still composite for future multi-entry/day) |
| `sleep` | `sleep_id uuid` | `(user_id, date desc)` | MoodTab adjacent |
| `symptoms` | `symptom_id uuid` | `(user_id, date desc)` | SymptomsTab list |
| `vials` | `vial_id uuid` | `(user_id, start_date desc)` | MedicationTab vials list; `start_date` is the most useful sort |
| `supplements` | see §1.B below | see §1.B below | special — see flattening |
| `settings` | `user_id` (PK alone) | none | singleton — no listing path |
| `photos` | `photo_id uuid` | `(user_id, date desc)` | BodyTab photo grid sort |

`[CITED: leanshot/.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-RESEARCH.md §4 — the canonical injections schema template]`

### Pattern 2: Sync engine fan-out via `subscribeToTable<T>`

The generic helper Phase 5 shipped at `src/lib/sync.ts:268-286` already accepts arbitrary table names. Phase 6 wraps it 8 times (10 with injections + photos already there) and adds per-table `mapServerToLocal` functions + per-table `applyRealtimePayload<T>` reducers.

```typescript
// src/lib/sync.ts (Phase 6 extension)
export function subscribeWeights(userId: string): RealtimeChannel {
  return subscribeToTable<ServerWeight>('weights', userId, (payload) => {
    const mapped = mapPayload(payload, mapServerWeightToLocal);
    useStore.getState().applyWeightRealtimePayload(mapped);
  });
}

// Same shape for meals, workouts, supplements, mood, sleep, symptoms, vials,
// settings, photos. 9 wrappers total (settings is one even though it's a singleton —
// the channel still fires UPDATE events on settings changes from other devices).
```

### Pattern 3: IndexedDB photo queue (`src/lib/photo-queue.ts`)

```typescript
// src/lib/photo-queue.ts
import { openDB, type IDBPDatabase } from 'idb';

/**
 * leanshot_photo_queue — single object store keyed by upload-op-id (UUID).
 *
 * Versioning rationale: schema is dirt-simple (one store, no indexes). v1 is
 * enough for the entire Phase 6 surface. A future change (adding an index, a
 * second store) bumps to v2 via `upgrade(db, oldVersion)` callback.
 *
 * Why a separate DB rather than reusing the supabase-js IndexedDB store:
 *   supabase-js owns its own auth-session DB (`sb-leanshot-auth-token`).
 *   Keeping our photo Blobs in a dedicated `leanshot_photo_queue` DB lets us
 *   add/wipe/inspect without touching auth state. Also: per-user wipe on
 *   sign-out (parallel to localStorage namespace cleanup) is one
 *   `indexedDB.deleteDatabase()` call.
 */
const DB_NAME = 'leanshot_photo_queue';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME); // out-of-line keys — caller supplies key
        }
      },
    });
  }
  return dbPromise;
}

export async function putPhotoBlob(key: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, blob, key);
}

export async function getPhotoBlob(key: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, key);
}

export async function deletePhotoBlob(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, key);
}

export async function listPhotoBlobKeys(): Promise<string[]> {
  const db = await getDb();
  const keys = await db.getAllKeys(STORE_NAME);
  return keys as string[];
}

/** Sign-out cleanup. Mirrors removeUserNamespace pattern. */
export async function clearAllPhotoBlobs(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}
```

`[CITED: github.com/jakearchibald/idb — openDB / upgrade callback / typed object store APIs]`

### Pattern 4: Client-side compression (`src/lib/photo-compress.ts`)

Main-thread path (correct default; Web Worker is an optional optimization for migrating large batches):

```typescript
// src/lib/photo-compress.ts
export interface CompressOptions {
  maxEdge?: number;        // default 1600 (D-06)
  quality?: number;        // default 0.85 (D-06)
  mimeType?: string;       // default 'image/jpeg'
}

export async function compressImage(
  source: Blob | File,
  opts: CompressOptions = {},
): Promise<Blob> {
  const { maxEdge = 1600, quality = 0.85, mimeType = 'image/jpeg' } = opts;

  // createImageBitmap handles Blob/File directly and is wider-supported than
  // Image() round-trip for HEIC/PNG (HEIC still requires browser support —
  // see §6 Pitfall 4 below).
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch (err) {
    throw new Error('UNSUPPORTED_FORMAT', { cause: err });
  }

  const { width: w0, height: h0 } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_2D_UNAVAILABLE');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('TO_BLOB_FAILED'))),
      mimeType,
      quality,
    );
  });
}
```

**Web Worker variant (deferred — only ship if migration of >20 photos shows main-thread jank):** wrap the same logic inside a worker using `OffscreenCanvas` + `canvas.convertToBlob({type, quality})`. The worker takes `{blob, opts}` via postMessage and posts back the compressed Blob. Worker creation cost (~5ms) is amortized across the serial drain.

### Pattern 5: Signed-URL cache with refresh-on-401

```typescript
// src/lib/signed-url-cache.ts
import { supabase } from '@/lib/supabase';

interface CachedUrl { url: string; expiresAt: number; }
const cache = new Map<string, CachedUrl>();
const SIGNED_URL_TTL_SEC = 300;        // 5 min per D-05
const REFRESH_BEFORE_EXPIRY_MS = 30_000; // refresh 30s before expiry on read

export async function getSignedPhotoUrl(storagePath: string): Promise<string> {
  const now = Date.now();
  const cached = cache.get(storagePath);
  if (cached && cached.expiresAt - now > REFRESH_BEFORE_EXPIRY_MS) {
    return cached.url;
  }
  const { data, error } = await supabase.storage
    .from('photos')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (error || !data) throw error ?? new Error('createSignedUrl returned no data');
  const expiresAt = now + SIGNED_URL_TTL_SEC * 1000;
  cache.set(storagePath, { url: data.signedUrl, expiresAt });
  return data.signedUrl;
}

/**
 * 401-aware fetch wrapper. Most photo loads happen via <img src=signedUrl>;
 * the <img> element does NOT expose a "401 happened" hook. For tiles where
 * we control the fetch (refresh button, programmatic download), this helper
 * intercepts 401 and refreshes once.
 *
 * For <img> tags: rely on `onError` handler on the <img> element to call
 * `cache.delete(storagePath)` + force a re-render with a fresh url.
 */
export async function fetchPhotoWithRefresh(storagePath: string): Promise<Response> {
  let url = await getSignedPhotoUrl(storagePath);
  let res = await fetch(url);
  if (res.status === 401) {
    cache.delete(storagePath);
    url = await getSignedPhotoUrl(storagePath);
    res = await fetch(url);
  }
  return res;
}

/** Cross-account sign-out invalidation. Called from App.tsx SIGNED_OUT. */
export function clearSignedUrlCache(): void {
  cache.clear();
}
```

`[CITED: supabase.com/docs/guides/storage/serving/downloads — createSignedUrl(path, expiresIn) returns {signedUrl}]`

### Pattern 6: sync-defer.ts (modeled on telemetry-defer.ts)

```typescript
// src/lib/sync-defer.ts (NEW per D-12)
/**
 * Sync deferral helper (Phase 6 D-12 CI hardening).
 *
 * Phase 5 wired @/lib/sync, @/lib/auth-migration, and (transitively) @supabase/supabase-js
 * into App.tsx's static graph. This pushed the entry chunk gzip past the 50 kB
 * Phase 2.1 ceiling. Phase 6 D-12 inverts the dependency: App.tsx imports
 * THIS module's tiny pre-init buffer + dynamic-import scheduler, and the heavy
 * @/lib/sync module loads after first paint.
 *
 * Differences vs telemetry-defer.ts:
 *   - Sync is bidirectional + stateful (channels, queue, subscriptions),
 *     where telemetry is fire-and-forget event capture.
 *   - We MUST buffer pre-init calls (sign-in, sign-out, online events,
 *     enqueue mutations) and replay them in order once @/lib/sync resolves.
 *   - Telemetry's pre-init buffer is `error`/`unhandledrejection` events;
 *     ours is sync-API calls keyed by name.
 *   - Buffer cap: 64 entries. If more than 64 enqueue during the idle window
 *     (extremely unlikely — typically just SIGNED_IN once), drop the OLDEST
 *     and log to console. The dropped calls are recoverable on next event
 *     (the queue itself survives in localStorage; SIGNED_IN re-fires on reload).
 */
import type { Session } from '@supabase/supabase-js';

type SyncCall =
  | { kind: 'onSignedIn'; userId: string; session: Session }
  | { kind: 'onSignedOut'; prevUserId: string | null }
  | { kind: 'flush' }
  | { kind: 'startMigration'; userId: string };

const buffer: SyncCall[] = [];
const BUFFER_CAP = 64;
let loadedApi: Awaited<ReturnType<typeof loadSync>> | null = null;

async function loadSync() {
  const [sync, authMig, migration] = await Promise.all([
    import('@/lib/sync'),
    import('@/lib/auth-migration'),
    import('@/lib/migration'),
  ]);
  return { sync, authMig, migration };
}

function drain(): void {
  if (!loadedApi) return;
  while (buffer.length > 0) {
    const call = buffer.shift()!;
    try {
      if (call.kind === 'onSignedIn') {
        // Per-table pull + subscribe; instantiate all 9 channels here.
        void loadedApi.sync.pullAndSubscribeAll(call.userId);
        void loadedApi.migration.maybeStartMigration(call.userId);
      } else if (call.kind === 'onSignedOut') {
        void loadedApi.sync.unsubscribeAll();
      } else if (call.kind === 'flush') {
        void loadedApi.sync.flushSyncQueue();
      } else if (call.kind === 'startMigration') {
        void loadedApi.migration.runMigration(call.userId);
      }
    } catch (e) {
      console.error('[leanshot] deferred sync call failed', call.kind, e);
    }
  }
}

function push(call: SyncCall): void {
  if (loadedApi) {
    buffer.push(call);
    drain();
    return;
  }
  if (buffer.length >= BUFFER_CAP) {
    console.warn('[leanshot] sync-defer buffer full; dropping oldest');
    buffer.shift();
  }
  buffer.push(call);
}

/** Public API mirrors what App.tsx used to call directly. */
export function deferOnSignedIn(userId: string, session: Session): void {
  push({ kind: 'onSignedIn', userId, session });
}
export function deferOnSignedOut(prevUserId: string | null): void {
  push({ kind: 'onSignedOut', prevUserId });
}
export function deferFlush(): void {
  push({ kind: 'flush' });
}

/** Scheduled from main.tsx after first paint. */
export function scheduleSyncInit(): void {
  const startLoad = (): void => {
    void loadSync().then((api) => {
      loadedApi = api;
      drain();
    });
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(startLoad, { timeout: 2000 });
  } else {
    setTimeout(startLoad, 100); // Safari/Firefox fallback (same as telemetry-defer)
  }
}
```

### Pattern 7: Migration state machine (`src/lib/migration.ts`)

```typescript
// src/lib/migration.ts (NEW)
type EntityStatus = 'pending' | 'in-progress' | 'complete' | 'error';
const ENTITIES = [
  'photos',       // largest typical payload — D-09 serial drain dominates
  'injections',   // Phase 5 already syncs; migration just enqueues
  'weights',
  'meals',
  'workouts',
  'supplements',
  'mood',
  'sleep',
  'symptoms',
  'vials',
  'settings',
] as const;

export type Entity = (typeof ENTITIES)[number];
export type MigrationState = Partial<Record<Entity, EntityStatus>> & {
  startedAt: string;   // ISO
  complete: boolean;
  snapshotKey: string; // 'leanshot_v4_pre_cloud_backup' (D-03)
};

const SNAPSHOT_KEY = 'leanshot_v4_pre_cloud_backup';
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function snapshotPreCloudBackup(): void {
  // D-03 — verbatim JSON snapshot before any cloud write.
  let raw: string | null = null;
  try { raw = localStorage.getItem('leanshot_v4'); } catch { return; }
  if (!raw) return;
  // Also check the user-namespaced key — Phase 5 may have already moved it.
  // The snapshot saves whichever key currently holds the data.
  const payload = JSON.stringify({
    state: JSON.parse(raw),
    version: 7,
    snapshotAt: new Date().toISOString(),
  });
  try { localStorage.setItem(SNAPSHOT_KEY, payload); } catch (e) {
    console.error('[leanshot] backup snapshot failed', e);
    throw e; // Migration MUST NOT proceed if backup failed (D-03 contract).
  }
}

/** Called from sync-defer.ts onSignedIn after persist hydration. */
export async function maybeStartMigration(userId: string): Promise<void> {
  // 1. Periodic cleanup (D-03 — researcher recommends "on next sign-in" trigger).
  cleanupExpiredBackup();

  // 2. Detect "needs migration" state.
  const state = readMigrationStateFromStore();
  if (state?.complete) return;       // already done
  if (state) return resumeMigration(userId, state); // mid-flight resume (D-02)

  // 3. Fresh migration — detect whether legacy v4 data exists.
  const snapshot = readPreCloudSnapshot();
  if (!snapshot) return; // net-new user; no migration needed

  // 4. Take backup BEFORE any cloud write (D-03).
  snapshotPreCloudBackup();

  // 5. Initialize migration_state and open the modal.
  initMigrationStateInStore(snapshot);
  return runMigration(userId);
}

export async function runMigration(userId: string): Promise<void> {
  // Per-entity drain. ORDER (D-01 + UI-SPEC §1 row order):
  // size-descending at runtime; default static order if counts tie.
  const ordered = computeRunOrder(); // pure function over the snapshot
  for (const entity of ordered) {
    try {
      markStatus(entity, 'in-progress');
      await migrateEntity(userId, entity); // enqueues + awaits flush
      markStatus(entity, 'complete');
    } catch (e) {
      markStatus(entity, 'error');
      console.error(`[leanshot] migration failed for ${entity}`, e);
      // Don't bail — surface as per-entity retry per UI-SPEC §1 Open Q #8.
      // Other entities proceed; user can retry the failed row inline.
    }
  }
  markComplete();
}

function cleanupExpiredBackup(): void {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { snapshotAt?: string };
    if (!parsed.snapshotAt) return;
    const age = Date.now() - new Date(parsed.snapshotAt).getTime();
    if (age > RETENTION_MS) {
      localStorage.removeItem(SNAPSHOT_KEY);
    }
  } catch { /* corrupt snapshot — silently leave; D-02 corruption detection catches it elsewhere */ }
}

/**
 * D-02 corruption detection rule (Claude's discretion):
 *   migration_state is "corrupted" iff ANY of:
 *     - JSON.parse on the persisted blob throws
 *     - typeof state.complete !== 'boolean'
 *     - typeof state.startedAt !== 'string' (or not a valid ISO)
 *     - any value in the entity-status map is NOT in {pending,in-progress,complete,error}
 *
 *   On detected corruption: clear migration_state, show "Something went wrong"
 *   error banner with "Retry migration" CTA (UI-SPEC §1 error-corrupted-state).
 *   The backup snapshot at leanshot_v4_pre_cloud_backup is the recovery seed —
 *   retry re-reads from there.
 */
```

### Anti-Patterns to Avoid

- **Don't put photo Blobs in localStorage.** That's the bug Phase 6 closes (SYNC-06). All photo binaries live in IDB or Supabase Storage; only the metadata row (with `storage_path`) lives in Zustand-persist.
- **Don't await Storage upload inside the Zustand reducer.** `addPhoto` reducer puts the Blob in IDB synchronously (well, schedules the put), enqueues a pendingOps entry, returns. The upload happens during `flushSyncQueue` on idle / on online.
- **Don't include `updated_at` in upsert payloads.** Phase 5 Pitfall #4 + Critical Gotcha #11: moddatetime is server-authoritative. Phase 6 extends to 9 tables; the regression test for injections must be PARAMETERIZED across all 10 tables.
- **Don't subscribe to channels before sign-in.** subscribe wrappers must early-return if no session. Phase 5 already gates via `isSyncEnabled()`; verify each new wrapper does the same.
- **Don't fetch signed URLs eagerly for all photos at once.** Photos lazy-load — `useSignedUrl(photoId)` resolves on tile mount, not on store hydration. Otherwise 50 photos × `createSignedUrl` RPC fires on dashboard load.
- **Don't omit the bucket-create migration.** Storage policies on `storage.objects` are global; the bucket itself must exist or every upload 404s. Create the bucket in SQL or via the JS admin path in a Wave-0 step.
- **Don't rely on `<img onError>` alone for 401 detection.** Browsers don't always expose HTTP status on `<img>` errors. The cache TTL pre-emptive refresh (30s before expiry) is the primary defense; onError is the fallback.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IndexedDB Promise wrapper | Hand-rolled `IDBRequest.onsuccess`/`onerror` listeners | `idb` 8.0.3 | The raw IDB API has been the source of countless production bugs (forgotten `versionchange` handlers, leaked transactions, request handle lifetime). `idb` is ~1 kB. |
| Image compression | `Image()` + `naturalWidth` round-trip | `createImageBitmap` + `<canvas>` `toBlob()` | createImageBitmap handles EXIF orientation correctly and works with Blob/File directly. The Image() pattern requires manual EXIF reading. |
| Realtime subscription per table | Bespoke `ws.send(JSON.stringify(...))` | `supabase.channel(name).on('postgres_changes', filter, cb).subscribe()` | The Realtime wire protocol (Phoenix Channels) is non-trivial; supabase-js owns reconnect, auth refresh, presence. |
| Bucket creation + RLS | Click-ops in Studio | SQL migration `20260514000010_storage_bucket.sql` | Click-ops aren't replayable to a fresh project; SQL migration is the canonical seed |
| Signed URL minting | Hand-rolled HMAC | `supabase.storage.from(bucket).createSignedUrl(path, expiresIn)` | The signing key lives server-side; clients cannot mint securely |
| LWW conflict resolution | Vector clocks, CRDTs | Server-authoritative `updated_at` + Phase 5's `applyRealtimePayload` LWW guard | v1 doesn't need true CRDT; "newest write wins by server clock" is the documented choice from CONTEXT D-08 and reuses Phase 5 infrastructure |
| Migration progress UI | Bespoke modal stack | Existing `Modal` + `ProgressBar` + `Toast` primitives | UI-SPEC §1 covers — zero new primitives |
| Migration backup mechanics | Background Web Worker copy | `localStorage.setItem('leanshot_v4_pre_cloud_backup', verbatim JSON)` | localStorage is the source; copy is synchronous and atomic |
| Per-user storage namespacing | New module | `createNamespacedStorage` from Phase 5 — already handles all persist slices including new `migration_state` | Already shipped; new slices in partialize inherit for free |

**Key insight:** Phase 6 is 80% mechanical extension of Phase 5 + 20% new substrate (Storage + IDB). The 80% inherits Phase 5's audited code paths verbatim; the 20% is where research focuses (signed-URL refresh, IDB quota, compression failures, supplements flattening).

---

## Detailed Resolutions

### §1. Per-table schema proposals (HONORS D-13)

#### §1.A. The 7 mechanical tables (weights, meals, workouts, mood, sleep, symptoms, vials)

Each follows the injections template verbatim. Concrete shape for `weights` (others mirror — substitute domain columns from `src/types/index.ts`):

```sql
-- supabase/migrations/20260514000000_weights.sql
create table public.weights (
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_id uuid not null,
  primary key (user_id, weight_id),

  -- Domain fields from src/types/index.ts WeightLog
  date text not null,          -- YYYY-MM-DD (TEXT to match local string; could be date type)
  weight numeric not null,
  body_fat numeric,            -- nullable; matches `bodyFat: number | null`
  ts bigint not null,          -- ms-since-epoch (matches existing `ts: number`)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index weights_user_date_idx on public.weights (user_id, date desc);

create trigger weights_set_updated_at
  before update on public.weights
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.weights enable row level security;

create policy "weights_select_own" on public.weights for select using (auth.uid() = user_id);
create policy "weights_insert_own" on public.weights for insert with check (auth.uid() = user_id);
create policy "weights_update_own" on public.weights for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "weights_delete_own" on public.weights for delete using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weights'
  ) then
    execute 'alter publication supabase_realtime add table public.weights';
  end if;
end$$;
```

Per-table domain columns (planner copies into the matching SQL file):

| Table | Required domain columns (NOT NULL unless noted) | Nullable columns |
|-------|-------------------------------------------------|------------------|
| `weights` | `date text`, `weight numeric`, `ts bigint` | `body_fat numeric` |
| `meals` | `date text`, `name text`, `calories numeric`, `protein numeric`, `fiber numeric`, `ts bigint` | `hunger numeric`, `satisfaction numeric` |
| `workouts` | `date text`, `type text` (CHECK in set), `name text`, `minutes numeric`, `notes text default ''` | `rpe numeric` |
| `mood` | `date text`, `mood smallint` (CHECK 1..5), `notes text default ''` | `energy numeric` |
| `sleep` | `date text`, `hours numeric`, `wakings smallint`, `notes text default ''` | `quality numeric` |
| `symptoms` | `date text`, `symptom text`, `severity smallint` (CHECK 1..5), `notes text default ''` | — |
| `vials` | `name text`, `doses_per_vial smallint`, `doses_used smallint`, `start_date text`, `expiration_date text` | — |

`[VERIFIED: src/types/index.ts WeightLog/Meal/Workout/MoodLog/SleepLog/SymptomLog/Vial]`

#### §1.B. `supplements` — flattening recommendation (researcher RECOMMENDS Option A)

Current Zustand shape: `Record<dateString, Record<supplementName, boolean>>` — i.e. one map per day of supplement-name → taken.

| Option | Schema | Rationale |
|--------|--------|-----------|
| **A. row-per-event (RECOMMENDED)** | `(user_id, date text, supplement_name text, taken boolean) — PK (user_id, date, supplement_name)` | Granular Realtime fanout (one row updates, one event). LWW per (date,name) pair — natural conflict resolution. Easier to add a 4th supplement post-migration without touching existing rows. Mirrors the "row per data point" shape of all other 8 tables. |
| B. one JSON row per day | `(user_id, date text, payload jsonb) — PK (user_id, date)` | Fewer rows. But a single "checked tablet" on phone vs laptop produces a whole-day JSON conflict; LWW means the loser's whole day is replaced. Realtime payload is fatter. Adding/removing supplement names requires a payload rewrite. |

**Researcher recommendation: Option A.** Tradeoffs scale better; matches the rest of the table-set's idioms; LWW semantics map to "the most recent toggle on supplement X for date Y wins" — which is what users intuitively expect. Migration of existing `Record<date, Record<name, boolean>>` data: flatten into one row per `(date, supplement_name)` where `taken=true`. (Optionally also rows where `taken=false` if you want to preserve the false signal; cleaner to only persist `true` rows and treat absence as false.)

```sql
-- supabase/migrations/20260514000003_supplements.sql (Option A)
create table public.supplements (
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,                  -- YYYY-MM-DD
  supplement_name text not null,
  primary key (user_id, date, supplement_name),

  taken boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplements_user_date_idx on public.supplements (user_id, date desc);

create trigger supplements_set_updated_at
  before update on public.supplements
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.supplements enable row level security;
-- 4 standard policies + publication membership as per template.
```

**Migration of existing data:** flatten via

```typescript
for (const [date, names] of Object.entries(snapshot.supplements)) {
  for (const [name, taken] of Object.entries(names)) {
    if (taken) enqueueOp({ table: 'supplements', op: 'upsert', key: `${date}:${name}` });
  }
}
```

The `pendingOps.key` is the synthetic `${date}:${name}` composite — uniquely identifies the row. flushSyncQueue parses it back when building the upsert rows.

#### §1.C. `settings` — singleton variant (asymmetric)

```sql
-- supabase/migrations/20260514000008_settings.sql
create table public.settings (
  user_id uuid not null primary key references auth.users(id) on delete cascade,

  -- Per-user singleton payload. Choosing JSON to defer the "exactly which
  -- settings fields are sync'd" decision — the User shape in src/types/index.ts
  -- is wide (units, medication, dose, doseUnit, targets, injectionDay,
  -- activityLevel, liftingLevel, ...). Migration would otherwise need a
  -- column-per-field design that drift-locks with the User interface.
  --
  -- Tradeoff: JSON loses per-field LWW (settings is whole-row). For a
  -- singleton row this is fine — the row IS the unit of conflict. The Phase 5
  -- LWW guard (updated_at on the row) still applies.
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No secondary index (singleton).

create trigger settings_set_updated_at
  before update on public.settings
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.settings enable row level security;

create policy "settings_select_own" on public.settings for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.settings for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- DELETE policy intentionally omitted — settings is created on first save and
-- never deleted in the normal flow. If account deletion fires, the
-- ON DELETE CASCADE on user_id wipes the row. If a future flow needs the
-- DELETE policy, add it then.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'settings'
  ) then
    execute 'alter publication supabase_realtime add table public.settings';
  end if;
end$$;
```

**Publication membership debate (D-13 surfaces the question):** Settings sync across devices IS valuable (the patient sets `injectionDay=Mon` on phone, expects the laptop UI to show "Monday" without refresh). Cost is one extra Realtime channel (channel #10 if photos is counted) and very low message volume (settings update on dashboard "Save" only). **Researcher recommendation: INCLUDE settings in publication**, ship the 9th channel. Cost is negligible; benefit is the cross-device-consistency promise of SYNC-01.

`[ASSUMED: settings sync is worth a Realtime channel. If user research disagrees, settings can be pulled-only on sign-in via a fetch and the publication membership line dropped without other schema changes.]`

#### §1.D. `photos` table (metadata only — Blob in Storage)

```sql
-- supabase/migrations/20260514000009_photos.sql
create table public.photos (
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_id uuid not null,
  primary key (user_id, photo_id),

  -- Domain fields from src/types/index.ts Photo + Phase 6 D-04 storage path
  date text not null,                   -- YYYY-MM-DD or ISO
  weight numeric,                       -- nullable (Photo.weight)
  storage_path text not null,           -- {userId}/photos/{photoId}.jpg (D-04)
  mime_type text not null default 'image/jpeg',
  size_bytes integer,                   -- compressed size; null pre-upload

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index photos_user_date_idx on public.photos (user_id, date desc);

-- moddatetime trigger + 4 RLS policies + publication membership (standard template).
```

`Photo` TypeScript interface adapter: drop the `data: string` (base64) field; add `storage_path: string` and `photo_id: string`. The component layer asks the signed-URL cache for a URL via `getSignedPhotoUrl(storage_path)`.

### §2. Supabase Storage architecture (HONORS D-04..D-07)

#### §2.1. Bucket creation (SQL migration over Studio UI)

```sql
-- supabase/migrations/20260514000010_storage_bucket.sql
-- D-04 / D-06 / D-07: photos bucket with size + mime-type guards.
-- Idempotent via INSERT...ON CONFLICT DO NOTHING; safe to re-apply.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,                        -- private — D-04 (signed URLs only)
  2097152,                      -- 2 MB ceiling (D-06 client target <1 MB + safety headroom)
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Storage RLS policies — folder-prefix isolation per D-04.
-- The path convention `{userId}/photos/{photoId}.jpg` puts the user UUID at
-- (storage.foldername(name))[1]; comparing to auth.uid()::text enforces
-- per-user isolation.
-- ----------------------------------------------------------------------------

create policy "photos_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

`[CITED: supabase.com/docs/guides/storage/security/access-control — folder-prefix RLS pattern verbatim from Supabase docs]`

#### §2.2. Bucket-level config

| Setting | Value | Source |
|---------|-------|--------|
| `public` | `false` | D-04 requires signed URLs; no public reads |
| `file_size_limit` | `2097152` bytes (2 MB) | D-06 client targets <1 MB; 2 MB gives headroom for outlier compress outputs while still rejecting raw 12 MP iPhone JPEGs (~3-5 MB) |
| `allowed_mime_types` | `['image/jpeg', 'image/png', 'image/webp']` | D-06 normalizes to JPEG; PNG + WebP allowed for forward-compat (e.g., screenshot uploads from desktop, HEIC-to-WebP fallback) |

`[CITED: supabase.com/docs/guides/storage/buckets/creating-buckets — file_size_limit + allowed_mime_types options]`

#### §2.3. Signed URL TTL + refresh-on-401

- **TTL:** `createSignedUrl(path, 300)` → 5 minutes per D-05.
- **Why 5 min and not longer:** an unauthorized 3rd party who got a URL has at most 5 min to use it. Long enough that an `<img>` element loads + caches the response; short enough that the URL is effectively useless if forwarded.
- **Refresh-on-401 logic:** §Pattern 5 above. Pre-emptive refresh 30 s before expiry; reactive refresh on `<img onError>` or `fetch` 401.

#### §2.4. Hard-delete cascade (D-07)

**Researcher recommendation: client-side `.remove([path])` after table delete.** Trigger-based cascade (`AFTER DELETE ON photos` calling `storage.delete_object`) is feasible but adds operational complexity (the trigger function needs a service-role context to bypass storage RLS, OR the storage policy must allow self-DELETE which it does — but the trigger pattern still requires a stable storage RPC available from inside a Postgres trigger).

The client-side path is simpler:

```typescript
removePhoto: async (photoId: string) => {
  const photo = useStore.getState().photos.find((p) => p.photo_id === photoId);
  if (!photo) return;
  // 1. Enqueue delete op for the metadata row (and Storage object).
  useStore.getState().enqueueOp({ table: 'photos', op: 'delete', key: photoId });
  useStore.setState((s) => ({ photos: s.photos.filter((p) => p.photo_id !== photoId) }));
  void flushSyncQueue();
},

// In flushSyncQueue, the photos delete branch becomes:
//   await supabase.from('photos').delete().eq('user_id', uid).eq('photo_id', photoId);
//   await supabase.storage.from('photos').remove([photo.storage_path]);
// Order matters: delete the metadata first so a failure to delete the Storage
// object leaves an orphan (recoverable later) rather than a dangling
// signed-URL reference. Failure to delete Storage: log + move on (orphan rows
// can be GC'd by a Phase 7 cron).
```

#### §2.5. Storage cost projection (free-tier ceiling)

**Free tier: 1 GB total storage** `[VERIFIED: Context7 supabase docs — "Free plan includes 1 GB of storage"]`

| Assumption | Value |
|------------|-------|
| Compressed photo size (D-06 target) | <1 MB; expect avg ~500 KB |
| Photos per active user per year | ~26 (2-week cadence per UI copy) |
| Year-1 active patients (LeanShot launch realistic) | 100–500 |
| 100 users × 26 photos × 500 KB | 1.3 GB — **exceeds free tier** |
| 500 users × 26 photos × 500 KB | 6.5 GB — **6× free tier** |

**Implication: free-tier Storage is sufficient for closed beta (~50 power users for the first 6 months) but breaks at any meaningful patient-launch scale.** Phase 7 already plans a Pro/Team tier upgrade for BAA + retention; Phase 6 ships on free tier and Phase 7 monitors the storage gauge in PostHog / Sentry.

**Action for the planner:** Add a `STORAGE_QUOTA_NOTE` doc-comment in the migration file calling out the 1 GB ceiling and pointing to Phase 7 as the upgrade trigger. Don't block on it for Phase 6 ship.

`[ASSUMED: launch scale of 100-500 users in first 6 months. If product goes viral, the upgrade trigger fires earlier — operationally tracked, not a code change.]`

### §3. IndexedDB library choice (HONORS D-08)

**Recommendation: `idb` 8.0.3.** Already justified in Standard Stack table. The single-object-store, no-index schema is the simplest case `idb` was designed for.

**Schema for `leanshot_photo_queue`:**

| Property | Value |
|----------|-------|
| Database name | `leanshot_photo_queue` |
| Database version | `1` |
| Object store name | `blobs` |
| Key strategy | out-of-line; caller supplies the key (`upload-op-id`, a UUID) |
| Indexes | none — only access pattern is `get(key)` / `put(key, blob)` / `delete(key)` / `keys()` |
| Versioning strategy | When schema changes, bump to `DB_VERSION = 2` and add an `upgrade(db, oldVersion)` branch. v1 → v2 is hypothetical (e.g., adding a `metadata` store); plan for it but don't ship a v2 in Phase 6. |
| Transaction pattern | `idb` auto-creates a transaction per `db.get/put/delete` call. For batch operations (e.g., draining 10 photos), use `db.transaction('blobs', 'readwrite')` explicitly so all 10 fit in one transaction. Phase 6's serial drain (D-09) means batch isn't critical; default per-call transactions are correct. |

**Browser storage quota (Phase 6 design assumption):**

| Browser | Quota for IndexedDB origin storage | Note |
|---------|-----------------------------------|------|
| Chrome / Edge / Brave | ~60% of free disk space (per origin) `[CITED: developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria]` | Effectively unbounded for our use |
| Firefox | ~50% of free disk space | Effectively unbounded |
| Safari (desktop) | ~1 GB hard cap per origin (improving in recent versions) | Constrains us to ~1000 Blobs at 1 MB each — comfortable |
| Safari iOS | ~1 GB hard cap; eviction risk if user "Clear Website Data" or 7+ days inactive | Worst case |
| Android Chrome | ~6% of total disk (~6 GB on 100 GB device) | Generous |

**Quota-exceeded error handling:** when `db.put()` rejects with `QuotaExceededError` (or `DOMException` with that name), the photo capture flow must (a) NOT crash; (b) surface a clear toast "Storage full — sync existing photos to free space"; (c) keep the in-memory `Blob` URL available so the user can still see the photo they just captured. D-09's serial drain helps because there's at most one queued upload at a time, but a backlog during offline migration could still exceed.

**Mitigation pattern (already accounted for in §6 Pitfall #5):**

```typescript
async function capturePhotoEnqueue(blob: Blob): Promise<void> {
  const opId = crypto.randomUUID();
  try {
    await putPhotoBlob(opId, blob);
    useStore.getState().enqueueOp({ table: 'photos', op: 'upload', key: photoId, blob_ref: opId });
  } catch (e) {
    const isQuota = (e as DOMException)?.name === 'QuotaExceededError';
    if (isQuota) {
      showToast({
        kind: 'error',
        message: 'Storage full — finish syncing photos before taking new ones.',
      });
      // The Blob URL can still be shown in the BodyTab tile via URL.createObjectURL,
      // but we did NOT persist the upload intent. The patient must explicitly retry.
      throw e;
    }
    throw e;
  }
}
```

### §4. Migration test matrix (HONORS SC#2 + Phase 5 Pitfall #4)

The 12 scenarios from Phase 5 PITFALLS.md Pitfall #4 (v3-only / v4-only / both / cloud-empty / cloud-with-prior / cloud-conflict × online / offline / flaky), reframed for Phase 6:

| # | Local state | Cloud state | Network | Expected behavior | Test type | Test file |
|---|-------------|-------------|---------|------------------|-----------|-----------|
| M1 | v4 with all 9 entities populated | empty | online | Migration runs to completion. All rows uploaded. backup snapshot retained. migration_state.complete=true. UI dismisses after "All done". | Playwright | `migration-v4-to-cloud.spec.ts` |
| M2 | v4 with only 2 entities populated (injections + photos) | empty | online | Counter rows for 2 populated entities tick to complete; other 7 show "0 of 0" → "Done" instantly. | Playwright | same |
| M3 | v4 empty (net-new install, signed up directly) | empty | online | No migration modal shown. `maybeStartMigration` no-ops. | unit + Playwright | `migration.test.ts` |
| M4 | v4 populated | populated (signed in from device 1 yesterday) | online | LWW resolves per-row; counter rows tick; toast "We kept your most recent edit" fires for any local row that lost. | Playwright | same |
| M5 | v4 populated | populated with literal conflict on row X (same primary key, different content, server `updated_at` newer) | online | Server wins per LWW; toast fires for row X. | Playwright | same |
| M6 | v4 populated | empty | offline at sign-in time | Sign-in succeeds (Phase 5 auth caches); migration queues all entities; counter rows all show "Pending" with offline indicator; on reconnect, drain happens. | Playwright with `setOffline` | `migration-offline.spec.ts` |
| M7 | v4 populated | empty | flaky (drops mid-migration after 2 entities) | After 2 entities complete, network drops; migration_state persists. Reload → resume modal shows "Resuming migration — 2 of 9 done"; remaining 7 entities drain when network returns. | Playwright (or unit-test the state machine) | `migration-resume.test.ts` |
| M8 | v4 populated, photos have base64 dataURL | empty | online | D-10 eager photo migration: decode → compress → upload to Storage → replace dataUrl with storage_path in Zustand. Counter row "Photos" ticks per-photo. Persisted slice shrinks visibly. | Playwright (+ unit) | `photo-migration.spec.ts` |
| M9 | v4 populated; `migration_state` corrupted (e.g., manually injected garbage) | empty | online | Corruption detected (D-02 rule from §Pattern 7); error banner shown; "Retry migration" CTA re-runs from backup snapshot. | unit (force corruption) | `migration-corruption.test.ts` |
| M10 | v4 populated; backup snapshot already exists from 80 days ago | empty | online | Backup is preserved (not overwritten — would lose the prior snapshot). New snapshot is appended? **Researcher recommendation: overwrite** — only one backup at a time. The 80-day-old snapshot would be auto-cleaned in 10 days anyway; the new migration's intent supersedes. | unit | `migration-backup.test.ts` |
| M11 | v4 populated; `leanshot_v4_pre_cloud_backup` snapshot exists from 95 days ago | empty | online | cleanupExpiredBackup fires first; expired snapshot deleted; fresh snapshot taken; migration proceeds. | unit | same |
| M12 | v3-only (legacy v1 user) | empty | online | v3→v4 migration runs first (Phase 5 chain), then v4→cloud migration runs. Two-stage; the v3 step is already covered by Phase 1 tests; Phase 6 only verifies the chain doesn't deadlock or lose data. | unit (chain) | `migration-v3-to-v4-to-cloud.test.ts` |

**Test file organization recommendation:**

- **One Playwright spec for the happy path + LWW** (M1, M4, M5, M8): `e2e/migration-v4-to-cloud.spec.ts`. Most important end-to-end coverage.
- **One Playwright spec for offline/flaky** (M6, M7): `e2e/migration-offline-resume.spec.ts`. Different setup pattern (`context.setOffline()` toggling).
- **Unit tests for state-machine edge cases** (M3, M9, M10, M11, M12): `src/lib/migration.test.ts`. Faster feedback; mock the snapshot fixture.
- **One photos-specific spec** (M2 if it gets fragile, plus photo-specific flows): `e2e/photo-migration.spec.ts`. Eager base64 → Storage path verification + signed-URL fetch.

### §5. Realtime channel topology + reconnect (HONORS D-14)

**Channel cap verification:** `[VERIFIED via Context7: "Most plans also enforce a limit of 100 channels per connection."]` Phase 6 uses 9 channels (10 with photos counted). Free tier cap is 100 per connection — 11× headroom. Pro tier same cap. Phase 6 is unaffected.

**Other relevant Realtime limits (free tier):** `[CITED: supabase.com/docs/guides/realtime/reports + limits]`

| Limit | Free tier | Phase 6 expected | Headroom |
|-------|-----------|------------------|----------|
| Concurrent connections | 200 | 1 per signed-in client | enormous |
| Channels per connection | 100 | 9 | 11× |
| Channel joins per second (across project) | 100 | ~9 per sign-in event | room for 11 concurrent sign-ins |
| Messages per second (across project) | 100 | LWW-driven; bursty during migration | watch during a 100-photo migration (one event per upload) — could spike but stays under |
| Payload size | 256 KB | <1 KB per postgres_changes row (we don't ship base64 anymore) | enormous |

**Reconnect behavior:** supabase-js auto-handles reconnect with exponential backoff. From Phase 5 RESEARCH §5: "supabase-js handles exponential backoff internally". Confirmed for Phase 6 (`[CITED: supabase.com/docs/guides/realtime/limits — "supabase-js will automatically reconnect when throughput decreases below the plan limit"]`).

**Single-channel-fails recovery:** Channels are independent at the supabase-js client. If channel `meals:<uid>` enters `CHANNEL_ERROR`, the other 8 channels are unaffected. Phase 5's pattern (log `CHANNEL_ERROR`/`TIMED_OUT` but don't bail) generalizes — Phase 6 adds per-channel status handlers that log per-table.

**Subtle gotcha:** Phase 5 uses a single module-level `injectionsChannel` handle. Phase 6 needs a Map: `channels: Map<TableName, RealtimeChannel>`. Teardown becomes a loop: `for (const c of channels.values()) supabase.removeChannel(c); channels.clear();`.

### §6. Common Pitfalls (Phase 6-specific, extends Phase 5's list)

#### Pitfall 1: Migration mid-flight crash leaves partial state — must be idempotent at the row level

**What goes wrong:** User force-quits the browser mid-migration. On reopen, `migration_state` says `weights: 'in-progress'` and 30 of 47 weight rows are uploaded. Naive resume re-uploads all 47 → duplicate-PK conflict OR LWW-overwrites the 30 newer server rows with stale local copies.

**Why it happens:** `migration_state` is granular at the entity level, not the row level. Without idempotency, "resume" means "restart from row 0 for the in-progress entity".

**How to avoid:** Use **`upsert` everywhere** (already Phase 5's pattern). The composite PK `(user_id, <entity>_id)` means a duplicate upsert is a no-op-or-update — never a duplicate insert. The LWW guard further protects: if the server row's `updated_at` is newer than the client's (server saw the row, client crashed before dequeuing), the local row is overwritten by the server's pull during resume. Net effect: re-uploading row N is safe.

**Test:** unit test `migration.test.ts::resume after in-progress`: pre-seed half the rows server-side via service-role, mark entity as `in-progress`, invoke `resumeMigration`, assert all rows present + no duplicates.

#### Pitfall 2: Photo compression failure (HEIC input not supported in canvas)

**What goes wrong:** iPhone user captures a HEIC photo (default iOS format). `createImageBitmap(heicBlob)` throws on Chromium/Firefox (Safari handles HEIC natively). Compression fails; the photo is queued but unable to upload.

**Why it happens:** HEIC is not a baseline canvas-supported format. Safari decodes it; Chrome/Firefox/Edge do not. Mobile Chrome on iOS uses WebKit (so it handles HEIC); mobile Chrome on Android doesn't see HEIC because Android cameras default to JPEG. So the practical impact is: a patient who uploads (e.g., AirDrop'd to laptop) a HEIC from their iPhone library, using a Chrome/Firefox browser, breaks.

**How to avoid:** Wrap `createImageBitmap` in try/catch; on failure, show a toast "This image format isn't supported. Save it as JPEG or PNG and try again." The capture flow on mobile (camera capture via `<input type="file" capture="environment">`) almost always returns JPEG on Android and HEIC on iOS — but iOS Safari handles HEIC, so the only break is the cross-platform case above.

**Forward-compat:** `heic2any` library exists (https://github.com/alexcorvi/heic2any) but adds ~150 kB. Not worth shipping in Phase 6 — defer to Phase 7+ if HEIC support shows up as a real user pain point.

**Test:** unit test `photo-compress.test.ts::throws UNSUPPORTED_FORMAT on bogus blob`: feed a non-image Blob, assert specific error code.

#### Pitfall 3: Signed URL race condition — `<img src=signedURL>` expires mid-load

**What goes wrong:** Photo tile renders `<img src={signedUrl}>` at t=4:59 (1s before 5-min TTL). Browser starts the fetch at t=5:00:00; server returns 401 at t=5:00:00.5. The `<img>` shows a broken-image icon. The cache still has the (now-stale) entry until t=5:00:00.

**Why it happens:** Two parallel clocks (client's `expiresAt`, server's signed-URL claim). Browser request can race the expiry.

**How to avoid:** **Pre-emptive refresh 30s before expiry** (`REFRESH_BEFORE_EXPIRY_MS = 30_000` in §Pattern 5). Means clients always see a URL with at least 30s of life ahead of it — a slow 3G load (~5s) still completes. Reactive: `<img onError>` triggers `cache.delete(path)` + force-rerender with a fresh URL (one retry). Belt and braces.

**Test:** unit test `signed-url-cache.test.ts::pre-emptive refresh`: mock `Date.now` to t = expiresAt - 20s, assert `getSignedPhotoUrl` triggers a new `createSignedUrl` call instead of returning the cache.

#### Pitfall 4: IndexedDB QuotaExceededError during migration

**What goes wrong:** User migrating 200 base64 photos. The eager migration loop decodes + compresses + queues all 200 Blobs into IDB before draining. Safari iOS's 1 GB quota fills at photo #150 (assuming ~7 MB original × 200 = 1.4 GB peak before compress); the put rejects mid-stream. The other 50 are dropped silently.

**Why it happens:** Eager-decode-all + serial-drain creates a peak that exceeds steady-state.

**How to avoid:** **Backpressure: don't enqueue if queue size > N.** Cap the queued Blob count at 5 (or 10). The migration loop becomes "decode 5 photos → wait for serial drain to ship them → decode the next 5". On QuotaExceededError, halt the migration of photos (mark `error`); other 8 entities continue; user is shown an inline retry on the photos row. The drain rate (~3-5 photos/sec on a fast network) means the bottleneck rarely hits.

**Implementation hint:** Migration loop for photos uses `for-of` over photos array, but enters a `while (queueSize() < 5) await sleep(50)` loop before each iteration. The serial drain shrinks queueSize as uploads complete.

**Test:** Playwright (or unit with IDB mock) — `migration-photos.spec.ts::backpressure under quota stress`.

#### Pitfall 5: `supplements` flattening edge case — empty days

**What goes wrong:** Zustand `supplements` shape allows `{ '2026-03-01': {} }` — a day with the daily UI opened but no supplement toggled. Naive flatten of `Object.entries(names)` produces zero rows for that day. Then on Realtime pull, the empty day "disappears" — and any UI that relied on "day exists, even if zero supplements" breaks.

**Why it happens:** The current shape distinguishes "day not visited" from "day visited but no supplements". Flattening into row-per-event loses that distinction.

**How to avoid:** **Don't try to preserve the distinction.** Treat absence as "no supplement taken that day" — which is consistent with reality (a user who opened the supplements view but didn't toggle anything took no supplements). Audit existing UI that depends on `supplements[date]` being defined: SupplementsTab.tsx, the streaks calc, the insights engine. Audit during plan-checker; fix call sites to `?? {}` defensively. The Zustand selector for "did the user log supplements on day X" becomes "are there any rows with date=X", which is equivalent in user-facing semantics.

**Test:** RTL test `SupplementsTab.test.tsx::renders empty when supplements[date] is undefined`. Migration unit test `supplements-flatten.test.ts::empty days produce zero rows`.

#### Pitfall 6: 64-bit namespace hash collision (theoretically)

**What goes wrong:** Phase 5 uses 64-bit hash truncation for the localStorage namespace key. Two UUIDs collide → Account B reads Account A's data. Birthday-paradox: collision is ~50% at 2^32 ≈ 4 billion users.

**Why it happens:** Truncating SHA-256 to 16 hex chars (64 bits) — Phase 5 D-12 explicit choice.

**How to avoid:** **Accept the risk for v1.** At LeanShot's expected scale (10k-100k users in years 1-2), collision probability is astronomically low (~5×10^-14 at 100k users). The threat model `T-05-05-01` in Phase 5 already accepted this. Phase 6 doesn't change the math. **Revisit at 100k+ users — bump hash to 24 hex chars (96 bits).**

Action: NONE for Phase 6 except inheriting the documented acceptance. The Phase 5 threat model log carries forward.

#### Pitfall 7: moddatetime on `settings` singleton — INSERT vs UPDATE timing

**What goes wrong:** A new user signs up. First settings save fires an `upsert` (INSERT path since the row doesn't exist). The `updated_at` defaults to `now()` per the column default. But moddatetime is `BEFORE UPDATE` — it doesn't fire on INSERT. Subsequent saves (UPDATE path) trigger moddatetime correctly.

**Why it happens:** Same as Phase 5 Pitfall #4 — moddatetime is BEFORE UPDATE only. The settings table is more affected because it has a longer span of "INSERT just happened" until the first UPDATE.

**How to avoid:** No code change — the column default `now()` on INSERT is correct. LWW based on `updated_at` works because both INSERT and UPDATE paths populate the column. Just be aware: the initial INSERT's `updated_at` is the client's perceived `now()` (since the row is empty); subsequent UPDATEs use the trigger's `now()`. They're functionally equivalent.

**Test:** unit `migrations/settings.test.ts::initial insert + subsequent update both stamp updated_at` (executed against the live DB).

#### Pitfall 8: Multi-base64-photo eager migration jank on main thread

**What goes wrong:** User has 50 base64 photos in their Zustand v4 state. Eager migration: for each, decode → canvas-compress → blob → upload. Canvas operations are synchronous on the main thread; 50 sequential 1600px-resize+JPEG-encode operations can block the UI for several seconds, freezing the migration modal counter updates.

**Why it happens:** Canvas `drawImage` + `toBlob` are main-thread; on a mid-tier phone each takes ~150ms; 50 × 150ms = 7.5s of jank.

**How to avoid:** **Yield between photos.** Wrap the per-photo work in a Promise that resolves after the next microtask + (in reduced-motion mode) one full frame:

```typescript
async function compressOnePhotoYielding(blob: Blob): Promise<Blob> {
  const out = await compressImage(blob);
  await new Promise<void>((resolve) => setTimeout(resolve, 0)); // yield
  return out;
}
```

This lets the modal repaint and the progress counter tick. On older devices, planner can add a Web Worker variant (Pattern 4 deferred path) — but that's a Phase 7 polish unless UAT screams.

#### Pitfall 9: Cross-tab simultaneous migration

**What goes wrong:** User signs in on Tab A; migration starts. They open Tab B in the same browser (already signed in via Phase 5 storage event); Tab B also runs `maybeStartMigration` and starts a parallel migration. Both upsert the same rows; both think they're authoritative.

**Why it happens:** No cross-tab mutex on the migration entry point.

**How to avoid:** **Migration is idempotent (Pitfall 1) — duplicate runs are SAFE but wasteful.** A formal mutex via Web Locks API (`navigator.locks.request('leanshot-migration-<userId>', ...)`) is the right fix; deferring it is acceptable because the worst case is wasted bandwidth, not data loss. Researcher recommendation: ship without the lock in Phase 6; if UAT reveals it as observable (e.g., two counters racing visually), add Web Locks in a small follow-up.

`[CITED: developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API — navigator.locks.request]`

#### Pitfall 10: `settings` payload schema drift

**What goes wrong:** Phase 6 settings stores `User` as JSON. In Phase 9 we add `clinicId` to `User`. Old clients still uploading `User` without `clinicId` will overwrite the server row, dropping the new field — until they themselves update.

**Why it happens:** Whole-row LWW + JSON payload = no per-field merge.

**How to avoid:** **Treat settings as add-only** at the migration layer: when reading from server, merge the server payload into the local User shape rather than replacing wholesale. Practically: `setUser({ ...localUser, ...serverPayload })` on pull instead of `setUser(serverPayload)`. Phase 6 plan should call this out so the planner wires it.

#### Pitfall 11: Storage RLS policy + `INSERT ON CONFLICT` interaction on the `storage.buckets` row

**What goes wrong:** The bucket-creation migration uses `INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING`. If the bucket row already exists (e.g., it was created via Studio UI earlier), the `file_size_limit` and `allowed_mime_types` settings from the migration are NOT applied — the existing row's settings stick.

**Why it happens:** `ON CONFLICT DO NOTHING` is a no-op on conflict.

**How to avoid:** Use `ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types`. The migration becomes idempotent AND self-correcting if Studio drift occurred.

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = excluded.public;
```

#### Pitfall 12: Realtime fanout amplification on bulk migration

**What goes wrong:** User on Tab A finishes migration of 200 meals. The Realtime broker emits 200 INSERT events to Tab A (it's the same user — but RLS doesn't suppress self-emits). Tab A's `applyMealRealtimePayload` runs 200 times, each triggering a Zustand set + re-render of NutritionTab.

**Why it happens:** Realtime emits row-by-row; supabase-js doesn't batch postgres_changes payloads.

**How to avoid:** Suppress self-emits during migration via a `migrationInProgress` flag in the apply-payload reducer:

```typescript
applyMealRealtimePayload: (payload) => {
  const state = useStore.getState();
  // During active migration, the local state is already authoritative for our own writes.
  // The server row will exist after migration; Realtime payload is redundant.
  if (state.migration_state?.meals === 'in-progress') return;
  // ...standard LWW apply path
}
```

The pull-initial + subscribe contract on completion (post-migration) handles the steady-state correctly.

### §7. Plan 06-01 CI hardening (HONORS D-12)

**`sync-defer.ts` public API surface (see §Pattern 6 for code):**

| Export | When called | Behavior |
|--------|-------------|----------|
| `scheduleSyncInit()` | Once in `main.tsx` after first paint | Schedules dynamic import of `@/lib/sync` + `@/lib/auth-migration` + `@/lib/migration` via `requestIdleCallback` (Chrome/Edge) or `setTimeout(100)` (Safari/Firefox fallback) |
| `deferOnSignedIn(userId, session)` | From App.tsx `onAuthStateChange` SIGNED_IN handler | Buffers a SyncCall; drains immediately if loaded, else queues for post-load drain |
| `deferOnSignedOut(prevUserId)` | From App.tsx SIGNED_OUT handler | Same buffer pattern; cleanup-class call |
| `deferFlush()` | From `window.addEventListener('online', ...)` | Same buffer pattern |

**Differences vs telemetry-defer.ts:**

| Aspect | telemetry-defer | sync-defer |
|--------|-----------------|------------|
| Pre-init buffer items | Browser events (`error`, `unhandledrejection`) | API calls by name (typed SyncCall union) |
| Buffer size cap | None (typically < 5 events pre-init) | 64 (typed because sync calls could pile if loaded after a multi-event burst) |
| Direction | Fire-and-forget (capture events, report later) | Bidirectional (subscribe, flush, pull) |
| State held | Sentry init params only | Channels, queue, migration_state — module-level singletons inside `@/lib/sync` and `@/lib/migration` |
| Cleanup on unload | None needed | None needed (browser unload tears down WebSockets) |

**Pre-init buffer semantics (FIFO, drain on loaded):** Already spelled out in Pattern 6. Cap is 64 — chosen because the worst-case pre-init burst is one SIGNED_IN + ~50 sync mutations from auto-flush attempts; 64 gives 25% headroom.

**Idle-scheduling primitive (`requestIdleCallback` + Safari fallback):** Same pattern as `telemetry-defer.ts` lines 88-92 — copy verbatim. The 100ms `setTimeout` fallback is empirically post-paint on Safari/Firefox per Phase 2.1 measurements.

**Bundle-size assertion target:** Phase 2.1 / Phase 5 ceiling is `dist/index-*.js` gzip ≤ 50 kB. Phase 5 broke this (CI bundle-size assertion is reportedly the lever that drove Plan 06-01 into existence). Post-fix prediction: extracting `@supabase/supabase-js` (~50 kB gz) + `@/lib/sync` (~1 kB) + `@/lib/auth-migration` (~3 kB) from the static graph should remove ~22-25 kB from the entry chunk. New entry should be ~30-35 kB gz. **Bundle-size guard target stays at 50 kB ceiling; the predicted ~30-35 kB is well under.**

`[VERIFIED via grep + ls: src/lib/telemetry-defer.ts exists; src/lib/sync.ts exists; src/lib/auth-migration.ts exists]`

**MedLevelChart.tsx:13 fix (D-12 Task 3):** Phase 5 Plan 06-01 hand-off note says replace `useStore((s) => s.user!)` with a nullable selector + early-return. Concrete shape:

```typescript
// src/components/dashboard/charts/MedLevelChart.tsx (current shape)
const u = useStore((s) => s.user!); // ❌ crashes when user is null mid-signOut

// Fix:
const u = useStore((s) => s.user);
if (!u) return null; // SIGNED_OUT view transition transient null state
```

Add a co-located RTL test that mounts MedLevelChart with `user: null` and asserts it renders nothing (no crash, no `useStore` error). Already scoped by Phase 5 Plan 05-06.

### §8. Validation Architecture (Nyquist Dimension 8)

#### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 2.x + Playwright (inherited from Phases 1, 4, 5) |
| Config file | `leanshot/vitest.config.ts` + `leanshot/playwright.config.ts` |
| Quick run command | `cd leanshot && npm test -- --run --reporter=dot` |
| Full suite command | `npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e -- --grep @phase06` |
| Estimated runtime | vitest ~40s post-Phase 6 additions; phase-06 e2e ~180s (migration + photos + LWW scenarios) |

#### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SYNC-02 (no data loss on migration) | Migration completes; v4 snapshot retained; all rows uploaded | Playwright | `npm run test:e2e -- e2e/migration-v4-to-cloud.spec.ts` | ❌ Wave 0 |
| SYNC-02 (idempotent resume) | After force-reload mid-migration, resume from last completed entity | unit | `npm test -- --run src/lib/migration.test.ts` | ❌ Wave 0 |
| SYNC-02 (corruption recovery) | Corrupted `migration_state` shows error banner + retry CTA | unit | `npm test -- --run src/lib/migration.test.ts -t "corruption"` | ❌ Wave 0 |
| SYNC-03 (90-day backup) | `localStorage.getItem('leanshot_v4_pre_cloud_backup')` populated with verbatim v4 JSON pre-migration | unit | `npm test -- --run src/lib/migration.test.ts -t "snapshotPreCloudBackup"` | ❌ Wave 0 |
| SYNC-03 (90-day cleanup) | Backup older than 90 days removed on next sign-in | unit | `npm test -- --run src/lib/migration.test.ts -t "cleanupExpiredBackup"` | ❌ Wave 0 |
| SYNC-04 (offline queue persists across reload) | Mutation while offline → reload → pendingOps survives → reconnect drains | Playwright | `npm run test:e2e -- e2e/offline-multi-table.spec.ts` | ❌ Wave 0 |
| SYNC-04 (LWW conflict toast) | Same row edited on two devices; server-wins; loser sees toast | Playwright | `npm run test:e2e -- e2e/conflict-lww-toast.spec.ts` | ❌ Wave 0 |
| SYNC-06 (photo to Storage) | Photo capture → IDB → Storage upload → signed URL fetch | Playwright | `npm run test:e2e -- e2e/photo-upload-signed-url.spec.ts` | ❌ Wave 0 |
| SYNC-06 (Zustand slice lean) | After migration of 50 base64 photos, persisted blob is < 1 MB (was previously ~6 MB) | unit | `npm test -- --run src/lib/migration.test.ts -t "Zustand slice shrinks"` | ❌ Wave 0 |
| SC#5 (cross-tenant RLS on 9 new tables) | Parameterized RLS proof — for each new table, B sees 0 rows of A's data | integration | `SUPABASE_SERVICE_ROLE_KEY=… npm run test:e2e:rls` | ❌ Wave 0 |
| SC#5 (cross-tenant Storage RLS) | B cannot read A's signed URL paths via direct GET | integration | included in `e2e/rls-storage-photos.test.ts` | ❌ Wave 0 |
| 06-01 D-12 (bundle-size guard) | `dist/index-*.js` gzip ≤ 50 kB | CI assertion | `npm run build && du -b dist/assets/index-*.js | gzip -9 | wc -c` style | ✅ exists (Phase 2.1 / Phase 5) |
| 06-01 D-12 (sync-defer pattern) | App.tsx static graph excludes `@supabase/supabase-js` | source assertion | `grep -c '@/lib/sync\|@/lib/auth-migration' src/App.tsx` returns 0 | ❌ Wave 0 |

#### Sampling Rate

- **Per task commit:** `npm test -- --run --reporter=dot` (~40s, vitest only)
- **Per wave merge:** full unit suite + the Playwright @phase06 spec set + cross-tenant RLS integration
- **Phase gate:** all three runners green AND a manual UAT on Vercel preview proving M1, M4 (LWW toast), M8 (eager photo migration), and a real-device photo capture-while-offline-and-reconnect flow

#### Wave 0 Gaps

- [ ] `supabase/migrations/20260514000000_weights.sql` and 9 sibling SQL files
- [ ] `supabase/migrations/20260514000010_storage_bucket.sql` (bucket + RLS)
- [ ] `src/lib/sync-defer.ts` + co-located `sync-defer.test.ts`
- [ ] `src/lib/photo-queue.ts` + co-located test
- [ ] `src/lib/photo-compress.ts` + co-located test
- [ ] `src/lib/signed-url-cache.ts` + co-located test
- [ ] `src/lib/migration.ts` + co-located test (covers M3, M9, M10, M11, M12)
- [ ] `src/components/sync/MigrationModal.tsx` + co-located RTL test
- [ ] `src/components/sync/MigrationEntityRow.tsx` + co-located RTL test
- [ ] `e2e/migration-v4-to-cloud.spec.ts` (M1, M4, M5, M8)
- [ ] `e2e/migration-offline-resume.spec.ts` (M6, M7)
- [ ] `e2e/photo-upload-signed-url.spec.ts` (SC#3 lifecycle)
- [ ] `e2e/conflict-lww-toast.spec.ts` (SC#4)
- [ ] `e2e/rls-all-tables.test.ts` (parameterized over the 9 new tables — SC#5)
- [ ] `e2e/rls-storage-photos.test.ts` (Storage RLS proof)
- [ ] `idb@8.0.3` installed (`npm install idb@8.0.3`)

#### Cross-tenant RLS proof template (parameterized over the 9 new tables)

```typescript
// e2e/rls-all-tables.test.ts
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const TABLES = [
  { name: 'weights', seed: { date: '2026-05-01', weight: 80, ts: Date.now() } },
  { name: 'meals',   seed: { date: '2026-05-01', name: 'salad', calories: 400, protein: 30, fiber: 5, ts: Date.now() } },
  { name: 'workouts', seed: { date: '2026-05-01', type: 'resistance', name: 'leg day', minutes: 45, notes: '' } },
  { name: 'mood',    seed: { date: '2026-05-01', mood: 4, notes: '' } },
  { name: 'sleep',   seed: { date: '2026-05-01', hours: 7.5, wakings: 1, notes: '' } },
  { name: 'symptoms', seed: { date: '2026-05-01', symptom: 'nausea', severity: 2, notes: '' } },
  { name: 'vials',   seed: { name: 'ozempic-0.5', doses_per_vial: 4, doses_used: 0, start_date: '2026-05-01', expiration_date: '2026-08-01' } },
  { name: 'supplements', seed: { date: '2026-05-01', supplement_name: 'vitamin-d', taken: true } },
  { name: 'photos',  seed: { date: '2026-05-01', storage_path: 'placeholder/photos/p.jpg' } },
  // settings: omitted — it's a singleton; the seed pattern is different (insert by user_id alone).
];

describeIfLive('Phase 6 SC#5 — cross-tenant RLS for all 9 new tables', () => {
  // ... (mirrors Phase 5 e2e/rls-injections.test.ts pattern)
  for (const { name, seed } of TABLES) {
    it(`${name}: user B cannot read user A's rows via RLS-scoped client`, async () => {
      // create A + B via admin; insert as A via admin; B selects → expect 0 rows.
    });
  }
});
```

### §9. Reusable patterns from Phase 5 that DIRECTLY apply

| Phase 5 asset | Phase 6 use |
|---------------|-------------|
| `supabase/migrations/20260513000000_injections.sql` | Template for 8 mechanical SQL migrations + photos table. Copy verbatim, search/replace `injections` → `<table>` + `log_id` → `<entity>_id`. |
| `src/lib/sync.ts` `subscribeToTable<T>` | Already generic. Phase 6 wraps once per new table — no changes to the generic. |
| `src/lib/sync.ts` `flushSyncQueue` | EXTEND — add the `op: 'upload'` branch for photos (resolves `blob_ref` from IDB, uploads to Storage, then upserts the metadata row). The existing per-table `op: 'upsert'`/`op: 'delete'` switch generalizes by reading `op.table`. |
| `src/lib/storage.ts` `createNamespacedStorage` | UNCHANGED. New slices (`migration_state`) in `partialize` inherit per-user isolation for free. Phase 6 MUST NOT regress the M4 ordering contract test. |
| `src/lib/storage.ts` `migrateV6ToV7` | TEMPLATE for v7→v8 if the planner decides one is needed (e.g., to formally introduce `migration_state` into the persisted shape). May not need to bump; `migration_state` can join partialize without a schema-version bump if it's `undefined` until used. |
| Phase 5 `applyRealtimePayload` LWW pattern | TEMPLATE for `applyWeightRealtimePayload`, `applyMealRealtimePayload`, etc. — each is a 20-line search-and-replace from the injections shape. |
| Phase 5 cross-tenant RLS test | TEMPLATE for `e2e/rls-all-tables.test.ts` parameterized form (see §8 above). |
| Phase 5 `cross-device-sync.spec.ts` | TEMPLATE for `e2e/photo-upload-signed-url.spec.ts` (multi-context: capture on A → see on B within 5 s via Realtime). |
| Phase 5 `offline-log-then-sync.spec.ts` | TEMPLATE for `e2e/offline-multi-table.spec.ts` (extend to mood + weight + photo, not just injections). |

### §10. External docs URLs (executor will need at implementation time)

- **Supabase Storage overview:** https://supabase.com/docs/guides/storage
- **Supabase Storage buckets (creation, file_size_limit, allowed_mime_types):** https://supabase.com/docs/guides/storage/buckets/creating-buckets
- **Supabase Storage RLS + folder-prefix pattern:** https://supabase.com/docs/guides/storage/security/access-control
- **Supabase Storage signed URLs:** https://supabase.com/docs/guides/storage/serving/downloads
- **Supabase Realtime postgres_changes (JS):** https://supabase.com/docs/guides/realtime/postgres-changes?language=js
- **Supabase Realtime limits + reports:** https://supabase.com/docs/guides/realtime/limits + https://supabase.com/docs/guides/realtime/reports
- **`idb` library (Jake Archibald):** https://github.com/jakearchibald/idb
- **IndexedDB browser support / quota:** https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- **`createImageBitmap`:** https://developer.mozilla.org/en-US/docs/Web/API/createImageBitmap
- **`OffscreenCanvas`:** https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- **Web Locks API (Pitfall 9 deferred mitigation):** https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API

---

## Common Pitfalls (top of mind for the planner — full list above in §6)

The most likely-to-bite-in-execution items:

1. **Pitfall 11 (bucket migration `ON CONFLICT DO UPDATE`)** — easy to write `DO NOTHING` and quietly leave a misconfigured bucket if Studio drift happened. Use `DO UPDATE`.
2. **Pitfall 4 (IDB QuotaExceededError mid-migration)** — surface during photo-heavy Playwright tests. Backpressure cap of 5 queued Blobs.
3. **Pitfall 8 (canvas main-thread jank on 50+ photos)** — yield-between-photos pattern keeps the modal alive.
4. **Pitfall 3 (signed URL race)** — pre-emptive 30s refresh window + `onError` fallback.
5. **Pitfall 5 (empty supplement days)** — audit existing UI for `supplements[date]` undefined-safety; mostly defensive `?? {}`.
6. **Pitfall 12 (Realtime self-emit amplification)** — guard `applyXRealtimePayload` reducers with the `migration_state.X === 'in-progress'` check.

---

## Code Examples

Verified patterns from Phase 5 + Context7 docs:

### Common Operation 1 — Compress and enqueue a photo

```typescript
// src/lib/store.ts (extension)
import { compressImage } from '@/lib/photo-compress';
import { putPhotoBlob } from '@/lib/photo-queue';
import { flushSyncQueue } from '@/lib/sync';

addPhoto: async (source: Blob | File, date: string, weight: number | null) => {
  const photoId = crypto.randomUUID();
  const compressed = await compressImage(source);
  const uploadOpId = crypto.randomUUID();
  await putPhotoBlob(uploadOpId, compressed);
  set((s) => ({
    photos: [
      { photo_id: photoId, date, weight, storage_path: null /* until uploaded */, _local_blob_ref: uploadOpId },
      ...s.photos,
    ],
    pendingOps: [
      ...(s.pendingOps ?? []),
      { table: 'photos', op: 'upload', key: photoId, blob_ref: uploadOpId, enqueuedAt: new Date().toISOString() },
    ],
  }));
  void flushSyncQueue();
},
```

### Common Operation 2 — flushSyncQueue photo-upload branch

```typescript
// src/lib/sync.ts (extension to existing flushSyncQueue)
const uploadOps = (state.pendingOps ?? []).filter(
  (op) => op.table === 'photos' && op.op === 'upload',
);
for (const op of uploadOps) { // SERIAL per D-09 — explicit for-of, not Promise.all
  const blob = await getPhotoBlob((op as any).blob_ref);
  if (!blob) {
    // Blob missing from IDB — drop the op so we don't loop.
    state.dropOps([op.key]);
    continue;
  }
  const photo = state.photos.find((p) => p.photo_id === op.key);
  if (!photo) {
    state.dropOps([op.key]);
    await deletePhotoBlob((op as any).blob_ref);
    continue;
  }
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `${uid}/photos/${op.key}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(storagePath, blob, { contentType: blob.type, upsert: true });
  if (uploadError) {
    if (isPermanent4xx(uploadError)) {
      console.error('[leanshot] photo upload permanent error', uploadError);
      state.dropOps([op.key]);
      await deletePhotoBlob((op as any).blob_ref);
    } else {
      // transient — leave queue intact
    }
    continue;
  }
  // 2) Upsert the metadata row (with storage_path) — server moddatetime stamps updated_at.
  const { error: rowError } = await supabase
    .from('photos')
    .upsert({
      user_id: uid,
      photo_id: photo.photo_id,
      date: photo.date,
      weight: photo.weight,
      storage_path: storagePath,
      mime_type: blob.type,
      size_bytes: blob.size,
    }, { onConflict: 'user_id,photo_id' });
  if (rowError) {
    if (isPermanent4xx(rowError)) state.dropOps([op.key]);
    continue;
  }
  // 3) Patch local row with storage_path; drop Blob; drop op.
  useStore.setState((s) => ({
    photos: s.photos.map((p) => p.photo_id === op.key ? { ...p, storage_path: storagePath } : p),
  }));
  await deletePhotoBlob((op as any).blob_ref);
  state.dropOps([op.key]);
}
```

`[CITED: supabase.com/docs/guides/storage — supabase.storage.from(bucket).upload(path, blob, {contentType, upsert})]`

### Common Operation 3 — Cross-tenant Storage RLS proof

```typescript
// e2e/rls-storage-photos.test.ts (gated by SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

describeIfLive('Phase 6 SC#5 — Storage RLS', () => {
  it('user B cannot signed-URL-read A\'s photo paths', async () => {
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const a = (await admin.auth.admin.createUser({ email: `test-a-${Date.now()}@leanshot.test`, email_confirm: true })).data.user!;
    const b = (await admin.auth.admin.createUser({ email: `test-b-${Date.now()}@leanshot.test`, email_confirm: true })).data.user!;
    // Service-role upload bypasses RLS (admin context).
    const aPath = `${a.id}/photos/test.jpg`;
    const aBlob = new Blob(['fake'], { type: 'image/jpeg' });
    await admin.storage.from('photos').upload(aPath, aBlob);

    // B signs in via magic-link OTP.
    const link = (await admin.auth.admin.generateLink({ type: 'magiclink', email: b.email! })).data;
    const bClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await bClient.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties!.hashed_token! });
    // B asks for a signed URL on A's path → expect error (RLS rejects).
    const { error } = await bClient.storage.from('photos').createSignedUrl(aPath, 60);
    expect(error).not.toBeNull();
    // Also attempt direct download — same rejection expected.
    const { data: dlData, error: dlError } = await bClient.storage.from('photos').download(aPath);
    expect(dlError).not.toBeNull();
    expect(dlData).toBeNull();
  });
});
```

### Common Operation 4 — IDB-backed photo capture (offline-safe)

```typescript
// src/components/dashboard/tabs/BodyTab.tsx (extension to existing onPhoto handler)
async function handlePhotoCapture(file: File): Promise<void> {
  try {
    await useStore.getState().addPhoto(file, todayISO(), currentWeight ?? null);
    showToast({ message: 'Photo saved.', kind: 'success' });
  } catch (e) {
    const isQuota = (e as DOMException)?.name === 'QuotaExceededError';
    if (isQuota) {
      showToast({
        message: 'Storage full — finish syncing first, then take a new photo.',
        kind: 'error',
        durationMs: 6000,
      });
    } else {
      const isUnsupported = (e as Error)?.message === 'UNSUPPORTED_FORMAT';
      showToast({
        message: isUnsupported
          ? 'Photo format not supported. Try JPEG or PNG.'
          : 'Couldn’t save photo. Try again.',
        kind: 'error',
      });
    }
  }
}
```

---

## State of the Art

| Old (pre-Phase 6) | Current (Phase 6) | When changed | Impact |
|-------------------|-------------------|--------------|--------|
| Photos as base64 dataURL in localStorage-persisted Zustand slice | Photos as `{storage_path}` metadata row + Blob in Supabase Storage + signed URLs | Phase 6 ship | Persisted slice ~6 MB → <1 MB; mobile signed-URL fetch is fast; SYNC-06 closed |
| Offline writes queued in localStorage only (text/number entities) | Hybrid: text/number entities in localStorage `pendingOps`; Blob payloads in IDB `leanshot_photo_queue` | Phase 6 D-08 | Photo capture survives offline → online; large Blobs don't bloat localStorage |
| One Realtime channel (`injections:<uid>`) | 9 channels (one per table) | Phase 6 D-14 | Per-table teardown ready; per-table debug; channel cap of 100 leaves 11× headroom |
| Migration is one-way + lossy (v3→v4 deleted v3 key) | Migration is reversible (90-day `leanshot_v4_pre_cloud_backup` snapshot) | Phase 6 D-03 / SYNC-03 | Existing v4 users can recover from cloud-migration bugs |
| `s.user!` non-null assertion in MedLevelChart | Nullable guard + early-return | Phase 6 Plan 06-01 D-12 | One observed crash class eliminated |
| App.tsx static graph includes `@supabase/supabase-js` | App.tsx imports only `sync-defer.ts`; supabase + sync load on idle | Phase 6 Plan 06-01 D-12 | Entry chunk shrinks; bundle-size CI guard re-greens |

**Deprecated/outdated:**

- The Phase 5 single `injectionsChannel` module-level singleton — replaced by a `channels: Map<TableName, RealtimeChannel>` for Phase 6.
- Phase 5 `dropOps(keys: string[])` filtering only by injections — Phase 6 generalizes to `dropOpsFor(table, keys)` OR universal `dropOps(keys)` that filters by key alone (keys are UUIDs and globally unique). Researcher recommendation: keep `dropOps(keys)` as universal — UUIDs are unique across tables; the table filter is redundant.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|--------------|
| A1 | Supplements flattening preserves user intent (treat absence-of-row as "did not take") rather than preserving "visited the day with no toggles" state | §1.B / §6 Pitfall 5 | Slight UX regression — streak calc might miss a "checked supplements card but didn't toggle anything" day. Likely invisible. Mitigation: audit SupplementsTab during planning. |
| A2 | Settings as `jsonb payload` (single column, whole-row LWW) is preferable to column-per-User-field design | §1.C | If User shape diverges quickly across versions, whole-row LWW loses fields silently when an older client overwrites. Mitigation: server-merge pattern in Pitfall 10 (`setUser({...local, ...remote})` on pull). |
| A3 | Settings publication membership is worth one Realtime channel | §1.C | Could simplify topology by leaving settings out of the publication and pull-only on sign-in. Negligible cost either way. |
| A4 | LeanShot's launch scale is 100-500 users in first 6 months — free-tier Storage's 1 GB is enough for closed beta | §2.5 | If viral, Storage fills before Phase 7. Mitigation: PostHog gauge on storage % + alert at 70% — Phase 7 upgrade can be triggered early. |
| A5 | 64-bit hash collision risk is accepted at LeanShot's expected scale (10k-100k users) | §6 Pitfall 6 | Acceptable to ~100k users (5e-14 collision probability). Revisit at scale. Inherited from Phase 5 threat model. |
| A6 | Cross-tab parallel migration is acceptable without a Web Locks mutex (Phase 6) | §6 Pitfall 9 | Worst case: wasted bandwidth, duplicate work, no data loss. If UAT shows visual races, add Web Locks in a follow-up. |
| A7 | OWASP / privacy posture: client-side compression + bucket-RLS + 5-min signed URL is sufficient for v1; HIPAA BAA is Phase 7 | §2.1 + Storage RLS template | If WMHMDA-class data is in photos (it isn't — body photos aren't health data per WMHMDA scope), an audit could surface gaps. Phase 7 legal-counsel review is the formal mitigation. |
| A8 | Web Worker for compression is NOT needed for the typical 5-15 photo migration; main-thread compress with yield-between is sufficient | §6 Pitfall 8 | If a power user has 100+ base64 photos in their v4 backup, the modal could jank visibly. Mitigation: ship the worker path as a Phase 6.x follow-up if UAT reveals it. |
| A9 | `idb` 8.0.3 is the right tradeoff for our single-store, no-index schema | Standard Stack | If we discover a need for indexed queries (e.g., "list queued photos by date"), we'd refactor to dexie. Currently no such query path. |
| A10 | Hard-delete via client-side `.remove([path])` after table delete is robust (vs server-side trigger) | §2.4 | If client crashes between table delete and storage remove, an orphan blob remains. Mitigation: Phase 7 cron-based orphan GC (acknowledged in CONTEXT deferred ideas). |
| A11 | `migration_state.complete = true` is a reliable forward-progress marker — once set, never re-runs | §Pattern 7 | If a future feature needs to re-trigger migration (e.g., new entity added in Phase 8), would need a "second migration" mechanism. Out of scope. |

If a claim above is critical and the user disagrees, surface during plan-checker or `/gsd-discuss-phase` rerun.

---

## Open Questions

1. **`settings` Realtime publication membership — keep or skip?**
   - What we know: 9-vs-10 channels is well below the 100 cap. Settings updates are rare (dashboard "Save" button), so the channel sees minimal traffic.
   - What's unclear: Is cross-device settings sync a real user request, or speculative?
   - Recommendation: SHIP with publication membership. Negligible cost; closes the "I changed units to imperial on phone, why is laptop still metric?" Q implicitly.

2. **Web Worker for canvas compression — Phase 6 or Phase 6.x?**
   - What we know: Main-thread compress with yield-between handles 50 photos in ~7.5s; modal stays responsive due to yield. WebSocket compress in a worker reduces wall time by ~20% and removes any jank entirely.
   - What's unclear: Whether UAT will surface the jank as observable on real mid-tier devices.
   - Recommendation: SHIP main-thread + yield. Defer Worker. Phase 6 plan creates a TODO marker in `photo-compress.ts` pointing to the worker variant.

3. **Cross-tab migration mutex — Phase 6 or follow-up?**
   - What we know: Migration is idempotent (Pitfall 1); duplicate runs from parallel tabs are safe but wasteful.
   - What's unclear: Whether two tabs simultaneously open during migration is a real user flow.
   - Recommendation: SHIP without the lock. Add to Phase 6 hand-off note as a known minor; revisit if UAT reveals.

4. **Migration error retry granularity — per-entity or whole-migration only?**
   - What we know: UI-SPEC §1 Open Q #8 captures the question. Default in spec is per-entity inline retry + whole-migration retry only for `migration_state` corruption.
   - What's unclear: Implementation cost of per-entity retry given the queue-driven design.
   - Recommendation: SHIP per-entity retry (small surface — each entity row has a `Retry` text-link). Whole-migration retry handles the corruption-class failure.

5. **Storage object orphan cleanup — Phase 6 or Phase 7?**
   - What we know: D-07 hard-delete via client-side `.remove([path])` after table delete. Crash between row delete and storage delete leaves an orphan.
   - What's unclear: How frequently this happens.
   - Recommendation: Phase 6 only documents the orphan risk in code comments + Phase 7 hand-off; Phase 7 ships the cron GC alongside the account-deletion / data-export RPC.

6. **Tap-to-dismiss on the conflict toast (UI-SPEC Open Q #4).**
   - What we know: Default is "ADD tap-to-dismiss", ~10 LoC change to Toast.tsx.
   - Recommendation: SHIP (~10 LoC; gives the conflict toast a UX-appropriate manual-close affordance).

7. **AvatarMenu sync-status dot (UI-SPEC Open Q #5).**
   - Recommendation: SHIP. ~30 LoC; gives a persistent at-a-glance "is sync working" affordance the dashboard otherwise lacks.

8. **`leanshot_v4_pre_cloud_backup` cleanup trigger (D-03 Claude's discretion).**
   - Recommendation: On next sign-in, in `maybeStartMigration` (Pattern 7). Lazy, idempotent, no background timer. If user never signs in again, the backup persists indefinitely — not a bug; consistent with "user's local data is theirs until they take action."

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite build, vitest, Playwright | ✓ | 22.18.0 `[VERIFIED]` | — |
| npx | Tooling (supabase CLI, ctx7) | ✓ | bundled with npm | — |
| `supabase` CLI | Pushing 11 new SQL migrations + storage bucket | ✓ | 2.98.2 `[VERIFIED via `npx supabase --version`]` | — |
| `@supabase/supabase-js` | Sync engine + Storage client | ✓ | ^2.105.4 (already in package.json) `[VERIFIED]` | — |
| `idb` | IndexedDB Blob queue | ✗ | — | install via `npm install idb@8.0.3` (Wave 0) |
| Vitest 2.x | Unit + RLS integration tests | ✓ | Phase 1 | — |
| Playwright | Multi-context e2e | ✓ | Phase 1 / Phase 5 e2e specs exist | — |
| Supabase project (ytnsipxxmzgaebkqmokp) | Live DB + Storage + Realtime | ✓ | Phase 4 provisioned | — |
| Supabase `service_role` key | Cross-tenant RLS tests, admin user seeding | ✓ | Phase 5 CI secret | — |
| Storage bucket `photos` | Photo blobs | ✗ | — | Wave 0 SQL migration `20260514000010_storage_bucket.sql` creates it |
| GitHub Actions runners | CI test-unit + test-e2e | ✓ | Phase 5 (pallefar/minisite) | — |
| Vercel Preview deploy | Manual UAT | ✓ | Phase 2 / Phase 5 | — |

**Missing dependencies with no fallback:** none. All gaps have install/migration paths in Wave 0.

**Missing dependencies with fallback:** `idb` is the only net-new dependency; install at start of Wave 0.

---

## Sources

### Primary (HIGH confidence)

- Context7 `/supabase/supabase` — fetched 2026-05-12:
  - `createSignedUrl(path, expiresIn)` API contract + behavior (verbatim docs snippet)
  - Storage RLS folder-prefix policy SQL (`(storage.foldername(name))[1] = auth.uid()::text`)
  - Storage `createBucket` options (`file_size_limit`, `allowed_mime_types`, `public`)
  - Realtime channel cap: 100 channels per connection
  - Realtime connection cap: 200 (free tier)
  - Free-tier storage quota: 1 GB
- Phase 5 artifacts (verbatim):
  - `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-RESEARCH.md` §4-§11 (schema template, Realtime patterns, offline queue, Pitfalls)
  - `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-VALIDATION.md` (Nyquist Dimension 8 patterns)
  - `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-03-SUMMARY.md` (sync.ts decisions, .spec.ts naming, test seeding patterns)
  - `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-05-SUMMARY.md` (createNamespacedStorage adapter contract; M4 ordering test must NOT regress)
- Phase 2.1 artifacts (verbatim):
  - `.planning/phases/02.1-spa-lighthouse-perf/02.1-RESEARCH.md` §Function-form manualChunks + bundle-size CI assertion pattern
- `leanshot/src/lib/telemetry-defer.ts` — verbatim shape for `sync-defer.ts`
- `leanshot/src/lib/sync.ts` — Phase 5's `subscribeToTable<T>` generic
- `leanshot/src/types/index.ts` — domain types verified
- `leanshot/src/lib/storage.ts` — STORAGE_VERSION + PersistedState shape

### Secondary (MEDIUM confidence)

- MDN IndexedDB Storage quota documentation — cited in §3 for browser-specific quotas
- Phase 5 hand-off note in `05-03-SUMMARY.md` — Phase 6 forward-compat guidance verbatim

### Tertiary (LOW confidence — flagged)

- LeanShot user-scale projections (100-500 users in first 6 months) — A4 assumption, market-driven
- Web Worker compression breakeven (~5ms creation cost) — A8, browser-runtime variable

---

## Metadata

**Confidence breakdown:**

- Schema design (8 mechanical + supplements + settings + photos): **HIGH** — mechanical extension of Phase 5's verified template, all 9 tables map cleanly except `supplements` (researcher recommendation captured with rationale).
- Supabase Storage architecture (bucket creation, RLS, signed URLs): **HIGH** — Context7-verified from official Supabase docs.
- IndexedDB library + schema: **HIGH** — `idb` is the de-facto wrapper, single-store schema is simple.
- Migration test matrix: **HIGH** — derived from Phase 5 PITFALLS.md Pitfall #4 + UI-SPEC scenarios; 12 scenarios enumerated with test types.
- Realtime channel topology: **HIGH** — Supabase docs explicitly verify 100/conn cap (well above 9).
- Pitfalls (Phase 6-specific): **HIGH** on the ones derived from Phase 5; **MEDIUM** on the IDB quota edge-case (browser-variable).
- 06-01 CI hardening (sync-defer.ts shape): **HIGH** — Phase 2.1's telemetry-defer.ts is the proven precedent.
- Validation Architecture: **HIGH** — Phase 5's VALIDATION.md is the template.

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 (30 days; Supabase Storage / Realtime APIs are stable; Phase 5 patterns are mature; the only volatility is `idb` minor releases — pinned to 8.0.3).

---

*Phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos*
*Researched 2026-05-12 via /gsd-research-phase 6 (sonnet model)*
*Inherits implementation patterns from: 05-RESEARCH.md (Phase 5), 02.1-RESEARCH.md (telemetry-defer.ts shape)*
*Honors all 14 LOCKED decisions in 06-CONTEXT.md (D-01..D-14)*
