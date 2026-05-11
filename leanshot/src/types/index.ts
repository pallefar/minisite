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
  datetime: string; // ISO
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  notes: string;
  /** PK-05 (Phase 3 D-07): pharmacology engine version that produced this record's expected curve.
   *  Optional so legacy literals + in-memory v5-shaped records typecheck.
   *  Storage v5→v6 migrate back-stamps to 1. New writes stamp 1 via addInjection. */
  pkEngineVersion?: number;
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

export interface Photo {
  date: string;
  data: string; // dataURL
  weight: number | null;
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
