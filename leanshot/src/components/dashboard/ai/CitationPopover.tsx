/**
 * Phase 60 Plan 60-10 Task 4 — CitationPopover component.
 *
 * Displays source metadata for a citation chunk:
 *   - Source title (linked to canonical_url, target=_blank)
 *   - TierBadge
 *   - Verbatim quote (DOMPurify-sanitized, 280-char truncation)
 *   - Freshness strip ("As of YYYY-MM-DD" + optional "May be outdated" pill)
 *   - LeanShot Research disclosure (when source_type='leanshot_research')
 *   - "Open source ↗" ghost button
 *   - Disclaimer line
 *
 * Surface:
 *   - ≥md: floating Popover positioned relative to anchorEl (320px max-width)
 *   - <md: bottom Sheet
 *
 * a11y: role="dialog" + aria-modal="true" + focus trap + ESC close +
 *       ←/→ sibling cycling + return-focus-to-marker on close.
 *
 * Telemetry: fires 'rag_citation_clicked' via server-rag-events-relay on
 * successful chunk load (ad-block immune via Edge Fn relay).
 *
 * T-60-10-XSS-1: verbatim_quote ALWAYS passes through sanitizeVerbatimQuote()
 * before dangerouslySetInnerHTML.
 */

import {
  useEffect, useRef, useState, useCallback,
  type ReactNode,
} from 'react';
import { X, ExternalLink, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { TierBadge } from '@/components/admin/rag/TierBadge';
import { Badge } from '@/components/ui/Badge';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/helpers';
import { useRagTranslation } from '@/lib/rag/i18n';
import { ragChunkById, type RagChunkResult } from '@/lib/rag/retrieve-client';
import { sanitizeVerbatimQuote } from '@/lib/rag/dompurify-config';
import { captureRagEventBrowser } from '@/lib/rag/server-rag-events-relay';
import { useReducedMotion } from '@/hooks/useReducedMotion';

// ─── Constants ────────────────────────────────────────────────────────────────

const VERBATIM_TRUNCATE_CHARS = 280;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return isoString;
  }
}

function truncateQuote(quote: string): { display: string; truncated: boolean } {
  if (quote.length <= VERBATIM_TRUNCATE_CHARS) {
    return { display: quote, truncated: false };
  }
  return { display: quote.slice(0, VERBATIM_TRUNCATE_CHARS) + '…', truncated: true };
}

// ─── Focus trap ───────────────────────────────────────────────────────────────

function getFocusable(el: HTMLElement): HTMLElement[] {
  return Array.from(
    el.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((n) => !n.hasAttribute('data-focus-guard'));
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CitationPopoverProps {
  chunkId: string;
  anchorEl: HTMLElement | null;
  siblings?: string[];
  onClose: () => void;
  onCycle?: (nextChunkId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CitationPopover({
  chunkId,
  anchorEl,
  siblings,
  onClose,
  onCycle,
}: CitationPopoverProps) {
  const { t } = useRagTranslation();
  const reducedMotion = useReducedMotion();

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'loaded'; chunk: RagChunkResult }
    | { status: 'error' }
  >({ status: 'loading' });

  const dialogRef = useRef<HTMLDivElement>(null);

  // Determine ≥md layout
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Load chunk + fire telemetry
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    void ragChunkById(chunkId).then((chunk) => {
      if (cancelled) return;
      if (chunk == null) {
        setState({ status: 'error' });
        return;
      }
      setState({ status: 'loaded', chunk });
      // Fire telemetry AFTER successful load
      void captureRagEventBrowser('rag_citation_clicked', {
        chunk_id: chunkId,
        source_tier: chunk.source_tier,
        source_type: chunk.source_type,
        topic_tag: chunk.topic_tag,
        surface: 'coach',
      });
    });

    return () => { cancelled = true; };
  }, [chunkId]);

  // Return focus to anchor on close
  const handleClose = useCallback(() => {
    onClose();
    // Return focus to marker after close
    requestAnimationFrame(() => {
      anchorEl?.focus();
    });
  }, [onClose, anchorEl]);

  // Focus trap + keyboard handling
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    // Set initial focus
    const firstFocusable = getFocusable(el)[0];
    firstFocusable?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      // Sibling cycling with ← / →
      if (siblings && siblings.length > 0) {
        const currentIdx = siblings.indexOf(chunkId);
        if (e.key === 'ArrowLeft' && currentIdx > 0) {
          e.preventDefault();
          handleClose();
          onCycle?.(siblings[currentIdx - 1]);
          return;
        }
        if (e.key === 'ArrowRight' && currentIdx < siblings.length - 1) {
          e.preventDefault();
          handleClose();
          onCycle?.(siblings[currentIdx + 1]);
          return;
        }
      }

      // Focus trap: Tab / Shift+Tab cycle within dialog
      if (e.key === 'Tab') {
        const focusable = getFocusable(el);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement;

        if (e.shiftKey) {
          if (active === first || !el.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !el.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [chunkId, siblings, handleClose, onCycle]);

  // ── Compute popover position (desktop) ──────────────────────────────────────
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isDesktop || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = 320;
    let left = rect.right + 8;
    // Flip to left if it would overflow viewport
    if (left + popoverWidth > window.innerWidth - 8) {
      left = rect.left - popoverWidth - 8;
    }
    setPosition({ top: rect.top + window.scrollY, left });
  }, [isDesktop, anchorEl]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderContent = (): ReactNode => {
    if (state.status === 'loading') {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse space-y-3 w-full">
            <div className="h-4 bg-[var(--color-border)] rounded w-3/4" />
            <div className="h-4 bg-[var(--color-border)] rounded w-full" />
            <div className="h-4 bg-[var(--color-border)] rounded w-5/6" />
          </div>
        </div>
      );
    }

    if (state.status === 'error') {
      return (
        <div className="flex items-start gap-2 py-4 text-[var(--color-text-secondary)]">
          <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden />
          <p className="text-[13px]">Couldn&apos;t load source details. Try again.</p>
        </div>
      );
    }

    const { chunk } = state;
    const { display: displayQuote, truncated } = truncateQuote(chunk.verbatim_quote);
    const sanitizedQuote = sanitizeVerbatimQuote(displayQuote);
    const dateDisplay = chunk.last_reviewed_at ? formatDate(chunk.last_reviewed_at) : formatDate(chunk.scraped_at);

    return (
      <div className="space-y-3">
        {/* Source title + TierBadge */}
        <div className="flex items-start gap-2">
          <a
            href={chunk.canonical_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-semibold text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors flex-1 min-w-0 truncate"
            id="citation-popover-source-name"
          >
            {chunk.source_name}
          </a>
          <TierBadge tier={chunk.source_tier} />
        </div>

        {/* Verbatim quote block (DOMPurify-sanitized — T-60-10-XSS-1) */}
        <div
          className="text-[13px] border-l-2 border-[var(--color-primary)] bg-[var(--color-surface-elevated)] px-3 py-2 rounded-r-sm"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: sanitizedQuote }}
        />
        {truncated && (
          <a
            href={chunk.canonical_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[var(--color-primary)] hover:underline"
          >
            {t('popover.read_full_chunk')}
          </a>
        )}

        {/* Freshness strip */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {t('popover.last_reviewed', { date: dateDisplay })}
          </span>
          {chunk.stale && (
            <Badge tone="warning">
              {t('popover.may_be_outdated')}
            </Badge>
          )}
        </div>

        {/* LeanShot Research disclosure */}
        {chunk.source_type === 'leanshot_research' && (
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            {t('popover.leanshot_research_disclosure')}
          </p>
        )}

        {/* Open source link */}
        <a
          href={chunk.canonical_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[13px] text-[var(--color-primary)] hover:underline font-normal"
        >
          <ExternalLink className="size-3" aria-hidden />
          {t('popover.open_source')}
        </a>

        {/* Disclaimer */}
        <p className="text-[11px] text-[var(--color-text-tertiary)] border-t border-[var(--color-border)] pt-2">
          {t('disclaimer')}
        </p>
      </div>
    );
  };

  // ── Desktop floating popover ─────────────────────────────────────────────────

  if (isDesktop) {
    return (
      <AnimatePresence>
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="citation-popover-source-name"
          style={{ top: position.top, left: position.left, maxWidth: 320 }}
          initial={reducedMotion ? {} : { opacity: 0, scale: 0.95 }}
          animate={reducedMotion ? {} : { opacity: 1, scale: 1 }}
          exit={reducedMotion ? {} : { opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className={cn(
            'fixed z-[200] w-[320px] bg-[var(--color-surface)] border border-[var(--color-border)]',
            'rounded-card shadow-2xl p-4 space-y-0',
          )}
          // Stop click propagation so clicking inside doesn't close the panel backdrop
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={handleClose}
              aria-label={t('popover.close_aria')}
              className="p-1 rounded-full hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <X className="size-4" />
            </button>
          </div>
          {renderContent()}
        </motion.div>
      </AnimatePresence>
    );
  }

  // ── Mobile bottom Sheet ──────────────────────────────────────────────────────

  return (
    <Sheet
      open
      onClose={handleClose}
      title={
        state.status === 'loaded'
          ? state.chunk.source_name
          : state.status === 'loading'
            ? '…'
            : 'Source'
      }
    >
      <div ref={dialogRef} role="dialog" aria-modal="true">
        {renderContent()}
      </div>
    </Sheet>
  );
}
