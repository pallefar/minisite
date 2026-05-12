/**
 * Phase 5 Plan 05-03 + Phase 6 Plan 06-03 — Sync engine.
 *
 * Phase 5 originals:
 *   - `pullInitialInjections(userId)` — explicit initial pull (Realtime
 *     postgres_changes does NOT replay history; Pitfall #5).
 *   - `subscribeInjections(userId)` — single global Realtime subscription
 *     (D-09). Idempotent.
 *   - `unsubscribeInjections()` — clean teardown.
 *   - `flushSyncQueue()` — drain `pendingOps` across all 10 tables. Upserts
 *     NEVER include `updated_at` — moddatetime trigger is server-authoritative
 *     (D-08, Critical Gotcha #11). Parameterized across every table.
 *   - `subscribeToTable<T>(tableName, userId, onPayload)` — forward-compat
 *     generic helper (also wrapped per-table internally below).
 *
 * Phase 6 06-03 additions (D-13 + D-14 + SYNC-02):
 *   - Per-table pullInitial + subscribe helpers for weights / meals / workouts
 *     / supplements / mood / sleep / symptoms / vials / settings.
 *   - `flushTableOps<TLocal>(table, pkField, mapLocalToServer)` — generic
 *     drain helper used by flushSyncQueue for the 7 mechanical mapped tables.
 *   - `flushSupplementsOps` / `flushSettingsOps` — bespoke handlers for the
 *     composite-key and singleton schemas.
 *   - `unsubscribeAll()` — iterate the per-table channel Map (06-RESEARCH §5).
 *   - `pullAndSubscribeAll(userId)` — parallel fan-out across all 10 tables.
 *
 * Server-row shapes mirror supabase/migrations/20260513000000_injections.sql
 * and supabase/migrations/2026051400000{0..8}_*.sql.
 */
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type {
  DoseUnit,
  Injection,
  InjectionSite,
  Meal,
  MoodLog,
  SleepLog,
  SymptomLog,
  Vial,
  WeightLog,
  Workout,
} from '@/types';

/** Module-level singleton channel handle. `null` while no subscription is live. */
let injectionsChannel: RealtimeChannel | null = null;

/**
 * Per-table Realtime channel Map (06-RESEARCH §5). Phase 6 needs Map
 * iteration for `unsubscribeAll`. The injections channel is kept on its
 * own module-level handle for back-compat with Phase 5 callers.
 */
const tableChannels = new Map<string, RealtimeChannel>();

// ---------------------------------------------------------------------------
// Phase 5 Injections — server-row shape + mapper
// ---------------------------------------------------------------------------

interface ServerInjection {
  user_id: string;
  log_id: string;
  medication: string;
  dose: string;
  unit: string;
  site: string | null;
  notes: string;
  logged_at: string;
  pk_engine_version: number;
  created_at?: string;
  updated_at: string;
}

function mapServerInjectionToLocal(row: ServerInjection): Injection {
  return {
    log_id: row.log_id,
    datetime: row.logged_at,
    dose: row.dose,
    unit: row.unit as DoseUnit,
    site: (row.site ?? null) as InjectionSite | null,
    notes: row.notes,
    pkEngineVersion: row.pk_engine_version ?? 1,
    updated_at: row.updated_at,
    user_id: row.user_id,
  };
}

// ---------------------------------------------------------------------------
// Phase 6 — per-table server-row shapes + mappers
// ---------------------------------------------------------------------------

interface ServerWeight {
  user_id: string;
  weight_id: string;
  date: string;
  weight: number;
  body_fat: number | null;
  ts: number;
  updated_at?: string;
}

interface ServerMeal {
  user_id: string;
  meal_id: string;
  date: string;
  name: string;
  calories: number;
  protein: number;
  fiber: number;
  hunger: number | null;
  satisfaction: number | null;
  ts: number;
  updated_at?: string;
}

interface ServerWorkout {
  user_id: string;
  workout_id: string;
  date: string;
  type: string;
  name: string;
  minutes: number;
  rpe: number | null;
  notes: string;
  updated_at?: string;
}

interface ServerMood {
  user_id: string;
  mood_id: string;
  date: string;
  mood: number;
  energy: number | null;
  notes: string;
  updated_at?: string;
}

interface ServerSleep {
  user_id: string;
  sleep_id: string;
  date: string;
  hours: number;
  wakings: number;
  quality: number | null;
  notes: string;
  updated_at?: string;
}

interface ServerSymptom {
  user_id: string;
  symptom_id: string;
  date: string;
  symptom: string;
  severity: number;
  notes: string;
  updated_at?: string;
}

interface ServerVial {
  user_id: string;
  vial_id: string;
  name: string;
  doses_per_vial: number;
  doses_used: number;
  start_date: string;
  expiration_date: string;
  updated_at?: string;
}

interface ServerSupplement {
  user_id: string;
  date: string;
  supplement_name: string;
  taken: boolean;
  updated_at?: string;
}

interface ServerSettings {
  user_id: string;
  payload: Record<string, unknown>;
  updated_at?: string;
}

/**
 * Local-to-server mappers. For most tables the camelCase ↔ snake_case rename
 * is minimal (just `body_fat` ↔ `bodyFat`, `doses_per_vial` ↔ `dosesPerVial`,
 * `start_date` ↔ `startDate`, `expiration_date` ↔ `expirationDate`). The
 * primary-key field is left to the caller — flushTableOps constructs the row
 * with `user_id` + PK from the local row's pk field name.
 *
 * Each mapper returns a Record WITHOUT `updated_at` so the upsert payload
 * stays server-authoritative (Critical Gotcha #11). The PK field is included
 * because flushTableOps reads it generically.
 */
function mapWeightLocalToServer(w: WeightLog & { weight_id?: string }): Record<string, unknown> {
  return {
    weight_id: w.weight_id,
    date: w.date,
    weight: w.weight,
    body_fat: w.bodyFat,
    ts: w.ts,
  };
}

function mapMealLocalToServer(m: Meal & { meal_id?: string }): Record<string, unknown> {
  return {
    meal_id: m.meal_id,
    date: m.date,
    name: m.name,
    calories: m.calories,
    protein: m.protein,
    fiber: m.fiber,
    hunger: m.hunger,
    satisfaction: m.satisfaction,
    ts: m.ts,
  };
}

function mapWorkoutLocalToServer(w: Workout & { workout_id?: string }): Record<string, unknown> {
  return {
    workout_id: w.workout_id,
    date: w.date,
    type: w.type,
    name: w.name,
    minutes: w.minutes,
    rpe: w.rpe,
    notes: w.notes,
  };
}

function mapMoodLocalToServer(m: MoodLog & { mood_id?: string }): Record<string, unknown> {
  return {
    mood_id: m.mood_id,
    date: m.date,
    mood: m.mood,
    energy: m.energy,
    notes: m.notes,
  };
}

function mapSleepLocalToServer(s: SleepLog & { sleep_id?: string }): Record<string, unknown> {
  return {
    sleep_id: s.sleep_id,
    date: s.date,
    hours: s.hours,
    wakings: s.wakings,
    quality: s.quality,
    notes: s.notes,
  };
}

function mapSymptomLocalToServer(
  s: SymptomLog & { symptom_id?: string },
): Record<string, unknown> {
  return {
    symptom_id: s.symptom_id,
    date: s.date,
    symptom: s.symptom,
    severity: s.severity,
    notes: s.notes,
  };
}

function mapVialLocalToServer(v: Vial & { vial_id?: string }): Record<string, unknown> {
  return {
    vial_id: v.vial_id,
    name: v.name,
    doses_per_vial: v.dosesPerVial,
    doses_used: v.dosesUsed,
    start_date: v.startDate,
    expiration_date: v.expirationDate,
  };
}

// Server-to-local mappers (used by pullInitial + Realtime payload handlers).

function mapServerWeightToLocal(r: ServerWeight): WeightLog & { weight_id: string; updated_at?: string; user_id?: string } {
  return {
    weight_id: r.weight_id,
    date: r.date,
    weight: r.weight,
    bodyFat: r.body_fat,
    ts: r.ts,
    updated_at: r.updated_at,
    user_id: r.user_id,
  };
}

function mapServerMealToLocal(r: ServerMeal): Meal & { meal_id: string; updated_at?: string; user_id?: string } {
  return {
    meal_id: r.meal_id,
    date: r.date,
    name: r.name,
    calories: r.calories,
    protein: r.protein,
    fiber: r.fiber,
    hunger: r.hunger,
    satisfaction: r.satisfaction,
    ts: r.ts,
    updated_at: r.updated_at,
    user_id: r.user_id,
  };
}

function mapServerWorkoutToLocal(r: ServerWorkout): Workout & { workout_id: string; updated_at?: string; user_id?: string } {
  return {
    workout_id: r.workout_id,
    date: r.date,
    type: r.type as Workout['type'],
    name: r.name,
    minutes: r.minutes,
    rpe: r.rpe,
    notes: r.notes,
    updated_at: r.updated_at,
    user_id: r.user_id,
  };
}

function mapServerMoodToLocal(r: ServerMood): MoodLog & { mood_id: string; updated_at?: string; user_id?: string } {
  return {
    mood_id: r.mood_id,
    date: r.date,
    mood: r.mood as MoodLog['mood'],
    energy: r.energy,
    notes: r.notes,
    updated_at: r.updated_at,
    user_id: r.user_id,
  };
}

function mapServerSleepToLocal(r: ServerSleep): SleepLog & { sleep_id: string; updated_at?: string; user_id?: string } {
  return {
    sleep_id: r.sleep_id,
    date: r.date,
    hours: r.hours,
    wakings: r.wakings,
    quality: r.quality,
    notes: r.notes,
    updated_at: r.updated_at,
    user_id: r.user_id,
  };
}

function mapServerSymptomToLocal(r: ServerSymptom): SymptomLog & { symptom_id: string; updated_at?: string; user_id?: string } {
  return {
    symptom_id: r.symptom_id,
    date: r.date,
    symptom: r.symptom,
    severity: r.severity as SymptomLog['severity'],
    notes: r.notes,
    updated_at: r.updated_at,
    user_id: r.user_id,
  };
}

function mapServerVialToLocal(r: ServerVial): Vial & { vial_id: string; updated_at?: string; user_id?: string } {
  return {
    vial_id: r.vial_id,
    name: r.name,
    dosesPerVial: r.doses_per_vial,
    dosesUsed: r.doses_used,
    startDate: r.start_date,
    expirationDate: r.expiration_date,
    updated_at: r.updated_at,
    user_id: r.user_id,
  };
}

// ---------------------------------------------------------------------------
// pullInitialInjections (Phase 5 — unchanged)
// ---------------------------------------------------------------------------

export async function pullInitialInjections(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('injections')
    .select('*')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false });
  if (error) {
    console.error('[leanshot] pullInitial failed', error);
    return;
  }
  const rows = (data ?? []) as ServerInjection[];
  const mapped = rows.map(mapServerInjectionToLocal);
  useStore.getState().mergeServerInjections(mapped);
}

// ---------------------------------------------------------------------------
// Phase 6 — per-table pullInitial helpers
// ---------------------------------------------------------------------------

async function pullInitialGeneric<TServer, TLocal>(
  tableName: string,
  userId: string,
  orderBy: string,
  mapper: (row: TServer) => TLocal,
  applier: (rows: TLocal[]) => void,
): Promise<void> {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('user_id', userId)
    .order(orderBy, { ascending: false });
  if (error) {
    console.error(`[leanshot] pullInitial(${tableName}) failed`, error);
    return;
  }
  const rows = (data ?? []) as TServer[];
  applier(rows.map(mapper));
}

export function pullInitialWeights(userId: string): Promise<void> {
  return pullInitialGeneric<ServerWeight, ReturnType<typeof mapServerWeightToLocal>>(
    'weights',
    userId,
    'date',
    mapServerWeightToLocal,
    (rows) => useStore.getState().mergeServerWeights(rows),
  );
}

export function pullInitialMeals(userId: string): Promise<void> {
  return pullInitialGeneric<ServerMeal, ReturnType<typeof mapServerMealToLocal>>(
    'meals',
    userId,
    'date',
    mapServerMealToLocal,
    (rows) => useStore.getState().mergeServerMeals(rows),
  );
}

export function pullInitialWorkouts(userId: string): Promise<void> {
  return pullInitialGeneric<ServerWorkout, ReturnType<typeof mapServerWorkoutToLocal>>(
    'workouts',
    userId,
    'date',
    mapServerWorkoutToLocal,
    (rows) => useStore.getState().mergeServerWorkouts(rows),
  );
}

export function pullInitialMood(userId: string): Promise<void> {
  return pullInitialGeneric<ServerMood, ReturnType<typeof mapServerMoodToLocal>>(
    'mood',
    userId,
    'date',
    mapServerMoodToLocal,
    (rows) => useStore.getState().mergeServerMood(rows),
  );
}

export function pullInitialSleep(userId: string): Promise<void> {
  return pullInitialGeneric<ServerSleep, ReturnType<typeof mapServerSleepToLocal>>(
    'sleep',
    userId,
    'date',
    mapServerSleepToLocal,
    (rows) => useStore.getState().mergeServerSleep(rows),
  );
}

export function pullInitialSymptoms(userId: string): Promise<void> {
  return pullInitialGeneric<ServerSymptom, ReturnType<typeof mapServerSymptomToLocal>>(
    'symptoms',
    userId,
    'date',
    mapServerSymptomToLocal,
    (rows) => useStore.getState().mergeServerSymptoms(rows),
  );
}

export function pullInitialVials(userId: string): Promise<void> {
  return pullInitialGeneric<ServerVial, ReturnType<typeof mapServerVialToLocal>>(
    'vials',
    userId,
    'start_date',
    mapServerVialToLocal,
    (rows) => useStore.getState().mergeServerVials(rows),
  );
}

export async function pullInitialSupplements(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('supplements')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    console.error('[leanshot] pullInitial(supplements) failed', error);
    return;
  }
  const rows = (data ?? []) as ServerSupplement[];
  useStore.getState().mergeServerSupplements(rows);
}

export async function pullInitialSettings(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[leanshot] pullInitial(settings) failed', error);
    return;
  }
  if (data) {
    useStore.getState().mergeServerSettings(data as ServerSettings);
  }
}

// ---------------------------------------------------------------------------
// subscribeInjections / unsubscribeInjections (Phase 5 — unchanged)
// ---------------------------------------------------------------------------

export function subscribeInjections(userId: string): void {
  if (injectionsChannel) return;
  injectionsChannel = supabase
    .channel(`injections:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'injections',
        filter: `user_id=eq.${userId}`,
      },
      (payload: RealtimePostgresChangesPayload<ServerInjection>) => {
        const mapped: RealtimePostgresChangesPayload<Injection> = {
          ...payload,
          new:
            payload.new && Object.keys(payload.new).length > 0
              ? (mapServerInjectionToLocal(payload.new as ServerInjection) as never)
              : (payload.new as never),
          old: payload.old as never,
        };
        useStore.getState().applyRealtimePayload(mapped);
      },
    )
    .subscribe((status: string) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[leanshot] injections channel error', status);
      }
    });
}

export async function unsubscribeInjections(): Promise<void> {
  if (!injectionsChannel) return;
  await supabase.removeChannel(injectionsChannel);
  injectionsChannel = null;
}

// ---------------------------------------------------------------------------
// Phase 6 — per-table subscribe helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subscribeMappedTable<TServer, TLocal extends { [key: string]: any }>(
  tableName: string,
  userId: string,
  mapper: (row: TServer) => TLocal,
  applier: (payload: RealtimePostgresChangesPayload<TLocal>) => void,
): void {
  if (tableChannels.has(tableName)) return;
  // Cast through `any` for the postgres_changes overload — supabase-js's
  // type-narrowed `.on()` overload doesn't infer the string literal cleanly
  // here. Same pattern is used by subscribeInjections.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ch = (supabase.channel(`${tableName}:${userId}`) as any)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: tableName,
        filter: `user_id=eq.${userId}`,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        const mapped = {
          ...payload,
          new:
            payload.new && Object.keys(payload.new).length > 0
              ? mapper(payload.new as TServer)
              : payload.new,
          old: payload.old,
        } as RealtimePostgresChangesPayload<TLocal>;
        applier(mapped);
      },
    )
    .subscribe();
  tableChannels.set(tableName, ch);
}

export function subscribeWeights(userId: string): void {
  subscribeMappedTable<ServerWeight, ReturnType<typeof mapServerWeightToLocal>>(
    'weights',
    userId,
    mapServerWeightToLocal,
    (p) => useStore.getState().applyWeightRealtimePayload(p),
  );
}

export function subscribeMeals(userId: string): void {
  subscribeMappedTable<ServerMeal, ReturnType<typeof mapServerMealToLocal>>(
    'meals',
    userId,
    mapServerMealToLocal,
    (p) => useStore.getState().applyMealRealtimePayload(p),
  );
}

export function subscribeWorkouts(userId: string): void {
  subscribeMappedTable<ServerWorkout, ReturnType<typeof mapServerWorkoutToLocal>>(
    'workouts',
    userId,
    mapServerWorkoutToLocal,
    (p) => useStore.getState().applyWorkoutRealtimePayload(p),
  );
}

export function subscribeMood(userId: string): void {
  subscribeMappedTable<ServerMood, ReturnType<typeof mapServerMoodToLocal>>(
    'mood',
    userId,
    mapServerMoodToLocal,
    (p) => useStore.getState().applyMoodRealtimePayload(p),
  );
}

export function subscribeSleep(userId: string): void {
  subscribeMappedTable<ServerSleep, ReturnType<typeof mapServerSleepToLocal>>(
    'sleep',
    userId,
    mapServerSleepToLocal,
    (p) => useStore.getState().applySleepRealtimePayload(p),
  );
}

export function subscribeSymptoms(userId: string): void {
  subscribeMappedTable<ServerSymptom, ReturnType<typeof mapServerSymptomToLocal>>(
    'symptoms',
    userId,
    mapServerSymptomToLocal,
    (p) => useStore.getState().applySymptomRealtimePayload(p),
  );
}

export function subscribeVials(userId: string): void {
  subscribeMappedTable<ServerVial, ReturnType<typeof mapServerVialToLocal>>(
    'vials',
    userId,
    mapServerVialToLocal,
    (p) => useStore.getState().applyVialRealtimePayload(p),
  );
}

export function subscribeSupplements(userId: string): void {
  if (tableChannels.has('supplements')) return;
  const ch = supabase
    .channel(`supplements:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'supplements',
        filter: `user_id=eq.${userId}`,
      },
      (payload: RealtimePostgresChangesPayload<ServerSupplement>) => {
        useStore.getState().applySupplementRealtimePayload(payload);
      },
    )
    .subscribe();
  tableChannels.set('supplements', ch);
}

export function subscribeSettings(userId: string): void {
  if (tableChannels.has('settings')) return;
  const ch = supabase
    .channel(`settings:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'settings',
        filter: `user_id=eq.${userId}`,
      },
      (payload: RealtimePostgresChangesPayload<ServerSettings>) => {
        useStore.getState().applySettingsRealtimePayload(payload);
      },
    )
    .subscribe();
  tableChannels.set('settings', ch);
}

/**
 * Tear down ALL Realtime channels (Phase 5 injections + Phase 6 × 9). Called
 * by sync-defer's onSignedOut drain.
 */
export async function unsubscribeAll(): Promise<void> {
  for (const [, ch] of tableChannels) {
    await supabase.removeChannel(ch);
  }
  tableChannels.clear();
  await unsubscribeInjections();
}

/**
 * Initial fan-out: pull then subscribe across all 10 tables in parallel.
 * Each per-table pair runs sequentially to preserve Pitfall #5 ordering
 * (pull BEFORE subscribe), but the 10 pairs run in parallel via Promise.all.
 */
export async function pullAndSubscribeAll(userId: string): Promise<void> {
  await Promise.all([
    (async () => {
      await pullInitialInjections(userId);
      subscribeInjections(userId);
    })(),
    (async () => {
      await pullInitialWeights(userId);
      subscribeWeights(userId);
    })(),
    (async () => {
      await pullInitialMeals(userId);
      subscribeMeals(userId);
    })(),
    (async () => {
      await pullInitialWorkouts(userId);
      subscribeWorkouts(userId);
    })(),
    (async () => {
      await pullInitialSupplements(userId);
      subscribeSupplements(userId);
    })(),
    (async () => {
      await pullInitialMood(userId);
      subscribeMood(userId);
    })(),
    (async () => {
      await pullInitialSleep(userId);
      subscribeSleep(userId);
    })(),
    (async () => {
      await pullInitialSymptoms(userId);
      subscribeSymptoms(userId);
    })(),
    (async () => {
      await pullInitialVials(userId);
      subscribeVials(userId);
    })(),
    (async () => {
      await pullInitialSettings(userId);
      subscribeSettings(userId);
    })(),
  ]);
}

// ---------------------------------------------------------------------------
// flushSyncQueue (Phase 5 + Phase 6) — parameterized across all 10 tables
// ---------------------------------------------------------------------------

interface FlushableState {
  signedIn: { user: { id: string } | null } | null;
  user: { medication?: string } | null;
  injections: Injection[];
  pendingOps: Array<{ table: string; op: 'upsert' | 'delete'; key: string }>;
  isSyncEnabled: () => boolean;
  dropOps: (keys: string[], table?: string) => void;
}

export async function flushSyncQueue(): Promise<void> {
  const state = useStore.getState() as unknown as FlushableState;
  if (!state.isSyncEnabled()) return;
  const uid = state.signedIn?.user?.id;
  if (!uid) return;

  // Phase 5 injections branch (unchanged for back-compat — Phase 5 tests
  // assert this exact shape).
  await flushInjections();

  // Phase 6 — 7 mechanical tables via generic flushTableOps. Mappers are
  // typed against their entity shape; the generic accepts any record-shape
  // local so we cast through `unknown` to satisfy the signature.
  type AnyMapper = (l: Record<string, unknown>) => Record<string, unknown>;
  await flushTableOps('weights', 'weight_id', mapWeightLocalToServer as unknown as AnyMapper);
  await flushTableOps('meals', 'meal_id', mapMealLocalToServer as unknown as AnyMapper);
  await flushTableOps('workouts', 'workout_id', mapWorkoutLocalToServer as unknown as AnyMapper);
  await flushTableOps('mood', 'mood_id', mapMoodLocalToServer as unknown as AnyMapper);
  await flushTableOps('sleep', 'sleep_id', mapSleepLocalToServer as unknown as AnyMapper);
  await flushTableOps('symptoms', 'symptom_id', mapSymptomLocalToServer as unknown as AnyMapper);
  await flushTableOps('vials', 'vial_id', mapVialLocalToServer as unknown as AnyMapper);

  // Phase 6 — bespoke composite-key + singleton handlers.
  await flushSupplementsOps();
  await flushSettingsOps();
}

/**
 * Phase 5 injections drain — unchanged shape so the 22 sync.test.ts
 * assertions continue to pass verbatim.
 */
async function flushInjections(): Promise<void> {
  const state = useStore.getState() as unknown as FlushableState;
  const uid = state.signedIn?.user?.id;
  if (!uid) return;

  const injectionOps = (state.pendingOps ?? []).filter((op) => op.table === 'injections');
  if (injectionOps.length === 0) return;

  const upsertKeys = injectionOps.filter((o) => o.op === 'upsert').map((o) => o.key);
  const deleteKeys = injectionOps.filter((o) => o.op === 'delete').map((o) => o.key);

  if (upsertKeys.length > 0) {
    const userMedication = state.user?.medication ?? 'unknown';
    const matching = state.injections.filter((i) => upsertKeys.includes(i.log_id));
    const successfulKeys: string[] = [];
    if (matching.length === 0) {
      state.dropOps(upsertKeys);
    } else {
      const rows = matching.map((r) => ({
        user_id: uid,
        log_id: r.log_id,
        medication: userMedication,
        dose: r.dose,
        unit: r.unit,
        site: r.site,
        notes: r.notes,
        logged_at: r.datetime,
        pk_engine_version: r.pkEngineVersion ?? 1,
        // INTENTIONALLY OMITTING updated_at — server moddatetime trigger sets per D-08.
      }));
      const { error } = await supabase
        .from('injections')
        .upsert(rows, { onConflict: 'user_id,log_id' });
      if (error) {
        if (isPermanent4xx(error)) {
          console.error('[leanshot] sync-permanent-error (upsert)', error);
          state.dropOps(upsertKeys);
        } else {
          console.warn('[leanshot] flushSyncQueue upsert transient error', error);
        }
      } else {
        successfulKeys.push(...rows.map((r) => r.log_id));
        state.dropOps(successfulKeys);
      }
    }
  }

  if (deleteKeys.length > 0) {
    const { error } = await supabase
      .from('injections')
      .delete()
      .eq('user_id', uid)
      .in('log_id', deleteKeys);
    if (error) {
      if (isPermanent4xx(error)) {
        console.error('[leanshot] sync-permanent-error (delete)', error);
        state.dropOps(deleteKeys);
      } else {
        console.warn('[leanshot] flushSyncQueue delete transient error', error);
      }
    } else {
      state.dropOps(deleteKeys);
    }
  }
}

/**
 * Phase 6 — generic per-table drain helper. Reads pendingOps filtered by
 * tableName, splits upsert/delete, and dispatches Supabase calls with the
 * appropriate onConflict signature. Upsert payloads NEVER include
 * `updated_at` (Critical Gotcha #11).
 *
 * The local row list is read from `state[tableName]` via the dynamic key
 * (TypeScript narrowing crossed via the FlushableStateWithTables cast).
 */
async function flushTableOps<TLocal extends Record<string, unknown>>(
  tableName: string,
  primaryKeyField: string,
  mapLocalToServer: (local: TLocal) => Record<string, unknown>,
): Promise<void> {
  const state = useStore.getState() as unknown as FlushableState & Record<string, unknown>;
  if (!state.isSyncEnabled()) return;
  const uid = state.signedIn?.user?.id;
  if (!uid) return;

  const ops = (state.pendingOps ?? []).filter((op) => op.table === tableName);
  if (ops.length === 0) return;

  const upsertOps = ops.filter((o) => o.op === 'upsert');
  const deleteOps = ops.filter((o) => o.op === 'delete');

  if (upsertOps.length > 0) {
    const localRows = (state[tableName] ?? []) as TLocal[];
    const upsertKeySet = new Set(upsertOps.map((o) => o.key));
    const matching = localRows.filter((r) =>
      upsertKeySet.has(String((r as Record<string, unknown>)[primaryKeyField] ?? '')),
    );
    if (matching.length === 0) {
      // Local rows for these keys were deleted while queued — drop ops.
      state.dropOps(
        upsertOps.map((o) => o.key),
        tableName,
      );
    } else {
      const rows = matching.map((r) => ({
        user_id: uid,
        ...mapLocalToServer(r),
        // INTENTIONALLY OMITTING updated_at — server moddatetime trigger sets per D-08.
      }));
      const { error } = await supabase.from(tableName).upsert(rows, {
        onConflict: `user_id,${primaryKeyField}`,
      });
      if (error) {
        if (isPermanent4xx(error)) {
          console.error(`[leanshot] sync-permanent-error (${tableName} upsert)`, error);
          state.dropOps(upsertOps.map((o) => o.key), tableName);
        } else {
          console.warn(`[leanshot] flushTableOps(${tableName}) upsert transient error`, error);
        }
      } else {
        state.dropOps(matching.map((r) => String((r as Record<string, unknown>)[primaryKeyField])), tableName);
      }
    }
  }

  if (deleteOps.length > 0) {
    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq('user_id', uid)
      .in(primaryKeyField, deleteOps.map((o) => o.key));
    if (error) {
      if (isPermanent4xx(error)) {
        console.error(`[leanshot] sync-permanent-error (${tableName} delete)`, error);
        state.dropOps(deleteOps.map((o) => o.key), tableName);
      } else {
        console.warn(`[leanshot] flushTableOps(${tableName}) delete transient error`, error);
      }
    } else {
      state.dropOps(deleteOps.map((o) => o.key), tableName);
    }
  }
}

/**
 * Supplements drain — composite key `(user_id, date, supplement_name)` via
 * the `date:name` colon-encoded op.key from store.toggleSupp.
 *
 * Upsert payload NEVER includes `updated_at` (Critical Gotcha #11).
 */
async function flushSupplementsOps(): Promise<void> {
  const state = useStore.getState() as unknown as FlushableState & {
    supplements: Record<string, Record<string, boolean>>;
  };
  if (!state.isSyncEnabled()) return;
  const uid = state.signedIn?.user?.id;
  if (!uid) return;

  const ops = (state.pendingOps ?? []).filter((op) => op.table === 'supplements');
  if (ops.length === 0) return;

  const upsertOps = ops.filter((o) => o.op === 'upsert');
  const deleteOps = ops.filter((o) => o.op === 'delete');

  if (upsertOps.length > 0) {
    const rows: Record<string, unknown>[] = [];
    const successKeys: string[] = [];
    for (const op of upsertOps) {
      const [date, name] = op.key.split(':');
      if (!date || !name) continue;
      const taken = Boolean(state.supplements?.[date]?.[name]);
      if (!taken) continue; // Option A: skip falsy rows (un-toggled supplements)
      rows.push({
        user_id: uid,
        date,
        supplement_name: name,
        taken: true,
        // INTENTIONALLY OMITTING updated_at — server moddatetime trigger sets per D-08.
      });
      successKeys.push(op.key);
    }
    // Always drain the op queue — any upsertOps that had taken=false locally
    // are converted to a delete branch below.
    const droppedFromConversion = upsertOps
      .filter((o) => !successKeys.includes(o.key))
      .map((o) => o.key);

    if (rows.length > 0) {
      const { error } = await supabase
        .from('supplements')
        .upsert(rows, { onConflict: 'user_id,date,supplement_name' });
      if (error) {
        if (isPermanent4xx(error)) {
          console.error('[leanshot] sync-permanent-error (supplements upsert)', error);
          state.dropOps(successKeys, 'supplements');
        } else {
          console.warn('[leanshot] flushSupplementsOps upsert transient error', error);
        }
      } else {
        state.dropOps(successKeys, 'supplements');
      }
    }

    // For taken=false rows, convert to delete and drop the op (the user
    // un-toggled — Option A semantics).
    if (droppedFromConversion.length > 0) {
      for (const key of droppedFromConversion) {
        const [date, name] = key.split(':');
        if (!date || !name) continue;
        await supabase
          .from('supplements')
          .delete()
          .eq('user_id', uid)
          .eq('date', date)
          .eq('supplement_name', name);
      }
      state.dropOps(droppedFromConversion, 'supplements');
    }
  }

  if (deleteOps.length > 0) {
    const successKeys: string[] = [];
    for (const op of deleteOps) {
      const [date, name] = op.key.split(':');
      if (!date || !name) continue;
      const { error } = await supabase
        .from('supplements')
        .delete()
        .eq('user_id', uid)
        .eq('date', date)
        .eq('supplement_name', name);
      if (error) {
        if (isPermanent4xx(error)) {
          console.error('[leanshot] sync-permanent-error (supplements delete)', error);
          successKeys.push(op.key);
        } else {
          console.warn('[leanshot] flushSupplementsOps delete transient error', error);
        }
      } else {
        successKeys.push(op.key);
      }
    }
    if (successKeys.length > 0) {
      state.dropOps(successKeys, 'supplements');
    }
  }
}

/**
 * Settings singleton drain — one row per user, upsert via `onConflict='user_id'`.
 *
 * Upsert payload NEVER includes `updated_at` (Critical Gotcha #11).
 */
async function flushSettingsOps(): Promise<void> {
  const state = useStore.getState() as unknown as FlushableState & {
    user: { medication?: string } | null;
  };
  if (!state.isSyncEnabled()) return;
  const uid = state.signedIn?.user?.id;
  if (!uid) return;

  const ops = (state.pendingOps ?? []).filter((op) => op.table === 'settings');
  if (ops.length === 0) return;

  const upsertOps = ops.filter((o) => o.op === 'upsert');
  // Settings deletes are not emitted in normal flow (D-13 — no DELETE policy).
  // If one shows up we drop it silently.
  const deleteOps = ops.filter((o) => o.op === 'delete');
  if (deleteOps.length > 0) {
    state.dropOps(deleteOps.map((o) => o.key), 'settings');
  }

  if (upsertOps.length === 0) return;

  const payload = (state.user ?? {}) as Record<string, unknown>;
  const { error } = await supabase.from('settings').upsert(
    [
      {
        user_id: uid,
        payload,
        // INTENTIONALLY OMITTING updated_at — server moddatetime trigger sets per D-08.
      },
    ],
    { onConflict: 'user_id' },
  );
  if (error) {
    if (isPermanent4xx(error)) {
      console.error('[leanshot] sync-permanent-error (settings upsert)', error);
      state.dropOps(upsertOps.map((o) => o.key), 'settings');
    } else {
      console.warn('[leanshot] flushSettingsOps upsert transient error', error);
    }
  } else {
    state.dropOps(upsertOps.map((o) => o.key), 'settings');
  }
}

function isPermanent4xx(err: unknown): boolean {
  const e = err as { code?: string | number; status?: number };
  const code = String(e?.code ?? e?.status ?? '');
  if (code === '429') return false;
  return /^4\d\d$/.test(code);
}

// ---------------------------------------------------------------------------
// subscribeToTable<T> — generic helper retained for direct callers
// ---------------------------------------------------------------------------

export function subscribeToTable<T extends Record<string, unknown> = Record<string, unknown>>(
  tableName: string,
  userId: string,
  onPayload: (p: RealtimePostgresChangesPayload<T>) => void,
): RealtimeChannel {
  return supabase
    .channel(`${tableName}:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: tableName,
        filter: `user_id=eq.${userId}`,
      },
      onPayload,
    )
    .subscribe();
}
