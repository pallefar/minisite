/**
 * Phase 62 Plan 62-06 Task 1 — Mandatory differential privacy disclosure footer.
 *
 * Rendered on EVERY /research/<slug> public page. Never optional, never behind a flag.
 * T-62-06-04 mitigation: component is unconditionally included in ResearchArticlePage.
 *
 * UI-SPEC §Surface 4 DP Methods Footer:
 *  - Container: var(--color-surface-elevated) bg, var(--color-border) border, rounded-card
 *  - Section heading: "Methods & Privacy" (13px/600)
 *  - 4 dl/dt/dd pairs (sr-only dt labels) at 11px/400 font-mono tabular-nums text-secondary
 *  - Clarifying note: 13px/400 text-tertiary
 *  - aria-label="Differential privacy disclosure" on container
 */

export interface DpMethodsFooterProps {
  /** Epsilon parameter (0.5 for public publications, 1.0 for admin output) */
  epsilon: number;
  /** k (≥5 always, per k-floor enforcement) */
  cohortSize: number;
  /** Count of suppressed sub-groups (cohorts below k-floor) */
  suppressedBuckets: number;
}

export function DpMethodsFooter({ epsilon, cohortSize, suppressedBuckets }: DpMethodsFooterProps) {
  return (
    <aside
      aria-label="Differential privacy disclosure"
      className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4 mt-8 space-y-2"
    >
      <p className="text-[13px] font-semibold text-[var(--color-text)]">Methods &amp; Privacy</p>
      <dl className="space-y-1">
        <div className="flex gap-2">
          <dt className="sr-only">Differential privacy</dt>
          <dd className="font-mono tabular-nums text-[11px] text-[var(--color-text-secondary)]">
            Differential privacy: ε = {epsilon} (Laplace mechanism)
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">Cohort size</dt>
          <dd className="font-mono tabular-nums text-[11px] text-[var(--color-text-secondary)]">
            Cohort size: {cohortSize} participants
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">Suppressed buckets</dt>
          <dd className="font-mono tabular-nums text-[11px] text-[var(--color-text-secondary)]">
            Suppressed buckets: {suppressedBuckets}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">Date binning</dt>
          <dd className="font-mono tabular-nums text-[11px] text-[var(--color-text-secondary)]">
            Date binning: weekly aggregates only
          </dd>
        </div>
      </dl>
      <p className="text-[13px] text-[var(--color-text-tertiary)]">
        Individual data is never included. Cohorts with fewer than 5 participants are suppressed
        entirely.
      </p>
    </aside>
  );
}

export default DpMethodsFooter;
