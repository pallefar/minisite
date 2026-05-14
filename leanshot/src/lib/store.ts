/**
 * Zustand store + persist.
 * Single source of truth for all user data and ephemeral UI state.
 */
import type {
  RealtimePostgresChangesPayload,
  Session,
  User as SupabaseUser,
} from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { track } from '@/lib/analytics';
// Phase 6 D-12 CI hardening: @/lib/auth + @/lib/sync are NO LONGER eager
// imports. Both transitively pull @supabase/supabase-js into the entry
// chunk's static graph (store.ts is reachable from main.tsx → hydrate()).
// `signOut()` action uses a dynamic import inside the action body;
// `addInjection` / `editInjection` / `removeInjection` route their
// fire-and-forget flush through `deferFlush()` from sync-defer.ts, which
// buffers pre-load and dispatches directly post-load (same idle-scheduled
// shape as Phase 2.1's telemetry-defer wrapper).
import type { Entity, EntityStatus, MigrationState } from '@/lib/migration';
import { deferFlush } from '@/lib/sync-defer';
import type {
  AIMessage,
  BillingState,
  Cost,
  Injection,
  Meal,
  MoodLog,
  PendingOp,
  Photo,
  SleepLog,
  SubscriptionProvider,
  SymptomLog,
  TabId,
  Tier,
  User,
  Vial,
  WeightLog,
  Workout,
  Measurement,
} from '@/types';
import {
  createNamespacedStorage,
  initialState,
  migrateFromV3,
  migrateV6ToV7,
  migrateV7ToV8,
  STORAGE_KEY,
  STORAGE_VERSION,
  type PersistedState,
} from './storage';

/**
 * Phase 5 D-13 / AUTH-06 cloud-sync gate slice.
 *
 * `null` while bootstrapping. Once App.tsx's `onAuthStateChange` resolves
 * INITIAL_SESSION, the slice is populated; on SIGNED_OUT it returns to null
 * (clearUserDataSlices below).
 *
 * `verified` is derived from `email_confirmed_at && !is_anonymous` so D-13's
 * gate (block cloud sync but allow local logging) is a single boolean read
 * via `isSyncEnabled()` rather than re-deriving across consumers.
 */
export interface SignedInSlice {
  user: SupabaseUser | null;
  session: Session | null;
  verified: boolean;
}

interface UIState {
  currentTab: TabId;
  /**
   * Phase 6 Plan 06-01 (UI-CHECK N4): `durationMs?: number` is an optional
   * override for the default 2400 ms auto-dismiss honored by Toast.tsx's
   * setTimeout. Phase 6's conflict-toast (Plan 06-05) passes 5000 ms;
   * existing callers omit the field and Toast falls back to 2400 ms.
   */
  toast: {
    message: string;
    kind: 'success' | 'error' | 'info';
    id: number;
    durationMs?: number;
  } | null;
  /**
   * Phase 5 D-13 — auth/session slice. NOT persisted via partialize: supabase-js
   * owns its own session under `sb-leanshot-auth`; we mirror only the derived
   * snapshot here so UI components can subscribe via Zustand selectors.
   */
  signedIn: SignedInSlice | null;
  /**
   * Phase 6 Plan 06-02 D-02 — ephemeral migration error flag. NOT persisted:
   * if the user reloads after a corruption, `maybeStartMigration` re-runs and
   * re-detects via `isMigrationStateCorrupted` so a stale persisted error
   * cannot mask a clean migration_state slice. Currently only takes the
   * sentinel `'corrupted'` value (D-02 corruption detection); future per-entity
   * error surfaces (e.g. quota exceeded) would extend this union.
   */
  migrationError: 'corrupted' | null;
}

interface Actions {
  setTab: (tab: TabId) => void;
  showToast: (message: string, kind?: 'success' | 'error' | 'info', durationMs?: number) => void;
  dismissToast: () => void;

  setUser: (user: User) => void;
  updateUser: (patch: Partial<User>) => void;
  resetAll: () => void;

  /** Phase 2 D-10/D-11: write the current disclaimer version into persisted state. */
  acknowledgeDisclaimer: (version: 'v1') => void;

  addInjection: (inj: Injection) => void;
  /**
   * Phase 5 D-08 — update an existing injection by log_id. Idempotent over the
   * upsert queue: if a pending upsert for the same log_id exists, no second
   * entry is added (enqueueOp dedupes by (table, op, key)).
   */
  editInjection: (logId: string, updates: Partial<Omit<Injection, 'log_id' | 'user_id'>>) => void;
  removeInjection: (idx: number) => void;

  addSymptom: (s: SymptomLog) => void;
  /** Phase 6 06-03 SYNC-02 — edit existing symptom by symptom_id; enqueues cloud upsert. */
  editSymptom: (symptomId: string, updates: Partial<Omit<SymptomLog, 'user_id'>>) => void;
  /** Phase 6 06-03 SYNC-02 — remove by index; enqueues cloud delete using symptom_id. */
  removeSymptom: (idx: number) => void;

  upsertWeight: (w: WeightLog) => void;
  removeWeight: (idx: number) => void;
  /** Phase 6 06-03 SYNC-02 — add weight log with uuid + cloud enqueue (parallel to addInjection). */
  addWeight: (w: WeightLog) => void;
  /** Phase 6 06-03 SYNC-02 — edit existing weight by weight_id; enqueues cloud upsert. */
  editWeight: (weightId: string, updates: Partial<Omit<WeightLog, 'user_id'>>) => void;

  addMeasurement: (m: Measurement) => void;

  addMeal: (m: Meal) => void;
  removeMeal: (idx: number) => void;
  /** Phase 6 06-03 SYNC-02 — edit existing meal by meal_id; enqueues cloud upsert. */
  editMeal: (mealId: string, updates: Partial<Omit<Meal, 'user_id'>>) => void;

  setWater: (date: string, n: number) => void;
  setFoodNoise: (date: string, n: number) => void;

  addWorkout: (w: Workout) => void;
  removeWorkout: (idx: number) => void;
  /** Phase 6 06-03 SYNC-02 — edit existing workout by workout_id; enqueues cloud upsert. */
  editWorkout: (workoutId: string, updates: Partial<Omit<Workout, 'user_id'>>) => void;

  setSteps: (date: string, n: number) => void;
  bulkSetSteps: (entries: Record<string, number>) => void;
  bulkAddWeights: (entries: WeightLog[]) => void;

  toggleSupp: (date: string, id: string) => void;
  resetSuppsForDate: (date: string) => void;
  /** Phase 6 06-03 SYNC-02 — alias for toggleSupp with explicit taken value (enqueues cloud upsert/delete). */
  toggleSupplement: (date: string, name: string, taken: boolean) => void;

  upsertMood: (m: MoodLog) => void;
  upsertSleep: (s: SleepLog) => void;
  /** Phase 6 06-03 SYNC-02 — add mood log with uuid + cloud enqueue. */
  addMood: (m: MoodLog) => void;
  /** Phase 6 06-03 SYNC-02 — edit existing mood by mood_id; enqueues cloud upsert. */
  editMood: (moodId: string, updates: Partial<Omit<MoodLog, 'user_id'>>) => void;
  /** Phase 6 06-03 SYNC-02 — remove mood by index; enqueues cloud delete. */
  removeMood: (idx: number) => void;
  /** Phase 6 06-03 SYNC-02 — add sleep log with uuid + cloud enqueue. */
  addSleep: (s: SleepLog) => void;
  /** Phase 6 06-03 SYNC-02 — edit existing sleep by sleep_id; enqueues cloud upsert. */
  editSleep: (sleepId: string, updates: Partial<Omit<SleepLog, 'user_id'>>) => void;
  /** Phase 6 06-03 SYNC-02 — remove sleep by index; enqueues cloud delete. */
  removeSleep: (idx: number) => void;

  addNSV: (text: string, date: string) => void;
  removeNSV: (idx: number) => void;

  /**
   * Phase 6 06-04 SYNC-06 / D-04 — Add a photo from a Blob source. The
   * Blob is compressed (canvas, D-06), persisted to IndexedDB
   * (`photo-queue`), and enqueued as a `'upload'` op. The metadata row is
   * appended optimistically to `photos` with `storage_path` populated for
   * the eventual cloud row; cloud-side row insertion happens at flush time
   * once the Storage upload succeeds.
   *
   * The action is async because compression is awaited inline; callers
   * fire-and-forget OR `await` for confirmation before navigating.
   */
  addPhoto: (blob: Blob, meta: { date: string; weight?: number | null }) => Promise<void>;
  removePhoto: (idx: number) => void;
  /** Phase 6 06-04 — handle Realtime postgres_changes payload for public.photos. */
  applyPhotoRealtimePayload: (payload: RealtimePostgresChangesPayload<Photo>) => void;
  /** Phase 6 06-04 — LWW merge for the initial pull (mirror Phase 5's mergeServerInjections). */
  mergeServerPhotos: (serverRows: Photo[]) => void;

  addVial: (v: Vial) => void;
  useVialDose: (idx: number) => void;
  removeVial: (idx: number) => void;
  /** Phase 6 06-03 SYNC-02 — edit existing vial by vial_id; enqueues cloud upsert. */
  editVial: (vialId: string, updates: Partial<Omit<Vial, 'user_id'>>) => void;

  addCost: (c: Cost) => void;
  removeCost: (idx: number) => void;

  appendAI: (m: AIMessage) => void;
  clearAI: () => void;
  /**
   * Phase 4 D-05 (streaming UX): append `delta` to the .content of the
   * LAST aiHistory message IF its role is 'assistant'. No-op when the
   * last message is a user message or the list is empty (defensive).
   * Mirrors the typing-effect UX the v1 BYO path used; the streaming
   * SSE parser in `callAIChat` calls this once per delta.
   */
  updateLastAssistant: (delta: string) => void;

  // Phase 14 Plan 14-05 — billing tier slice.
  /** Set the billing tier + subscription metadata. All 4 fields persist via partialize. */
  setTier: (next: Partial<BillingState> & { tier: Tier }) => void;

  // Phase 5 Plan 05-02 Task 2 — session + offline write queue + sync gate.
  setSession: (session: Session | null) => void;
  clearUserDataSlices: () => void;
  signOut: () => Promise<void>;
  enqueueOp: (op: PendingOp) => void;
  /**
   * Remove pendingOps entries whose `key` is in the supplied list.
   *
   * Phase 5 contract: when called without `table`, scope to `table === 'injections'`
   * (back-compat — the only Phase 5 caller is flushSyncQueue's injections branch).
   *
   * Phase 6 06-03 extension: when `table` is provided, scope to
   * `table === <table> AND key in keys`. The per-table flushTableOps helper
   * passes `table` so cross-table key collisions never cause spurious drops.
   */
  dropOps: (keys: string[], table?: string) => void;
  /** D-13: cloud sync is permitted only when verified AND online. */
  isSyncEnabled: () => boolean;
  /** Phase 5 D-08 — LWW merge: server rows overwrite local on log_id conflict iff server.updated_at > local.updated_at. */
  mergeServerInjections: (serverRows: Injection[]) => void;
  /** Phase 5 D-08 / D-10 — handle Realtime postgres_changes payload (INSERT/UPDATE/DELETE). */
  applyRealtimePayload: (payload: RealtimePostgresChangesPayload<Injection>) => void;

  // -------------------------------------------------------------------------
  // Phase 6 06-03 — per-entity LWW merge + Realtime payload handlers
  // (mirror Phase 5's mergeServerInjections / applyRealtimePayload contracts).
  // -------------------------------------------------------------------------
  mergeServerWeights: (
    serverRows: Array<WeightLog & { weight_id: string; updated_at?: string }>,
  ) => void;
  mergeServerMeals: (serverRows: Array<Meal & { meal_id: string; updated_at?: string }>) => void;
  mergeServerWorkouts: (
    serverRows: Array<Workout & { workout_id: string; updated_at?: string }>,
  ) => void;
  mergeServerMood: (serverRows: Array<MoodLog & { mood_id: string; updated_at?: string }>) => void;
  mergeServerSleep: (
    serverRows: Array<SleepLog & { sleep_id: string; updated_at?: string }>,
  ) => void;
  mergeServerSymptoms: (
    serverRows: Array<SymptomLog & { symptom_id: string; updated_at?: string }>,
  ) => void;
  mergeServerVials: (serverRows: Array<Vial & { vial_id: string; updated_at?: string }>) => void;
  mergeServerSupplements: (
    serverRows: Array<{ date: string; supplement_name: string; taken: boolean }>,
  ) => void;
  mergeServerSettings: (row: { payload: Record<string, unknown> }) => void;
  applyWeightRealtimePayload: (
    payload: RealtimePostgresChangesPayload<WeightLog & { weight_id: string; updated_at?: string }>,
  ) => void;
  applyMealRealtimePayload: (
    payload: RealtimePostgresChangesPayload<Meal & { meal_id: string; updated_at?: string }>,
  ) => void;
  applyWorkoutRealtimePayload: (
    payload: RealtimePostgresChangesPayload<Workout & { workout_id: string; updated_at?: string }>,
  ) => void;
  applyMoodRealtimePayload: (
    payload: RealtimePostgresChangesPayload<MoodLog & { mood_id: string; updated_at?: string }>,
  ) => void;
  applySleepRealtimePayload: (
    payload: RealtimePostgresChangesPayload<SleepLog & { sleep_id: string; updated_at?: string }>,
  ) => void;
  applySymptomRealtimePayload: (
    payload: RealtimePostgresChangesPayload<
      SymptomLog & { symptom_id: string; updated_at?: string }
    >,
  ) => void;
  applyVialRealtimePayload: (
    payload: RealtimePostgresChangesPayload<Vial & { vial_id: string; updated_at?: string }>,
  ) => void;
  applySupplementRealtimePayload: (
    payload: RealtimePostgresChangesPayload<{
      date: string;
      supplement_name: string;
      taken: boolean;
    }>,
  ) => void;
  applySettingsRealtimePayload: (
    payload: RealtimePostgresChangesPayload<{ payload: Record<string, unknown> }>,
  ) => void;

  /**
   * Phase 6 06-05 D-11 — LWW conflict UX surface (lww-loser notification).
   *
   * Fires the non-blocking info toast `"We kept your most recent edit."`
   * (kind: 'info', durationMs: 5000) on the LOSING device when a server-wins
   * LWW resolution overwrites a local pending edit. The `table` and `key`
   * args are unused for toast rendering today (the copy is fixed per D-11)
   * but the action signature retains them for future audit-log wiring
   * (Phase 7).
   *
   * Callers: the 10 applyXRealtimePayload reducers via the module-scoped
   * `_maybeFireLwwLossToast` helper, plus the testable `detectAndNotifyLwwLoss`
   * helper in @/lib/sync.
   */
  notifyLwwLoss: (table: string, key: string) => void;

  /** D-13: hide the EmailVerificationBanner for 24h. */
  dismissVerificationBanner: () => void;

  // -------------------------------------------------------------------------
  // Phase 6 Plan 06-02 D-02 — migration slice actions. The state machine in
  // `@/lib/migration` calls these via `useStore.getState()` rather than going
  // through `setState` directly, so the action surface here is the single
  // source of truth for "how does migration progress mutate the slice".
  // -------------------------------------------------------------------------
  /** Replace the migration_state slice wholesale. `null` clears it (resume gate or post-corruption reset). */
  setMigrationState: (next: MigrationState | null) => void;
  /** Per-entity status transition. No-op if migration_state is null. */
  markMigrationEntity: (entity: Entity, status: EntityStatus) => void;
  /** Set `complete: true` on the existing slice. No-op if migration_state is null. */
  markMigrationComplete: () => void;
  /** Surface (or clear) the corruption error banner. */
  setMigrationError: (err: 'corrupted' | null) => void;
}

export type Store = PersistedState & UIState & Actions;

let toastId = 0;

/**
 * Phase 6 06-05 D-11 — module-scope LWW loss-detection helper called by every
 * applyXRealtimePayload reducer (10 in total: injections + 8 mechanical tables
 * from 06-03 + photos from 06-04).
 *
 * Three-condition heuristic — ALL must hold to fire the toast:
 *   1. Both timestamps parseable AND server.updated_at STRICTLY GREATER than
 *      local.updated_at (i.e. server's row is newer).
 *   2. A pendingOp exists for (table, key) — the local user had a queued edit
 *      that is about to be overwritten by the newer server row.
 *   3. (Implicit) The local row actually exists with a parseable updated_at.
 *      Vanilla cross-device propagation has no local-pending edit → condition
 *      2 fails → no toast (lww-loser: false positive averted).
 *
 * Equal or older server timestamps short-circuit early. Missing timestamps
 * never fire (treated as no-loss to avoid false positives on clock skew).
 *
 * This helper is intentionally synchronous and pure-ish (it reads useStore
 * once for `pendingOps` and the action handle) so reducer-side wiring needs
 * exactly one line per call site.
 *
 * The mirror export at `@/lib/sync#detectAndNotifyLwwLoss` is the
 * test-surface for unit tests; both share semantics (see sync.ts comment).
 */
function _maybeFireLwwLossToast(
  table: string,
  key: string,
  serverUpdatedAt: string | undefined,
  localUpdatedAt: string | undefined,
): boolean {
  if (!serverUpdatedAt || !localUpdatedAt) return false;
  const serverTs = new Date(serverUpdatedAt).getTime();
  const localTs = new Date(localUpdatedAt).getTime();
  if (Number.isNaN(serverTs) || Number.isNaN(localTs)) return false;
  // Condition 1: server STRICTLY newer (ties treated as no-loss; clock skew safety).
  if (serverTs <= localTs) return false;
  const state = useStore.getState();
  // Condition 2: a pending local edit exists for this row.
  const hadPendingEdit = (state.pendingOps ?? []).some(
    (op) => op.table === table && op.key === key,
  );
  if (!hadPendingEdit) return false;
  // All conditions met — surface lww-loser toast.
  state.notifyLwwLoss(table, key);
  return true;
}

/**
 * Pure persist-migration function.
 *
 * Chains schema transformations with `version <= N` predicates (NOT `===`)
 * so a user who skipped intermediate versions still receives every transform:
 *
 *   - v3 → bootstrap: migrate legacy `leanshot_v3` blob into v4 shape via
 *     migrateFromV3() (kept here only for the "no persisted state" path).
 *   - v <= 4 → Phase 2 D-10/D-11: reset acknowledgedDisclaimer to undefined
 *     so v4 users (and v4-direct-to-v6 users) see the dashboard fallback
 *     modal on next load. NEVER default to 'v1' here — that would silently
 *     grandfather every existing user past the disclaimer (RESEARCH Pitfall 5).
 *   - v <= 5 → Phase 3 D-07 / PK-05: back-stamp every Injection with
 *     pkEngineVersion: 1 if missing, so a future v1.1 two-compartment engine
 *     can address records by version without ambiguity. Use `?? 1` so an
 *     explicit value (e.g. from a future migration that stamped 2) is
 *     preserved, never overwritten.
 *
 * Defensive: `state.injections ?? []` collapses a malformed snapshot's
 * missing array into an empty list (T-03-16 mitigation).
 *
 * Exported so unit tests can drive the migration directly without spinning
 * up the persist middleware.
 */
export function migrateState(persistedState: unknown, version: number): PersistedState {
  // CR-03 (Phase 3 review): the v3-bootstrap branch previously returned
  // early, skipping the v<=4 and v<=5 transforms — so a v3-direct-to-v6
  // user landed at v6 with pkEngineVersion: undefined on every legacy
  // injection. Funnel the bootstrap output through the same chained
  // transforms so every back-stamp / reset runs regardless of entry path.
  let state: PersistedState;
  if (!persistedState && version < STORAGE_VERSION) {
    // First boot of v2 with v3 data sitting around (no persisted state yet).
    const v3 = migrateFromV3();
    state = v3 ? { ...initialState, ...v3 } : { ...initialState };
  } else {
    state = persistedState as PersistedState;
  }
  // Phase 2 D-10/D-11: reset disclaimer for v4 users (also covers v4-direct-to-v6
  // AND v3-direct-to-v6 after CR-03).
  if (state && version <= 4) {
    state = { ...state, acknowledgedDisclaimer: undefined };
  }
  // Phase 3 D-07 / PK-05: back-stamp pkEngineVersion on every injection.
  // After CR-03 this also covers v3-direct-to-v6 migrants (the prior early
  // return left their injections unstamped, defeating the v5→v6 bump).
  if (state && version <= 5) {
    state = {
      ...state,
      injections: (state.injections ?? []).map((inj) => ({
        ...inj,
        pkEngineVersion: inj.pkEngineVersion ?? 1,
      })),
    };
  }
  // Phase 5 D-08 + DELEG-2: back-stamp log_id on every injection + initialise
  // pendingOps slice for the unified offline write queue. Chained AFTER v5→v6
  // so a v3-direct-to-v7 user passes through every transform in order.
  if (state && version < 7) {
    state = migrateV6ToV7(state);
  }
  // Phase 6 06-04 / D-04 / SYNC-06: back-stamp photo_id + storage_path +
  // mime_type on every Photo so the eager migration loop in migration.ts
  // can address rows by stable composite-PK identity. Legacy `data: string`
  // (base64 dataURL) is preserved through v8 — dropped per-photo after the
  // upload loop runs (migration.ts photo branch).
  if (state && version < 8) {
    state = migrateV7ToV8(state);
  }
  return state;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...initialState,
      // Plan 05-02 Task 2: pendingOps is in initialState, but TS narrows it as
      // optional via PersistedState — ensure a concrete empty array at boot so
      // every consumer can rely on .length / .find without ?? guards.
      pendingOps: [],
      // Phase 6 Plan 06-02 D-02: migration_state is in initialState (null) but
      // PersistedState marks it optional; pin it here so consumers can rely on
      // `s.migration_state` being a concrete `MigrationState | null` rather
      // than a tri-state with `undefined`.
      migration_state: null,
      currentTab: 'home',
      toast: null,
      signedIn: null,
      migrationError: null,

      setTab: (tab) => {
        set({ currentTab: tab });
        track('tab_viewed', { tab });
      },

      // Phase 14 Plan 14-05 — billing tier action.
      setTier: (next) =>
        set({
          tier: next.tier,
          current_period_end: next.current_period_end ?? null,
          plan_id: next.plan_id ?? null,
          provider: next.provider ?? null,
        }),
      showToast: (message, kind = 'success', durationMs) =>
        set({
          toast: {
            message,
            kind,
            id: ++toastId,
            ...(durationMs !== undefined && { durationMs }),
          },
        }),
      dismissToast: () => set({ toast: null }),
      // Phase 6 06-05 D-11 — non-blocking info toast on LWW-losing device.
      // Wording per 06-CONTEXT D-11 / 06-UI-SPEC §"Conflict toast copy".
      // Duration 5000ms via the 06-01 durationMs extension. The (table, key)
      // args are reserved for future audit-log wiring (Phase 7) and for
      // unit-test granularity; toast UI does not vary by table.
      notifyLwwLoss: (_table, _key) => {
        get().showToast('We kept your most recent edit.', 'info', 5000);
      },

      setUser: (user) => {
        set({ user });
        // Phase 6 06-03: settings singleton — every User mutation enqueues a
        // settings upsert keyed by user_id. The actual cloud row payload is
        // captured at flush time via state.user.
        const uid = get().signedIn?.user?.id;
        if (uid) {
          get().enqueueOp({
            table: 'settings',
            op: 'upsert',
            key: uid,
            enqueuedAt: new Date().toISOString(),
          });
          deferFlush();
        }
      },
      updateUser: (patch) => {
        set((s) => (s.user ? { user: { ...s.user, ...patch } } : s));
        const uid = get().signedIn?.user?.id;
        if (uid) {
          get().enqueueOp({
            table: 'settings',
            op: 'upsert',
            key: uid,
            enqueuedAt: new Date().toISOString(),
          });
          deferFlush();
        }
      },
      acknowledgeDisclaimer: (version) => set({ acknowledgedDisclaimer: version }),
      resetAll: () => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* noop */
        }
        set({ ...initialState, currentTab: 'home', toast: null });
      },

      addInjection: (inj) => {
        const log_id = inj.log_id ?? crypto.randomUUID();
        set((s) => {
          // Phase 3 D-07 / PK-05: every new injection carries the engine version
          // that produced its expected curve. Default to 1 (current 1-compartment
          // engine); explicit caller value wins so a future v1.1 engine can stamp
          // its own version without a code change here.
          // Phase 5 D-08 / SYNC-01: stamp a stable log_id (composite PK with user_id
          // on public.injections) so the offline write queue and eventual cloud upsert
          // can identify this row across local-only logging and Realtime fanout. Callers
          // (e.g. MedicationTab) currently pass form-shaped objects without log_id —
          // back-stamp here rather than push the requirement onto every UI surface.
          // Phase 6 06-05 D-11: stamp `updated_at` so the LWW loss-detection
          // heuristic has a meaningful local baseline. The cloud upsert payload
          // intentionally omits updated_at (mappers in sync.ts) — the server's
          // moddatetime trigger is the source of truth. This local stamp only
          // exists so that Realtime payloads arriving back can be compared.
          const stamped: Injection = {
            ...inj,
            log_id,
            pkEngineVersion: inj.pkEngineVersion ?? 1,
            updated_at: inj.updated_at ?? new Date().toISOString(),
          };
          const injections = [stamped, ...s.injections];
          // Decrement first non-empty vial
          const vials = s.vials.map((v, i) => {
            const firstActive = s.vials.findIndex((x) => x.dosesUsed < x.dosesPerVial);
            return i === firstActive ? { ...v, dosesUsed: v.dosesUsed + 1 } : v;
          });
          return {
            injections,
            vials,
            user: s.user ? { ...s.user, dose: inj.dose, doseUnit: inj.unit } : s.user,
          };
        });
        // Phase 5 D-10 — enqueue cloud upsert + fire-and-forget flush. The
        // queue survives reload (partialize) and is drained by 05-03's
        // flushSyncQueue gated on isSyncEnabled() (D-13).
        get().enqueueOp({
          table: 'injections',
          op: 'upsert',
          key: log_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editInjection: (logId, updates) => {
        // Phase 6 06-05 D-11: stamp `updated_at` on every local edit so the
        // LWW comparison in applyRealtimePayload has a fresh local baseline.
        const stampedAt = new Date().toISOString();
        set((s) => ({
          injections: s.injections.map((i) =>
            i.log_id === logId ? { ...i, ...updates, updated_at: stampedAt } : i,
          ),
        }));
        get().enqueueOp({
          table: 'injections',
          op: 'upsert',
          key: logId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      removeInjection: (idx) => {
        // Look up the log_id BEFORE the filter mutates state so the delete op
        // references the now-deleted row's stable identifier (composite PK
        // with user_id on public.injections).
        const target = useStore.getState().injections[idx];
        const logId = target?.log_id;
        set((s) => ({ injections: s.injections.filter((_, i) => i !== idx) }));
        if (!logId) return;
        get().enqueueOp({
          table: 'injections',
          op: 'delete',
          key: logId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      addSymptom: (sx) => {
        // Phase 6 06-03: stamp symptom_id (composite PK on public.symptoms)
        // so the cloud upsert can identify this row across local-only logging
        // and Realtime fanout. Caller may pass an existing symptom_id (e.g.
        // from a server pull); we preserve it.
        // Phase 6 06-05 D-11: stamp `updated_at` so LWW loss-detection works.
        const sxWithId = sx as SymptomLog & { symptom_id?: string; updated_at?: string };
        const symptom_id = sxWithId.symptom_id ?? crypto.randomUUID();
        const stamped: SymptomLog & { symptom_id: string; updated_at?: string } = {
          ...sx,
          symptom_id,
          updated_at: sxWithId.updated_at ?? new Date().toISOString(),
        };
        set((s) => ({ symptoms: [stamped as never, ...s.symptoms] }));
        get().enqueueOp({
          table: 'symptoms',
          op: 'upsert',
          key: symptom_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editSymptom: (symptomId, updates) => {
        const stampedAt = new Date().toISOString();
        set((s) => ({
          symptoms: s.symptoms.map((sx) =>
            (sx as SymptomLog & { symptom_id?: string }).symptom_id === symptomId
              ? ({ ...sx, ...updates, updated_at: stampedAt } as SymptomLog)
              : sx,
          ),
        }));
        get().enqueueOp({
          table: 'symptoms',
          op: 'upsert',
          key: symptomId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      removeSymptom: (idx) => {
        const target = useStore.getState().symptoms[idx] as
          | (SymptomLog & { symptom_id?: string })
          | undefined;
        const symptomId = target?.symptom_id;
        set((s) => ({ symptoms: s.symptoms.filter((_, i) => i !== idx) }));
        if (!symptomId) return;
        get().enqueueOp({
          table: 'symptoms',
          op: 'delete',
          key: symptomId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      upsertWeight: (w) =>
        set((s) => {
          const idx = s.weights.findIndex((x) => x.date === w.date);
          const next = [...s.weights];
          if (idx >= 0) next[idx] = w;
          else next.push(w);
          next.sort((a, b) => a.date.localeCompare(b.date));
          return { weights: next };
        }),
      removeWeight: (idx) => {
        const target = useStore.getState().weights[idx] as
          | (WeightLog & { weight_id?: string })
          | undefined;
        const weightId = target?.weight_id;
        set((s) => ({ weights: s.weights.filter((_, i) => i !== idx) }));
        if (!weightId) return;
        get().enqueueOp({
          table: 'weights',
          op: 'delete',
          key: weightId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      addWeight: (w) => {
        const wWithId = w as WeightLog & { weight_id?: string; updated_at?: string };
        const weight_id = wWithId.weight_id ?? crypto.randomUUID();
        // Phase 6 06-05 D-11: stamp `updated_at` for LWW loss-detection.
        const stamped: WeightLog & { weight_id: string; updated_at?: string } = {
          ...w,
          weight_id,
          updated_at: wWithId.updated_at ?? new Date().toISOString(),
        };
        set((s) => ({ weights: [...s.weights, stamped as never] }));
        get().enqueueOp({
          table: 'weights',
          op: 'upsert',
          key: weight_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editWeight: (weightId, updates) => {
        const stampedAt = new Date().toISOString();
        set((s) => ({
          weights: s.weights.map((w) =>
            (w as WeightLog & { weight_id?: string }).weight_id === weightId
              ? ({ ...w, ...updates, updated_at: stampedAt } as WeightLog)
              : w,
          ),
        }));
        get().enqueueOp({
          table: 'weights',
          op: 'upsert',
          key: weightId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      addMeasurement: (m) => set((s) => ({ measurements: [m, ...s.measurements] })),

      addMeal: (m) => {
        const mWithId = m as Meal & { meal_id?: string; updated_at?: string };
        const meal_id = mWithId.meal_id ?? crypto.randomUUID();
        // Phase 6 06-05 D-11: stamp `updated_at` for LWW loss-detection.
        const stamped: Meal & { meal_id: string; updated_at?: string } = {
          ...m,
          meal_id,
          updated_at: mWithId.updated_at ?? new Date().toISOString(),
        };
        set((s) => ({ meals: [...s.meals, stamped as never] }));
        get().enqueueOp({
          table: 'meals',
          op: 'upsert',
          key: meal_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      removeMeal: (idx) => {
        const target = useStore.getState().meals[idx] as (Meal & { meal_id?: string }) | undefined;
        const mealId = target?.meal_id;
        set((s) => ({ meals: s.meals.filter((_, i) => i !== idx) }));
        if (!mealId) return;
        get().enqueueOp({
          table: 'meals',
          op: 'delete',
          key: mealId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editMeal: (mealId, updates) => {
        const stampedAt = new Date().toISOString();
        set((s) => ({
          meals: s.meals.map((m) =>
            (m as Meal & { meal_id?: string }).meal_id === mealId
              ? ({ ...m, ...updates, updated_at: stampedAt } as Meal)
              : m,
          ),
        }));
        get().enqueueOp({
          table: 'meals',
          op: 'upsert',
          key: mealId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      setWater: (date, n) =>
        set((s) => ({ water: { ...s.water, [date]: s.water[date] === n ? n - 1 : n } })),
      setFoodNoise: (date, n) => set((s) => ({ foodNoise: { ...s.foodNoise, [date]: n } })),

      addWorkout: (w) => {
        const wWithId = w as Workout & { workout_id?: string; updated_at?: string };
        const workout_id = wWithId.workout_id ?? crypto.randomUUID();
        // Phase 6 06-05 D-11: stamp `updated_at` for LWW loss-detection.
        const stamped: Workout & { workout_id: string; updated_at?: string } = {
          ...w,
          workout_id,
          updated_at: wWithId.updated_at ?? new Date().toISOString(),
        };
        set((s) => ({ workouts: [stamped as never, ...s.workouts] }));
        get().enqueueOp({
          table: 'workouts',
          op: 'upsert',
          key: workout_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      removeWorkout: (idx) => {
        const target = useStore.getState().workouts[idx] as
          | (Workout & { workout_id?: string })
          | undefined;
        const workoutId = target?.workout_id;
        set((s) => ({ workouts: s.workouts.filter((_, i) => i !== idx) }));
        if (!workoutId) return;
        get().enqueueOp({
          table: 'workouts',
          op: 'delete',
          key: workoutId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editWorkout: (workoutId, updates) => {
        const stampedAt = new Date().toISOString();
        set((s) => ({
          workouts: s.workouts.map((w) =>
            (w as Workout & { workout_id?: string }).workout_id === workoutId
              ? ({ ...w, ...updates, updated_at: stampedAt } as Workout)
              : w,
          ),
        }));
        get().enqueueOp({
          table: 'workouts',
          op: 'upsert',
          key: workoutId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      setSteps: (date, n) => set((s) => ({ steps: { ...s.steps, [date]: n } })),
      bulkSetSteps: (entries) => set((s) => ({ steps: { ...s.steps, ...entries } })),
      bulkAddWeights: (entries) =>
        set((s) => {
          const seen = new Set(s.weights.map((w) => w.date));
          const fresh = entries.filter((e) => !seen.has(e.date));
          const next = [...s.weights, ...fresh];
          next.sort((a, b) => a.date.localeCompare(b.date));
          return { weights: next };
        }),

      toggleSupp: (date, id) => {
        // Phase 6 06-03: toggle local state + enqueue cloud op. The cloud
        // row IS the natural key (user_id, date, supplement_name); the
        // sync.ts handler converts taken=true → upsert, taken=false → delete.
        let nextTaken = false;
        set((s) => {
          const day = s.supplements[date] ?? {};
          nextTaken = !day[id];
          return {
            supplements: { ...s.supplements, [date]: { ...day, [id]: nextTaken } },
          };
        });
        get().enqueueOp({
          table: 'supplements',
          op: nextTaken ? 'upsert' : 'delete',
          key: `${date}:${id}`,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      resetSuppsForDate: (date) => set((s) => ({ supplements: { ...s.supplements, [date]: {} } })),
      toggleSupplement: (date, name, taken) => {
        set((s) => {
          const day = s.supplements[date] ?? {};
          return {
            supplements: { ...s.supplements, [date]: { ...day, [name]: taken } },
          };
        });
        get().enqueueOp({
          table: 'supplements',
          op: taken ? 'upsert' : 'delete',
          key: `${date}:${name}`,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      upsertMood: (m) =>
        set((s) => {
          const idx = s.mood.findIndex((x) => x.date === m.date);
          const next = [...s.mood];
          if (idx >= 0) next[idx] = m;
          else next.push(m);
          return { mood: next };
        }),
      upsertSleep: (sl) =>
        set((s) => {
          const idx = s.sleep.findIndex((x) => x.date === sl.date);
          const next = [...s.sleep];
          if (idx >= 0) next[idx] = sl;
          else next.push(sl);
          return { sleep: next };
        }),
      addMood: (m) => {
        const mWithId = m as MoodLog & { mood_id?: string; updated_at?: string };
        const mood_id = mWithId.mood_id ?? crypto.randomUUID();
        // Phase 6 06-05 D-11: stamp `updated_at` for LWW loss-detection.
        const stamped: MoodLog & { mood_id: string; updated_at?: string } = {
          ...m,
          mood_id,
          updated_at: mWithId.updated_at ?? new Date().toISOString(),
        };
        set((s) => ({ mood: [...s.mood, stamped as never] }));
        get().enqueueOp({
          table: 'mood',
          op: 'upsert',
          key: mood_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editMood: (moodId, updates) => {
        const stampedAt = new Date().toISOString();
        set((s) => ({
          mood: s.mood.map((m) =>
            (m as MoodLog & { mood_id?: string }).mood_id === moodId
              ? ({ ...m, ...updates, updated_at: stampedAt } as MoodLog)
              : m,
          ),
        }));
        get().enqueueOp({
          table: 'mood',
          op: 'upsert',
          key: moodId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      removeMood: (idx) => {
        const target = useStore.getState().mood[idx] as
          | (MoodLog & { mood_id?: string })
          | undefined;
        const moodId = target?.mood_id;
        set((s) => ({ mood: s.mood.filter((_, i) => i !== idx) }));
        if (!moodId) return;
        get().enqueueOp({
          table: 'mood',
          op: 'delete',
          key: moodId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      addSleep: (sl) => {
        const sWithId = sl as SleepLog & { sleep_id?: string; updated_at?: string };
        const sleep_id = sWithId.sleep_id ?? crypto.randomUUID();
        // Phase 6 06-05 D-11: stamp `updated_at` for LWW loss-detection.
        const stamped: SleepLog & { sleep_id: string; updated_at?: string } = {
          ...sl,
          sleep_id,
          updated_at: sWithId.updated_at ?? new Date().toISOString(),
        };
        set((s) => ({ sleep: [...s.sleep, stamped as never] }));
        get().enqueueOp({
          table: 'sleep',
          op: 'upsert',
          key: sleep_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editSleep: (sleepId, updates) => {
        const stampedAt = new Date().toISOString();
        set((s) => ({
          sleep: s.sleep.map((sl) =>
            (sl as SleepLog & { sleep_id?: string }).sleep_id === sleepId
              ? ({ ...sl, ...updates, updated_at: stampedAt } as SleepLog)
              : sl,
          ),
        }));
        get().enqueueOp({
          table: 'sleep',
          op: 'upsert',
          key: sleepId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      removeSleep: (idx) => {
        const target = useStore.getState().sleep[idx] as
          | (SleepLog & { sleep_id?: string })
          | undefined;
        const sleepId = target?.sleep_id;
        set((s) => ({ sleep: s.sleep.filter((_, i) => i !== idx) }));
        if (!sleepId) return;
        get().enqueueOp({
          table: 'sleep',
          op: 'delete',
          key: sleepId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      addNSV: (text, date) => set((s) => ({ nsvs: [{ text, date }, ...s.nsvs] })),
      removeNSV: (idx) => set((s) => ({ nsvs: s.nsvs.filter((_, i) => i !== idx) })),

      addPhoto: async (blob, meta) => {
        const photo_id = crypto.randomUUID();
        // Phase 6 D-06: client-side compression — canvas, 1600px maxEdge,
        // JPEG-85. The Storage bucket also caps file_size_limit at 2 MB
        // server-side (defence-in-depth T-06-04-02).
        const { compressImage } = await import('@/lib/photo-compress');
        let compressed: Blob;
        try {
          compressed = await compressImage(blob);
        } catch (e) {
          console.error('[leanshot] photo compression failed', e);
          return;
        }
        // Phase 6 D-08 substrate split: Blob lives in IndexedDB, NOT
        // localStorage (the persisted Zustand slice).
        const { putPhotoBlob } = await import('@/lib/photo-queue');
        try {
          await putPhotoBlob(photo_id, compressed);
        } catch (e) {
          console.error('[leanshot] photo IDB put failed', e);
          return;
        }

        const uid = get().signedIn?.user?.id;
        const photo: Photo = {
          photo_id,
          date: meta.date,
          weight: meta.weight ?? undefined,
          // storage_path is the canonical bucket path; pre-populate even
          // when offline so the queued tile UI can compose the eventual URL
          // shape. Empty string when no uid (anon session) — the upload op
          // populates it when the SIGNED_IN drain re-runs flushPhotoOps.
          storage_path: uid ? `${uid}/photos/${photo_id}.jpg` : '',
          mime_type: 'image/jpeg',
          size_bytes: compressed.size,
          // Phase 6 06-05 D-11: stamp `updated_at` for LWW loss-detection.
          updated_at: new Date().toISOString(),
        };
        set((s) => ({ photos: [photo, ...s.photos] }));
        get().enqueueOp({
          table: 'photos',
          op: 'upload',
          key: photo_id,
          blob_ref: photo_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      removePhoto: (idx) => {
        const target = useStore.getState().photos[idx];
        const photoId = target?.photo_id;
        set((s) => ({ photos: s.photos.filter((_, i) => i !== idx) }));
        if (!photoId) return;
        // Best-effort drop the local Blob if still queued — frees IDB space.
        void (async () => {
          try {
            const { deletePhotoBlob } = await import('@/lib/photo-queue');
            await deletePhotoBlob(photoId);
          } catch {
            /* noop */
          }
        })();
        get().enqueueOp({
          table: 'photos',
          op: 'delete',
          key: photoId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      addVial: (v) => {
        const vWithId = v as Vial & { vial_id?: string; updated_at?: string };
        const vial_id = vWithId.vial_id ?? crypto.randomUUID();
        // Phase 6 06-05 D-11: stamp `updated_at` for LWW loss-detection.
        const stamped: Vial & { vial_id: string; updated_at?: string } = {
          ...v,
          vial_id,
          updated_at: vWithId.updated_at ?? new Date().toISOString(),
        };
        set((s) => ({ vials: [...s.vials, stamped as never] }));
        get().enqueueOp({
          table: 'vials',
          op: 'upsert',
          key: vial_id,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      useVialDose: (idx) => {
        let vialId: string | undefined;
        set((s) => {
          const next = s.vials.map((v, i) =>
            i === idx && v.dosesUsed < v.dosesPerVial ? { ...v, dosesUsed: v.dosesUsed + 1 } : v,
          );
          vialId = (next[idx] as (Vial & { vial_id?: string }) | undefined)?.vial_id;
          return { vials: next };
        });
        if (vialId) {
          get().enqueueOp({
            table: 'vials',
            op: 'upsert',
            key: vialId,
            enqueuedAt: new Date().toISOString(),
          });
          deferFlush();
        }
      },
      removeVial: (idx) => {
        const target = useStore.getState().vials[idx] as (Vial & { vial_id?: string }) | undefined;
        const vialId = target?.vial_id;
        set((s) => ({ vials: s.vials.filter((_, i) => i !== idx) }));
        if (!vialId) return;
        get().enqueueOp({
          table: 'vials',
          op: 'delete',
          key: vialId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },
      editVial: (vialId, updates) => {
        const stampedAt = new Date().toISOString();
        set((s) => ({
          vials: s.vials.map((v) =>
            (v as Vial & { vial_id?: string }).vial_id === vialId
              ? ({ ...v, ...updates, updated_at: stampedAt } as Vial)
              : v,
          ),
        }));
        get().enqueueOp({
          table: 'vials',
          op: 'upsert',
          key: vialId,
          enqueuedAt: new Date().toISOString(),
        });
        deferFlush();
      },

      addCost: (c) => set((s) => ({ costs: [c, ...s.costs] })),
      removeCost: (idx) => set((s) => ({ costs: s.costs.filter((_, i) => i !== idx) })),

      appendAI: (m) => set((s) => ({ aiHistory: [...s.aiHistory, m] })),
      clearAI: () => set({ aiHistory: [] }),
      updateLastAssistant: (delta) =>
        set((s) => {
          const last = s.aiHistory[s.aiHistory.length - 1];
          if (!last || last.role !== 'assistant') return s;
          const next = [...s.aiHistory];
          next[next.length - 1] = { ...last, content: last.content + delta };
          return { aiHistory: next };
        }),

      // -----------------------------------------------------------------
      // Phase 5 Plan 05-02 Task 2 — D-11 + CONF-2 + CONF-3 + DELEG-2 + D-13.
      // -----------------------------------------------------------------

      setSession: (session) => {
        if (!session) {
          set({ signedIn: null });
          return;
        }
        const user = session.user ?? null;
        const verified = Boolean(user && !user.is_anonymous && user.email_confirmed_at != null);
        set({ signedIn: { user, session, verified } });
      },

      /**
       * D-11 + CONF-3: clear every user-data slice while preserving
       * device-level preferences (`acknowledgedDisclaimer`). Theme and
       * `tour_seen` (the latter currently captured implicitly via guided-tour
       * logic; not persisted in this store) are managed elsewhere.
       *
       * Triggered by: signOut() below + App.tsx SIGNED_OUT handler.
       */
      clearUserDataSlices: () =>
        set((state) => ({
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
          pendingOps: [],
          signedIn: null,
          // Phase 6 D-02: migration_state is per-account — MUST clear on signout
          // so a second user signing in on the same browser does not see the
          // prior user's resume modal. migrationError is ephemeral but also
          // cleared here so the corruption banner does not bleed across users.
          migration_state: null,
          migrationError: null,
          // CONF-3: PRESERVE through signout. Device-level acknowledgment.
          acknowledgedDisclaimer: state.acknowledgedDisclaimer,
          // Phase 14 Plan 14-05: reset billing tier cache on signout so the
          // next signed-in user does not inherit the prior session's tier.
          tier: 'free' as Tier,
          current_period_end: null,
          plan_id: null,
          provider: null as SubscriptionProvider,
        })),

      signOut: async () => {
        // Phase 6 D-12: dynamic-import @/lib/auth so the store module does
        // not pull @supabase/supabase-js onto the entry chunk's static
        // graph. The signOut action is user-initiated (Settings → Sign out)
        // and never runs on cold-load, so the lazy import latency is
        // acceptable. The auth.test.ts contract (scope: 'local') is still
        // exercised because src/lib/auth.ts is unchanged.
        const { signOut: authSignOut } = await import('@/lib/auth');
        const { error } = await authSignOut();
        if (error) {
          console.error('[leanshot] signOut failed', error);
          return;
        }
        // Phase 9 Plan 09-03: clear the clinic permission cache so the next
        // signed-in user does not inherit cached has_permission decisions
        // made under the prior auth.uid(). Tiny dynamic import keeps the
        // clinic-permissions module off the store's static graph (avoids
        // pulling supabase-js into the entry chunk).
        const { clearPermissionCache } = await import('@/lib/clinic-permissions');
        clearPermissionCache();
        // Phase 14 Plan 14-05: clear the billing tier cache so the next
        // signed-in user does not inherit cached tier decisions made under
        // the prior auth.uid(). Dynamic import keeps billing.ts off the
        // store's static graph (mirrors Phase 9 clearPermissionCache pattern).
        const { clearTierCache } = await import('@/lib/billing');
        clearTierCache();
        get().clearUserDataSlices();
      },

      enqueueOp: (op) =>
        set((s) => {
          const existing = (s.pendingOps ?? []).find(
            (p) => p.table === op.table && p.op === op.op && p.key === op.key,
          );
          if (existing) return s;
          return { pendingOps: [...(s.pendingOps ?? []), op] };
        }),

      dropOps: (keys, table) =>
        set((s) => {
          // Phase 5 back-compat: when `table` is omitted, scope to
          // injections (the only Phase 5 caller is flushSyncQueue's injections
          // branch). Phase 6 06-03 callers pass an explicit `table` so
          // cross-table key collisions can never cause spurious drops.
          const scopeTable = table ?? 'injections';
          return {
            pendingOps: (s.pendingOps ?? []).filter(
              (p) => !(p.table === scopeTable && keys.includes(p.key)),
            ),
          };
        }),

      /**
       * D-13: cloud sync is gated. Local logging continues regardless.
       * `navigator.onLine` is heuristic (some browsers report true on captive
       * portals), but combined with verified-session it's a sufficient
       * client-side gate; the actual upsert/Realtime calls 05-03 wires will
       * surface network errors back into pendingOps if they fail.
       */
      isSyncEnabled: () => {
        const s = get();
        return Boolean(s.signedIn?.verified) && navigator.onLine === true;
      },

      /**
       * Phase 5 D-08 LWW merge (RESEARCH §6 lines 844-858).
       *
       * Build a Map keyed by log_id from local rows, then for each server row
       * overwrite IFF the local is missing or older. Local-only rows survive
       * the merge — important for the initial pull after offline edits.
       *
       * Local rows that came from a previous server snapshot already carry
       * `updated_at`; brand-new local rows have NO `updated_at`, so server
       * rows always win against them (which is correct: any server row for a
       * brand-new local id means the server already saw it via flushSyncQueue
       * AND stamped its own authoritative timestamp).
       */
      mergeServerInjections: (serverRows) =>
        set((s) => {
          const map = new Map<string, Injection>();
          for (const local of s.injections) map.set(local.log_id, local);
          for (const remote of serverRows) {
            const local = map.get(remote.log_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.log_id, remote);
            }
          }
          return { injections: Array.from(map.values()) };
        }),
      /**
       * Phase 5 D-08 / D-10 — Realtime postgres_changes payload handler
       * (RESEARCH §6 lines 860-881). INSERT/UPDATE branch is LWW-guarded so a
       * stale fanout (e.g. our own write echoing back) does not clobber a
       * newer local edit. DELETE drops the row by log_id.
       */
      applyRealtimePayload: (payload) =>
        set((s) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Injection;
            const idx = s.injections.findIndex((i) => i.log_id === remote.log_id);
            if (idx === -1) {
              return { injections: [...s.injections, remote] };
            }
            const local = s.injections[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection. Fires the toast iff
            // the 3-condition heuristic holds (see _maybeFireLwwLossToast).
            _maybeFireLwwLossToast(
              'injections',
              remote.log_id,
              remote.updated_at,
              local.updated_at,
            );
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...s.injections];
              next[idx] = remote;
              return { injections: next };
            }
            return {}; // local is newer or equal; ignore
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { log_id?: string };
            if (!oldRow.log_id) return {};
            return {
              injections: s.injections.filter((i) => i.log_id !== oldRow.log_id),
            };
          }
          return {};
        }),

      // -----------------------------------------------------------------
      // Phase 6 06-03 — per-entity merge + Realtime reducers. Each mirrors
      // the Phase 5 injections LWW contract: a Map keyed by the entity's
      // PK column; server wins iff local is missing OR local.updated_at is
      // absent OR remote.updated_at > local.updated_at.
      // -----------------------------------------------------------------

      mergeServerWeights: (serverRows) =>
        set((s) => {
          type Row = WeightLog & { weight_id: string; updated_at?: string };
          const map = new Map<string, Row>();
          for (const local of s.weights as Row[]) {
            if (local.weight_id) map.set(local.weight_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.weight_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.weight_id, remote);
            }
          }
          return { weights: Array.from(map.values()) as never };
        }),
      mergeServerMeals: (serverRows) =>
        set((s) => {
          type Row = Meal & { meal_id: string; updated_at?: string };
          const map = new Map<string, Row>();
          for (const local of s.meals as Row[]) {
            if (local.meal_id) map.set(local.meal_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.meal_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.meal_id, remote);
            }
          }
          return { meals: Array.from(map.values()) as never };
        }),
      mergeServerWorkouts: (serverRows) =>
        set((s) => {
          type Row = Workout & { workout_id: string; updated_at?: string };
          const map = new Map<string, Row>();
          for (const local of s.workouts as Row[]) {
            if (local.workout_id) map.set(local.workout_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.workout_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.workout_id, remote);
            }
          }
          return { workouts: Array.from(map.values()) as never };
        }),
      mergeServerMood: (serverRows) =>
        set((s) => {
          type Row = MoodLog & { mood_id: string; updated_at?: string };
          const map = new Map<string, Row>();
          for (const local of s.mood as Row[]) {
            if (local.mood_id) map.set(local.mood_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.mood_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.mood_id, remote);
            }
          }
          return { mood: Array.from(map.values()) as never };
        }),
      mergeServerSleep: (serverRows) =>
        set((s) => {
          type Row = SleepLog & { sleep_id: string; updated_at?: string };
          const map = new Map<string, Row>();
          for (const local of s.sleep as Row[]) {
            if (local.sleep_id) map.set(local.sleep_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.sleep_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.sleep_id, remote);
            }
          }
          return { sleep: Array.from(map.values()) as never };
        }),
      mergeServerSymptoms: (serverRows) =>
        set((s) => {
          type Row = SymptomLog & { symptom_id: string; updated_at?: string };
          const map = new Map<string, Row>();
          for (const local of s.symptoms as Row[]) {
            if (local.symptom_id) map.set(local.symptom_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.symptom_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.symptom_id, remote);
            }
          }
          return { symptoms: Array.from(map.values()) as never };
        }),
      mergeServerVials: (serverRows) =>
        set((s) => {
          type Row = Vial & { vial_id: string; updated_at?: string };
          const map = new Map<string, Row>();
          for (const local of s.vials as Row[]) {
            if (local.vial_id) map.set(local.vial_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.vial_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.vial_id, remote);
            }
          }
          return { vials: Array.from(map.values()) as never };
        }),
      mergeServerSupplements: (serverRows) =>
        set((s) => {
          const next: Record<string, Record<string, boolean>> = { ...s.supplements };
          for (const row of serverRows) {
            if (!next[row.date]) next[row.date] = {};
            next[row.date]![row.supplement_name] = row.taken;
          }
          return { supplements: next };
        }),
      mergeServerSettings: (row) =>
        set((s) => {
          // Settings is server-authoritative when no local user exists; otherwise
          // shallow-merge into current user (LWW via server's updated_at would
          // require comparing against a local lastSyncedAt — Phase 6 ships
          // "newest write wins" for the singleton via overwrite).
          if (!s.user) {
            return { user: row.payload as never };
          }
          return { user: { ...s.user, ...(row.payload as Partial<User>) } };
        }),

      applyWeightRealtimePayload: (payload) =>
        set((s) => {
          type Row = WeightLog & { weight_id: string; updated_at?: string };
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Row;
            const idx = (s.weights as Row[]).findIndex((w) => w.weight_id === remote.weight_id);
            if (idx === -1) return { weights: [...s.weights, remote as never] };
            const local = (s.weights as Row[])[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast(
              'weights',
              remote.weight_id,
              remote.updated_at,
              local.updated_at,
            );
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...(s.weights as Row[])];
              next[idx] = remote;
              return { weights: next as never };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { weight_id?: string };
            if (!oldRow.weight_id) return {};
            return {
              weights: (s.weights as Row[]).filter(
                (w) => w.weight_id !== oldRow.weight_id,
              ) as never,
            };
          }
          return {};
        }),
      applyMealRealtimePayload: (payload) =>
        set((s) => {
          type Row = Meal & { meal_id: string; updated_at?: string };
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Row;
            const idx = (s.meals as Row[]).findIndex((m) => m.meal_id === remote.meal_id);
            if (idx === -1) return { meals: [...s.meals, remote as never] };
            const local = (s.meals as Row[])[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast('meals', remote.meal_id, remote.updated_at, local.updated_at);
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...(s.meals as Row[])];
              next[idx] = remote;
              return { meals: next as never };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { meal_id?: string };
            if (!oldRow.meal_id) return {};
            return {
              meals: (s.meals as Row[]).filter((m) => m.meal_id !== oldRow.meal_id) as never,
            };
          }
          return {};
        }),
      applyWorkoutRealtimePayload: (payload) =>
        set((s) => {
          type Row = Workout & { workout_id: string; updated_at?: string };
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Row;
            const idx = (s.workouts as Row[]).findIndex((w) => w.workout_id === remote.workout_id);
            if (idx === -1) return { workouts: [...s.workouts, remote as never] };
            const local = (s.workouts as Row[])[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast(
              'workouts',
              remote.workout_id,
              remote.updated_at,
              local.updated_at,
            );
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...(s.workouts as Row[])];
              next[idx] = remote;
              return { workouts: next as never };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { workout_id?: string };
            if (!oldRow.workout_id) return {};
            return {
              workouts: (s.workouts as Row[]).filter(
                (w) => w.workout_id !== oldRow.workout_id,
              ) as never,
            };
          }
          return {};
        }),
      applyMoodRealtimePayload: (payload) =>
        set((s) => {
          type Row = MoodLog & { mood_id: string; updated_at?: string };
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Row;
            const idx = (s.mood as Row[]).findIndex((m) => m.mood_id === remote.mood_id);
            if (idx === -1) return { mood: [...s.mood, remote as never] };
            const local = (s.mood as Row[])[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast('mood', remote.mood_id, remote.updated_at, local.updated_at);
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...(s.mood as Row[])];
              next[idx] = remote;
              return { mood: next as never };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { mood_id?: string };
            if (!oldRow.mood_id) return {};
            return { mood: (s.mood as Row[]).filter((m) => m.mood_id !== oldRow.mood_id) as never };
          }
          return {};
        }),
      applySleepRealtimePayload: (payload) =>
        set((s) => {
          type Row = SleepLog & { sleep_id: string; updated_at?: string };
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Row;
            const idx = (s.sleep as Row[]).findIndex((sl) => sl.sleep_id === remote.sleep_id);
            if (idx === -1) return { sleep: [...s.sleep, remote as never] };
            const local = (s.sleep as Row[])[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast('sleep', remote.sleep_id, remote.updated_at, local.updated_at);
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...(s.sleep as Row[])];
              next[idx] = remote;
              return { sleep: next as never };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { sleep_id?: string };
            if (!oldRow.sleep_id) return {};
            return {
              sleep: (s.sleep as Row[]).filter((sl) => sl.sleep_id !== oldRow.sleep_id) as never,
            };
          }
          return {};
        }),
      applySymptomRealtimePayload: (payload) =>
        set((s) => {
          type Row = SymptomLog & { symptom_id: string; updated_at?: string };
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Row;
            const idx = (s.symptoms as Row[]).findIndex(
              (sx) => sx.symptom_id === remote.symptom_id,
            );
            if (idx === -1) return { symptoms: [...s.symptoms, remote as never] };
            const local = (s.symptoms as Row[])[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast(
              'symptoms',
              remote.symptom_id,
              remote.updated_at,
              local.updated_at,
            );
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...(s.symptoms as Row[])];
              next[idx] = remote;
              return { symptoms: next as never };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { symptom_id?: string };
            if (!oldRow.symptom_id) return {};
            return {
              symptoms: (s.symptoms as Row[]).filter(
                (sx) => sx.symptom_id !== oldRow.symptom_id,
              ) as never,
            };
          }
          return {};
        }),
      applyVialRealtimePayload: (payload) =>
        set((s) => {
          type Row = Vial & { vial_id: string; updated_at?: string };
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Row;
            const idx = (s.vials as Row[]).findIndex((v) => v.vial_id === remote.vial_id);
            if (idx === -1) return { vials: [...s.vials, remote as never] };
            const local = (s.vials as Row[])[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast('vials', remote.vial_id, remote.updated_at, local.updated_at);
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...(s.vials as Row[])];
              next[idx] = remote;
              return { vials: next as never };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { vial_id?: string };
            if (!oldRow.vial_id) return {};
            return {
              vials: (s.vials as Row[]).filter((v) => v.vial_id !== oldRow.vial_id) as never,
            };
          }
          return {};
        }),
      applySupplementRealtimePayload: (payload) =>
        set((s) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const row = payload.new as {
              date?: string;
              supplement_name?: string;
              taken?: boolean;
              updated_at?: string;
            };
            if (!row.date || !row.supplement_name) return {};
            // Phase 6 06-05 D-11 — lww-loser detection. Supplements use a
            // composite key `date:name`. Local-side carries no per-cell
            // updated_at (the slice is a Record<date, Record<name, boolean>>);
            // pass undefined so the heuristic correctly short-circuits unless
            // both sides are present. The pendingOps check via op.key still
            // catches true conflicts when the user toggled the same cell.
            _maybeFireLwwLossToast(
              'supplements',
              `${row.date}:${row.supplement_name}`,
              row.updated_at,
              undefined,
            );
            const next = { ...s.supplements };
            if (!next[row.date]) next[row.date] = {};
            next[row.date]![row.supplement_name] = row.taken !== false;
            return { supplements: next };
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { date?: string; supplement_name?: string };
            if (!oldRow.date || !oldRow.supplement_name) return {};
            const day = { ...(s.supplements[oldRow.date] ?? {}) };
            delete day[oldRow.supplement_name];
            return { supplements: { ...s.supplements, [oldRow.date]: day } };
          }
          return {};
        }),
      applySettingsRealtimePayload: (payload) =>
        set((s) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const row = payload.new as {
              payload?: Record<string, unknown>;
              updated_at?: string;
              user_id?: string;
            };
            if (!row.payload) return {};
            // Phase 6 06-05 D-11 — lww-loser detection. Settings is a per-user
            // singleton; the local user blob has no `updated_at` so the helper
            // short-circuits on the missing-baseline guard unless a future
            // mutation stamps one. Wired here so the call site is uniform
            // across all 10 reducers (audit-grep compliance).
            _maybeFireLwwLossToast('settings', row.user_id ?? '', row.updated_at, undefined);
            if (!s.user) return { user: row.payload as never };
            return { user: { ...s.user, ...(row.payload as Partial<User>) } };
          }
          return {};
        }),

      // -----------------------------------------------------------------
      // Phase 6 06-04 — photos LWW merge + Realtime reducer. The Storage
      // bucket holds the Blob; this slice only carries the metadata row.
      // -----------------------------------------------------------------

      mergeServerPhotos: (serverRows) =>
        set((s) => {
          const map = new Map<string, Photo>();
          for (const local of s.photos) {
            if (local.photo_id) map.set(local.photo_id, local);
          }
          for (const remote of serverRows) {
            const local = map.get(remote.photo_id);
            if (
              !local ||
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              map.set(remote.photo_id, remote);
            }
          }
          return { photos: Array.from(map.values()) };
        }),

      applyPhotoRealtimePayload: (payload) =>
        set((s) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remote = payload.new as Photo;
            const idx = s.photos.findIndex((p) => p.photo_id === remote.photo_id);
            if (idx === -1) return { photos: [remote, ...s.photos] };
            const local = s.photos[idx]!;
            // Phase 6 06-05 D-11 — lww-loser detection.
            _maybeFireLwwLossToast('photos', remote.photo_id, remote.updated_at, local.updated_at);
            if (
              !local.updated_at ||
              (remote.updated_at && new Date(remote.updated_at) > new Date(local.updated_at))
            ) {
              const next = [...s.photos];
              next[idx] = remote;
              return { photos: next };
            }
            return {};
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { photo_id?: string };
            if (!oldRow.photo_id) return {};
            return { photos: s.photos.filter((p) => p.photo_id !== oldRow.photo_id) };
          }
          return {};
        }),

      dismissVerificationBanner: () => {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        set({ verificationBannerDismissedUntil: until });
      },

      // -----------------------------------------------------------------
      // Phase 6 Plan 06-02 D-02 — migration_state slice actions.
      // -----------------------------------------------------------------

      setMigrationState: (next) => set({ migration_state: next }),

      markMigrationEntity: (entity, status) =>
        set((s) => {
          if (!s.migration_state) return s;
          return { migration_state: { ...s.migration_state, [entity]: status } };
        }),

      markMigrationComplete: () =>
        set((s) => {
          if (!s.migration_state) return s;
          return { migration_state: { ...s.migration_state, complete: true } };
        }),

      setMigrationError: (err) => set({ migrationError: err }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      // Phase 5 G2 (Plan 05-05): per-user namespaced storage adapter — closes
      // 05-UAT.md gap G2 (T-05-03 cross-account leak). `createNamespacedStorage`
      // is a `StateStorage` (string-based) whose get/set/removeItem route to
      // localStorage[activeNamespaceKey ?? STORAGE_KEY]. `createJSONStorage`
      // wraps it so persist's `PersistStorage<S>` contract is satisfied (JSON
      // serialize on the way in, parse on the way out). App.tsx's
      // onAuthStateChange handler calls setActiveStorageUserId(session.user.id)
      // on every verified SIGNED_IN BEFORE renameStorageNamespace.
      storage: createJSONStorage(() => createNamespacedStorage()),
      // Only persist domain data, not transient UI flags.
      // Phase 5 Plan 05-02 DELEG-2: `pendingOps` joins the allow-list so the
      // offline write queue survives reload/refresh — 05-03 drains it on
      // SIGNED_IN+online via `flushSyncQueue`. `signedIn` is NOT persisted
      // (supabase-js owns the session under `sb-leanshot-auth`).
      partialize: (state) => ({
        user: state.user,
        injections: state.injections,
        symptoms: state.symptoms,
        weights: state.weights,
        measurements: state.measurements,
        meals: state.meals,
        water: state.water,
        foodNoise: state.foodNoise,
        workouts: state.workouts,
        steps: state.steps,
        supplements: state.supplements,
        mood: state.mood,
        sleep: state.sleep,
        nsvs: state.nsvs,
        photos: state.photos,
        vials: state.vials,
        aiHistory: state.aiHistory,
        costs: state.costs,
        acknowledgedDisclaimer: state.acknowledgedDisclaimer,
        pendingOps: state.pendingOps,
        verificationBannerDismissedUntil: state.verificationBannerDismissedUntil,
        // Phase 6 D-02: migration_state survives reload so a mid-migration
        // crash resumes the modal in "Resuming migration" mode rather than
        // restarting from scratch. migrationError is NOT persisted — it's
        // re-derived from corruption detection on next sign-in.
        migration_state: state.migration_state,
        // Phase 14 Plan 14-05: billing tier persists across reload so the
        // paywall gate state matches the user's actual subscription status
        // on every mount (before the next webhook event re-confirms it).
        tier: state.tier,
        current_period_end: state.current_period_end,
        plan_id: state.plan_id,
        provider: state.provider,
      }),
      migrate: (persistedState, version) => migrateState(persistedState, version),
      // Synchronous-by-default. We rehydrate inside main.tsx before render.
    },
  ),
);

/** Manual hydration call used by main.tsx to avoid pre-paint flash. */
export const hydrate = (): Promise<void> => {
  // If a v3 blob exists but no v4 yet, prime v4 from v3 BEFORE persist boots.
  // (Persist will not run migrate when there's no persisted state at all.)
  try {
    if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem('leanshot_v3')) {
      const v3 = migrateFromV3();
      if (v3) {
        // CR-03 (Phase 3 review): apply the same v<=5 pkEngineVersion
        // back-stamp transform here that migrateState applies. Without
        // this, a v3-direct-to-v6 user reached the dashboard with every
        // legacy injection at pkEngineVersion: undefined — defeating the
        // entire reason STORAGE_VERSION was bumped to 6 (D-07 / PK-05).
        const stampedV3 = {
          ...v3,
          injections: (v3.injections ?? []).map((inj) => ({
            ...inj,
            pkEngineVersion: inj.pkEngineVersion ?? 1,
          })),
        };
        useStore.setState((s) => ({ ...s, ...stampedV3 }));
        // Manually persist a snapshot so subsequent loads find v4.
        useStore.persist.rehydrate();
      }
    }
  } catch (e) {
    console.error('[leanshot] hydrate failed', e);
  }
  return useStore.persist.rehydrate() as Promise<void>;
};

// Phase 6 06-05 — Playwright test seam. Expose `useStore` on `window` in
// non-production builds so e2e specs (offline-conflict-toast.spec.ts) can
// drive store actions directly via `page.evaluate()` without depending on
// UI affordances that may or may not exist for every entity (e.g. inline
// weight-edit). Guarded behind `import.meta.env.MODE !== 'production'` so
// production bundles do NOT leak the store handle. Mirrors the pattern
// used by other test-instrumented modules in the codebase.
//
// Phase 7 07-01 (Rule 3 deviation): the CI e2e job runs `npm run preview`
// against a production build (MODE === 'production'), which would hide
// this handle and break specs #4 (offline-conflict-toast) and #7
// (signout-cache-clear) that need it. The CI build step opts in via
// `VITE_E2E=true`; Vercel production builds do NOT set the flag, so the
// deployed bundle still hides the handle. See
// `.planning/phases/07-compliance-foundations-legal-counsel-led/07-01-findings.md`
// §"Cross-cutting deviation".
if (
  typeof window !== 'undefined' &&
  (import.meta.env.MODE !== 'production' || import.meta.env.VITE_E2E === 'true')
) {
  (window as unknown as { useStore?: typeof useStore }).useStore = useStore;
}

// Phase 7 RC4 debug seam — capture every state transition that mutates
// `user` or `acknowledgedDisclaimer`, REGARDLESS of whether it comes from
// useStore.setState (covered by useStore.subscribe), the persist middleware's
// captured-original setter (also covered by useStore.subscribe), or a
// localStorage write/clear (covered by wrapping window.localStorage).
// Gated ONLY by VITE_E2E === 'true'; Vercel production builds do NOT set
// this flag. Remove after RC4 is closed
// (see .planning/debug/phase7-e2e-rc4-state-wipe-race.md).
if (typeof window !== 'undefined' && import.meta.env.VITE_E2E === 'true') {
  interface StateLogEntry {
    kind: 'state' | 'lsset' | 'lsremove' | 'lsclear' | 'lsget';
    ts: number;
    beforeUser?: 'set' | 'null';
    afterUser?: 'set' | 'null';
    beforeAck?: string | null;
    afterAck?: string | null;
    key?: string;
    sample?: string;
    stack: string;
  }
  interface WindowWithLog {
    __leanshot_state_log__?: StateLogEntry[];
  }
  const w = window as unknown as WindowWithLog;
  const pushLog = (entry: StateLogEntry): void => {
    if (!w.__leanshot_state_log__) w.__leanshot_state_log__ = [];
    w.__leanshot_state_log__.push(entry);
  };
  const stackOf = (skip: number): string =>
    new Error().stack
      ?.split('\n')
      .slice(skip, skip + 6)
      .join(' | ') ?? '';

  // (1) Zustand subscribe — fires on EVERY state change including persist
  // middleware's captured-original setter and rehydrate.
  let prevUser: 'set' | 'null' = useStore.getState().user ? 'set' : 'null';
  let prevAck: string | null = useStore.getState().acknowledgedDisclaimer ?? null;
  useStore.subscribe((s) => {
    const u: 'set' | 'null' = s.user ? 'set' : 'null';
    const a: string | null = s.acknowledgedDisclaimer ?? null;
    if (u !== prevUser || a !== prevAck) {
      pushLog({
        kind: 'state',
        ts: Date.now(),
        beforeUser: prevUser,
        afterUser: u,
        beforeAck: prevAck,
        afterAck: a,
        stack: stackOf(2),
      });
      prevUser = u;
      prevAck = a;
    }
  });

  // (2) localStorage instrumentation — catches direct removes/clears that
  // would invalidate persist's view of the world even without a setState call.
  // Only log operations against `leanshot_v4` keys to avoid log spam.
  const ls = window.localStorage;
  const origSetItem = ls.setItem.bind(ls);
  const origRemoveItem = ls.removeItem.bind(ls);
  const origClear = ls.clear.bind(ls);
  const isLeanshotKey = (k: string): boolean => k.startsWith('leanshot_v4');
  ls.setItem = (k: string, v: string): void => {
    if (isLeanshotKey(k)) {
      pushLog({
        kind: 'lsset',
        ts: Date.now(),
        key: k,
        sample: v.slice(0, 80),
        stack: stackOf(2),
      });
    }
    origSetItem(k, v);
  };
  ls.removeItem = (k: string): void => {
    if (isLeanshotKey(k)) {
      pushLog({ kind: 'lsremove', ts: Date.now(), key: k, stack: stackOf(2) });
    }
    origRemoveItem(k);
  };
  ls.clear = (): void => {
    pushLog({ kind: 'lsclear', ts: Date.now(), stack: stackOf(2) });
    origClear();
  };
}
