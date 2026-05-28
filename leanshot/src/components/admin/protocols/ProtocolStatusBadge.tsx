/**
 * Phase 61 Plan 61-04 — ProtocolStatusBadge.
 *
 * Thin Badge wrapper for protocol_review_state ENUM.
 * Mirroring TierBadge.tsx structure verbatim with protocol status substitutions.
 *
 * Tone mapping (UI-SPEC §Color):
 *   draft     → neutral
 *   in_review → warning
 *   published → success
 *   archived  → neutral + opacity-60 (muted intent; Badge does not have 'muted' tone)
 *
 * Typography: text-[11px] via Badge primitive (inherits tracking-[0.02em] font-semibold).
 */
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import type { ProtocolReviewState } from '@/types/protocols';

const TONE_MAP: Record<ProtocolReviewState, BadgeTone> = {
  draft: 'neutral',
  in_review: 'warning',
  published: 'success',
  archived: 'neutral',
};

const ARIA_MAP: Record<ProtocolReviewState, string> = {
  draft: 'Protocol status: draft',
  in_review: 'Protocol status: pending review',
  published: 'Protocol status: published',
  archived: 'Protocol status: archived',
};

const LABEL_MAP: Record<ProtocolReviewState, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

export function ProtocolStatusBadge({ status }: { status: ProtocolReviewState }) {
  return (
    <Badge
      tone={TONE_MAP[status]}
      aria-label={ARIA_MAP[status]}
      className={status === 'archived' ? 'opacity-60' : undefined}
    >
      {LABEL_MAP[status]}
    </Badge>
  );
}

export default ProtocolStatusBadge;
