/**
 * Phase 60 Plan 60-10 Task 5 — SourcesFooter component.
 *
 * Collapsible footer showing the list of cited sources for an AI coach reply.
 * Default state: collapsed.
 *
 * a11y:
 *   - aria-expanded on the toggle button
 *   - aria-live="polite" on the expanding region (screen readers narrate on expand)
 *   - Numbered list format: [N] source_name TierBadge truncated-url
 *
 * Telemetry: fires 'rag_sources_footer_expanded' once per false→true transition.
 * Returns null when citations array is empty.
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { TierBadge } from '@/components/admin/rag/TierBadge';
import { cn } from '@/lib/helpers';
import { useRagTranslation } from '@/lib/rag/i18n';
import { captureRagEventBrowser } from '@/lib/rag/server-rag-events-relay';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SourceCitationEntry {
  chunkId: string;
  refIndex: number;
  sourceName: string;
  sourceTier: 'A' | 'B' | 'C';
  canonicalUrl: string;
}

export interface SourcesFooterProps {
  citations: SourceCitationEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const URL_TRUNCATE_CHARS = 32;

function truncateUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const lastSegment = pathname.split('/').filter(Boolean).pop() ?? url;
    if (lastSegment.length <= URL_TRUNCATE_CHARS) return lastSegment;
    return '…' + lastSegment.slice(-URL_TRUNCATE_CHARS);
  } catch {
    return url.length > URL_TRUNCATE_CHARS ? '…' + url.slice(-URL_TRUNCATE_CHARS) : url;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SourcesFooter({ citations }: SourcesFooterProps) {
  const { t } = useRagTranslation();
  const [expanded, setExpanded] = useState(false);

  // Return null for empty citations (UI-SPEC: no empty footer)
  if (citations.length === 0) return null;

  const handleToggle = () => {
    const nextExpanded = !expanded;
    if (nextExpanded) {
      // Fire telemetry on false→true transition only
      void captureRagEventBrowser('rag_sources_footer_expanded', { count: citations.length });
    }
    setExpanded(nextExpanded);
  };

  return (
    <div className="mt-2 border-t border-[var(--color-border)] pt-2">
      {/* Toggle button */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t('sources_footer.aria', { count: citations.length })}
        onClick={handleToggle}
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]',
          'hover:text-[var(--color-text)] transition-colors focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-sm',
        )}
      >
        {t('sources_footer.label', { count: citations.length })}
        {expanded ? (
          <ChevronUp className="size-3.5" aria-hidden />
        ) : (
          <ChevronDown className="size-3.5" aria-hidden />
        )}
      </button>

      {/* Expandable citation list */}
      <div
        aria-live="polite"
        className={cn(
          'overflow-hidden transition-all',
          expanded ? 'mt-2 opacity-100' : 'h-0 opacity-0',
        )}
      >
        {expanded && (
          <ul className="space-y-1.5 text-[11px]">
            {citations.map((c) => (
              <li key={c.chunkId} className="flex items-center gap-2 min-w-0">
                <span className="text-[var(--color-text-secondary)] font-semibold shrink-0">
                  [{c.refIndex}]
                </span>
                <span className="truncate text-[var(--color-text)] font-normal">
                  {c.sourceName}
                </span>
                <TierBadge tier={c.sourceTier} />
                <span className="text-[var(--color-text-tertiary)] truncate min-w-0">
                  {truncateUrl(c.canonicalUrl)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
