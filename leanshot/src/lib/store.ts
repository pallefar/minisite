/**
 * Zustand store + persist.
 * Single source of truth for all user data and ephemeral UI state.
 */
import type { RealtimePostgresChangesPayload, Session, User as SupabaseUser } from '@supabase/supabase-js';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { track } from '@/lib/analytics';
import { signOut as authSignOut } from '@/lib/auth';
import { flushSyncQueue } from '@/lib/sync';
import type {
  AIMessage,
  Cost,
  Injection,
  Meal,
  MoodLog,
  PendingOp,
  Photo,
  SleepLog,
  SymptomLog,
  TabId,
  User,
  Vial,
  WeightLog,
  Workout,
  Measurement,
} from '@/types';
import {
  initialState,
  migrateFromV3,
  migrateV6ToV7,
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
  toast: { message: string; kind: 'success' | 'error' | 'info'; id: number } | null;
  /**
   * Phase 5 D-13 — auth/session slice. NOT persisted via partialize: supabase-js
   * owns its own session under `sb-leanshot-auth`; we mirror only the derived
   * snapshot here so UI components can subscribe via Zustand selectors.
   */
  signedIn: SignedInSlice | null;
}

interface Actions {
  setTab: (tab: TabId) => void;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
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

  upsertWeight: (w: WeightLog) => void;
  removeWeight: (idx: number) => void;

  addMeasurement: (m: Measurement) => void;

  addMeal: (m: Meal) => void;
  removeMeal: (idx: number) => void;

  setWater: (date: string, n: number) => void;
  setFoodNoise: (date: string, n: number) => void;

  addWorkout: (w: Workout) => void;
  removeWorkout: (idx: number) => void;

  setSteps: (date: string, n: number) => void;
  bulkSetSteps: (entries: Record<string, number>) => void;
  bulkAddWeights: (entries: WeightLog[]) => void;

  toggleSupp: (date: string, id: string) => void;
  resetSuppsForDate: (date: string) => void;

  upsertMood: (m: MoodLog) => void;
  upsertSleep: (s: SleepLog) => void;

  addNSV: (text: string, date: string) => void;
  removeNSV: (idx: number) => void;

  addPhoto: (p: Photo) => void;
  removePhoto: (idx: number) => void;

  addVial: (v: Vial) => void;
  useVialDose: (idx: number) => void;
  removeVial: (idx: number) => void;

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

  // Phase 5 Plan 05-02 Task 2 — session + offline write queue + sync gate.
  setSession: (session: Session | null) => void;
  clearUserDataSlices: () => void;
  signOut: () => Promise<void>;
  enqueueOp: (op: PendingOp) => void;
  /**
   * Remove pendingOps entries whose `key` is in the supplied list AND
   * `table === 'injections'`. Called by `flushSyncQueue` (sync.ts) after a
   * successful upsert/delete batch.
   */
  dropOps: (keys: string[]) => void;
  /** D-13: cloud sync is permitted only when verified AND online. */
  isSyncEnabled: () => boolean;
  /** Phase 5 D-08 — LWW merge: server rows overwrite local on log_id conflict iff server.updated_at > local.updated_at. */
  mergeServerInjections: (serverRows: Injection[]) => void;
  /** Phase 5 D-08 / D-10 — handle Realtime postgres_changes payload (INSERT/UPDATE/DELETE). */
  applyRealtimePayload: (payload: RealtimePostgresChangesPayload<Injection>) => void;

  /** D-13: hide the EmailVerificationBanner for 24h. */
  dismissVerificationBanner: () => void;
}

export type Store = PersistedState & UIState & Actions;

let toastId = 0;

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
      currentTab: 'home',
      toast: null,
      signedIn: null,

      setTab: (tab) => {
        set({ currentTab: tab });
        track('tab_viewed', { tab });
      },
      showToast: (message, kind = 'success') => set({ toast: { message, kind, id: ++toastId } }),
      dismissToast: () => set({ toast: null }),

      setUser: (user) => set({ user }),
      updateUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
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
          const stamped: Injection = {
            ...inj,
            log_id,
            pkEngineVersion: inj.pkEngineVersion ?? 1,
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
        void flushSyncQueue();
      },
      editInjection: (logId, updates) => {
        set((s) => ({
          injections: s.injections.map((i) =>
            i.log_id === logId ? { ...i, ...updates } : i,
          ),
        }));
        get().enqueueOp({
          table: 'injections',
          op: 'upsert',
          key: logId,
          enqueuedAt: new Date().toISOString(),
        });
        void flushSyncQueue();
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
        void flushSyncQueue();
      },

      addSymptom: (sx) => set((s) => ({ symptoms: [sx, ...s.symptoms] })),

      upsertWeight: (w) =>
        set((s) => {
          const idx = s.weights.findIndex((x) => x.date === w.date);
          const next = [...s.weights];
          if (idx >= 0) next[idx] = w;
          else next.push(w);
          next.sort((a, b) => a.date.localeCompare(b.date));
          return { weights: next };
        }),
      removeWeight: (idx) => set((s) => ({ weights: s.weights.filter((_, i) => i !== idx) })),

      addMeasurement: (m) => set((s) => ({ measurements: [m, ...s.measurements] })),

      addMeal: (m) => set((s) => ({ meals: [...s.meals, m] })),
      removeMeal: (idx) => set((s) => ({ meals: s.meals.filter((_, i) => i !== idx) })),

      setWater: (date, n) =>
        set((s) => ({ water: { ...s.water, [date]: s.water[date] === n ? n - 1 : n } })),
      setFoodNoise: (date, n) => set((s) => ({ foodNoise: { ...s.foodNoise, [date]: n } })),

      addWorkout: (w) => set((s) => ({ workouts: [w, ...s.workouts] })),
      removeWorkout: (idx) => set((s) => ({ workouts: s.workouts.filter((_, i) => i !== idx) })),

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

      toggleSupp: (date, id) =>
        set((s) => {
          const day = s.supplements[date] ?? {};
          return {
            supplements: { ...s.supplements, [date]: { ...day, [id]: !day[id] } },
          };
        }),
      resetSuppsForDate: (date) => set((s) => ({ supplements: { ...s.supplements, [date]: {} } })),

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

      addNSV: (text, date) => set((s) => ({ nsvs: [{ text, date }, ...s.nsvs] })),
      removeNSV: (idx) => set((s) => ({ nsvs: s.nsvs.filter((_, i) => i !== idx) })),

      addPhoto: (p) => set((s) => ({ photos: [p, ...s.photos] })),
      removePhoto: (idx) => set((s) => ({ photos: s.photos.filter((_, i) => i !== idx) })),

      addVial: (v) => set((s) => ({ vials: [...s.vials, v] })),
      useVialDose: (idx) =>
        set((s) => ({
          vials: s.vials.map((v, i) =>
            i === idx && v.dosesUsed < v.dosesPerVial ? { ...v, dosesUsed: v.dosesUsed + 1 } : v,
          ),
        })),
      removeVial: (idx) => set((s) => ({ vials: s.vials.filter((_, i) => i !== idx) })),

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
        const verified = Boolean(
          user && !user.is_anonymous && user.email_confirmed_at != null,
        );
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
          // CONF-3: PRESERVE through signout. Device-level acknowledgment.
          acknowledgedDisclaimer: state.acknowledgedDisclaimer,
        })),

      signOut: async () => {
        const { error } = await authSignOut();
        if (error) {
          console.error('[leanshot] signOut failed', error);
          return;
        }
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

      dropOps: (keys) =>
        set((s) => ({
          pendingOps: (s.pendingOps ?? []).filter(
            (p) => !(p.table === 'injections' && keys.includes(p.key)),
          ),
        })),

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
              (remote.updated_at &&
                new Date(remote.updated_at) > new Date(local.updated_at))
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
          if (
            payload.eventType === 'INSERT' ||
            payload.eventType === 'UPDATE'
          ) {
            const remote = payload.new as Injection;
            const idx = s.injections.findIndex((i) => i.log_id === remote.log_id);
            if (idx === -1) {
              return { injections: [...s.injections, remote] };
            }
            const local = s.injections[idx]!;
            if (
              !local.updated_at ||
              (remote.updated_at &&
                new Date(remote.updated_at) > new Date(local.updated_at))
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

      dismissVerificationBanner: () => {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        set({ verificationBannerDismissedUntil: until });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
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
