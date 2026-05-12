/**
 * Persistence + migration.
 *
 * v1 used a single localStorage key `leanshot_v3` with a flat shape.
 * v2 uses `leanshot_v4` via Zustand persist with explicit `migrate()` so
 * existing users keep their data. The legacy v3 key is deleted only after
 * a successful merge.
 */
import type {
  AIMessage,
  Cost,
  Injection,
  Meal,
  Measurement,
  MoodLog,
  NSV,
  PendingOp,
  Photo,
  SleepLog,
  SymptomLog,
  User,
  Vial,
  WeightLog,
  Workout,
} from '@/types';

export const STORAGE_KEY = 'leanshot_v4';
export const LEGACY_KEY = 'leanshot_v3';
// Phase 5 D-08 / SYNC-01: bumped 6 → 7 so persist `migrate` back-stamps existing
// injections with a stable `log_id` (composite PK with user_id on public.injections)
// and initialises `pendingOps: []` for the unified offline write queue (DELEG-2).
// Do NOT rename STORAGE_KEY — that is the localStorage key, not the schema version.
// The localStorage namespace per user (D-12) is layered ON TOP via `namespacedKey`;
// STORAGE_KEY remains the bare prefix.
export const STORAGE_VERSION = 7;
// Phase 4 D-03: API_KEY_STORAGE + apiKeyStorage helper removed. The
// BYO Anthropic-key UX is retired — AI now flows through the
// server-side ai-chat Edge Function. The legacy 'leanshot_anthropic_key'
// key is wiped on next boot by the one-shot cleanup in src/main.tsx.

export interface PersistedState {
  user: User | null;
  injections: Injection[];
  symptoms: SymptomLog[];
  weights: WeightLog[];
  measurements: Measurement[];
  meals: Meal[];
  water: Record<string, number>;
  foodNoise: Record<string, number>;
  workouts: Workout[];
  steps: Record<string, number>;
  supplements: Record<string, Record<string, boolean>>;
  mood: MoodLog[];
  sleep: SleepLog[];
  nsvs: NSV[];
  photos: Photo[];
  vials: Vial[];
  aiHistory: AIMessage[];
  costs: Cost[];
  /** Phase 2 D-10/D-11: versioned disclaimer acknowledgment. `undefined` triggers the dashboard-render fallback. */
  acknowledgedDisclaimer: 'v1' | undefined;
  /** Phase 5 DELEG-2: unified offline write queue. Optional during v6→v7 migration grace;
   *  the persist `migrate` callback initialises to `[]` if missing. The persist allow-list
   *  bump (partialize) lands in 05-03 alongside the sync engine that consumes this slice. */
  pendingOps?: PendingOp[];
  /**
   * Phase 5 Plan 05-02 D-13 — ISO timestamp until which the EmailVerificationBanner
   * stays dismissed. Set to "now + 24h" when user clicks "Dismiss for today".
   * Undefined = banner is visible whenever the gate condition holds.
   */
  verificationBannerDismissedUntil?: string;
}

export const initialState: PersistedState = {
  user: null,
  injections: [],
  symptoms: [],
  weights: [],
  measurements: [],
  meals: [],
  water: {},
  foodNoise: {},
  workouts: [],
  steps: {},
  supplements: {},
  mood: [],
  sleep: [],
  nsvs: [],
  photos: [],
  vials: [],
  aiHistory: [],
  costs: [],
  // D-10/D-11: net-new install → dashboard fallback fires until user clicks "I understand".
  acknowledgedDisclaimer: undefined,
};

/**
 * Read v3 data and shape it into v4. Defensive: any malformed field
 * falls back to the v4 default.
 */
export function migrateFromV3(): Partial<PersistedState> | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const v3 = JSON.parse(raw) as Record<string, unknown>;
    const merged: Partial<PersistedState> = {
      user: (v3.user as User) ?? null,
      injections: (v3.injections as Injection[]) ?? [],
      symptoms: (v3.symptoms as SymptomLog[]) ?? [],
      weights: (v3.weights as WeightLog[]) ?? [],
      measurements: (v3.measurements as Measurement[]) ?? [],
      meals: (v3.meals as Meal[]) ?? [],
      water: (v3.water as Record<string, number>) ?? {},
      foodNoise: (v3.foodNoise as Record<string, number>) ?? {},
      workouts: (v3.workouts as Workout[]) ?? [],
      steps: (v3.steps as Record<string, number>) ?? {},
      supplements: (v3.supplements as Record<string, Record<string, boolean>>) ?? {},
      mood: (v3.mood as MoodLog[]) ?? [],
      sleep: (v3.sleep as SleepLog[]) ?? [],
      nsvs: (v3.nsvs as NSV[]) ?? [],
      photos: (v3.photos as Photo[]) ?? [],
      vials: (v3.vials as Vial[]) ?? [],
      aiHistory: (v3.aiHistory as AIMessage[]) ?? [],
      costs: (v3.costs as Cost[]) ?? [],
      // D-11 / RESEARCH Pitfall 5: v3 migrants must see the fallback modal on next load.
      // Defaulting to 'v1' here would silently grandfather every existing user, breaking SC#2.
      acknowledgedDisclaimer: undefined,
    };
    // Only delete legacy after we've successfully built the merged state.
    localStorage.removeItem(LEGACY_KEY);
    return merged;
  } catch (e) {
    console.error('[leanshot] v3 migration failed', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 5 D-12 / DELEG-2 — namespaced storage helpers + v6→v7 migration.
// ---------------------------------------------------------------------------

/**
 * Compute the user-scoped localStorage namespace key per D-12.
 *
 * Returns `leanshot_v4:<first 16 hex chars of sha256(userId)>`. The hash is
 * truncated — full collision-resistance isn't required because the namespace
 * is internal to localStorage and the user_id is already a uniqueness token;
 * 64 bits is more than enough to keep two real Supabase UUIDs apart.
 */
export async function namespacedKey(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${STORAGE_KEY}:${hex.slice(0, 16)}`;
}

/**
 * On first SIGNED_IN: move data from the universal `leanshot_v4` key to the
 * per-user namespaced key. Idempotent and crash-safe:
 *  - If universal key is absent → no-op.
 *  - If target already has data → preserve target (signed-in user's data wins)
 *    and ALWAYS delete the universal key (T-05-03 multi-account leak prevention).
 *  - localStorage access is wrapped — private-mode browsers are silent no-ops.
 */
export async function renameStorageNamespace(userId: string): Promise<void> {
  const target = await namespacedKey(userId);
  let universalRaw: string | null = null;
  try {
    universalRaw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!universalRaw) return;
  let targetRaw: string | null = null;
  try {
    targetRaw = localStorage.getItem(target);
  } catch {
    /* noop */
  }
  try {
    if (targetRaw === null) {
      localStorage.setItem(target, universalRaw);
    }
    // Always remove the universal key to prevent multi-account leak (T-05-03).
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private-mode noop */
  }
}

/**
 * v6→v7 migration (Phase 5 D-08 + DELEG-2 + T-05-06):
 *  - Back-stamp every Injection lacking `log_id` with `crypto.randomUUID()`.
 *  - Initialise `pendingOps: []` for the unified offline write queue.
 *  - Idempotent: re-running on v7-shaped state preserves existing `log_id`s
 *    and an existing `pendingOps` array.
 *
 * Defensive: a malformed snapshot whose `injections` is missing collapses to
 * `[]` (mirrors the v5→v6 transform in store.ts `migrateState`).
 */
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

// ---------------------------------------------------------------------------
// Phase 5 G2 (Plan 05-05) — per-user storage adapter.
//
// Closes 05-UAT.md gap G2 (T-05-03 cross-account leak). Before this adapter,
// Zustand persist was hardcoded with `name: STORAGE_KEY` — so every write
// after the one-shot `renameStorageNamespace` migration went BACK to the
// universal key, defeating per-user isolation.
//
// Usage (src/lib/store.ts):
//   persist((set, get) => ({...}), {
//     name: STORAGE_KEY,                       // persist's `name` is ignored by the adapter
//     storage: createNamespacedStorage(),      // adapter routes via module-level activeNamespaceKey
//     ...
//   })
//
// Wiring (src/App.tsx onAuthStateChange):
//   case 'SIGNED_IN' / 'INITIAL_SESSION' (verified):
//     await setActiveStorageUserId(session.user.id);   // MUST precede renameStorageNamespace
//     await renameStorageNamespace(session.user.id);
//   case 'SIGNED_OUT':
//     const prev = useStore.getState().signedIn?.user?.id ?? null;
//     await setActiveStorageUserId(null);
//     if (prev) await removeUserNamespace(prev);
// ---------------------------------------------------------------------------

let activeNamespaceKey: string | null = null;

/**
 * Set the active user's namespaced key. Pass `null` to revert to the universal
 * `STORAGE_KEY` (used on SIGNED_OUT and during pre-signin anon activity).
 * `namespacedKey` is async (uses `crypto.subtle.digest`); the result is cached
 * synchronously so subsequent get/setItem calls do not need to await.
 */
export async function setActiveStorageUserId(
  userId: string | null,
): Promise<void> {
  if (userId == null) {
    activeNamespaceKey = null;
    return;
  }
  activeNamespaceKey = await namespacedKey(userId);
}

/** Test-only inspector: returns the cached namespaced key (or null). */
export function getActiveStorageNamespace(): string | null {
  return activeNamespaceKey;
}

/**
 * Zustand `StateStorage` adapter that routes every read/write/delete to the
 * active user's namespaced localStorage key (or `STORAGE_KEY` when no user is
 * active). The `name` argument from Zustand persist is IGNORED — persist
 * configures `name: STORAGE_KEY` only to satisfy its type contract; routing
 * is owned by `activeNamespaceKey`.
 *
 * Wrapped try/catch on every operation mirrors the existing `migrateFromV3`
 * pattern — private-mode browsers and quota errors are silent no-ops.
 */
export function createNamespacedStorage(): {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
} {
  return {
    getItem: (_name: string): string | null => {
      const key = activeNamespaceKey ?? STORAGE_KEY;
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (_name: string, value: string): void => {
      const key = activeNamespaceKey ?? STORAGE_KEY;
      try {
        localStorage.setItem(key, value);
      } catch {
        /* private-mode / quota — silent no-op */
      }
    },
    removeItem: (_name: string): void => {
      const key = activeNamespaceKey ?? STORAGE_KEY;
      try {
        localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    },
  };
}

/**
 * Wipe a specific user's namespaced localStorage key. Called by App.tsx's
 * SIGNED_OUT handler with the prior user's id so signed-out users leave no
 * per-user residue (UAT G2 missing item #2).
 */
export async function removeUserNamespace(userId: string): Promise<void> {
  const key = await namespacedKey(userId);
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

/**
 * Test-only reset hook — clears the module-level cached namespace so unit
 * tests can run independently. Not for production use.
 * @internal
 */
export function __resetActiveNamespaceForTests(): void {
  activeNamespaceKey = null;
}

