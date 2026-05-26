/**
 * Phase 62 Plan 62-04 — CohortBuilderPage.
 *
 * Page composing CohortBuilderForm + RetentionChart + CrossTabMatrix.
 * Receives result from CohortBuilderForm and distributes to chart/matrix.
 *
 * Layout (UI-SPEC Surface 1):
 *  - H1 "Research Dashboard" (text-heading/600)
 *  - Sub-heading "Cohort Builder" (18px/600)
 *  - CohortBuilderForm
 *  - space-y-12 between cohort builder and chart panel
 *  - Conditional: suppressed banner | chart + matrix | empty state
 *
 * Typography: text-heading for H1, text-[18px] for sub-heading, text-[13px] for body.
 * All @theme tokens verified in src/index.css.
 *
 * Copywriting contract (UI-SPEC verbatim):
 *  - Empty state: "Run a cohort to see retention curves."
 *  - Suppressed banner: "Cohort suppressed — k<5 at the selected filters."
 */
import { useState } from 'react';
import type { CohortResponse } from './CohortBuilderForm';
import { CohortBuilderForm } from './CohortBuilderForm';
import { CrossTabMatrix } from './CrossTabMatrix';
import { EmptyState } from '@/components/ui/EmptyState';
import { RetentionChart } from './RetentionChart';
import { useReducedMotion } from '@/hooks/useReducedMotion';

// Extract retention data from RPC response
function extractRetentionData(
  data: Array<Record<string, unknown>>,
): Array<{ week_label: string; retained_pct: number }> {
  return data
    .filter((row) => typeof row.week_label === 'string' && typeof row.retained_pct === 'number')
    .map((row) => ({
      week_label: row.week_label as string,
      retained_pct: row.retained_pct as number,
    }));
}

// Extract cross-tab rows/columns from RPC response
function extractCrossTabData(data: Array<Record<string, unknown>>): {
  rows: Array<{ label: string; values: Array<number | null> }>;
  columns: string[];
} {
  if (data.length === 0) return { rows: [], columns: [] };

  // Assume columns are all keys except 'label'
  const firstRow = data[0];
  const colKeys = Object.keys(firstRow).filter((k) => k !== 'label' && k !== 'week_label' && k !== 'retained_pct');

  const rows = data.map((row) => ({
    label: String(row.label ?? row.week_label ?? 'Unknown'),
    values: colKeys.map((key) => {
      const v = row[key];
      return typeof v === 'number' ? v : null;
    }),
  }));

  return { rows, columns: colKeys };
}

export function CohortBuilderPage() {
  const [result, setResult] = useState<CohortResponse | null>(null);
  const reducedMotion = useReducedMotion();

  const animationClass = reducedMotion ? '' : 'animate-fade-in';

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="text-heading font-semibold text-[var(--color-text)]">
          Research Dashboard
        </h1>
        <h2 className="text-[18px] font-semibold text-[var(--color-text)] mt-1">
          Cohort Builder
        </h2>
      </div>

      {/* Filter form */}
      <CohortBuilderForm onResult={setResult} />

      {/* Results area — space-y-12 between cohort builder and chart panel */}
      <div className="space-y-12 mt-12">
        {result === null && (
          <EmptyState
            title="Run a cohort to see retention curves."
            body="Select filters above and click Run Cohort to generate results."
            inline
          />
        )}

        {result !== null && result.suppressed && (
          <div
            className={`min-h-[48px] flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--color-warning-soft)] ${animationClass}`}
            role="alert"
          >
            <span className="text-[13px] font-semibold text-[var(--color-warning)]">
              Cohort suppressed — k&lt;5 at the selected filters.
            </span>
          </div>
        )}

        {result !== null && !result.suppressed && (
          <div className={`space-y-8 ${animationClass}`}>
            <RetentionChart
              data={extractRetentionData(result.data)}
              epsilon={result.epsilon}
            />
            <CrossTabMatrix
              rows={extractCrossTabData(result.data).rows}
              columns={extractCrossTabData(result.data).columns}
              epsilon={result.epsilon}
              suppressedBuckets={result.suppressed_buckets}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default CohortBuilderPage;
