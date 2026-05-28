/**
 * Phase 10 Plan 10-06 — ScoreChip component.
 *
 * Renders the score numeral inside a color-coded pill per bucket:
 *   low  (0-29)  → sage background
 *   mid  (30-69) → neutral/secondary background
 *   high (70-100)→ warning background
 *
 * Permission gate (D-13):
 *   - canViewBreakdown=false (Viewer role) → read-only span.
 *   - canViewBreakdown=true (Coach/Owner) → button that opens
 *     ScoreBreakdownPopover; fires PostHog clinic_rank_breakdown_expanded.
 *
 * Score numerals use font-mono + numerals-tabular for column alignment
 * per UI-SPEC typography contract.
 */
import { useState } from 'react';
import { CLINIC_EVENTS, scoreBucket } from '@/lib/clinic-events';
import { ScoreBreakdownPopover } from './ScoreBreakdownPopover';

export interface ScoreChipProps {
  score: number;
  breakdown: Record<string, number>;
  canViewBreakdown: boolean;
}

const bucketStyles: Record<'low' | 'mid' | 'high', string> = {
  low: 'bg-[var(--color-sage)] text-[var(--color-text-on-sage,#0f302c)]',
  mid: 'bg-[var(--color-text-tertiary,#7a9e9a)] text-[var(--color-surface,#fdfbf6)]',
  high: 'bg-[var(--color-warning)] text-[var(--color-text-on-warning,#0f302c)]',
};

const bucketLabel: Record<'low' | 'mid' | 'high', string> = {
  low: 'healthy',
  mid: 'monitor',
  high: 'needs attention',
};

export function ScoreChip({ score, breakdown, canViewBreakdown }: ScoreChipProps) {
  const [open, setOpen] = useState(false);
  const bucket = scoreBucket(score);
  const colorClass = bucketStyles[bucket];
  const label = bucketLabel[bucket];

  const inner = (
    <span
      className={`inline-flex items-center justify-center min-w-[40px] h-6 rounded-pill px-2 text-[13px] font-semibold font-mono numerals-tabular ${colorClass}`}
    >
      {score}
    </span>
  );

  if (!canViewBreakdown) {
    return (
      <span aria-label={`Score ${score} of 100, ${label}`} title={`Score ${score} of 100`}>
        {inner}
      </span>
    );
  }

  const handleOpen = () => {
    setOpen(true);
    // PHI-safe: only score_bucket, no raw score value
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).posthog?.capture(CLINIC_EVENTS.RANK_BREAKDOWN_EXPANDED, {
        score_bucket: bucket,
      });
    } catch {
      // PostHog unavailable — ignore
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Score ${score} of 100, ${label}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Click to see what's driving this score"
        onClick={handleOpen}
        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1 rounded-pill"
      >
        {inner}
      </button>
      {open && (
        <ScoreBreakdownPopover score={score} breakdown={breakdown} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
