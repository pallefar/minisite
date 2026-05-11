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
// D-07 (Phase 3): bumped 5 → 6 so persist `migrate` back-stamps existing
// injections with pkEngineVersion: 1 (PK-05). Do NOT rename STORAGE_KEY —
// that is the localStorage key, not the schema version.
export const STORAGE_VERSION = 6;
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

