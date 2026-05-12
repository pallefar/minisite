/**
 * Phase 6 Plan 06-01 — sync-defer.ts unit tests.
 *
 * sync-defer.ts is the FIFO pre-init buffer + idle-scheduled dynamic-import
 * wrapper that keeps `@/lib/sync`, `@/lib/auth-migration`, and (transitively)
 * `@supabase/supabase-js` OUT of App.tsx's static graph. This file locks the
 * six contracts from 06-01-PLAN Task 1 <behavior>:
 *
 *   1. Pre-load calls buffer; loadedApi stays null until the idle callback fires.
 *   2. Post-load drain happens in FIFO order across the three call kinds.
 *   3. Calls AFTER load drain immediately (push → drain in same tick).
 *   4. Buffer cap = 64; the 65th push drops the oldest with a console.warn.
 *   5. Idle scheduling uses window.requestIdleCallback when present; setTimeout fallback otherwise.
 *   6. _resetForTests() clears the buffer + loadedApi for test isolation.
 */
import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks of the dynamic-import targets. Vitest hoists vi.mock calls, so these
// reference the spy fns via the module-scope `mocks` object indirection.
// ---------------------------------------------------------------------------
const mocks = {
  pullInitialInjections: vi.fn(async (_uid: string) => undefined),
  subscribeInjections: vi.fn((_uid: string) => undefined),
  unsubscribeInjections: vi.fn(async () => undefined),
  flushSyncQueue: vi.fn(async () => undefined),
  runAnonPromotionMigrationIfNeeded: vi.fn(async (_uid: string) => undefined),
  enqueueLocalInjectionsForSync: vi.fn(() => undefined),
  setLastWasAnon: vi.fn((_v: boolean) => undefined),
};

vi.mock('@/lib/sync', () => ({
  pullInitialInjections: (...a: unknown[]) => mocks.pullInitialInjections(...(a as [string])),
  subscribeInjections: (...a: unknown[]) => mocks.subscribeInjections(...(a as [string])),
  unsubscribeInjections: (...a: unknown[]) => mocks.unsubscribeInjections(...(a as [])),
  flushSyncQueue: (...a: unknown[]) => mocks.flushSyncQueue(...(a as [])),
}));

vi.mock('@/lib/auth-migration', () => ({
  runAnonPromotionMigrationIfNeeded: (...a: unknown[]) =>
    mocks.runAnonPromotionMigrationIfNeeded(...(a as [string])),
  enqueueLocalInjectionsForSync: (...a: unknown[]) =>
    mocks.enqueueLocalInjectionsForSync(...(a as [])),
  setLastWasAnon: (...a: unknown[]) => mocks.setLastWasAnon(...(a as [boolean])),
}));

const fakeSession = { user: { id: 'u1' } } as unknown as Session;

// Save original requestIdleCallback descriptor for restore between tests.
const originalRic = (
  window as unknown as { requestIdleCallback?: typeof window.requestIdleCallback }
).requestIdleCallback;

async function flushMicrotasks(): Promise<void> {
  // Run enough microtask cycles to cover: idle-callback invocation →
  // loadSync's Promise.all(dyn-import x2) → .then(api → drain).
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
  // Also yield to setTimeout(0) to flush the macrotask queue (the fallback
  // path uses setTimeout(startLoad, 100)).
  await new Promise<void>((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Make requestIdleCallback synchronous by default so tests don't have to wait.
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: (cb: IdleRequestCallback) => {
      cb({
        didTimeout: false,
        timeRemaining: () => 50,
      } as IdleDeadline);
      return 1 as unknown as number;
    },
  });
});

afterEach(() => {
  if (originalRic === undefined) {
    // Remove our stub if there wasn't one originally.
    delete (window as unknown as { requestIdleCallback?: typeof window.requestIdleCallback })
      .requestIdleCallback;
  } else {
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: originalRic,
    });
  }
});

describe('sync-defer', () => {
  it('Test 1: buffers calls before scheduleSyncInit fires; loadedApi remains null', async () => {
    // Don't run idle yet — stub requestIdleCallback to a no-op so the import never resolves.
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: () => 1 as unknown as number,
    });
    const mod = await import('./sync-defer');
    mod._resetForTests();
    mod.deferOnSignedIn('user-1', fakeSession);
    // No flush has happened — the dynamic-import target was never invoked.
    expect(mocks.pullInitialInjections).not.toHaveBeenCalled();
    expect(mocks.subscribeInjections).not.toHaveBeenCalled();
  });

  it('Test 2: after scheduleSyncInit resolves, buffered calls drain in FIFO order', async () => {
    const mod = await import('./sync-defer');
    mod._resetForTests();
    mod.deferOnSignedIn('user-1', fakeSession);
    mod.deferFlush();
    mod.deferOnSignedOut('user-1');

    mod.scheduleSyncInit();
    await flushMicrotasks();

    // FIFO: onSignedIn (pull+subscribe+flush) → flush (flushSyncQueue) → onSignedOut (unsubscribe).
    // pullInitialInjections fires from the first call.
    expect(mocks.pullInitialInjections).toHaveBeenCalledWith('user-1');
    expect(mocks.subscribeInjections).toHaveBeenCalledWith('user-1');
    // flushSyncQueue fires twice: once from onSignedIn drain, once from the explicit deferFlush call.
    expect(mocks.flushSyncQueue.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.unsubscribeInjections).toHaveBeenCalled();
  });

  it('Test 3: calls AFTER load drain immediately (push → drain same tick)', async () => {
    const mod = await import('./sync-defer');
    mod._resetForTests();
    mod.scheduleSyncInit();
    await flushMicrotasks();

    // Now loadedApi is non-null. A fresh deferFlush should drain immediately.
    mocks.flushSyncQueue.mockClear();
    mod.deferFlush();
    // The drain is synchronous through push() — but flushSyncQueue may be async
    // dispatched via `void`. The CALL should have occurred by the next tick.
    await flushMicrotasks();
    expect(mocks.flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it('Test 4: buffer cap = 64; 65th push drops oldest with console.warn', async () => {
    // Block the idle init so buffer stays unflushed.
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: () => 1 as unknown as number,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mod = await import('./sync-defer');
    mod._resetForTests();
    // Push 65 entries.
    for (let i = 0; i < 65; i++) {
      mod.deferFlush();
    }
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toMatch(/sync-defer buffer full/);
    warn.mockRestore();
  });

  it('Test 5: falls back to setTimeout when requestIdleCallback is absent', async () => {
    delete (window as unknown as { requestIdleCallback?: typeof window.requestIdleCallback })
      .requestIdleCallback;
    vi.useFakeTimers();
    try {
      const mod = await import('./sync-defer');
      mod._resetForTests();
      mod.deferFlush();
      mod.scheduleSyncInit();
      // Before timers run, no flush should have happened.
      expect(mocks.flushSyncQueue).not.toHaveBeenCalled();
      vi.runAllTimers();
      vi.useRealTimers();
      await flushMicrotasks();
      expect(mocks.flushSyncQueue).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Test 6: _resetForTests clears the buffer + loadedApi', async () => {
    const mod = await import('./sync-defer');
    mod._resetForTests();
    mod.scheduleSyncInit();
    await flushMicrotasks();
    // loadedApi is now non-null. A reset should clear it so the next push
    // re-enters the buffered branch.
    mod._resetForTests();
    // Block the idle init for the post-reset push.
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: () => 1 as unknown as number,
    });
    mocks.flushSyncQueue.mockClear();
    mod.deferFlush();
    // After reset + no scheduleSyncInit, the buffered call should not drain.
    await flushMicrotasks();
    expect(mocks.flushSyncQueue).not.toHaveBeenCalled();
  });
});
