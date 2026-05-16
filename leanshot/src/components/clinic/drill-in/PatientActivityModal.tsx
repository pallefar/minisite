/**
 * Phase 23 Plan 23-03 — PatientActivityModal.
 *
 * Chronological-merge modal showing the impersonated patient's full logged-activity
 * timeline (all six data domains interleaved, newest-first). Closes the Plan 10-09
 * carry-forward (DEBT-01).
 *
 * Data strategy:
 *   - Fetches 6 Supabase tables in parallel via Promise.all.
 *   - Each query uses `.eq('user_id', patientId)` to scope to the patient's rows.
 *     This is safe: callers (ClinicDrillInPage) pass the patient_id they already
 *     resolved via the clinic-snapshot Edge Function + operator membership check.
 *   - Rows per table capped at 100 for v1 (no pagination — deferred to v1.3).
 *   - Merge by normalizing each row's timestamp to ISO string, then sort desc.
 *
 * No new RLS policies needed (D-02): per-user owner policies on each data table
 * allow reads only when auth.uid() = user_id. The operator's session sees the
 * patient's data through the snapshot Edge Function; for the modal, patientId is
 * the explicit scope key passed from the already-verified drill-in context.
 *
 * A11y:
 *   - Wraps the existing Modal.tsx primitive (already has role=dialog, aria-modal,
 *     Esc + backdrop close, focus return on unmount).
 *   - Empty-state copy: "No logged activity yet for this patient."
 *   - Loading: skeleton rows while fetches are in flight.
 *
 * Bundle: lazy-loaded via React.lazy() from ClinicDrillInPage.tsx so this source
 * is NOT in the index static graph. The manualChunks `clinic` rule will group it
 * with the drill-in page chunk — the index gz stays ≤ 24.5 kB (Phase 12 invariant).
 *
 * No non-null bang assertions on session user — Phase 23 DEBT-02 ESLint rule enforces this.
 */

import { useEffect, useState } from 'react';
import { Activity, Camera, Frown, Syringe, Utensils, Weight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientActivityModalProps {
  /** Impersonated patient's user_id — used as the row-level filter. */
  patientId: string;
  open: boolean;
  onClose: () => void;
}

type ActivityKind = 'injection' | 'weight' | 'meal' | 'workout' | 'symptom' | 'photo';

type ActivityEntry =
  | { kind: 'injection'; ts: string; summary: string }
  | { kind: 'weight'; ts: string; summary: string }
  | { kind: 'meal'; ts: string; summary: string }
  | { kind: 'workout'; ts: string; summary: string }
  | { kind: 'symptom'; ts: string; summary: string }
  | { kind: 'photo'; ts: string; summary: string };

// ---------------------------------------------------------------------------
// Helpers — timestamp normalization
// ---------------------------------------------------------------------------

/** Convert any date/timestamp value from a server row into an ISO string. */
function toIso(value: string | number | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (typeof value === 'number') {
    // ts fields (ms since epoch)
    return new Date(value).toISOString();
  }
  // Already ISO or YYYY-MM-DD — either parses fine.
  return new Date(value).toISOString();
}

/** Format an ISO timestamp as a human-readable relative string (no date-fns dependency). */
export function formatRelativeTs(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}yr ago`;
}

// ---------------------------------------------------------------------------
// Config — kind metadata
// ---------------------------------------------------------------------------

const KIND_META: Record<
  ActivityKind,
  { label: string; icon: React.ReactElement; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  injection: {
    label: 'Injection',
    icon: <Syringe className="size-4" aria-hidden />,
    tone: 'info',
  },
  weight: {
    label: 'Weight',
    icon: <Weight className="size-4" aria-hidden />,
    tone: 'neutral',
  },
  meal: {
    label: 'Meal',
    icon: <Utensils className="size-4" aria-hidden />,
    tone: 'success',
  },
  workout: {
    label: 'Workout',
    icon: <Activity className="size-4" aria-hidden />,
    tone: 'warning',
  },
  symptom: {
    label: 'Symptom',
    icon: <Frown className="size-4" aria-hidden />,
    tone: 'danger',
  },
  photo: {
    label: 'Photo',
    icon: <Camera className="size-4" aria-hidden />,
    tone: 'neutral',
  },
};

// ---------------------------------------------------------------------------
// Data fetch — 6 parallel queries
// ---------------------------------------------------------------------------

// Server-row shapes (minimal — we only need the fields we display)
interface ServerInjectionRow {
  log_id: string;
  dose: string;
  unit: string;
  medication?: string;
  site?: string | null;
  logged_at: string;
}
interface ServerWeightRow {
  weight_id: string;
  weight: number;
  date: string;
  body_fat?: number | null;
  ts: number;
}
interface ServerMealRow {
  meal_id: string;
  name: string;
  calories: number;
  date: string;
  ts: number;
}
interface ServerWorkoutRow {
  workout_id: string;
  name: string;
  type: string;
  minutes?: number;
  date: string;
  ts: number;
}
interface ServerSymptomRow {
  symptom_id: string;
  symptom: string;
  severity: number;
  date: string;
  ts?: number;
  created_at?: string;
}
interface ServerPhotoRow {
  photo_id: string;
  storage_path: string;
  date: string;
}

async function fetchActivityEntries(patientId: string): Promise<ActivityEntry[]> {
  const [
    injectionsRes,
    weightsRes,
    mealsRes,
    workoutsRes,
    symptomsRes,
    photosRes,
  ] = await Promise.all([
    supabase
      .from('injections')
      .select('log_id, dose, unit, medication, site, logged_at')
      .eq('user_id', patientId)
      .order('logged_at', { ascending: false })
      .limit(100),
    supabase
      .from('weights')
      .select('weight_id, weight, date, body_fat, ts')
      .eq('user_id', patientId)
      .order('ts', { ascending: false })
      .limit(100),
    supabase
      .from('meals')
      .select('meal_id, name, calories, date, ts')
      .eq('user_id', patientId)
      .order('ts', { ascending: false })
      .limit(100),
    supabase
      .from('workouts')
      .select('workout_id, name, type, minutes, date, ts')
      .eq('user_id', patientId)
      .order('ts', { ascending: false })
      .limit(100),
    supabase
      .from('symptoms')
      .select('symptom_id, symptom, severity, date, created_at')
      .eq('user_id', patientId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('photos')
      .select('photo_id, storage_path, date')
      .eq('user_id', patientId)
      .order('date', { ascending: false })
      .limit(100),
  ]);

  const entries: ActivityEntry[] = [];

  // Injections
  if (!injectionsRes.error && injectionsRes.data) {
    for (const row of injectionsRes.data as ServerInjectionRow[]) {
      const summary = `${row.dose} ${row.unit}${row.medication ? ` · ${row.medication}` : ''}${row.site ? ` · ${row.site}` : ''}`;
      entries.push({ kind: 'injection', ts: toIso(row.logged_at), summary });
    }
  } else if (injectionsRes.error) {
    console.warn('[PatientActivityModal] injections fetch failed', injectionsRes.error);
  }

  // Weights
  if (!weightsRes.error && weightsRes.data) {
    for (const row of weightsRes.data as ServerWeightRow[]) {
      const summary = `${row.weight} kg${row.body_fat != null ? ` · ${row.body_fat}% BF` : ''}`;
      entries.push({ kind: 'weight', ts: toIso(row.ts), summary });
    }
  } else if (weightsRes.error) {
    console.warn('[PatientActivityModal] weights fetch failed', weightsRes.error);
  }

  // Meals
  if (!mealsRes.error && mealsRes.data) {
    for (const row of mealsRes.data as ServerMealRow[]) {
      const summary = `${row.name} · ${row.calories} kcal`;
      entries.push({ kind: 'meal', ts: toIso(row.ts), summary });
    }
  } else if (mealsRes.error) {
    console.warn('[PatientActivityModal] meals fetch failed', mealsRes.error);
  }

  // Workouts
  if (!workoutsRes.error && workoutsRes.data) {
    for (const row of workoutsRes.data as ServerWorkoutRow[]) {
      const summary = `${row.name} · ${row.type}${row.minutes != null ? ` · ${row.minutes}min` : ''}`;
      entries.push({ kind: 'workout', ts: toIso(row.ts), summary });
    }
  } else if (workoutsRes.error) {
    console.warn('[PatientActivityModal] workouts fetch failed', workoutsRes.error);
  }

  // Symptoms
  if (!symptomsRes.error && symptomsRes.data) {
    for (const row of symptomsRes.data as ServerSymptomRow[]) {
      const summary = `${row.symptom} · severity ${row.severity}/5`;
      // Use created_at if available, fall back to date (YYYY-MM-DD).
      const ts = row.created_at ? toIso(row.created_at) : toIso(row.date);
      entries.push({ kind: 'symptom', ts, summary });
    }
  } else if (symptomsRes.error) {
    console.warn('[PatientActivityModal] symptoms fetch failed', symptomsRes.error);
  }

  // Photos
  if (!photosRes.error && photosRes.data) {
    for (const row of photosRes.data as ServerPhotoRow[]) {
      entries.push({ kind: 'photo', ts: toIso(row.date), summary: 'Progress photo' });
    }
  } else if (photosRes.error) {
    console.warn('[PatientActivityModal] photos fetch failed', photosRes.error);
  }

  // Sort newest-first
  entries.sort((a, b) => b.ts.localeCompare(a.ts));

  return entries;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-[var(--color-border)]">
      <Skeleton className="size-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-3 w-12 flex-shrink-0" />
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const meta = KIND_META[entry.kind];
  return (
    <div
      className="flex items-start gap-3 py-3 border-b border-[var(--color-border)] last:border-0"
      data-testid="activity-row"
    >
      <span
        className="flex items-center justify-center size-8 rounded-full bg-[var(--color-surface-raised)] flex-shrink-0 text-[var(--color-text-secondary)] mt-0.5"
        aria-hidden
      >
        {meta.icon}
      </span>
      <div className="flex-1 min-w-0">
        <Badge tone={meta.tone} className="mb-1">
          {meta.label}
        </Badge>
        <p className="text-[13px] text-[var(--color-text-secondary)] truncate">{entry.summary}</p>
      </div>
      <time
        dateTime={entry.ts}
        className="text-[12px] text-[var(--color-text-tertiary)] flex-shrink-0 pt-1"
      >
        {formatRelativeTs(entry.ts)}
      </time>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * PatientActivityModal — lazy-loaded from ClinicDrillInPage.
 *
 * Props:
 *   - patientId: impersonated patient's user_id (for .eq filter)
 *   - open: whether the modal is visible
 *   - onClose: callback to close the modal
 */
export function PatientActivityModal({ patientId, open, onClose }: PatientActivityModalProps) {
  // null = loading, [] = empty, [...] = data
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    if (!open || !patientId) return;

    setEntries(null); // reset to loading state on each open
    let cancelled = false;

    fetchActivityEntries(patientId)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err) => {
        console.warn('[PatientActivityModal] unexpected fetch error', err);
        if (!cancelled) setEntries([]); // degrade gracefully to empty state
      });

    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  return (
    <Modal open={open} onClose={onClose} title="Patient activity" size="lg">
      {entries === null ? (
        // Loading state — 5 skeleton rows
        <div data-testid="activity-loading">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : entries.length === 0 ? (
        // Empty state
        <p
          className="text-[14px] text-[var(--color-text-secondary)] text-center py-10"
          data-testid="activity-empty"
        >
          No logged activity yet for this patient.
        </p>
      ) : (
        // Activity timeline
        <div data-testid="activity-timeline">
          {entries.map((entry, idx) => (
            <ActivityRow key={`${entry.kind}-${entry.ts}-${idx}`} entry={entry} />
          ))}
        </div>
      )}
    </Modal>
  );
}
