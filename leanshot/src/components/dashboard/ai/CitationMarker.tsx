/**
 * Phase 60 Plan 60-10 Task 4 — CitationMarker component.
 *
 * Renders a [N] superscript button (inline in assistant message text).
 * Activates CitationPopover on click/tap.
 *
 * UI-SPEC §3 invariant 10 exception:
 *   - Visible badge: 14×14px rounded-full, text-[11px] font-semibold, info tone
 *   - Tap target: p-[5px] padding → 5+14+5 = 24px minimum hit area
 *
 * a11y: aria-label via i18n key 'citation_marker.aria' (e.g. "Open citation 3").
 */

import { useRagTranslation } from '@/lib/rag/i18n';
import { cn } from '@/lib/helpers';

export interface CitationMarkerProps {
  /** 1-based numeric index shown in the marker (e.g. [1], [2], [3]). */
  refIndex: number;
  /** UUID of the chunk this marker references. */
  chunkId: string;
  /** Called with (chunkId, anchorElement) when the marker is activated. */
  onActivate: (chunkId: string, anchorEl: HTMLElement) => void;
  className?: string;
}

export function CitationMarker({ refIndex, chunkId, onActivate, className }: CitationMarkerProps) {
  const { t } = useRagTranslation();

  return (
    <button
      type="button"
      aria-label={t('citation_marker.aria', { n: refIndex })}
      onClick={(e) => {
        e.preventDefault();
        onActivate(chunkId, e.currentTarget);
      }}
      className={cn(
        // p-[5px]: 5+14+5 = 24px minimum tap target (UI-SPEC §3 invariant 10)
        'inline-flex items-center justify-center p-[5px] align-text-top',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        'rounded-full',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // Visible badge: 14px × 14px, info tone, text-[11px] semibold
          'h-[14px] min-w-[14px] inline-flex items-center justify-center',
          'rounded-full bg-[var(--color-info-soft)] text-[var(--color-info)]',
          'text-[11px] font-semibold leading-none px-[2px]',
        )}
      >
        [{refIndex}]
      </span>
    </button>
  );
}
