/**
 * Zustand store + persist.
 * Single source of truth for all user data and ephemeral UI state.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
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

export const useStore = create<Store>()(
  persist(
    (set) => ({
      ...initialState,
      currentTab: 'home',
      toast: null,

      setTab: (tab) => set({ currentTab: tab }),
      showToast: (message, kind = 'success') => set({ toast: { message, kind, id: ++toastId } }),
      dismissToast: () => set({ toast: null }),

      setUser: (user) => set({ user }),
      updateUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
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
          const injections = [inj, ...s.injections];
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
      }),
      migrate: (persistedState, version) => {
        // First boot of v2 with v3 data sitting around.
        if (!persistedState && version < STORAGE_VERSION) {
          const v3 = migrateFromV3();
          if (v3) return { ...initialState, ...v3 };
          return { ...initialState };
        }
        return persistedState as PersistedState;
      },
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
        useStore.setState((s) => ({ ...s, ...v3 }));
        // Manually persist a snapshot so subsequent loads find v4.
        useStore.persist.rehydrate();
      }
    }
  } catch (e) {
    console.error('[leanshot] hydrate failed', e);
  }
  return useStore.persist.rehydrate() as Promise<void>;
};
