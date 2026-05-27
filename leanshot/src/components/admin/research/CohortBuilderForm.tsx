/**
 * Phase 62 Plan 62-04 — CohortBuilderForm.
 *
 * Filter form for the research cohort builder. Provides:
 *  - Compound multiselect (Pill chips, aria-pressed)
 *  - Tenure bucket select (<3m | 3-6m | 6-12m | 12m+)
 *  - Audience multiselect (B2C | clinic | both)
 *  - Outcome metric select (weight_change | dose_adherence | retention_30d | symptom_severity)
 *  - Debounced (400ms) live cohort size estimate via estimate_research_cohort RPC
 *  - k_floor sentinel UX: < 5 → warning + disabled Run Cohort button
 *  - Run Cohort button: posts to compile_research_cohort, lifts result to parent
 *
 * Typography STRICTLY 11/13/18/text-heading, font-normal or font-semibold only.
 * All @theme tokens verified present in src/index.css.
 *
 * Copywriting contract (UI-SPEC verbatim):
 *  - k_floor warning: "Cohort too small (k<5) — broaden filters"
 *  - estimate display: "Estimated cohort: {N} users"
 *  - epsilon display: "epsilon = 1.0 (admin output)"
 *  - error toast: "Cohort could not be compiled. Check filters and try again."
 */

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

// --- Types ---

type TenureBucket = '<3m' | '3-6m' | '6-12m' | '12m+' | null;
type OutcomeMetric = 'weight_change' | 'dose_adherence' | 'retention_30d' | 'symptom_severity';

type CohortSuppressedResponse = {
  suppressed: true;
  reason: 'k_floor';
  k: number;
};
type CohortSuccessResponse = {
  suppressed: false;
  cohort_size: number;
  epsilon: number;
  suppressed_buckets: number;
  metric: string;
  data: Array<Record<string, unknown>>;
};
export type CohortResponse = CohortSuppressedResponse | CohortSuccessResponse;

interface EstimateResponse {
  cohort_size: number;
  below_floor: boolean;
}

interface CohortFilters {
  metric: OutcomeMetric;
  compound: string[];
  tenure_bucket: TenureBucket;
  audience_segment: string[];
}

export interface CohortBuilderFormProps {
  onResult: (result: CohortResponse) => void;
  onLoading?: (loading: boolean) => void;
}

// --- Constants ---

const COMPOUND_OPTIONS = [
  'tirzepatide',
  'semaglutide',
  'liraglutide',
  'dulaglutide',
  'exenatide',
];

const AUDIENCE_OPTIONS = ['B2C', 'clinic', 'both'];

const TENURE_OPTIONS: Array<{ value: NonNullable<TenureBucket>; label: string }> = [
  { value: '<3m',  label: 'Under 3 months' },
  { value: '3-6m', label: '3–6 months' },
  { value: '6-12m', label: '6–12 months' },
  { value: '12m+', label: '12+ months' },
];

const OUTCOME_OPTIONS: Array<{ value: OutcomeMetric; label: string }> = [
  { value: 'weight_change',     label: 'Weight Change' },
  { value: 'dose_adherence',    label: 'Dose Adherence' },
  { value: 'retention_30d',     label: '30-Day Retention' },
  { value: 'symptom_severity',  label: 'Symptom Severity' },
];

// --- Pure helper (also exported for logic-only tests) ---
export function shouldDisableRunButton(estimate: number | null): boolean {
  return estimate === null || estimate < 5;
}

// --- Component ---

export function CohortBuilderForm({ onResult, onLoading }: CohortBuilderFormProps) {
  const showToast = useToast();

  const [compounds, setCompounds] = useState<string[]>([]);
  const [tenureBucket, setTenureBucket] = useState<TenureBucket>(null);
  const [audience, setAudience] = useState<string[]>([]);
  const [outcomeMetric, setOutcomeMetric] = useState<OutcomeMetric>('weight_change');
  const [estimatedCohortSize, setEstimatedCohortSize] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [running, setRunning] = useState(false);

  // Build filters object
  const filters: CohortFilters = {
    metric: outcomeMetric,
    compound: compounds,
    tenure_bucket: tenureBucket,
    audience_segment: audience,
  };

  // Debounced estimate on filter change (400ms, cancellation token pattern)
  useEffect(() => {
    let cancelled = false;
    const timerId = setTimeout(async () => {
      if (cancelled) return;
      setEstimating(true);
      try {
        const { data, error } = await supabase.rpc('estimate_research_cohort', {
          p_filters: filters,
        });
        if (cancelled) return;
        if (!error && data) {
          const estimate = data as EstimateResponse;
          setEstimatedCohortSize(estimate.cohort_size);
        }
      } catch {
        // Silently ignore estimate errors — user can still try Run Cohort
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeMetric, compounds.join(','), tenureBucket, audience.join(',')]);

  // Toggle compound selection
  const toggleCompound = (compound: string) => {
    setCompounds((prev) =>
      prev.includes(compound) ? prev.filter((c) => c !== compound) : [...prev, compound],
    );
  };

  // Toggle audience selection
  const toggleAudience = (seg: string) => {
    setAudience((prev) =>
      prev.includes(seg) ? prev.filter((a) => a !== seg) : [...prev, seg],
    );
  };

  // Run Cohort
  const handleRunCohort = async () => {
    if (shouldDisableRunButton(estimatedCohortSize)) return;
    setRunning(true);
    onLoading?.(true);
    try {
      const { data, error } = await supabase.rpc('compile_research_cohort', {
        p_filters: filters,
      });
      if (error) throw error;
      onResult(data as CohortResponse);
    } catch {
      // Defensive fallback per plan spec
      onResult({ suppressed: true, reason: 'k_floor', k: 0 });
      showToast('Cohort could not be compiled. Check filters and try again.', 'error');
    } finally {
      setRunning(false);
      onLoading?.(false);
    }
  };

  const disabled = shouldDisableRunButton(estimatedCohortSize);

  return (
    <div className="space-y-4">
      {/* Compound multiselect */}
      <fieldset>
        <legend className="text-[13px] font-semibold text-[var(--color-text)] mb-2">
          Compound
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {COMPOUND_OPTIONS.map((compound) => (
            <Pill
              key={compound}
              size="sm"
              active={compounds.includes(compound)}
              onClick={() => toggleCompound(compound)}
            >
              {compound}
            </Pill>
          ))}
        </div>
      </fieldset>

      {/* Tenure bucket select */}
      <div>
        <label
          htmlFor="tenure-bucket-select"
          className="text-[13px] font-semibold text-[var(--color-text)] block mb-1"
        >
          Tenure Bucket
        </label>
        <select
          id="tenure-bucket-select"
          value={tenureBucket ?? ''}
          onChange={(e) => setTenureBucket((e.target.value as TenureBucket) || null)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)]"
        >
          <option value="">All tenures</option>
          {TENURE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Audience multiselect */}
      <fieldset>
        <legend className="text-[13px] font-semibold text-[var(--color-text)] mb-2">
          Audience Segment
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {AUDIENCE_OPTIONS.map((seg) => (
            <Pill
              key={seg}
              size="sm"
              active={audience.includes(seg)}
              onClick={() => toggleAudience(seg)}
            >
              {seg}
            </Pill>
          ))}
        </div>
      </fieldset>

      {/* Outcome metric select */}
      <div>
        <label
          htmlFor="outcome-metric-select"
          aria-label="Outcome Metric"
          className="text-[13px] font-semibold text-[var(--color-text)] block mb-1"
        >
          Outcome Metric
        </label>
        <select
          id="outcome-metric-select"
          value={outcomeMetric}
          onChange={(e) => setOutcomeMetric(e.target.value as OutcomeMetric)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)]"
          role="combobox"
          aria-label="Outcome Metric"
        >
          {OUTCOME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* k_floor sentinel UX + estimate display */}
      <div className="min-h-[40px] flex items-center gap-2">
        {estimating && (
          <span className="text-[13px] text-[var(--color-text-tertiary)]">Estimating…</span>
        )}
        {!estimating && estimatedCohortSize !== null && estimatedCohortSize < 5 && (
          <>
            <AlertTriangle
              className="size-4 text-[var(--color-warning)] shrink-0"
              aria-hidden="true"
            />
            <span className="text-[13px] font-semibold text-[var(--color-warning)]">
              Cohort too small (k&lt;5) — broaden filters
            </span>
          </>
        )}
        {!estimating && estimatedCohortSize !== null && estimatedCohortSize >= 5 && (
          <div className="space-y-0.5">
            <span className="text-[13px] font-mono tabular-nums text-[var(--color-text-secondary)]">
              Estimated cohort: {estimatedCohortSize} users
            </span>
            <div>
              <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                epsilon = 1.0 (admin output)
              </span>
            </div>
          </div>
        )}
        {!estimating && estimatedCohortSize === null && (
          <span className="text-[13px] text-[var(--color-text-tertiary)]">
            Select filters to estimate cohort size
          </span>
        )}
      </div>

      {/* Run Cohort button */}
      <div>
        <Button
          variant="primary"
          size="md"
          loading={running}
          disabled={running}
          aria-disabled={disabled ? 'true' : undefined}
          aria-describedby={disabled ? 'run-cohort-tooltip' : undefined}
          onClick={disabled ? undefined : handleRunCohort}
          className={disabled ? 'pointer-events-none opacity-50' : ''}
        >
          Run Cohort
        </Button>
        {disabled && (
          <span id="run-cohort-tooltip" className="sr-only">
            Cohort must have at least 5 users
          </span>
        )}
      </div>
    </div>
  );
}

export default CohortBuilderForm;
