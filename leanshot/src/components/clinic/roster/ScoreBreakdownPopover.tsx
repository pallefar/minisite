/**
 * Phase 10 Plan 10-06 — ScoreBreakdownPopover.
 *
 * Modal-like popover anchored to the ScoreChip that opened it.
 * Renders per-signal weight rows from breakdown jsonb.
 * Accessibility:
 *   - role="dialog" aria-modal aria-labelledby
 *   - Close on Escape
 *   - Focus trap (Tab cycles within popover)
 *   - Focus returns to the ScoreChip button on close
 *
 * Per UI-SPEC: signal labels in font-mono text-sm.
 * Per 10-EVENTS.md: PostHog clinic_rank_breakdown_expanded fires in
 * ScoreChip (the caller) when the popover opens — not in this component.
 */
import { useEffect, useRef } from 'react';

export interface ScoreBreakdownPopoverProps {
  score: number;
  breakdown: Record<string, number>;
  onClose: () => void;
}

function toHumanLabel(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function ScoreBreakdownPopover({
  score,
  breakdown,
  onClose,
}: ScoreBreakdownPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const titleId = 'breakdown-popover-heading';

  // Focus first focusable element on open
  useEffect(() => {
    const el = popoverRef.current?.querySelector<HTMLElement>(
      'button, [tabindex="0"]',
    );
    el?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Focus trap within popover
  useEffect(() => {
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !popoverRef.current) return;
      const focusable = popoverRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-card shadow-lg p-5 w-[320px] max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id={titleId} className="text-[18px] font-semibold text-[var(--color-text)]">
            Score breakdown
          </h2>
          <button
            type="button"
            aria-label="Close score breakdown"
            onClick={onClose}
            className="size-8 flex items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            ✕
          </button>
        </div>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-3 leading-snug">
          Each signal contributes to the overall score. Higher numbers mean more attention.
        </p>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
          Total score: <span className="font-semibold font-mono numerals-tabular">{score}</span>/100
        </p>
        <dl className="space-y-2">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center justify-between text-[13px]"
            >
              <dt className="text-[var(--color-text)] font-mono">{toHumanLabel(key)}:</dt>
              <dd className="font-semibold font-mono numerals-tabular text-[var(--color-text)]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
