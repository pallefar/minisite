/**
 * Zustand store + persist.
 * Single source of truth for all user data and ephemeral UI state.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { track } from '@/lib/analytics';
import type {
  AIMessage,
  Cost,
  Injection,
  Meal,
  MoodLog,
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
  STORAGE_KEY,
  STORAGE_VERSION,
  type PersistedState,
} from './storage';

interface UIState {
  currentTab: TabId;
  toast: { message: string; kind: 'success' | 'error' | 'info'; id: number } | null;
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
  return state;
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      ...initialState,
      currentTab: 'home',
      toast: null,

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

      addInjection: (inj) =>
        set((s) => {
          // Phase 3 D-07 / PK-05: every new injection carries the engine version
          // that produced its expected curve. Default to 1 (current 1-compartment
          // engine); explicit caller value wins so a future v1.1 engine can stamp
          // its own version without a code change here.
          const stamped: Injection = { ...inj, pkEngineVersion: inj.pkEngineVersion ?? 1 };
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
        }),
      removeInjection: (idx) =>
        set((s) => ({ injections: s.injections.filter((_, i) => i !== idx) })),

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
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only persist domain data, not transient UI flags.
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
