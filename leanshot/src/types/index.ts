/**
 * Domain types for LeanShot v2.
 * State shape is a deliberate evolution of v1 (`leanshot_v3`) and is migrated
 * forward by `lib/storage.ts` so existing users don't lose data.
 */

export type Units = 'metric' | 'imperial';

export type MedicationId =
  | 'ozempic'
  | 'wegovy'
  | 'mounjaro'
  | 'zepbound'
  | 'rybelsus'
  | 'saxenda'
  | 'trulicity'
  | 'retatrutide'
  | 'compound-sema'
  | 'compound-tirz';

export type DoseUnit = 'mg' | 'units' | 'ml';
export type GoalType = 'fat-loss' | 'recomp' | 'health' | 'maintenance';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very';
export type LiftingLevel = 'none' | 'beginner' | 'intermediate' | 'advanced';
export type Sex = 'male' | 'female';

export type InjectionSite =
  | 'abdomen-ul'
  | 'abdomen-ur'
  | 'abdomen-ll'
  | 'abdomen-lr'
  | 'thigh-l'
  | 'thigh-r'
  | 'arm-l'
  | 'arm-r';

export interface User {
  name: string;
  units: Units;
  medication: MedicationId;
  dose: string;
  doseUnit: DoseUnit;
  startDate: string; // YYYY-MM-DD
  startWeight: number;
  height: number | null;
  age: number | null;
  sex: Sex;
  bodyFat: number | null;
  goalWeight: number;
  goal: GoalType;
  proteinTarget: number;
  calorieTarget: number;
  fiberTarget: number;
  waterTarget: number;
  injectionDay: number; // 0=Sun..6=Sat
  activityLevel: ActivityLevel;
  liftingLevel: LiftingLevel;
  createdAt: string; // ISO
}

export interface Injection {
  /** Phase 5 D-08/SYNC-01: client-generated UUID (crypto.randomUUID), composite PK with user_id on
   *  public.injections. Stable across local-only logging, offline queue, and cloud upsert.
   *  Storage v6→v7 migrate back-stamps existing legacy rows; new writes stamp via addInjection. */
  log_id: string;
  datetime: string; // ISO; maps to server `logged_at`
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  notes: string;
  /** PK-05 (Phase 3 D-07): pharmacology engine version that produced this record's expected curve.
   *  Optional so legacy literals + in-memory v5-shaped records typecheck.
   *  Storage v5→v6 migrate back-stamps to 1. New writes stamp 1 via addInjection. */
  pkEngineVersion?: number;
  /** Server timestamptz; populated only on rows that came FROM the server. Used for LWW merge. */
  updated_at?: string;
  /** Server-derived rows only; not persisted client-side. */
  user_id?: string;
}

/**
 * Unified offline write queue entry (Phase 5 DELEG-2; forward-compat with Phase 6
 * weights/meals/photos/...). Phase 5 only uses `table: 'injections'`. Do NOT inline-couple
 * to Injection — `key` is the natural identifier (`log_id` for injections; `(date)` or
 * `(date,name)` for Phase 6 tables).
 */
export interface PendingOp {
  table: string;
  /**
   * Phase 6 06-04: `'upload'` is the photo-specific op variant — sync.ts's
   * flushPhotoOps reads the Blob from IndexedDB (`@/lib/photo-queue`),
   * uploads to Storage, then upserts the metadata row. `blob_ref` carries
   * the IndexedDB key (typically === op.key for simplicity).
   */
  op: 'upsert' | 'delete' | 'upload';
  key: string;
  enqueuedAt: string; // ISO
  /** Phase 6 06-04 — IndexedDB key for the Blob payload (upload ops only). */
  blob_ref?: string;
}

export interface SymptomLog {
  date: string; // ISO
  symptom: string; // id from SYMPTOMS_LIST
  severity: 1 | 2 | 3 | 4 | 5;
  notes: string;
}

export interface WeightLog {
  date: string; // YYYY-MM-DD
  weight: number;
  bodyFat: number | null;
  ts: number;
}

export interface Measurement {
  date: string;
  waist?: number;
  hips?: number;
  chest?: number;
  neck?: number;
  arms?: number;
  thighs?: number;
}

export interface Meal {
  date: string; // YYYY-MM-DD
  name: string;
  calories: number;
  protein: number;
  fiber: number;
  hunger: number | null;
  satisfaction: number | null;
  ts: number;
}

export interface Workout {
  date: string;
  type: 'resistance' | 'cardio' | 'hybrid' | 'walk' | 'yoga';
  name: string;
  minutes: number;
  rpe: number | null;
  notes: string;
}

export interface Vial {
  name: string;
  dosesPerVial: number;
  dosesUsed: number;
  startDate: string;
  expirationDate: string;
}

export interface Cost {
  date: string;
  amount: number;
  type: 'vial' | 'copay' | 'compound' | 'telehealth' | 'lab' | 'other';
  notes: string;
}

export interface NSV {
  text: string;
  date: string;
}

export interface MoodLog {
  date: string;
  mood: 1 | 2 | 3 | 4 | 5;
  energy: number | null;
  notes: string;
}

export interface SleepLog {
  date: string;
  hours: number;
  quality: number | null;
  wakings: number;
  notes: string;
}

/**
 * Phase 6 06-04 SYNC-06 / D-04 — Photo metadata. The Blob itself lives in
 * Supabase Storage at `${user_id}/photos/${photo_id}.jpg`; this interface
 * only carries the pointer + per-photo metadata (date, weight, mime, size).
 *
 * Pre-06-04 the legacy `data: string` (base64 dataURL) field carried the
 * full image bytes inline — that field is migrated to Storage by the eager
 * loop in migration.ts (D-10) and dropped after upload. Existing v7
 * persisted state is back-stamped by migrateV7ToV8 in storage.ts.
 *
 * Local preview during the "queued-for-upload" state is served by reading
 * the Blob from IndexedDB (`@/lib/photo-queue`) and producing an
 * `URL.createObjectURL` blob URL on demand — NOT stored on this interface.
 */
export interface Photo {
  /** Client-stable uuid (crypto.randomUUID); composite PK with user_id on public.photos. */
  photo_id: string;
  date: string;
  /** Optional weight at time of photo (kg in metric, lb in imperial). */
  weight?: number | null;
  /** {userId}/photos/{photo_id}.jpg. Empty string during queued-for-upload window. */
  storage_path: string;
  /** Defaults to 'image/jpeg' after compression. */
  mime_type: string;
  /** Compressed size in bytes; nullable pre-upload. */
  size_bytes?: number;
  /** Server-stamped via moddatetime trigger; populated on rows that came FROM the server. */
  updated_at?: string;
  /** Server-derived rows only. */
  user_id?: string;
  /**
   * Phase 23 Plan 23-04 (DEBT-03) — soft-delete timestamp.
   * Non-null = photo is in the Trash; null = active (visible in main grid).
   * Populated from the DB server; absent on locally-queued photos pre-sync.
   */
  trashed_at?: string | null;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  hasDataReference?: boolean;
}

export type TabId =
  | 'home'
  | 'medication'
  | 'symptoms'
  | 'body'
  | 'nutrition'
  | 'activity'
  | 'supplements'
  | 'mood'
  | 'insights';

export type Theme = 'light' | 'dark';

// Phase 14 — Billing

/**
 * UX tier — collapsed from 8 Stripe subscription.status values per RESEARCH Pitfall 6.
 * active + trialing → 'paid'
 * past_due + unpaid → 'past_due'
 * canceled (after period_end) + incomplete_expired + missing row + paused → 'free'
 * incomplete (initial 23h auth window) → 'free'
 */
export type Tier = 'free' | 'paid' | 'past_due';

/** 'revenuecat' lands in Phase 16; null = no active subscription row. */
export type SubscriptionProvider = 'stripe' | 'revenuecat' | null;

export interface BillingState {
  tier: Tier;
  current_period_end: string | null; // ISO timestamp; null when tier='free'
  plan_id: string | null; // Stripe price ID (e.g. 'price_1Q…') or null
  provider: SubscriptionProvider;
}
