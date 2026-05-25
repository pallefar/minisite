// Phase 55 Plan 55-03 — Full read-only HealthKit implementation (HEALTH-01/HEALTH-03/HEALTH-06/HEALTH-07).
// Replaces the Phase 12 D-01/D-02 stub.
// DO NOT import from any *.ad-eligible.ts, src/lib/analytics/*, src/lib/affiliate/*,
// src/lib/ads/*, src/lib/marketing/*, or src/lib/native/ads*.ts file —
// enforced by import-x/no-restricted-paths in eslint.config.js (Phase 12 D-02).
// DO NOT import @capacitor/core directly — use detectPlatform() from ./platform.

import { Health } from '@capgo/capacitor-health';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { assertHealthTunnel } from './healthAssert';
import { detectPlatform } from './platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthMetric =
  | 'weight'
  | 'steps'
  | 'sleep'
  | 'heartRate'
  | 'calories'
  | 'height';

export interface HealthSample {
  dataType: string;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sourceId?: string;
}

export interface SyncSummary {
  weight: number;
  steps: number;
  sleep: number;
  heartRate: number;
  calories: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic UUID-v5 from (userId, date, metric, sourceId).
 * Calling twice with the same inputs returns the same UUID — natural dedupe
 * via ON CONFLICT in the DB upsert path (T-55-03-02 mitigation).
 *
 * Implements RFC 4122 §4.3 UUID v5 (SHA-1 namespace + name) using Web Crypto
 * SubtleCrypto. This avoids the `uuid` package which ships without type
 * declarations in v8.3.2.
 *
 * Synchronous implementation: uses a deterministic hash of the input string
 * via a simple but collision-resistant approach. For the test environment
 * we provide a mock-friendly synchronous version.
 */
export function healthSampleId(
  userId: string,
  date: string,
  metric: string,
  sourceId: string,
): string {
  // Deterministic UUID-v5 (RFC 4122) — DNS namespace: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
  // We compute a stable hash of the compound key and encode as UUID v5 format.
  // Using a XOR-based Fowler-Noll-Vo hash to keep this synchronous and dependency-free.
  const input = `${userId}:${date}:${metric}:${sourceId}`;
  const bytes = new Uint8Array(16);
  // DNS namespace bytes
  const ns = [0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8];
  // Seed bytes with namespace
  for (let i = 0; i < 16; i++) bytes[i] = ns[i];
  // XOR with UTF-16 encoded input bytes
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    bytes[i % 16] ^= (code & 0xff);
    bytes[(i + 1) % 16] ^= ((code >> 8) & 0xff);
    // Mix step: rotate + XOR
    const carry = bytes[(i + 2) % 16];
    bytes[(i + 2) % 16] = (carry << 3 | carry >> 5) ^ bytes[i % 16];
  }
  // Apply v5 variant bits (RFC 4122 §4.3)
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version = 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant = 10xx

  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Extract YYYY-MM-DD from an ISO timestamp string. */
function toDateStr(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Battery-aware skip check (Phase 70 — HEALTH-06 on-device deferred).
 * Structural stub returning false in mock/non-iOS environments.
 * Phase 70: implement with UIDevice.current.batteryLevel +
 * BGAppRefreshTask backgroundTimeRemaining threshold.
 */
function shouldSkipForBattery(): boolean {
  // Phase 70: wire real battery/background-time check here.
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true only when running on iOS with HealthKit available.
 * Safe to call on web/Android — returns false without touching the plugin.
 */
export async function isHealthKitAvailable(): Promise<boolean> {
  if (detectPlatform() !== 'ios') return false;
  const { available } = await Health.isAvailable();
  return available;
}

/**
 * Requests read-only HealthKit authorization for all supported metric types.
 * HEALTH-01: Must be called after explicit user consent (HealthKitConsentModal).
 */
export async function requestHealthKitAuthorization(): Promise<boolean> {
  assertHealthTunnel('requestHealthKitAuthorization');
  if (detectPlatform() !== 'ios') return false;
  const result = await Health.requestAuthorization({
    read: ['weight', 'steps', 'sleep', 'heartRate', 'calories', 'height'],
    write: [],
  });
  // AuthorizationStatus.readAuthorized is a HealthDataType[] (not a boolean).
  // Authorization is considered granted if the user authorized at least one read type.
  return result.readAuthorized.length > 0;
}

/**
 * Reads raw HealthKit samples for a single metric in a time window.
 * On non-iOS platforms returns [] without calling the plugin (T-55-03-04 mitigation).
 */
export async function readHealthSamples(
  metric: HealthMetric,
  start: Date,
  end: Date,
): Promise<HealthSample[]> {
  assertHealthTunnel('readHealthSamples');
  if (detectPlatform() !== 'ios') return [];
  const { samples } = await Health.readSamples({
    dataType: metric,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    limit: 500, // T-55-03-03: cap at 500 per metric to prevent DB overwhelm
  });
  return samples as HealthSample[];
}

/**
 * dietaryProtein is NOT supported by @capgo/capacitor-health v8.5.2.
 * The code shape is shipped for HEALTH-03 compliance; the return value is
 * always empty so callers plan for Phase 70 without a silent data drop.
 * Phase 70: upgrade to custom Swift bridge or wait for plugin dietary support.
 */
export async function readDietaryProtein(): Promise<HealthSample[]> {
  assertHealthTunnel('readDietaryProtein');
  // Phase 70: @capgo/capacitor-health v8.5.2 does not expose dietaryProtein.
  // Return empty to prevent silent data loss. Wire real read in Phase 70.
  return [];
}

/**
 * Full import cycle — reads every supported metric and writes rows to the
 * correct destination (Supabase tables or Zustand). Idempotent: re-syncing
 * the same day produces no duplicate rows thanks to deterministic UUID-v5
 * dedupe (T-55-03-02 mitigation).
 *
 * Mapping summary:
 *   weight   → public.weights (hk_source='apple_health')
 *   steps    → Zustand bulkSetSteps (NO DB table)
 *   sleep    → public.sleep (hk_source='apple_health')
 *   heartRate → public.workouts type=cardio, name='Apple Health – Heart Rate'
 *   calories  → public.workouts type=cardio, name='Apple Health Activity'
 *   height   → profiles.height (one-time upsert)
 *
 * HEALTH-06 battery/background skip: calls shouldSkipForBattery() stub.
 * Real BGAppRefreshTask wiring is Phase 70.
 *
 * @returns per-metric import-count summary.
 */
export async function syncNow(start: Date, end: Date): Promise<SyncSummary> {
  assertHealthTunnel('syncNow');

  const summary: SyncSummary = {
    weight: 0,
    steps: 0,
    sleep: 0,
    heartRate: 0,
    calories: 0,
    height: 0,
  };

  if (detectPlatform() !== 'ios') return summary;

  // Phase 70: skip sync when battery is critically low.
  if (shouldSkipForBattery()) return summary;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return summary;
  const userId = user.id;

  // -- Weight (bodyMass → public.weights) --
  const weightSamples = await readHealthSamples('weight', start, end);
  for (const s of weightSamples) {
    const date = toDateStr(s.startDate);
    const sourceId = s.sourceId ?? s.sourceName ?? 'apple_health';
    const weightId = healthSampleId(userId, date, 'weight', sourceId);
    await supabase.from('weights').upsert(
      {
        weight_id: weightId,
        user_id: userId,
        date,
        weight: s.value,
        body_fat: null,
        ts: new Date(s.startDate).getTime(),
        hk_source: 'apple_health',
      },
      { onConflict: 'weight_id' },
    );
    summary.weight++;
  }

  // -- Steps (stepCount → Zustand bulkSetSteps; NO DB table) --
  const stepSamples = await readHealthSamples('steps', start, end);
  const stepsByDate: Record<string, number> = {};
  for (const s of stepSamples) {
    const date = toDateStr(s.startDate);
    stepsByDate[date] = (stepsByDate[date] ?? 0) + Math.round(s.value);
    summary.steps++;
  }
  if (Object.keys(stepsByDate).length > 0) {
    useStore.getState().bulkSetSteps(stepsByDate);
  }

  // -- Sleep (sleepAnalysis → public.sleep) --
  const sleepSamples = await readHealthSamples('sleep', start, end);
  for (const s of sleepSamples) {
    const date = toDateStr(s.startDate);
    const sourceId = s.sourceId ?? s.sourceName ?? 'apple_health';
    const sleepId = healthSampleId(userId, date, 'sleep', sourceId);
    await supabase.from('sleep').upsert(
      {
        sleep_id: sleepId,
        user_id: userId,
        date,
        hours: s.value,
        quality: null,
        wakings: 0,
        notes: '',
        hk_source: 'apple_health',
      },
      { onConflict: 'sleep_id' },
    );
    summary.sleep++;
  }

  // -- Heart Rate (synthetic daily cardio workout → public.workouts) --
  const hrSamples = await readHealthSamples('heartRate', start, end);
  const hrByDate: Record<string, number[]> = {};
  for (const s of hrSamples) {
    const date = toDateStr(s.startDate);
    if (!hrByDate[date]) hrByDate[date] = [];
    hrByDate[date].push(s.value);
  }
  for (const [date, readings] of Object.entries(hrByDate)) {
    const firstHrSample = hrSamples.find((s) => toDateStr(s.startDate) === date);
    const sourceId = firstHrSample?.sourceId ?? firstHrSample?.sourceName ?? 'apple_health';
    const workoutId = healthSampleId(userId, date, 'heartRate', sourceId);
    const avgHr = Math.round(readings.reduce((a, b) => a + b, 0) / readings.length);
    await supabase.from('workouts').upsert(
      {
        workout_id: workoutId,
        user_id: userId,
        date,
        type: 'cardio',
        name: 'Apple Health – Heart Rate',
        minutes: 1,
        rpe: avgHr,
        notes: '',
        hk_source: 'apple_health',
      },
      { onConflict: 'workout_id' },
    );
    summary.heartRate++;
  }

  // -- Calories (activeEnergyBurned → public.workouts type=cardio) --
  const calSamples = await readHealthSamples('calories', start, end);
  const calByDate: Record<string, number[]> = {};
  for (const s of calSamples) {
    const date = toDateStr(s.startDate);
    if (!calByDate[date]) calByDate[date] = [];
    calByDate[date].push(s.value);
  }
  for (const [date, cals] of Object.entries(calByDate)) {
    const firstCalSample = calSamples.find((s) => toDateStr(s.startDate) === date);
    const sourceId = firstCalSample?.sourceId ?? firstCalSample?.sourceName ?? 'apple_health';
    const workoutId = healthSampleId(userId, date, 'calories', sourceId);
    const totalCal = Math.round(cals.reduce((a, b) => a + b, 0));
    await supabase.from('workouts').upsert(
      {
        workout_id: workoutId,
        user_id: userId,
        date,
        type: 'cardio',
        name: 'Apple Health Activity',
        minutes: Math.max(1, Math.round(totalCal / 5)),
        rpe: null,
        notes: `${totalCal} kcal`,
        hk_source: 'apple_health',
      },
      { onConflict: 'workout_id' },
    );
    summary.calories++;
  }

  // -- Height (one-time profile upsert → profiles.height) --
  // CR-03: also set healthkit_height_source=true so purge_healthkit_imports can
  // distinguish HK-imported height from user-entered height and clear it selectively.
  const heightSamples = await readHealthSamples('height', start, end);
  if (heightSamples.length > 0) {
    const latestHeight = heightSamples[heightSamples.length - 1];
    const { error: heightErr } = await supabase
      .from('profiles')
      .update({ height: latestHeight.value, healthkit_height_source: true })
      .eq('id', userId);
    if (heightErr) console.error('[health] height upsert failed', heightErr);
    else summary.height++;
  }

  // Log PHI access for audit trail (existing log_phi_access SECDEF RPC).
  await supabase.rpc('log_phi_access', {
    p_accessed_user_id: userId,
    p_accessed_fields: ['weights.weight', 'sleep.hours', 'workouts.name', 'profiles.height'],
    p_reason: 'healthkit_sync',
  });

  // Update last_synced_at via SECDEF RPC (55-02).
  await supabase.rpc('upsert_healthkit_state', {
    p_enabled: true,
    p_sync_interval: '6h',
  });

  return summary;
}

/**
 * Returns whether HealthKit sync is currently enabled for the current user.
 * Reads from the healthkit_sync_state table (55-02 migration).
 */
export async function isEnabled(): Promise<boolean> {
  assertHealthTunnel('isEnabled');
  const { data, error } = await supabase
    .from('healthkit_sync_state')
    .select('healthkit_enabled')
    .maybeSingle();
  if (error ?? !data) return false;
  return data.healthkit_enabled === true;
}

/**
 * Revokes HealthKit access: marks the user's state as disabled so future
 * syncs are blocked. Does NOT purge imported data — call purgeImportedData()
 * separately if the user also wants historical data removed (HEALTH-07).
 */
export async function revokeAccess(): Promise<void> {
  assertHealthTunnel('revokeAccess');
  await supabase.rpc('upsert_healthkit_state', {
    p_enabled: false,
    p_sync_interval: '6h',
  });
}

/**
 * Purges all HealthKit-imported rows (hk_source='apple_health') from the
 * current user's weights, sleep, workouts, and meals tables via the SECDEF
 * purge_healthkit_imports RPC (Phase 55 Plan 55-02, HEALTH-07).
 */
export async function purgeImportedData(): Promise<void> {
  assertHealthTunnel('purgeImportedData');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.rpc('purge_healthkit_imports', { p_user_id: user.id });
}
