/**
 * Sync deferral helper (Phase 6 D-12 CI hardening).
 *
 * Phase 5 wired @/lib/sync, @/lib/auth-migration, and (transitively)
 * @supabase/supabase-js into App.tsx's static graph. That pushed the entry
 * chunk gzip past the 50 kB Phase 2.1 ceiling enforced by
 * scripts/assert-vendor-react-size.sh and broke the CI guard. Phase 6 D-12
 * inverts the dependency: App.tsx imports THIS module's tiny pre-init buffer
 * + dynamic-import scheduler, and the heavy modules load AFTER first paint
 * via window.requestIdleCallback (setTimeout fallback on Safari < 17 /
 * Firefox).
 *
 * Behavior mirrors src/lib/telemetry-defer.ts (Phase 2.1 proven pattern):
 *   - Pre-init: callers push SyncCall entries into a FIFO buffer (cap 64;
 *     oldest dropped with console.warn on overflow).
 *   - On idle: dynamic-import the heavy modules in parallel, then drain the
 *     buffer.
 *   - Post-init: subsequent calls bypass the buffer and dispatch directly.
 *
 * Plan 06-01 ships THREE call kinds (`onSignedIn`, `onSignedOut`, `flush`) +
 * a `setLastWasAnon` call kind (added during App.tsx rewire — see Task 2 step
 * 5). Plan 06-02 will extend with `'startMigration'` for the data-migration
 * orchestrator. Keep the SyncCall discriminated union exhaustive so a missed
 * branch surfaces at typecheck.
 *
 * Type-only import of `Session` is mandatory: a value import of
 * `@supabase/supabase-js` here defeats the deferral.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
// Type-only namespace imports of the heavy modules — these are erased at
// compile time (verbatimModuleSyntax) and DO NOT pull the modules onto the
// static graph. The runtime loads happen via the `import(...)` expressions
// inside `loadSync()` below.
import type * as AuthMigrationModule from '@/lib/auth-migration';
import type * as MigrationModule from '@/lib/migration';
import type * as SyncModule from '@/lib/sync';

type SyncCall =
  | { kind: 'onSignedIn'; userId: string; session: Session }
  | { kind: 'onSignedOut'; prevUserId: string | null }
  | { kind: 'flush' }
  | { kind: 'setLastWasAnon'; value: boolean }
  // Phase 6 Plan 06-02: explicit migration trigger. The normal SIGNED_IN
  // drain ALSO triggers migration via the `onSignedIn` branch below — this
  // kind is the manual fallback for e.g. App.tsx's "Retry migration" CTA.
  | { kind: 'startMigration'; userId: string };

const BUFFER_CAP = 64;
const buffer: SyncCall[] = [];

interface LoadedApi {
  sync: typeof SyncModule;
  authMig: typeof AuthMigrationModule;
  migration: typeof MigrationModule;
}

let loadedApi: LoadedApi | null = null;
let loadingPromise: Promise<LoadedApi> | null = null;

async function loadSync(): Promise<LoadedApi> {
  // Phase 6 Plan 06-02: load @/lib/migration alongside @/lib/sync +
  // @/lib/auth-migration so the onSignedIn drain branch can call
  // maybeStartMigration without a second idle-callback hop.
  const [sync, authMig, migration] = await Promise.all([
    import('@/lib/sync'),
    import('@/lib/auth-migration'),
    import('@/lib/migration'),
  ]);
  return { sync, authMig, migration };
}

function dispatch(api: LoadedApi, call: SyncCall): void {
  try {
    switch (call.kind) {
      case 'onSignedIn': {
        // Mirrors App.tsx's INITIAL_SESSION / SIGNED_IN handler triplet:
        // anon-promotion migration helper + enqueue local injections, then
        // explicit initial pull BEFORE subscribe (Pitfall #5 — postgres_changes
        // does NOT replay history), then drain any pendingOps.
        void api.authMig.runAnonPromotionMigrationIfNeeded(call.userId);
        api.authMig.enqueueLocalInjectionsForSync();
        void api.sync.pullInitialInjections(call.userId);
        api.sync.subscribeInjections(call.userId);
        // Phase 6 06-04 — photos channel runs alongside injections so a
        // photo uploaded on Context A fans out to Context B via Realtime
        // within the SC#3 5s budget. The pull-BEFORE-subscribe ordering
        // mirrors injections (Pitfall #5 — postgres_changes does not
        // replay history). For users with no photo rows yet the pull is a
        // single 0-row round-trip.
        void (async () => {
          await api.sync.pullInitialPhotos(call.userId);
          api.sync.subscribePhotos(call.userId);
        })();
        void api.sync.flushSyncQueue();
        // Phase 6 Plan 06-02 — kick off the leanshot_v4 → cloud migration
        // AFTER subscribe so Realtime is already listening when the per-entity
        // upload loop enqueues server writes (Pitfall #5 mirror — server fanout
        // for our own upserts arrives via the channel we just opened). For
        // net-new users `maybeStartMigration` exits early on the v4-data
        // absence check, so this is a near-free call.
        void api.migration.maybeStartMigration(call.userId);
        return;
      }
      case 'onSignedOut': {
        // Phase 5 D-09 — tear down Realtime BEFORE the caller clears user
        // data slices. App.tsx already enforces the ordering at the call
        // site (deferOnSignedOut → clearUserDataSlices); this drain branch
        // owns the unsubscribe + Phase 6 06-04 photo-substrate cleanup.
        void api.sync.unsubscribeAll().catch((e: unknown) => {
          console.warn('[leanshot] unsubscribeAll failed', e);
        });
        // Phase 6 06-04 T-06-04-04: prior user's queued photo blobs MUST
        // NOT survive sign-out (shared-device leak). The signed-URL cache
        // must also be flushed so a forwarded URL cannot be re-resolved
        // across accounts.
        void (async () => {
          try {
            const [{ clearAllPhotoBlobs }, { clearSignedUrlCache }] = await Promise.all([
              import('@/lib/photo-queue'),
              import('@/lib/signed-url-cache'),
            ]);
            await clearAllPhotoBlobs();
            clearSignedUrlCache();
          } catch (e) {
            console.warn('[leanshot] photo cleanup on signout failed', e);
          }
        })();
        return;
      }
      case 'flush': {
        void api.sync.flushSyncQueue();
        return;
      }
      case 'setLastWasAnon': {
        api.authMig.setLastWasAnon(call.value);
        return;
      }
      case 'startMigration': {
        // Phase 6 Plan 06-02: explicit re-entry path for the "Retry migration"
        // CTA after corruption. maybeStartMigration is idempotent (module-level
        // migrationInFlight guard), so even if onSignedIn just fired this is
        // safe.
        void api.migration.maybeStartMigration(call.userId);
        return;
      }
    }
  } catch (e) {
    console.error('[leanshot] deferred sync call failed', call.kind, e);
  }
}

function drain(): void {
  if (!loadedApi) return;
  while (buffer.length > 0) {
    const call = buffer.shift()!;
    dispatch(loadedApi, call);
  }
}

function push(call: SyncCall): void {
  if (loadedApi) {
    // Fast path: dispatch directly, skipping the buffer.
    dispatch(loadedApi, call);
    return;
  }
  if (buffer.length >= BUFFER_CAP) {
    console.warn('[leanshot] sync-defer buffer full; dropping oldest');
    buffer.shift();
  }
  buffer.push(call);
}

/** Phase 6 SIGNED_IN / INITIAL_SESSION handler — buffer + drain pull/subscribe/flush. */
export function deferOnSignedIn(userId: string, session: Session): void {
  push({ kind: 'onSignedIn', userId, session });
}

/** Phase 6 SIGNED_OUT handler — buffer + drain unsubscribe. */
export function deferOnSignedOut(prevUserId: string | null): void {
  push({ kind: 'onSignedOut', prevUserId });
}

/** Phase 6 online / generic flush trigger — buffer + drain flushSyncQueue. */
export function deferFlush(): void {
  push({ kind: 'flush' });
}

/** Phase 5 D-05/D-07 anon-promotion hint — buffer + drain setLastWasAnon. */
export function deferSetLastWasAnon(value: boolean): void {
  push({ kind: 'setLastWasAnon', value });
}

/**
 * Phase 6 Plan 06-02 explicit migration trigger — buffer + drain
 * maybeStartMigration. Used by App.tsx's "Retry migration" CTA AND any other
 * caller that needs to kick the migration outside of the normal SIGNED_IN
 * drain. Idempotent: a no-op if the module-level migrationInFlight guard is
 * already set or migration_state.complete is true.
 */
export function deferStartMigration(userId: string): void {
  push({ kind: 'startMigration', userId });
}

/**
 * Idle-scheduled dynamic import of the heavy modules. Caller pattern: ONE
 * invocation from main.tsx after `createRoot.render()` (mirrors
 * deferSentryInit + deferAnalyticsInit wiring).
 *
 * Idempotent: a second call while loadingPromise is in flight is a no-op.
 */
export function scheduleSyncInit(): void {
  if (loadedApi || loadingPromise) return;
  const startLoad = (): void => {
    if (loadedApi || loadingPromise) return;
    loadingPromise = loadSync();
    void loadingPromise.then((api) => {
      loadedApi = api;
      drain();
    });
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(startLoad, { timeout: 2000 });
  } else {
    setTimeout(startLoad, 100);
  }
}

/**
 * Dynamic-import wrapper for `supabase.auth.onAuthStateChange`. Keeps
 * `@/lib/supabase` (and transitively `@supabase/supabase-js`) OUT of
 * App.tsx's static graph. Returns the supabase subscription handle so the
 * caller can clean up on unmount.
 *
 * NOTE: this loads `@/lib/supabase` on FIRST call, which happens inside
 * App's mount useEffect — i.e. AFTER first paint. The dynamic import resolves
 * concurrently with the idle-scheduled scheduleSyncInit() load; the chunk
 * graph dedups @supabase/supabase-js across both entry points.
 */
export async function subscribeAuthStateChanges(
  handler: (event: AuthChangeEvent, session: Session | null) => void,
): Promise<{
  data: { subscription: { unsubscribe: () => void } };
}> {
  const { supabase } = await import('@/lib/supabase');
  return supabase.auth.onAuthStateChange(handler);
}

/**
 * Dynamic-import wrapper for `supabase.auth.getSession() + signInAnonymously()`.
 * Used by App.tsx's dashboard-auto-anon-mint useEffect so the supabase client
 * stays out of the entry chunk's static graph.
 */
export async function autoMintAnonSessionIfMissing(): Promise<void> {
  const { supabase } = await import('@/lib/supabase');
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  await supabase.auth.signInAnonymously();
  // The setLastWasAnon hint is best-effort; the auth-migration module is
  // loaded by scheduleSyncInit, so this call may either drain immediately
  // (post-load) or buffer (pre-load) — push() handles both.
  deferSetLastWasAnon(true);
}

/** Test-only reset hook. */
export function _resetForTests(): void {
  buffer.length = 0;
  loadedApi = null;
  loadingPromise = null;
}
