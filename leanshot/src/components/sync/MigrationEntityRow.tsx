/**
 * Phase 6 Plan 06-02 — single entity row inside MigrationModal's checklist.
 *
 * Visual contract per 06-UI-SPEC §1 entity-row anatomy:
 *   - Leading icon: state-derived (Check / Loader2 / AlertCircle / Circle)
 *   - Plural noun + count (or "—" when pending; "X of Y" when in-progress)
 *   - Optional ProgressBar (thin) when status === 'in-progress' AND total > 0
 *   - "Retry" link when status === 'error' (deferred to per-entity retry in 06-05)
 *
 * Color tokens use CSS variables EXCLUSIVELY (Pattern E — no Tailwind palette
 * keys) so the row inherits theme switches without component changes.
 */
import { AlertCircle, Check, Circle, Loader2 } from 'lucide-react';
import { ProgressBar } from '@/components/ui/ProgressRing';

export type MigrationEntityRowStatus = 'pending' | 'in-progress' | 'complete' | 'error';

export interface MigrationEntityRowProps {
  /** Plural-noun, title-case display name (e.g. "Injections", "Photos"). */
  name: string;
  status: MigrationEntityRowStatus;
  /** Current upload count (for in-progress / error states). */
  uploaded?: number;
  /** Target row count (for complete / in-progress / error states). */
  total?: number;
  /** Shown as a "Retry" link when status === 'error'. Deferred wiring to 06-05. */
  onRetry?: () => void;
}

export function MigrationEntityRow({
  name,
  status,
  uploaded = 0,
  total = 0,
  onRetry,
}: MigrationEntityRowProps) {
  const icon =
    status === 'complete' ? (
      <Check className="size-4 text-[var(--color-success)]" aria-hidden />
    ) : status === 'in-progress' ? (
      <Loader2 className="size-4 text-[var(--color-primary)] animate-spin" aria-hidden />
    ) : status === 'error' ? (
      <AlertCircle className="size-4 text-[var(--color-danger)]" aria-hidden />
    ) : (
      <Circle className="size-4 text-[var(--color-text-tertiary)]" aria-hidden />
    );

  // Count rendering per 06-UI-SPEC §1 table. Pending shows an em-dash
  // placeholder; complete shows the final tally; transient states show progress.
  const countText =
    status === 'complete' ? `${total}` : status === 'pending' ? '—' : `${uploaded} of ${total}`;

  const statusAnnouncement = status === 'in-progress' ? 'in progress' : status;
  const ariaLabel = `${name}: ${countText}, ${statusAnnouncement}`;

  return (
    <li
      aria-busy={status === 'in-progress'}
      aria-label={ariaLabel}
      className="flex flex-col py-2.5 border-t border-[var(--color-border)] first:border-t-0"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {icon}
          <span className="text-[13px] font-semibold tabular-nums text-[var(--color-text)]">
            {name}
          </span>
        </div>
        <span className="text-[13px] font-semibold tabular-nums text-[var(--color-text-secondary)]">
          {countText}
          {status === 'error' && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-2 underline text-[var(--color-danger)]"
            >
              Retry
            </button>
          )}
        </span>
      </div>
      {status === 'in-progress' && total > 0 && (
        <ProgressBar
          value={Math.round((uploaded / total) * 100)}
          thickness="thin"
          color="var(--color-primary)"
          className="mt-1.5"
        />
      )}
    </li>
  );
}
