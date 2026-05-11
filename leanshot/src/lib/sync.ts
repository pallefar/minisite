/**
 * Phase 5 Plan 05-03 — Sync engine.
 *
 * Five exports:
 *   - `pullInitialInjections(userId)` — explicit initial pull (Realtime
 *     postgres_changes does NOT replay history; Pitfall #5).
 *   - `subscribeInjections(userId)` — single global Realtime subscription
 *     (D-09). Idempotent: a second call while a channel is live is a no-op.
 *   - `unsubscribeInjections()` — clean teardown via `supabase.removeChannel`.
 *   - `flushSyncQueue()` — drain `pendingOps` (injections only in Phase 5).
 *     Gated by `isSyncEnabled()` (D-13 / T-05-07). Upserts NEVER include
 *     `updated_at` — the moddatetime trigger is server-authoritative (D-08).
 *   - `subscribeToTable<T>(tableName, userId, onPayload)` — forward-compat
 *     generic helper Phase 6 wraps per new table (weights, meals, photos).
 *
 * Server-row shape (mirrors supabase/migrations/20260513000000_injections.sql):
 *   { user_id, log_id, medication, dose, unit, site, notes, logged_at,
 *     pk_engine_version, created_at, updated_at }
 *
 * Local `Injection` shape (src/types/index.ts):
 *   { log_id, datetime, dose, unit, site, notes, pkEngineVersion?, updated_at?, user_id? }
 *
 * Mapping: server `logged_at` <-> local `datetime`; server `pk_engine_version`
 * <-> local `pkEngineVersion`. All other columns share names.
 */
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { DoseUnit, Injection, InjectionSite } from '@/types';

/** Module-level singleton channel handle. `null` while no subscription is live. */
let injectionsChannel: RealtimeChannel | null = null;

/**
 * Server row shape returned by `supabase.from('injections').select('*')` /
 * Realtime payload `new` field. Mirrors the SQL schema verbatim so the
 * mapping point lives in exactly one place.
 */
interface ServerInjection {
  user_id: string;
  log_id: string;
  medication: string;
  dose: string;
  unit: string;
  site: string | null;
  notes: string;
  logged_at: string;
  pk_engine_version: number;
  created_at?: string;
  updated_at: string;
}

function mapServerToLocal(row: ServerInjection): Injection {
  return {
    log_id: row.log_id,
    datetime: row.logged_at,
    dose: row.dose,
    unit: row.unit as DoseUnit,
    site: (row.site ?? null) as InjectionSite | null,
    notes: row.notes,
    pkEngineVersion: row.pk_engine_version ?? 1,
    updated_at: row.updated_at,
    user_id: row.user_id,
  };
}

// ---------------------------------------------------------------------------
// pullInitialInjections
// ---------------------------------------------------------------------------

/**
 * One-shot select on signed-in/verified mount. Feeds rows into the store's
 * LWW merge (Plan 05-03 Task 2). Errors are logged + swallowed — the user
 * should not see a blocking failure here; Realtime + retry on next online
 * event covers the recovery path.
 */
export async function pullInitialInjections(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('injections')
    .select('*')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false });
  if (error) {
    console.error('[leanshot] pullInitial failed', error);
    return;
  }
  const rows = (data ?? []) as ServerInjection[];
  const mapped = rows.map(mapServerToLocal);
  useStore.getState().mergeServerInjections(mapped);
}

// ---------------------------------------------------------------------------
// subscribeInjections / unsubscribeInjections
// ---------------------------------------------------------------------------

/**
 * Single global Realtime subscription (D-09). RLS already gates fanout
 * server-side; the explicit `user_id=eq.<uid>` filter narrows the
 * WebSocket stream so other users' rows never reach this client (defense
 * in depth + bandwidth).
 *
 * Filter syntax MUST be the string form `user_id=eq.<uid>` (Pitfall #10).
 *
 * Idempotent: a second call while a channel is live is a no-op so React
 * StrictMode's double-mount in dev does not produce two subscribers.
 */
export function subscribeInjections(userId: string): void {
  if (injectionsChannel) return;
  injectionsChannel = supabase
    .channel(`injections:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'injections',
        filter: `user_id=eq.${userId}`,
      },
      (payload: RealtimePostgresChangesPayload<ServerInjection>) => {
        const mapped: RealtimePostgresChangesPayload<Injection> = {
          ...payload,
          new:
            payload.new && Object.keys(payload.new).length > 0
              ? (mapServerToLocal(payload.new as ServerInjection) as never)
              : (payload.new as never),
          old: payload.old as never,
        };
        useStore.getState().applyRealtimePayload(mapped);
      },
    )
    .subscribe((status: string) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[leanshot] injections channel error', status);
        // supabase-js handles reconnect with exponential backoff internally.
      }
    });
}

export async function unsubscribeInjections(): Promise<void> {
  if (!injectionsChannel) return;
  await supabase.removeChannel(injectionsChannel);
  injectionsChannel = null;
}

// ---------------------------------------------------------------------------
// flushSyncQueue
// ---------------------------------------------------------------------------

interface FlushableState {
  signedIn: { user: { id: string } | null } | null;
  user: { medication?: string } | null;
  injections: Injection[];
  pendingOps: Array<{ table: string; op: 'upsert' | 'delete'; key: string }>;
  isSyncEnabled: () => boolean;
  dropOps: (keys: string[]) => void;
}

/**
 * D-13 / T-05-07: cloud sync is gated. Mutations enqueue into `pendingOps`
 * unconditionally; flushing is permitted only when verified AND online.
 *
 * Error classification (RESEARCH §6):
 *   - Network / 5xx / 429 → transient; keep pendingOps for retry.
 *   - 4xx non-429        → permanent; log + dequeue to prevent loop.
 *   - Success            → dequeue successful keys via store.dropOps.
 *
 * Upsert payload NEVER includes `updated_at` (D-08, Critical Gotcha #11):
 * the moddatetime BEFORE UPDATE trigger overwrites server-side.
 */
export async function flushSyncQueue(): Promise<void> {
  const state = useStore.getState() as unknown as FlushableState;
  if (!state.isSyncEnabled()) return;

  const uid = state.signedIn?.user?.id;
  if (!uid) return;

  const injectionOps = (state.pendingOps ?? []).filter(
    (op) => op.table === 'injections',
  );
  if (injectionOps.length === 0) return;

  const upsertKeys = injectionOps.filter((o) => o.op === 'upsert').map((o) => o.key);
  const deleteKeys = injectionOps.filter((o) => o.op === 'delete').map((o) => o.key);

  // ----- Upserts ----------------------------------------------------------
  if (upsertKeys.length > 0) {
    const userMedication = state.user?.medication ?? 'unknown';
    const matching = state.injections.filter((i) => upsertKeys.includes(i.log_id));
    const successfulKeys: string[] = [];
    if (matching.length === 0) {
      // The keys reference rows that no longer exist locally (deleted while
      // queued). Drop them so we don't loop forever.
      state.dropOps(upsertKeys);
    } else {
      const rows = matching.map((r) => ({
        user_id: uid,
        log_id: r.log_id,
        medication: userMedication,
        dose: r.dose,
        unit: r.unit,
        site: r.site,
        notes: r.notes,
        logged_at: r.datetime,
        pk_engine_version: r.pkEngineVersion ?? 1,
        // INTENTIONALLY OMITTING updated_at — server moddatetime trigger sets per D-08.
      }));
      const { error } = await supabase
        .from('injections')
        .upsert(rows, { onConflict: 'user_id,log_id' });
      if (error) {
        if (isPermanent4xx(error)) {
          console.error('[leanshot] sync-permanent-error (upsert)', error);
          state.dropOps(upsertKeys);
        } else {
          console.warn('[leanshot] flushSyncQueue upsert transient error', error);
          // Leave queue intact for retry.
        }
      } else {
        successfulKeys.push(...rows.map((r) => r.log_id));
        state.dropOps(successfulKeys);
      }
    }
  }

  // ----- Deletes ----------------------------------------------------------
  if (deleteKeys.length > 0) {
    const { error } = await supabase
      .from('injections')
      .delete()
      .eq('user_id', uid)
      .in('log_id', deleteKeys);
    if (error) {
      if (isPermanent4xx(error)) {
        console.error('[leanshot] sync-permanent-error (delete)', error);
        state.dropOps(deleteKeys);
      } else {
        console.warn('[leanshot] flushSyncQueue delete transient error', error);
      }
    } else {
      state.dropOps(deleteKeys);
    }
  }
}

function isPermanent4xx(err: unknown): boolean {
  // Supabase PostgREST surfaces a `code` (HTTP status) on errors.
  // 429 (rate-limit) is treated as transient; other 4xx as permanent.
  const e = err as { code?: string | number; status?: number };
  const code = String(e?.code ?? e?.status ?? '');
  if (code === '429') return false;
  return /^4\d\d$/.test(code);
}

// ---------------------------------------------------------------------------
// subscribeToTable<T> — Phase 6 forward-compat (RESEARCH §13)
// ---------------------------------------------------------------------------

/**
 * Generic Realtime subscription factory. Phase 5 uses `subscribeInjections`
 * directly (because the payload mapping is injection-specific). Phase 6
 * (weights, meals, photos, ...) wraps this once per table — the caller
 * receives a `RealtimeChannel` and is responsible for `supabase.removeChannel`
 * teardown.
 */
export function subscribeToTable<T extends Record<string, unknown> = Record<string, unknown>>(
  tableName: string,
  userId: string,
  onPayload: (p: RealtimePostgresChangesPayload<T>) => void,
): RealtimeChannel {
  return supabase
    .channel(`${tableName}:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: tableName,
        filter: `user_id=eq.${userId}`,
      },
      onPayload,
    )
    .subscribe();
}
