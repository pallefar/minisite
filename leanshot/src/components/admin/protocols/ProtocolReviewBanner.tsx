/**
 * Phase 61 Plan 61-05 — ProtocolReviewBanner.
 *
 * Full-width warning banner rendered above the editor grid when a protocol is
 * in the `in_review` state.
 *
 * Two visual modes:
 *  - Author view (isAuthor=true): banner only, NO Publish CTA.
 *    Critical PROTOCOL-04 invariant: the Publish button is NEVER present in the
 *    DOM for authors — full conditional render, not disabled+hidden.
 *  - Reviewer view (isAuthor=false): banner + Publish CTA.
 *
 * Color tokens: --color-rose-soft (background) + --color-warning (text + icon).
 * Both tokens guaranteed by Plan 61-04 Task 1 (Wave 2 serialization).
 *
 * Typography: text-[13px] font-semibold (warning text) per Phase 60 BLOCKER lesson.
 */
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ProtocolReviewBannerProps {
  isAuthor: boolean;
  reviewerName?: string;
  onPublish?: () => Promise<void>;
  publishing?: boolean;
}

export function ProtocolReviewBanner({
  isAuthor,
  reviewerName,
  onPublish,
  publishing,
}: ProtocolReviewBannerProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-[var(--color-rose-soft)] mb-6">
      <Clock className="size-4 text-[var(--color-warning)] shrink-0" aria-hidden="true" />
      {isAuthor ? (
        <span className="text-[13px] font-semibold text-[var(--color-warning)]">
          Pending review by another admin
        </span>
      ) : (
        <>
          <span className="text-[13px] font-semibold text-[var(--color-warning)]">
            Review as: {reviewerName ?? 'reviewer'}
          </span>
          {onPublish && (
            <Button
              size="sm"
              variant="primary"
              loading={publishing}
              onClick={onPublish}
              className="ms-auto"
            >
              Publish Protocol
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default ProtocolReviewBanner;
