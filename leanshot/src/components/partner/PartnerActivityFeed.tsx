/**
 * Phase 19 Plan 19-06a — PartnerActivityFeed.
 *
 * Spec references:
 *   - 19-UI-SPEC.md §/partner/dashboard activity feed (row anatomy + empty state)
 *   - Status badge mapping: UI-SPEC §Color §Semantic states
 *
 * Row schema: `[date col-span-3] [status col-span-2] [commission col-span-2] [subscription_id col-span-5 truncate]`.
 */
import { type ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ConversionRow } from '@/lib/affiliate/api';

export interface PartnerActivityFeedProps {
  rows: ConversionRow[];
}

const STATUS_TONES: Record<
  ConversionRow['status'],
  { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }
> = {
  pending: { tone: 'warning', label: 'Pending' },
  confirmed: { tone: 'success', label: 'Confirmed' },
  flagged: { tone: 'danger', label: 'Flagged' },
  rejected: { tone: 'neutral', label: 'Rejected' },
  paid: { tone: 'success', label: 'Paid' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDollars(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

export function PartnerActivityFeed({ rows }: PartnerActivityFeedProps): ReactNode {
  return (
    <Card span={12} padding="md">
      <CardHeader title="Recent conversions" />
      {rows.length === 0 ? (
        <EmptyState
          title="No conversions yet"
          body="Your dashboard updates within 10 minutes of a paid referral. Share your link to get started."
          inline
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => {
            const meta = STATUS_TONES[row.status];
            return (
              <li key={row.id} className="grid grid-cols-12 gap-2 py-2 text-sm items-center">
                <span className="col-span-3 text-[var(--color-text-secondary)]">
                  {formatDate(row.created_at)}
                </span>
                <span className="col-span-2">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </span>
                <span className="col-span-2 font-semibold tabular-nums text-[var(--color-text)]">
                  {formatDollars(row.commission_cents)}
                </span>
                <span className="col-span-5 text-[var(--color-text-secondary)] truncate font-mono text-xs">
                  {row.subscription_id ?? '—'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
