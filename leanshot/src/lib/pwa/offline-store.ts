/**
 * Phase 42 Plan 04 (D-13) — offline state store.
 *
 * Lightweight standalone store (no Zustand dependency to keep this module
 * tree-shakeable away from the main store). Drives:
 *   - OfflineBanner.tsx — render when isOffline.
 *   - Logging surfaces — Wave 3 logging forms read disableLogging() to gate
 *     submit (D-13: "logging resumes when reconnected").
 *
 * State source: `navigator.onLine` + 'online' / 'offline' window events.
 */
type Listener = (state: OfflineState) => void;

export interface OfflineState {
  isOffline: boolean;
  banner_dismissed_at: string | null;
}

let state: OfflineState = {
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  banner_dismissed_at: null,
};
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn(state);
}

function setOffline(off: boolean): void {
  if (state.isOffline === off) return;
  state = { ...state, isOffline: off };
  emit();
}

let initialized = false;

/** Idempotent initializer — call once from App.tsx useEffect. */
export function initializeOfflineStore(): void {
  if (typeof window === 'undefined') return;
  if (initialized) return;
  initialized = true;
  window.addEventListener('online', () => setOffline(false));
  window.addEventListener('offline', () => setOffline(true));
}

export function getOfflineState(): OfflineState {
  return state;
}

export function subscribeOffline(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Gate function read by logging forms before allowing submit (D-13).
 * Returns `true` when logging is currently disabled (i.e. offline).
 */
export function disableLogging(): boolean {
  return state.isOffline;
}

/** Test-only reset (vitest). */
export function __resetOfflineStoreForTests(): void {
  state = {
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    banner_dismissed_at: null,
  };
  listeners.clear();
  initialized = false;
}
