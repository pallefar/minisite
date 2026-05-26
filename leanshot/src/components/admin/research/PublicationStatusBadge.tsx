/**
 * Phase 62 Plan 62-05 — PublicationStatusBadge.
 *
 * Thin Badge wrapper for ResearchPublicationStatus.
 * Mirrors ProtocolStatusBadge.tsx structure verbatim with research status substitutions.
 *
 * Tone mapping (UI-SPEC §Color + plan must_haves):
 *   draft     → neutral
 *   in_review → warning
 *   published → success
 *   archived  → neutral + opacity-60 (muted intent)
 *
 * Typography: text-[11px] via Badge primitive (inherits tracking-[0.02em] font-semibold).
 */
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import type { ResearchPublicationStatus } from '@/types/research';

const TONE_MAP: Record<ResearchPublicationStatus, BadgeTone> = {
  draft:     'neutral',
  in_review: 'warning',
  published: 'success',
  archived:  'neutral',
};

const ARIA_MAP: Record<ResearchPublicationStatus, string> = {
  draft:     'Publication status: draft',
  in_review: 'Publication status: pending review',
  published: 'Publication status: published',
  archived:  'Publication status: archived',
};

const LABEL_MAP: Record<ResearchPublicationStatus, string> = {
  draft:     'Draft',
  in_review: 'In Review',
  published: 'Published',
  archived:  'Archived',
};

export function PublicationStatusBadge({ status }: { status: ResearchPublicationStatus }) {
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

export default PublicationStatusBadge;
