/**
 * Phase 10 Plan 10-09 — PatientActivityRow component.
 *
 * Renders a single audit-log row in the PatientActivityModal.
 *
 * Two formats:
 *   - Operator-views: `{relative-time} — {actor name} ({role badge}) viewed your {section name}`
 *   - Ranking-events: `{relative-time} — Your data triggered a clinical-attention flag …` +
 *     "Why?" expander link → breakdown_snapshot top-3 signals.
 *
 * D-19: NO posthog.capture calls in this component.
 * D-20: actor_display_name falls back to "a clinic member" (supplied by Edge Function).
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';

interface ActivityRowProps {
  row: {
    id: number;
    timestamp: string;
    action: string;
    actor_display_name: string;
    actor_role: string | null;
    metadata: Record<string, unknown> | null;
    org_id: string | null;
  };
  orgName: string;
}

/** Relative time formatter matching the ActiveOrganizationsSection pattern. */
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then; // positive = in the past
  const abs = Math.abs(diffMs);
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (abs < min) return 'just now';
  if (abs < hr) {
    const m = Math.round(abs / min);
    return `${m}m ago`;
  }
  if (abs < day) {
    const h = Math.round(abs / hr);
    return `${h}h ago`;
  }
  const d = Math.round(abs / day);
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

/** Map action enum to human section label (UI-SPEC L273). */
const ACTION_SECTION_MAP: Record<string, string> = {
  section_view: 'data',
  'patient_data.read': 'data',
  'patient_photos.read': 'photos',
  clinic_snapshot_loaded: 'data',
};

function sectionLabel(action: string, metadata: Record<string, unknown> | null): string {
  // If metadata has a section field, use it (D-21 per-section granularity)
  if (metadata?.section && typeof metadata.section === 'string') {
    return metadata.section;
  }
  return ACTION_SECTION_MAP[action] ?? 'data';
}

/**
 * Extract top-3 signals from breakdown_snapshot (D-18 metadata shape).
 * breakdown_snapshot: { missed_dose: N, symptom_severity: N, weight_trend: N, ... }
 */
function top3Signals(breakdown: Record<string, unknown>): string {
  const entries = Object.entries(breakdown)
    .filter(([, v]) => typeof v === 'number')
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 3)
    .map(([key]) => key.replace(/_/g, ' '));
  return entries.join(', ') || 'no signals';
}

export function PatientActivityRow({ row, orgName }: ActivityRowProps) {
  const [expanded, setExpanded] = useState(false);

  const time = relTime(row.timestamp);
  const isRanking = row.action === 'rank_threshold_crossed';

  if (isRanking) {
    const metadata = row.metadata ?? {};
    const score = typeof metadata.score === 'number' ? metadata.score : null;
    const breakdown = typeof metadata.breakdown_snapshot === 'object' && metadata.breakdown_snapshot !== null
      ? (metadata.breakdown_snapshot as Record<string, unknown>)
      : {};
    const signals = top3Signals(breakdown);
    const detailsId = `ranking-${row.id}-details`;

    return (
      <div
        className="py-3 border-b border-[var(--color-border)] last:border-b-0 space-y-1"
        data-testid={`activity-row-${row.id}`}
      >
        <p className="text-[13px] text-[var(--color-text)] leading-snug">
          <span className="font-mono text-[var(--color-text-secondary)]">{time}</span>
          <span aria-hidden> — </span>
          Your data triggered a clinical-attention flag in {orgName}&apos;s ranking.{' '}
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label="Show what triggered this flag"
            onClick={() => setExpanded((v) => !v)}
            className="text-[var(--color-primary)] underline underline-offset-2 text-[13px] font-medium hover:opacity-80 transition-opacity"
          >
            Why?
          </button>
        </p>

        {expanded && (
          <div
            id={detailsId}
            role="region"
            aria-label="What triggered this flag"
            className="mt-2 rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-3 space-y-1"
          >
            <p className="text-[13px] font-semibold text-[var(--color-text)]">
              What triggered this flag
            </p>
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug">
              {score !== null ? `Score: ${score}/100. ` : ''}
              Top contributing signals: {signals}.
            </p>
          </div>
        )}
      </div>
    );
  }

  // Operator-views row
  const section = sectionLabel(row.action, row.metadata);

  return (
    <div
      className="py-3 border-b border-[var(--color-border)] last:border-b-0 flex items-start gap-2"
      data-testid={`activity-row-${row.id}`}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-[13px] text-[var(--color-text)] leading-snug">
          <span className="font-mono text-[var(--color-text-secondary)]">{time}</span>
          <span aria-hidden> — </span>
          <span className="font-medium">{row.actor_display_name}</span>{' '}
          {row.actor_role && (
            <Badge tone="neutral" className="text-[11px] align-middle">
              {row.actor_role}
            </Badge>
          )}{' '}
          viewed your {section}
        </p>
      </div>
    </div>
  );
}
