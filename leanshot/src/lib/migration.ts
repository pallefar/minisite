/**
 * Phase 6 D-01..D-03 + D-10 migration state machine.
 *
 * Lifecycle:
 *   1. maybeStartMigration(userId) — entry point called from sync-defer.ts onSignedIn drain
 *   2. cleanupExpiredBackup() — drops the 90-day-old snapshot if any
 *   3. detect "needs migration" via migration_state slice and/or v4 data presence
 *   4. snapshotPreCloudBackup() — D-03 contract: BEFORE any cloud write
 *   5. runMigration(userId) — per-entity drain in size-descending order
 *   6. On corruption: clear migration_state, set migrationError, surface UI banner
 *
 * Idempotency invariants:
 *   - migrationInFlight module-level guard prevents concurrent runs
 *   - All upserts are PK-keyed → duplicate upserts are no-ops (Phase 5 Pitfall 1)
 *   - Backup snapshot is single-slot — re-running snapshotPreCloudBackup overwrites
 *
 * NOTE: the per-entity upload loops are STUBBED for the 8 mechanical tables —
 * Plan 06-03 wires real `enqueueOp` calls + the SQL tables they upsert into;
 * Plan 06-04 wires the photos base64→Storage path. The `injections` entity
 * already has a working path via Phase 5's `enqueueLocalInjectionsForSync`.
 */
import { useStore } from '@/lib/store';
// Type-only namespace import — sync.ts is loaded via `import('@/lib/sync')`
// inside `runMigration` so it stays off this module's static graph. The type
// reference here lets `migrateEntity` annotate its `sync` parameter without
// re-eagerizing the import (verbatimModuleSyntax erases the type import at
// compile time). Mirrors sync-defer.ts's pattern.
import type * as SyncModule from '@/lib/sync';

const SNAPSHOT_KEY = 'leanshot_v4_pre_cloud_backup';
const LEGACY_KEY = 'leanshot_v4';
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type EntityStatus = 'pending' | 'in-progress' | 'complete' | 'error';

/**
 * D-01 / 06-UI-SPEC §1 row order — size-descending default. ENTITIES.length === 11.
 * `photos` first because base64 dataURL payloads dominate v4 localStorage size
 * (Plan 06-04 will eager-migrate them to Storage). `settings` is per-user
 * singleton; placed last because it's a 1-row write.
 */
export const ENTITIES = [
  'photos',
  'injections',
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
  startedAt: string;
  complete: boolean;
  snapshotKey: string;
};

/**
 * Module-level guard: only one migration loop runs at a time. Mirrors
 * auth-migration.ts's `lastWasAnon` flag. Cleared after `runMigration`
 * resolves (or rejects) in `maybeStartMigration`'s try/finally.
 */
let migrationInFlight = false;

/** Test-only reset hook. Mirrors auth-migration.ts's `_resetLastWasAnonForTests`. */
export function _resetMigrationInFlightForTests(): void {
  migrationInFlight = false;
}

/**
 * D-02 corruption detection rule. Returns `true` iff `state` is non-null but
 * structurally invalid for a MigrationState.
 *
 * `null` is NOT corrupted — it's the "no migration yet" sentinel. Returning
 * `false` for `null` lets `maybeStartMigration` differentiate "needs fresh
 * migration" (null + v4 data exists) from "corrupted, surface retry CTA".
 */
export function isMigrationStateCorrupted(state: unknown): boolean {
  if (state === null || state === undefined) return false;
  if (typeof state !== 'object') return true;
  const s = state as Record<string, unknown>;
  if (typeof s.complete !== 'boolean') return true;
  if (typeof s.startedAt !== 'string') return true;
  if (Number.isNaN(new Date(s.startedAt).getTime())) return true;
  if (typeof s.snapshotKey !== 'string') return true;
  const validStatuses = new Set<EntityStatus>(['pending', 'in-progress', 'complete', 'error']);
  for (const entity of ENTITIES) {
    const v = s[entity];
    if (v !== undefined && !validStatuses.has(v as EntityStatus)) return true;
  }
  return false;
}

/**
 * D-03 retention cleanup. Fires on every `maybeStartMigration` entry so a
 * returning user (≥90 days) gets a fresh snapshot rather than reading stale
 * pre-cloud bytes. No-op when there's no snapshot key or the snapshot is
 * fresh.
 */
export function cleanupExpiredBackup(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SNAPSHOT_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { snapshotAt?: string };
    if (!parsed.snapshotAt) return;
    const age = Date.now() - new Date(parsed.snapshotAt).getTime();
    if (age > RETENTION_MS) {
      try {
        localStorage.removeItem(SNAPSHOT_KEY);
      } catch {
        /* private-mode noop */
      }
    }
  } catch {
    /* corrupt snapshot JSON — leave; subsequent reads will surface the issue */
  }
}

/**
 * D-03 backup contract: snapshot localStorage.getItem('leanshot_v4') verbatim
 * into 'leanshot_v4_pre_cloud_backup' with shape
 * `{ state: <verbatim v4 state>, version: 7, snapshotAt: <ISO> }`.
 *
 * MUST be called BEFORE any cloud write. If `localStorage.setItem` throws
 * (quota / private-mode), this function re-throws so the caller halts the
 * migration — D-03's contract is "no cloud write without a backup".
 *
 * No-op when there's no v4 data to snapshot (net-new install / already-migrated
 * user whose universal key has been cleared by `renameStorageNamespace`).
 */
export function snapshotPreCloudBackup(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return; // private-mode browsers — silent no-op
  }
  if (!raw) return;
  let parsedState: unknown;
  try {
    parsedState = JSON.parse(raw);
  } catch {
    return; // malformed v4 blob — leave; runMigration's defensive reads handle the empty case
  }
  const payload = JSON.stringify({
    state: parsedState,
    version: 7,
    snapshotAt: new Date().toISOString(),
  });
  try {
    localStorage.setItem(SNAPSHOT_KEY, payload);
  } catch (e) {
    console.error('[leanshot] backup snapshot failed', e);
    throw e; // D-03: migration MUST NOT proceed if backup failed
  }
}

function readV4Snapshot(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Returns the inner `state` payload from a v4 blob (i.e. the Zustand persist
 * envelope's `state` key). Defensive against either shape (raw state or
 * `{ state: {...}, version }`).
 */
function readV4InnerState(): Record<string, unknown> | null {
  const blob = readV4Snapshot();
  if (!blob) return null;
  if (typeof blob.state === 'object' && blob.state !== null) {
    return blob.state as Record<string, unknown>;
  }
  return blob;
}

/**
 * v4 data presence check: returns true iff the localStorage 'leanshot_v4' blob
 * exists AND contains at least one populated entity array OR a non-null `user`
 * slice. A net-new install has no v4 key at all → false.
 *
 * Test-controllable so M3 (net-new) can mock-out the localStorage layer.
 */
function v4HasUserData(snapshot: Record<string, unknown> | null): boolean {
  if (!snapshot) return false;
  const inner =
    typeof snapshot.state === 'object' && snapshot.state !== null
      ? (snapshot.state as Record<string, unknown>)
      : snapshot;
  if (inner.user && typeof inner.user === 'object') return true;
  for (const entity of ENTITIES) {
    if (entity === 'settings') continue;
    const v = inner[entity];
    if (Array.isArray(v) && v.length > 0) return true;
    if (entity === 'supplements' && v && typeof v === 'object' && Object.keys(v).length > 0) {
      return true;
    }
  }
  return false;
}

function computeRunOrder(_snapshot: Record<string, unknown>): readonly Entity[] {
  // D-01: size-descending; ENTITIES is already declared in size-descending
  // order so the static order doubles as the runtime order until a future
  // Plan refines it with row-count introspection.
  return ENTITIES;
}

/**
 * Entry point. Called from `sync-defer.ts` `onSignedIn` drain branch after the
 * Phase 5 setActiveStorageUserId / renameStorageNamespace step has finished.
 *
 * Flow:
 *   1. Guard: bail if another migration is in-flight (idempotency).
 *   2. Cleanup expired backup (D-03 retention).
 *   3. Detect corruption — clear slice + surface error banner if so.
 *   4. Already-complete → no-op.
 *   5. Mid-flight resume → re-enter runMigration with existing state.
 *   6. Fresh migration → snapshot + initialise slice + runMigration.
 *
 * Net-new (M3) users hit (6)'s `v4HasUserData === false` branch and return
 * without ever painting the modal.
 */
export async function maybeStartMigration(userId: string): Promise<void> {
  if (migrationInFlight) return;
  // (2) cleanup BEFORE corruption check so a fresh start after corruption
  // still re-runs the retention sweep on the next entry.
  cleanupExpiredBackup();

  const storeState = useStore.getState();
  const existingMigration = storeState.migration_state;

  // (3) corruption — clear + flag, do not proceed.
  if (existingMigration !== null && isMigrationStateCorrupted(existingMigration)) {
    storeState.setMigrationState(null);
    storeState.setMigrationError('corrupted');
    return;
  }

  // (4) already complete.
  if (existingMigration?.complete) return;

  // (5) resume.
  if (existingMigration) {
    migrationInFlight = true;
    try {
      // Capture snapshot BEFORE runMigration in case the persist middleware
      // has overwritten leanshot_v4 with a partial in-flight state.
      const captured = readV4InnerState();
      await runMigration(userId, captured);
    } finally {
      migrationInFlight = false;
    }
    return;
  }

  // (6) fresh — only when there's v4 data to migrate (M3 net-new returns here).
  const v4 = readV4Snapshot();
  if (!v4HasUserData(v4)) return;

  // (6a) D-03: snapshot BEFORE any cloud write. snapshotPreCloudBackup throws
  // on quota error — re-raise (the migration cannot proceed without a backup).
  snapshotPreCloudBackup();

  // (6b) Capture the v4 inner state BEFORE setMigrationState fires — the
  // persist middleware would otherwise overwrite leanshot_v4 with the live
  // (empty) initialState shape on the next set() call, defeating the
  // migration read. Hand the captured snapshot to runMigration directly.
  const capturedSnapshot = readV4InnerState();

  // (6c) initialise migration_state.
  const init: MigrationState = {
    startedAt: new Date().toISOString(),
    complete: false,
    snapshotKey: SNAPSHOT_KEY,
  };
  for (const entity of ENTITIES) {
    init[entity] = 'pending';
  }
  storeState.setMigrationState(init);

  migrationInFlight = true;
  try {
    await runMigration(userId, capturedSnapshot);
  } finally {
    migrationInFlight = false;
  }
}

/**
 * Per-entity drain loop. Imports `@/lib/sync` dynamically so this module stays
 * off `sync-defer.ts`'s static graph. Marks every entity through
 * pending → in-progress → complete (or `error` if the per-entity handler
 * throws).
 *
 * On exit, sets `migration_state.complete = true` IFF every entity reached
 * 'complete'. A partial drain (one entity in 'error') leaves complete=false
 * so the resume path re-enters on next sign-in.
 */
export async function runMigration(
  userId: string,
  preCapturedSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const sync = await import('@/lib/sync');
  const storeState = useStore.getState();
  // Phase 6 06-03: prefer the pre-captured snapshot from maybeStartMigration
  // (taken BEFORE setMigrationState fires). Fallback to a fresh read only
  // when no caller-provided snapshot is supplied (e.g. external callers /
  // future tests). The persist middleware overwrites leanshot_v4 on every
  // set() call so reading after setMigrationState would miss seeded data.
  const snapshot = preCapturedSnapshot === undefined ? readV4InnerState() : preCapturedSnapshot;

  const ordered = computeRunOrder(snapshot ?? {});
  let allComplete = true;
  for (const entity of ordered) {
    // Skip entities already complete on resume (idempotent re-entry).
    const currentStatus = useStore.getState().migration_state?.[entity];
    if (currentStatus === 'complete') continue;
    try {
      storeState.markMigrationEntity(entity, 'in-progress');
      await migrateEntity(userId, entity, snapshot ?? {}, sync);
      storeState.markMigrationEntity(entity, 'complete');
    } catch (e) {
      storeState.markMigrationEntity(entity, 'error');
      console.error(`[leanshot] migration failed for ${entity}`, e);
      allComplete = false;
    }
  }
  if (allComplete) {
    storeState.markMigrationComplete();
  }
}

/**
 * Phase 6 06-03: per-entity PK field map. The 7 mechanical mapped entities
 * use `<entity>_id` UUIDs; supplements + settings have bespoke key shapes
 * handled in the dedicated branches below.
 */
const ENTITY_PK_FIELD: Record<string, string> = {
  weights: 'weight_id',
  meals: 'meal_id',
  workouts: 'workout_id',
  mood: 'mood_id',
  sleep: 'sleep_id',
  symptoms: 'symptom_id',
  vials: 'vial_id',
};

async function migrateEntity(
  userId: string,
  entity: Entity,
  snapshot: Record<string, unknown>,
  sync: typeof SyncModule,
): Promise<void> {
  // Plan 06-04 wires the photos base64→Storage path. For 06-03 this is a
  // no-op so the entity flips pending → complete without doing work.
  if (entity === 'photos') {
    return;
  }

  if (entity === 'injections') {
    // Reuse Phase 5's existing helper. enqueueLocalInjectionsForSync is
    // idempotent (enqueueOp dedupes by (table, op, key)) so re-running on
    // resume is safe. flushSyncQueue is gated by isSyncEnabled() so a
    // sign-in-while-offline path no-ops here and drains later.
    const { enqueueLocalInjectionsForSync } = await import('@/lib/auth-migration');
    enqueueLocalInjectionsForSync();
    await sync.flushSyncQueue();
    return;
  }

  const now = new Date().toISOString();
  const storeState = useStore.getState();

  // Phase 6 06-03 — 7 mechanical entities. Each row carries a stable
  // <entity>_id (back-stamped by addX actions OR explicitly assigned during
  // migration if absent). Read from the v4 snapshot rather than the live
  // store slice so the migration sees the pre-Zustand-hydrate payload.
  if (entity in ENTITY_PK_FIELD) {
    const arr = snapshot[entity];
    if (Array.isArray(arr) && arr.length > 0) {
      const pkField = ENTITY_PK_FIELD[entity]!;
      for (const row of arr as Record<string, unknown>[]) {
        const key = String(row[pkField] ?? '');
        if (!key) continue; // skip rows without a stable id (defensive — addX stamps client-side now)
        storeState.enqueueOp({
          table: entity,
          op: 'upsert',
          key,
          enqueuedAt: now,
        });
      }
    }
    await sync.flushSyncQueue();
    return;
  }

  if (entity === 'supplements') {
    // 06-RESEARCH §1.B Option A flattening — emit ONE upsert op per
    // (date, supplement_name) where taken === true. taken=false rows are
    // intentionally skipped (the natural "row exists" predicate IS taken).
    const supplementsByDate =
      (snapshot.supplements as Record<string, Record<string, boolean>> | undefined) ?? {};
    for (const [date, names] of Object.entries(supplementsByDate)) {
      for (const [name, taken] of Object.entries(names ?? {})) {
        if (taken === true) {
          storeState.enqueueOp({
            table: 'supplements',
            op: 'upsert',
            key: `${date}:${name}`,
            enqueuedAt: now,
          });
        }
      }
    }
    await sync.flushSyncQueue();
    return;
  }

  if (entity === 'settings') {
    // Singleton — one row per user keyed by user_id. The flushSettingsOps
    // handler reads state.user as the upsert payload; this branch just
    // emits the op so the queue includes settings on first migration.
    storeState.enqueueOp({
      table: 'settings',
      op: 'upsert',
      key: userId,
      enqueuedAt: now,
    });
    await sync.flushSyncQueue();
    return;
  }
}
