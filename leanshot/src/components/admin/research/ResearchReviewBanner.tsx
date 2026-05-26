/**
 * Phase 62 Plan 62-05 — ResearchReviewBanner.
 *
 * Full-width warning banner rendered above the editor grid when a publication is
 * in the `in_review` state. Verbatim mirror of ProtocolReviewBanner.tsx per
 * PATTERNS.md lines 18-63 and [[feedback_planner_prompt_explicit_reuse_targets]].
 *
 * Two visual modes:
 *  - Author view (isAuthor=true): banner only, NO Publish CTA.
 *    Critical 2-person review invariant: the Publish button is NEVER present in the
 *    DOM for authors — full conditional render, not disabled+hidden.
 *  - Reviewer view (isAuthor=false): banner + Publish Research CTA.
 *
 * Color tokens: --color-rose-soft (background) + --color-warning (text + icon).
 * Both tokens verified in src/index.css @theme.
 *
 * Typography: text-[13px] font-semibold (warning text) per Phase 60 BLOCKER lesson.
 */
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ResearchReviewBannerProps {
  isAuthor: boolean;
  reviewerName?: string;
  onPublish?: () => Promise<void>;
  publishing?: boolean;
}

export function ResearchReviewBanner({
  isAuthor,
  reviewerName,
  onPublish,
  publishing,
}: ResearchReviewBannerProps) {
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
              Publish Research
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default ResearchReviewBanner;
