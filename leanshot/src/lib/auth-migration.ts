/**
 * Phase 5 Plan 05-02 Task 4 — silent migration helpers.
 *
 * Two responsibilities:
 *   - **runAnonPromotionMigrationIfNeeded** (D-05/D-07): when SIGNED_IN fires
 *     with a user whose previous session was anonymous on this device, surface
 *     a friendly post-promotion toast. The "previous-was-anon" hint is tracked
 *     via the module-level `lastWasAnon` flag set by App.tsx when an anon
 *     INITIAL_SESSION or auto-mint anon completes.
 *   - **enqueueLocalInjectionsForSync** (D-06): bulk-enqueue every existing
 *     local injection (with a stable `log_id`) into `pendingOps` so 05-03's
 *     flushSyncQueue can upsert them to Supabase. Idempotent — re-running on
 *     a clean queue is a no-op.
 *
 * NOTE: the actual cloud upsert lives in Plan 05-03's `src/lib/sync.ts`.
 * This module only mutates client state.
 */
import { useStore } from '@/lib/store';

let lastWasAnon = false;

/** Set by App.tsx after INITIAL_SESSION resolves the cached session. */
export function setLastWasAnon(value: boolean): void {
  lastWasAnon = value;
}

/** Test-only reset hook. Exported so the test file does not need to import the module under test. */
export function _resetLastWasAnonForTests(): void {
  lastWasAnon = false;
}

/**
 * Run after SIGNED_IN with a permanent user. If the previous session was
 * anonymous (same browser), surface a friendly post-promotion toast.
 *
 * No-op when the previous session was NOT anonymous (returning sign-in, fresh
 * signup-then-signin, etc).
 */
export async function runAnonPromotionMigrationIfNeeded(userId: string): Promise<void> {
  if (!lastWasAnon || !userId) return;
  // Once consumed, reset so re-entry of the SIGNED_IN handler does not re-toast.
  lastWasAnon = false;
  useStore
    .getState()
    .showToast('Welcome back — your AI chat history is saved to your account.', 'success');
}

/**
 * D-06: bulk-upload local injections after first SIGNED_IN. Enqueues into
 * `pendingOps`; 05-03's `flushSyncQueue` does the actual upsert.
 *
 * Idempotent: an injection that already has a pending upsert op is skipped.
 */
export function enqueueLocalInjectionsForSync(): void {
  const state = useStore.getState();
  const now = new Date().toISOString();
  for (const inj of state.injections) {
    state.enqueueOp({
      table: 'injections',
      op: 'upsert',
      key: inj.log_id,
      enqueuedAt: now,
    });
  }
}
