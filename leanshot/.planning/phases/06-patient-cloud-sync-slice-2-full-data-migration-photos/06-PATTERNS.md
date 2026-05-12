# Phase 6: Patient Cloud Sync Slice 2 — Full Data + Migration + Photos — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 25 (16 new + 9 modified)
**Analogs found:** 23 / 25 (2 partial — IndexedDB layer + 8-of-9 SQL migrations parameterized from 1 template)

> **Inheritance rule:** Every Phase 6 file MUST copy, not reinvent, the Phase 5 analogs below. Phase 5 shipped 47 passing tests against these patterns (16 store, 16 storage, RLS, sync, namespacing) — Phase 6 regresses zero of them.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `leanshot/src/lib/sync-defer.ts` | utility (deferred-init wrapper) | event-driven (idle-scheduled) | `leanshot/src/lib/telemetry-defer.ts` | **exact** |
| `leanshot/src/lib/migration.ts` | service (state-machine) | batch (per-entity drain) | `leanshot/src/lib/auth-migration.ts` + `migrateV6ToV7` in `storage.ts` | role-match (composed) |
| `leanshot/src/lib/photo-queue.ts` | service (IndexedDB adapter) | streaming (Blob get/put/delete) | `leanshot/src/lib/storage.ts` `createNamespacedStorage` adapter shape | partial (storage adapter style, different substrate) |
| `leanshot/src/lib/photo-compress.ts` | utility (pure transform) | transform (in→out Blob) | `leanshot/src/lib/share-card/renderer.ts` canvas helpers | partial |
| `leanshot/src/lib/signed-url-cache.ts` | utility (in-memory Map + TTL) | request-response | `leanshot/src/lib/sync.ts` module-level singleton pattern | role-match |
| `leanshot/src/lib/migration.test.ts` | test | unit | `leanshot/src/lib/auth-migration.test.ts` | **exact** |
| `leanshot/src/lib/photo-queue.test.ts` | test | unit | `leanshot/src/lib/storage.test.ts` `describe('Plan 05-05 — per-user storage adapter')` | role-match |
| `leanshot/src/lib/sync-defer.test.ts` | test | unit | `leanshot/src/lib/sentry.test.ts` (deferred-init test shape) | role-match |
| `leanshot/e2e/rls-multi-table.test.ts` | test (RLS integration) | request-response (Supabase) | `leanshot/e2e/rls-injections.test.ts` parameterized over 9 tables | **exact** (parameterize) |
| `leanshot/e2e/migrate-resume.spec.ts` | test (Playwright e2e) | event-driven | `leanshot/e2e/auth-signup-verify-signin.spec.ts` + `offline-log-then-sync.spec.ts` (seed-then-reload pattern) | **exact** |
| `leanshot/e2e/photo-cross-device.spec.ts` | test (Playwright e2e) | event-driven (Realtime + Storage) | `leanshot/e2e/cross-device-sync.spec.ts` two-context Realtime template | **exact** |
| `leanshot/src/components/sync/MigrationModal.tsx` | component | event-driven (progress) | `leanshot/src/components/auth/PostSignupSent.tsx` (blocking-card pattern) + existing `Modal` primitive | role-match |
| `leanshot/src/components/sync/MigrationEntityRow.tsx` | component | request-response | `leanshot/src/components/auth/EmailVerificationBanner.tsx` (icon + text + CTA row anatomy) | partial |
| `supabase/migrations/20260514000000_weights.sql` .. `..00007_vials.sql` (8 files) | config (SQL DDL) | CRUD | `supabase/migrations/20260513000000_injections.sql` | **exact** (template) |
| `supabase/migrations/20260514000008_settings.sql` | config (SQL DDL) | CRUD (singleton variant) | `supabase/migrations/20260513000000_injections.sql` (PK shape adjusted) | role-match |
| `supabase/migrations/20260514000009_photos.sql` | config (SQL DDL + bucket + Storage RLS) | CRUD + file-I/O | `supabase/migrations/20260513000000_injections.sql` + Supabase Storage RLS pattern | partial |
| `leanshot/src/App.tsx` (MODIFIED) | controller (view router + auth listener) | event-driven | self (existing eager imports → defer through `sync-defer.ts`) | exact (strip eager imports) |
| `leanshot/src/lib/store.ts` (MODIFIED) | model (Zustand store) | CRUD | self (existing `addInjection`/`enqueueOp` patterns extended for 8 new entities + migration_state slice) | exact (extend) |
| `leanshot/src/lib/storage.ts` (MODIFIED) | model (persist + migrate) | CRUD | self (existing `partialize` allow-list extended; `migrateV6ToV7` precedent for `migrateV7ToV8`) | exact (extend) |
| `leanshot/src/lib/sync.ts` (MODIFIED) | service (sync engine) | event-driven (Realtime) + CRUD | self (existing `subscribeInjections`/`flushSyncQueue` instantiated 9× via `subscribeToTable<T>`) | exact (extend) |
| `leanshot/src/components/ui/Toast.tsx` (MODIFIED) | component (UI primitive) | request-response | self (add optional `durationMs?: number` per UI-SPEC §2) | exact (1-line ext) |
| `leanshot/src/components/ui/Skeleton.tsx` (MODIFIED) | component (UI primitive) | request-response | self (add `@media (prefers-reduced-motion: reduce)` rule per UI-CHECK N5) | exact (CSS fix) |
| `leanshot/src/components/dashboard/charts/MedLevelChart.tsx:13` (MODIFIED) | component (chart) | request-response | self (replace `useStore((s) => s.user!)` with nullable selector + early-return per D-12 #3) | exact (1-line null-guard) |
| `leanshot/src/components/dashboard/tabs/BodyTab.tsx` (MODIFIED) | component (tab) | request-response | self (existing photo-grid `<img src={p.data}>` swap → signed-URL + queued badge per UI-SPEC §3) | exact (extend grid render) |

---

## Pattern Assignments

### `src/lib/sync-defer.ts` (utility, event-driven)

**Analog:** `src/lib/telemetry-defer.ts` (Phase 2.1 D-12 perf fix)

This is the single most load-bearing pattern in Plan 06-01. **Copy the shape verbatim**, swap the buffered-event semantics for "buffered subscribe/flush/migrate calls."

**Imports pattern** (lines 19–20):
```typescript
import type { beforeSend as BeforeSendFn } from './sentry';
```
Use **type-only imports** for the heavy modules — this keeps `sync-defer.ts` itself out of the eager graph that pulls in `@supabase/supabase-js`.

**Pre-init buffer + listener-install pattern** (lines 22–45):
```typescript
interface BufferedError { kind: 'error' | 'unhandledrejection'; payload: ...; timestamp: number; }
const buffer: BufferedError[] = [];
let onErrorListener: ((e: ErrorEvent) => void) | null = null;

function installPreInitListeners(): void {
  onErrorListener = (e) => buffer.push({ kind: 'error', payload: e, timestamp: Date.now() });
  window.addEventListener('error', onErrorListener);
}
```
Phase 6 mirror: maintain a `pendingSyncCalls: Array<() => Promise<void>>` queue that buffers `subscribeInjections`, `subscribeToTable`, `pullInitialInjections`, `flushSyncQueue`, `runMigrationIfNeeded` calls until `loaded()` drains them.

**Idle-scheduled dynamic import** (lines 56–93):
```typescript
export function deferSentryInit(beforeSend: typeof BeforeSendFn): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  installPreInitListeners();
  const initFn = (): void => {
    void import('@sentry/react').then(({ init, captureException }) => {
      init({ dsn, environment: import.meta.env.MODE, integrations: [], beforeSend });
      // Drain pre-init buffer
      for (const item of buffer) { /* ... */ }
      buffer.length = 0;
      uninstallPreInitListeners();
    });
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initFn, { timeout: 2000 });
  } else {
    setTimeout(initFn, 100);  // Safari/Firefox fallback
  }
}
```
Phase 6 `deferSyncInit()` MUST dynamic-import `@/lib/sync` + `@/lib/auth-migration` (which transitively pulls `@supabase/supabase-js`) inside `initFn`. Phase 6 RESEARCH §"Pattern 6" lines 552–624 spells out the full Phase 6 shape but the rhythm is identical.

**Risk if pattern not followed:** Bundle-size CI guard fails (`dist/index-*.js gzip > 50 kB`). D-12 is a blocking prerequisite for the rest of Phase 6 — `depends_on: ['06-01']` on every other plan. If this file ships the wrong shape, **the entire phase blocks at CI**.

---

### `src/lib/migration.ts` (service, batch)

**Analog:** `src/lib/auth-migration.ts` + `src/lib/storage.ts:204` (`migrateV6ToV7`)

**Imports pattern** (from `auth-migration.ts` lines 18–19):
```typescript
import { useStore } from '@/lib/store';
```
Same single-import minimalism. Avoid dragging supabase into this module — it talks to the store, the store enqueues into `pendingOps`, and `sync.ts` (loaded via `sync-defer.ts`) does the cloud writes.

**Module-level state flag + reset hook** (lines 20–30):
```typescript
let lastWasAnon = false;
export function setLastWasAnon(value: boolean): void { lastWasAnon = value; }
export function _resetLastWasAnonForTests(): void { lastWasAnon = false; }
```
Phase 6 mirror: `let migrationInFlight = false` + `_resetMigrationInFlightForTests()` so the migration runner is idempotent and re-entry-safe (matches D-02 "Migration is idempotent and resumable").

**Bulk-enqueue across entities** (lines 57–68):
```typescript
export function enqueueLocalInjectionsForSync(): void {
  const state = useStore.getState();
  const now = new Date().toISOString();
  for (const inj of state.injections) {
    state.enqueueOp({ table: 'injections', op: 'upsert', key: inj.log_id, enqueuedAt: now });
  }
}
```
Phase 6 extends this into `enqueueLocalDataForSync()` — loops over all 9 new entities (weights, meals, workouts, supplements, mood, sleep, symptoms, vials, settings) PLUS photos (which enqueue with `op: 'upload'` + `blob_ref` per D-08). The `enqueueOp` dedupe-by-`(table, op, key)` invariant from Phase 5 must be preserved.

**Backup-snapshot-before-migration pattern** (analog: `migrateFromV3` in `storage.ts` lines 101–136):
```typescript
try {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  const v3 = JSON.parse(raw) as Record<string, unknown>;
  /* defensive merge with ?? defaults */
  localStorage.removeItem(LEGACY_KEY);  // only after successful merge
} catch (e) {
  console.error('[leanshot] v3 migration failed', e);
  return null;
}
```
Phase 6 D-03 backup snapshot: BEFORE the first cloud write, `localStorage.setItem('leanshot_v4_pre_cloud_backup', JSON.stringify({ state, version: 7, snapshotAt: ISO }))`. Defensive try/catch wrapping matches Phase 5's posture (private-mode browsers are silent no-ops).

**Risk if pattern not followed:** D-02 "idempotent and resumable" breaks — a re-mount during migration could double-enqueue or double-snapshot the backup. The `enqueueOp` dedupe + module-level `migrationInFlight` flag are mandatory.

---

### `src/lib/photo-queue.ts` (service, IndexedDB adapter)

**Analog (partial):** `createNamespacedStorage` in `src/lib/storage.ts:277-290`

No direct analog; this is the **only** net-new substrate in Phase 6. The closest shape is the `StateStorage` adapter contract from Phase 5 — get/set/delete on string keys, wrapped try/catch, silent no-op on quota/private-mode.

**Adapter-style contract to mirror** (from `storage.ts:277`):
```typescript
export function createNamespacedStorage(): {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}
```
Phase 6 photo-queue equivalent (per RESEARCH §"Pattern 3" lines 376+):
```typescript
export const photoQueue = {
  put: (key: string, blob: Blob): Promise<void>,
  get: (key: string): Promise<Blob | null>,
  delete: (key: string): Promise<void>,
  keys: (): Promise<string[]>,
};
```
**Wrap every operation in try/catch** (matching `setActiveStorageUserId` defensiveness `storage.ts:189`):
```typescript
try { localStorage.setItem(target, universalRaw); } catch { /* private-mode noop */ }
```

**Library choice:** Use `idb` (~1 kB) per RESEARCH §"Net-new dependency". DO NOT hand-roll the raw IndexedDB API — too much error-prone boilerplate.

**Risk if pattern not followed:** Photos lost on private-mode browsers, or worse, an unhandled IDBError bubbles to React's default boundary and kills the whole app. The Phase 5 silent-failure pattern is non-negotiable.

---

### `src/lib/sync.ts` (MODIFIED — service, event-driven + CRUD)

**Analog:** self (Phase 5 patterns mechanically extended)

**The forward-compat generic ALREADY EXISTS** (`sync.ts:268-286`):
```typescript
export function subscribeToTable<T extends Record<string, unknown> = Record<string, unknown>>(
  tableName: string,
  userId: string,
  onPayload: (p: RealtimePostgresChangesPayload<T>) => void,
): RealtimeChannel {
  return supabase
    .channel(`${tableName}:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: tableName, filter: `user_id=eq.${userId}` }, onPayload)
    .subscribe();
}
```
Phase 6 instantiates this 8× (one per new table) — one channel per table per D-14. The channel filter MUST be the string-form `user_id=eq.${userId}` (Pitfall #10 from Phase 5 RESEARCH; the object form silently sends-all-rows).

**The flushSyncQueue extension** (lines 173–246) demands the same shape per new entity:
```typescript
const injectionOps = (state.pendingOps ?? []).filter((op) => op.table === 'injections');
if (upsertKeys.length > 0) {
  const rows = matching.map((r) => ({
    user_id: uid,
    log_id: r.log_id,
    // INTENTIONALLY OMITTING updated_at — server moddatetime trigger sets per D-08.
  }));
  const { error } = await supabase.from('injections').upsert(rows, { onConflict: 'user_id,log_id' });
  if (error) {
    if (isPermanent4xx(error)) { state.dropOps(upsertKeys); }
    else { console.warn('transient'); /* leave queue intact */ }
  } else {
    state.dropOps(rows.map((r) => r.log_id));
  }
}
```
Phase 6 mirror: extract a generic helper `flushTableOps<TLocal>(tableName, primaryKeyField, mapLocalToServer)` so the 8 new tables share one implementation. The 4xx vs 5xx/429 split (`isPermanent4xx` lines 248–255) is the canonical error-classification policy — copy verbatim.

**Server-row mapping pattern** (lines 42–68):
```typescript
interface ServerInjection { user_id; log_id; medication; dose; unit; ...; updated_at: string; }
function mapServerToLocal(row: ServerInjection): Injection {
  return {
    log_id: row.log_id,
    datetime: row.logged_at,  // server `logged_at` <-> local `datetime`
    pkEngineVersion: row.pk_engine_version ?? 1,  // snake_case → camelCase
    updated_at: row.updated_at,
    user_id: row.user_id,
  };
}
```
Every new table needs its own `ServerX` interface + `mapServerXToLocal` function. Keep the mapping point in exactly one place per table.

**Photo upload op** (new in Phase 6 per D-08/D-09): adds a third op type `'upload'` whose handler reads the Blob from `photoQueue.get(blob_ref)`, calls `supabase.storage.from('photos').upload(path, blob)`, then on success dequeues + back-stamps the local `Photo.storage_path`. **Serial drain (D-09)** — process one upload at a time, not in parallel.

**Risk if pattern not followed:** (a) Forgetting `updated_at` omission breaks LWW — client clocks lose to the trigger silently and conflicts appear non-deterministically; (b) wrong filter syntax leaks other users' rows over Realtime; (c) parallel photo uploads hit Supabase Storage rate limits during migration of 50+ photos.

---

### `supabase/migrations/2026051400000X_{table}.sql` × 8 mechanical tables (config, CRUD)

**Analog:** `supabase/migrations/20260513000000_injections.sql` (Phase 5)

Copy the entire file 8 times, parameterize 4 substitutions: table name, entity_id column name, domain field block, listing-index column.

**Composite PK + FK + moddatetime trigger** (lines 30–58):
```sql
create extension if not exists moddatetime schema extensions;

create table public.injections (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_id uuid not null,
  primary key (user_id, log_id),

  -- Domain fields mirror src/types/index.ts `Injection` interface.
  medication text not null,
  dose text not null,
  unit text not null check (unit in ('mg', 'units', 'ml')),
  -- ... domain block ...

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index injections_user_logged_at_idx
  on public.injections (user_id, logged_at desc);

create trigger injections_set_updated_at
  before update on public.injections
  for each row
  execute function extensions.moddatetime(updated_at);
```

**Default-deny RLS + 4 policies** (lines 60–82):
```sql
alter table public.injections enable row level security;

create policy "injections_select_own" on public.injections for select using (auth.uid() = user_id);
create policy "injections_insert_own" on public.injections for insert with check (auth.uid() = user_id);
create policy "injections_update_own" on public.injections for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "injections_delete_own" on public.injections for delete using (auth.uid() = user_id);
```

**Idempotent Realtime publication membership** (lines 87–98):
```sql
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'injections'
  ) then
    execute 'alter publication supabase_realtime add table public.injections';
  end if;
end$$;
```
**MUST be the `do $$` block** — `alter publication ... add table` errors if the table is already a member, which breaks `supabase db push` retry.

**Risk if pattern not followed:** (a) Skipping moddatetime → LWW broken silently; (b) skipping RLS → cross-tenant data leak (the `rls-multi-table.test.ts` parameterized RLS test will fail); (c) skipping `do $$` idempotency → CI db-push retries fail.

---

### `supabase/migrations/...settings.sql` (config, CRUD singleton)

**Analog:** `injections.sql` with PK = `user_id` alone (no entity_id), no listing index.

**Asymmetry note from D-13:** `settings` is a per-user singleton. PK shape becomes:
```sql
create table public.settings (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  -- ... settings fields ...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- NO listing index — there's only one row per user.
-- moddatetime trigger + 4 RLS policies + Realtime membership UNCHANGED.
```
Realtime SELECT/UPDATE only in normal flow (no INSERT/DELETE during account lifetime), but ship all 4 RLS policies anyway for defense-in-depth + future-proofing (account-deletion flow does DELETE).

---

### `supabase/migrations/...photos.sql` (config, CRUD + file-I/O bucket)

**Analog:** `injections.sql` for table portion + Supabase Storage RLS pattern (NEW; researcher §2.1 lines 998–1061 spells out the bucket SQL).

**Bucket creation + RLS for Storage objects** (must accompany the table):
```sql
-- Bucket creation (planner: copy researcher §2.1 verbatim)
insert into storage.buckets (id, name, public) values ('photos', 'photos', false);

-- Storage RLS: enforce `auth.uid()::text = (storage.foldername(name))[1]` per D-04
create policy "photos_select_own" on storage.objects for select
  using (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]);
-- + insert, update, delete with the same predicate.
```
The path convention `{userId}/photos/{photoId}.jpg` (D-04) is what makes `storage.foldername(name)[1]` work. **Storage RLS is separate from table RLS** — both must ship in this migration.

---

### `e2e/rls-multi-table.test.ts` (test, RLS integration)

**Analog:** `e2e/rls-injections.test.ts` parameterized over 9 tables.

**Skip-gate pattern** (lines 25–31):
```typescript
const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;
```
Copy exactly. Skip-gates prevent CI fork-PRs from failing for lack of service-role key.

**Two-user seed → JWT-scoped client → RLS-bound select pattern** (lines 59–166):
```typescript
const { data: aRes, error: aErr } = await adminClient.auth.admin.createUser({
  email: emailA, password: passwordA, email_confirm: true,
});
const userAClient = createClient(URL!, ANON!, {
  auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-inj-a' },
});
await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });

// 3. Seed: user A inserts ONE row via own JWT (proves INSERT RLS allows own-row).
const { error: insErr } = await userAClient.from('injections').insert({ user_id: userA.id, /* ... */ });

// 4. Admin (service role) confirms row exists.
const { data: adminData } = await adminClient.from('injections').select('*').eq('log_id', seedLogId);
expect(adminData).toHaveLength(1);

// 5. User A reads OWN — count = 1.
const { data: aData } = await userAClient.from('injections').select('*');
expect(aData).toHaveLength(1);

// 6. THE PROOF: user B reads ZERO — RLS returns empty set (NOT 403).
const { data: bData } = await userBClient.from('injections').select('*');
expect(bData).toEqual([]);

// 7. NEGATIVE: user B impersonation attempt → RLS WITH CHECK rejects.
const { error: impErr } = await userBClient.from('injections').insert({ user_id: userA.id, /* ... */ });
expect(impErr?.code === '42501' || /violates row-level security/i.test(impErr?.message ?? '')).toBe(true);
```
Phase 6 mirror: wrap in `it.each(['weights', 'meals', 'workouts', 'supplements', 'mood', 'sleep', 'symptoms', 'vials', 'settings'])` with table-specific seed payloads. Same 7-step skeleton for each.

**Cleanup with cascade** (lines 48–57):
```typescript
afterAll(async () => {
  if (!admin) return;
  for (const id of createdUserIds) {
    try { await admin.auth.admin.deleteUser(id); } catch { /* cascade handles rows */ }
  }
});
```
`on delete cascade` from the table FK (mirrored in every Phase 6 migration) means deleting the user cleans up all 9 tables' rows automatically.

**Risk if pattern not followed:** Missing cleanup → Supabase test instance accumulates orphan test users over many CI runs. Missing the negative impersonation test → a critical RLS misconfiguration (WITH CHECK on UPDATE missing) ships undetected.

---

### `e2e/photo-cross-device.spec.ts` (test, Playwright e2e)

**Analog:** `e2e/cross-device-sync.spec.ts` (Phase 5)

**Two-context seed + sign-in pattern** (lines 48–98):
```typescript
async function seedUserAndSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/#/auth/signin');
  await page.evaluate(({ user, key }) => {
    const blob = {
      state: { user, injections: [], /* all entity arrays */, pendingOps: [], acknowledgedDisclaimer: 'v1' },
      version: 7,
    };
    localStorage.setItem(key, JSON.stringify(blob));
  }, { user: SEED_USER, key: 'leanshot_v4' });
  await page.reload();
  // sign in flow ...
  await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 8000 });
}
```
Phase 6 photo test: seed BOTH contexts (B first so it's subscribed before A uploads), then upload a photo in context A and expect the photo to appear in context B's `BodyTab` photo grid within the 5s budget. Bump `version: 7` → `version: 8` if Phase 6 storage migration ships.

**Two-context Realtime assertion** (lines 138–172):
```typescript
test('injection logged on context A propagates to context B within 5s', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  // Seed B FIRST so it's already subscribed when A logs.
  await seedUserAndSignIn(pageB, email, password);
  await seedUserAndSignIn(pageA, email, password);

  const tStart = Date.now();
  await pageA.getByTestId('injection-submit').click();

  // Context A: local-first invariant — visible immediately.
  await expect(pageA.getByTestId('injection-list').locator(`text=${uniqueDose}`)).toBeVisible({ timeout: 1500 });

  // Context B: Realtime push — visible within 5s.
  await expect(pageB.getByTestId('injection-list').locator(`text=${uniqueDose}`)).toBeVisible({ timeout: 5000 });
});
```
Photo equivalent: context A uploads photo → context A's local Blob preview visible immediately → context B sees the new tile (via Realtime `photos` table INSERT + signed-URL fetch) within 5s. Local-first invariant first, Realtime ceiling second.

---

### `e2e/migrate-resume.spec.ts` (test, Playwright e2e)

**Analog:** `e2e/auth-signup-verify-signin.spec.ts` (verify-link flow) + the seed-then-reload helper from `cross-device-sync.spec.ts`

**Two-test pattern** (lines 36–76 + 78+):
```typescript
test('signs up, verifies via admin-generated link, sets password, lands on dashboard', async ({ page }) => {
  // ... full happy path ...
});

test('session persists across browser reload (AUTH-03)', async ({ page }) => {
  // Bootstrap a verified session via admin, reload, assert still signed in.
});
```
Phase 6 resume test:
1. Seed `leanshot_v4` with a 50-injection / 12-photo / 3-vial snapshot + `migration_state: { injections: 'complete', weights: 'in-progress', ... }`.
2. Sign in → expect MigrationModal title = "Resuming migration".
3. Reload mid-migration (simulate crash) → expect modal re-opens with same progress.
4. Allow drain → expect title swaps to "All done" → expect dashboard visible.

**Admin-API user creation pattern** (auth spec lines 28–34):
```typescript
test.afterAll(async () => {
  if (!userId || !SERVICE_ROLE || !SUPABASE_URL) return;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  await admin.auth.admin.deleteUser(userId).catch(() => {});
});
```
Always wire `afterAll` cleanup with admin client — Phase 5 precedent.

---

### `src/components/sync/MigrationModal.tsx` (component, event-driven)

**Analog:** `src/components/auth/PostSignupSent.tsx` (centered-card blocking pattern) + existing `Modal` primitive

**Imports + composition pattern** (PostSignupSent.tsx lines 9–13):
```typescript
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { getUser, resendVerification } from '@/lib/auth';
```
Phase 6 modal: similar imports + `useStore` for `migration_state` slice + lazy-load gating (dynamic import via `sync-defer.ts` per UI-SPEC §1 "Bundle-size note").

**Layout idiom** (PostSignupSent.tsx lines 41–66):
```typescript
return (
  <div className="flex flex-col gap-5 text-center py-8">
    <Mail className="size-12 mx-auto text-[var(--color-primary)]" aria-hidden />
    <header>
      <h1 className="text-[26px] font-bold tracking-tight">Check your email</h1>
      <p className="text-[14px] text-[var(--color-text-secondary)] mt-2">...</p>
    </header>
    <Button onClick={onResend} loading={resending} variant="secondary" block>
      Resend email
    </Button>
  </div>
);
```
Phase 6 MigrationModal completion-state body mirrors this exactly: success icon + h1 ("All done") + body copy + primary CTA. The in-progress body is a `<ol role="list">` of `MigrationEntityRow` per UI-SPEC §1.

**Modal primitive usage:** Wrap body in `<Modal dismissible={false} hideClose title="..." size="md">` per UI-SPEC §1. Z-index `z-[100]` is the default (no GuidedTour collision per UI-SPEC line 43).

**aria-live announcer** (UI-SPEC §1 line 334):
> "DO NOT announce every count tick (deafening for 200-meal users); instead fire announcements only on state TRANSITIONS (pending→in-progress, in-progress→complete, *→error)."

Implementation: a hidden `<span role="status">` whose text only changes on transition events, not count updates.

---

### `src/components/sync/MigrationEntityRow.tsx` (component, request-response)

**Analog (partial):** `src/components/auth/EmailVerificationBanner.tsx` (icon + text + CTA row anatomy)

**Two-column flex pattern** (EmailVerificationBanner.tsx lines 50–73):
```typescript
<div
  role="region"
  aria-label="Email verification reminder"
  className="mb-5 rounded-xl border border-[var(--color-warning,#a36a00)] bg-[var(--color-warning-soft,...)] p-3.5 flex items-start gap-3"
>
  <AlertCircle className="size-5 shrink-0 mt-0.5 text-[var(--color-warning,#a36a00)]" aria-hidden />
  <div className="min-w-0 flex-1">
    <p className="text-[14px] font-semibold leading-snug">Verify your email to sync across devices</p>
    <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 leading-snug">...</p>
    <div className="flex gap-2 mt-2.5">
      <Button size="sm" variant="secondary" onClick={onResend} loading={resending}>Resend</Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>Dismiss for today</Button>
    </div>
  </div>
</div>
```
Phase 6 entity row layout: `<li className="flex items-start gap-3 py-2.5">` + state icon + flex-1 column with name/count + optional inline ProgressBar (in-progress only) per UI-SPEC §1 entity-row anatomy. **CSS variables only — no Tailwind palette keys** per CLAUDE.md.

---

### `src/lib/store.ts` (MODIFIED — model, CRUD)

**Pattern preservation:** Phase 5's `enqueueOp` dedupe-by-`(table, op, key)` is the canonical extension point. Phase 6 extends `Actions` interface (lines 66+) with `addWeight`/`editWeight`/`removeWeight` etc. for all 8 new entities AND a new `migration_state` slice.

**Actions naming convention** (store.ts lines 66–125):
```typescript
addInjection: (inj: Injection) => void;
editInjection: (logId: string, updates: Partial<Omit<Injection, 'log_id' | 'user_id'>>) => void;
removeInjection: (idx: number) => void;
```
Phase 6 mirror: `addWeight`/`editWeight`/`removeWeight` (composite-PK entities) follow the `editInjection` shape — by stable client-generated key, not by array index. The legacy `removeWeight(idx: number)` semantics from pre-Phase-5 era should be preserved for back-compat but new edits go through the keyed variant.

**Persist allow-list extension** (store.ts:598-620):
```typescript
partialize: (state) => ({
  user: state.user,
  injections: state.injections,
  // ... existing keys ...
  pendingOps: state.pendingOps,
  verificationBannerDismissedUntil: state.verificationBannerDismissedUntil,
}),
```
Phase 6 adds `migration_state: state.migration_state` to the allow-list (per D-02 "persisted across reload"). **Do NOT regress** any existing key — the partialize allow-list is append-only.

**Risk if pattern not followed:** A regressed allow-list breaks Phase 5's M4 "ordering contract test" (per 05-05-SUMMARY canonical ref) → 16 storage tests fail → CI red.

---

### `src/lib/storage.ts` (MODIFIED — model, CRUD)

**Pattern preservation:** `STORAGE_VERSION` bump 7 → 8 (if any persisted shape changes) + new `migrateV7ToV8` function with the same defensive shape as `migrateV6ToV7` (lines 204–217):

```typescript
export function migrateV6ToV7(state: PersistedState): PersistedState {
  const stamped = (state.injections ?? []).map((row) =>
    typeof (row as { log_id?: unknown }).log_id === 'string'
      ? row
      : { ...row, log_id: crypto.randomUUID() },
  );
  return {
    ...state,
    injections: stamped,
    pendingOps: Array.isArray((state as { pendingOps?: unknown }).pendingOps)
      ? (state as { pendingOps: PendingOp[] }).pendingOps
      : [],
  };
}
```
Same defensive `?? []` / `?? defaults` posture (storage.ts:107-127 in migrateFromV3). Same idempotent re-run posture (running the migration on already-migrated state is a no-op).

**Do NOT touch `createNamespacedStorage`** — the M4 ordering contract test (Phase 5 05-05-SUMMARY) gates the entire phase. Per CONTEXT canonical_refs: "Phase 6 must NOT regress this."

---

### `src/components/ui/Toast.tsx` (MODIFIED — UI primitive)

**Analog:** self — single-line extension per UI-SPEC §2.

**Current shape** (lines 11–15):
```typescript
useEffect(() => {
  if (!toast) return;
  const t = setTimeout(dismiss, 2400);
  return () => clearTimeout(t);
}, [toast, dismiss]);
```

**Phase 6 extension** (per UI-SPEC §2 / N4):
```typescript
const t = setTimeout(dismiss, toast.durationMs ?? 2400);
```
+ extend `toast` state shape in `store.ts:57`:
```typescript
toast: { message: string; kind: 'success' | 'error' | 'info'; id: number; durationMs?: number } | null;
```
Default unchanged; conflict toast passes `durationMs: 5000`.

**Optional Phase 6 extension (UI-SPEC §2 Open Question #4):** tap-to-dismiss — wrap the pill in `<button onClick={dismiss}>` with `cursor-pointer`. ~10 LoC.

---

### `src/components/ui/Skeleton.tsx` (MODIFIED — UI primitive)

**Analog:** self — add reduced-motion CSS rule per UI-CHECK N5.

**Current shape** (lines 18–25 — animation runs unconditionally):
```typescript
style={{
  background: 'linear-gradient(90deg, var(--color-skeleton) 0%, color-mix(...) 50%, var(--color-skeleton) 100%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.6s linear infinite',
}}
```

**Phase 6 fix (per UI-SPEC §3 reduced-motion section):** add a CSS rule in `index.css`:
```css
@media (prefers-reduced-motion: reduce) {
  .skeleton-shimmer { animation: none; }
}
```
+ add `className="skeleton-shimmer"` to the Skeleton root. OR: use JS branch via `useReducedMotion()` hook (existing — `src/hooks/useReducedMotion.ts`). CSS is preferred per CLAUDE.md "CSS-level reduced-motion is also enforced via `index.css`."

---

### `src/components/dashboard/tabs/BodyTab.tsx` (MODIFIED — component)

**Analog:** self — replace direct `<img src={p.data}>` at line 266 with signed-URL hook + queued badge per UI-SPEC §3.

**Current shape** (lines 259–286):
```tsx
<div className="grid grid-cols-3 gap-2 mt-3">
  {photos.map((p, i) => (
    <SwipeToDelete key={i} onDelete={() => removePhoto(i)} className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[var(--color-surface-elevated)] border border-[var(--color-border)] group">
      <img src={p.data} alt="" className="w-full h-full object-cover absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 ...">...</div>
    </SwipeToDelete>
  ))}
</div>
```

**Phase 6 extension:**
- `<img src={p.data}>` → `<PhotoTile photo={p} />` where PhotoTile resolves state matrix (loaded / loading-signed-url / signed-url-failed / queued-for-upload) per UI-SPEC §3 state table.
- Empty state copy at lines 251–257 **UNCHANGED** per D-10 + UI-SPEC §5.
- Add absolute-positioned `<Badge>` for queued-for-upload state per UI-SPEC §3 anatomy diagram.

**aria-busy on tile during signed-URL fetch** (UI-SPEC §3 a11y):
```tsx
<div role="img" aria-busy={state === 'loading-signed-url'}>
  {state === 'loading-signed-url' && <Skeleton shape="rect" className="absolute inset-0" />}
  {state === 'loaded' && <img src={signedUrl} alt="" />}
  {state === 'queued-for-upload' && <Badge tone="warning">Queued</Badge>}
</div>
```

---

### `src/components/dashboard/charts/MedLevelChart.tsx:13` (MODIFIED — 1-line null-guard)

**Per D-12 #3:** Replace `useStore((s) => s.user!)` with nullable selector + early-return.

**Current shape** (line 13):
```typescript
const u = useStore((s) => s.user!);
```

**Phase 6 fix:**
```typescript
const u = useStore((s) => s.user);
if (!u) return null;  // or a placeholder/skeleton
```
**Single-file change**, no other chart/component pattern affected. This is the only `s.user!` audit-target folded into Phase 6 per CONTEXT.md "Deferred Ideas — broader audit deferred."

---

### `src/App.tsx` (MODIFIED — strip eager imports per D-12 #2)

**Current shape** (lines 9–26):
```typescript
import { enqueueLocalInjectionsForSync, runAnonPromotionMigrationIfNeeded, setLastWasAnon } from '@/lib/auth-migration';
import { removeUserNamespace, renameStorageNamespace, setActiveStorageUserId } from '@/lib/storage';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { flushSyncQueue, pullInitialInjections, subscribeInjections, unsubscribeInjections } from '@/lib/sync';
```

**Phase 6 D-12 #2 transform:**
- Keep storage imports (lightweight; required pre-paint).
- Move sync/auth-migration/supabase out of static graph → re-export through `@/lib/sync-defer.ts` which buffers calls until idle-load completes.
- `App.tsx` calls `syncDefer.subscribeInjections(uid)` (buffered) instead of `subscribeInjections(uid)` (eager). The deferred wrapper drains the buffer post-idle.

**Pattern source — telemetry-defer.ts main.tsx wire-up:** main.tsx calls `deferSentryInit(beforeSend)` instead of `Sentry.init(...)`. The "main.tsx → telemetry-defer" relationship maps to "App.tsx → sync-defer".

**Risk if pattern not followed:** Bundle-size CI assertion fails → D-12 blocks rest of Phase 6.

---

## Shared Patterns

### Pattern A: Module-level singleton with idempotent install/teardown

**Source:** `src/lib/sync.ts:35` + `:111-146`
**Apply to:** `sync-defer.ts` (init flag), `migration.ts` (in-flight flag), `signed-url-cache.ts` (map singleton), `photo-queue.ts` (db connection singleton).

```typescript
let injectionsChannel: RealtimeChannel | null = null;

export function subscribeInjections(userId: string): void {
  if (injectionsChannel) return;  // idempotent install
  injectionsChannel = supabase.channel(...).subscribe();
}

export async function unsubscribeInjections(): Promise<void> {
  if (!injectionsChannel) return;
  await supabase.removeChannel(injectionsChannel);
  injectionsChannel = null;
}
```
**Why mandatory:** React StrictMode double-mounts in dev. Without idempotent install, every Phase 6 surface produces double-subscribes (9 tables × 2 = 18 channels) on every dev reload.

---

### Pattern B: Defensive try/catch around every storage I/O

**Source:** `src/lib/storage.ts:170-191` + `:653`
**Apply to:** `photo-queue.ts` (every IDB op), `migration.ts` (backup snapshot write), any Phase 6 code touching `localStorage` or IndexedDB.

```typescript
try {
  universalRaw = localStorage.getItem(STORAGE_KEY);
} catch {
  return;  // private-mode browsers
}
// ...
try {
  if (targetRaw === null) localStorage.setItem(target, universalRaw);
  localStorage.removeItem(STORAGE_KEY);
} catch {
  /* private-mode noop */
}
```
**Why mandatory:** CLAUDE.md "Silent localStorage failures. Every `localStorage` read/write is wrapped." Phase 6's IndexedDB usage extends this contract.

---

### Pattern C: Server-authoritative `updated_at` — NEVER passed by client

**Source:** `src/lib/sync.ts:208` + `supabase/migrations/20260513000000_injections.sql:55-58`
**Apply to:** Every new entity's upsert in Phase 6 `flushSyncQueue` extension. All 8 mechanical migrations + `settings.sql` + `photos.sql` MUST ship the moddatetime trigger.

```typescript
// In sync.ts flushSyncQueue:
const rows = matching.map((r) => ({
  user_id: uid,
  log_id: r.log_id,
  dose: r.dose,
  // ... domain fields ...
  // INTENTIONALLY OMITTING updated_at — server moddatetime trigger sets per D-08.
}));
```
```sql
-- In every Phase 6 SQL migration:
create trigger {table}_set_updated_at
  before update on public.{table}
  for each row
  execute function extensions.moddatetime(updated_at);
```
**Why mandatory:** D-08 LWW depends on monotonic server time. Client clocks drift; passing client `updated_at` breaks the toast-on-loser invariant non-deterministically.

---

### Pattern D: Skip-gated live-Supabase tests

**Source:** `e2e/rls-injections.test.ts:25-31` + `e2e/cross-device-sync.spec.ts:17-21`
**Apply to:** `rls-multi-table.test.ts`, `migrate-resume.spec.ts`, `photo-cross-device.spec.ts`.

```typescript
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

test.skip(!HAS_LIVE_AUTH, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
```
**Why mandatory:** Fork-PR CI doesn't get the service-role secret. Skip-gating is what keeps Phase 5's e2e suite green on contributor PRs.

---

### Pattern E: CSS-variable-only colors (no Tailwind palette keys)

**Source:** `src/components/auth/EmailVerificationBanner.tsx:54` (`bg-[var(--color-warning-soft,rgba(...))]`)
**Apply to:** All net-new Phase 6 component styling — MigrationModal, MigrationEntityRow, queued badge in BodyTab, signed-URL-failed tile.

```tsx
className="bg-[var(--color-warning-soft,rgba(255,189,89,0.12))] text-[var(--color-warning,#a36a00)] border border-[var(--color-border)]"
```
**Forbidden:** `bg-amber-200`, `text-yellow-600`, etc. Per CLAUDE.md "Hard-coding colors in components" anti-pattern + UI-SPEC §"Color" line 40: "`bg-amber-200` and similar Tailwind palette keys are forbidden."

---

### Pattern F: `aria-live="polite"` for transitional state announcements

**Source:** `src/components/ui/Toast.tsx:22-23`
**Apply to:** MigrationModal entity-row list (UI-SPEC §1 a11y), signed-URL-failed retry button.

```tsx
<div role="status" aria-live="polite" aria-atomic="false">
  {/* Only update text on state TRANSITIONS, not on count ticks. */}
</div>
```
**Why mandatory:** UI-SPEC §1 explicit: "DO NOT announce every count tick (deafening for 200-meal users)." Phase 6 must implement the transition-only announcer.

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner Guidance |
|------|------|-----------|--------|------------------|
| `src/lib/photo-queue.ts` IndexedDB layer | service | streaming | No IndexedDB usage exists yet in the codebase | Follow RESEARCH §"Pattern 3" lines 376-441 verbatim. Use `idb` library (researcher-vetted, ~1 kB). Adapter shape (Pattern A) + defensive try/catch (Pattern B) still apply. |
| `src/lib/photo-compress.ts` canvas compression | utility | transform | No canvas-image-processing exists yet (share-card renderer is a different use case) | Follow RESEARCH §"Pattern 4" lines 442-494. Web Worker variant per D-06 (Claude's discretion). |

---

## Metadata

**Analog search scope:**
- `leanshot/src/lib/` (Phase 5 sync, storage, auth-migration, telemetry-defer)
- `leanshot/src/components/auth/` (Phase 5 auth UI patterns)
- `leanshot/src/components/ui/` (Toast, Skeleton, Modal primitives)
- `leanshot/src/components/dashboard/tabs/BodyTab.tsx` (existing photo grid)
- `leanshot/e2e/` (Phase 5 RLS + Realtime + Playwright templates)
- `supabase/migrations/` (Phase 5 injections.sql template)

**Files scanned:** ~30 (15 read in full, 15 grep'd or partially read)
**Pattern extraction date:** 2026-05-12

---

*Phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos*
*Mapped by gsd-pattern-mapper (Opus 4.7 1M)*
*Phase 5 patterns inherited 1:1 — zero net-new architectural primitives*
