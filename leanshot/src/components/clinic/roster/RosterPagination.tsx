/**
 * Phase 10 Plan 10-06 — RosterPagination.
 *
 * Previous / Next buttons + "Showing X–Y of N" count label.
 * Per UI-SPEC: button disabled state includes descriptive aria-label.
 */
import { Button } from '@/components/ui/Button';

export interface RosterPaginationProps {
  offset: number;
  limit: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function RosterPagination({
  offset,
  limit,
  total,
  onPrevious,
  onNext,
}: RosterPaginationProps) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const isFirst = offset === 0;
  const isLast = end >= total;

  return (
    <div className="flex items-center justify-between gap-4 pt-2">
      <span className="text-[13px] text-[var(--color-text-secondary)]">
        {total === 0 ? 'No patients' : `Showing ${start}–${end} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={isFirst}
          onClick={onPrevious}
          aria-label={
            isFirst
              ? 'Previous page (disabled, you\'re on the first page)'
              : 'Previous page'
          }
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={isLast}
          onClick={onNext}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
