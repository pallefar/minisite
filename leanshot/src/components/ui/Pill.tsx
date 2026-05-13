import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/helpers';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: 'sm' | 'md';
  leadingIcon?: ReactNode;
  /** Phase 13 DS-07: optional right-aligned count chip (decorative; aria-hidden). */
  count?: number | string;
  /**
   * Phase 13 DS-07: square icon-only pill (no text). Container collapses to
   * aspect-square sized by `size`. Drops the gap so the single icon centers.
   * @requires aria-label when iconOnly is true (enforced at consumer level via
   * jsx-a11y/aria-label-has-name; this prop intentionally avoids the conditional-
   * type ceremony so refresh-in-place stays additive — see 13-02-PLAN.md Task 3).
   */
  iconOnly?: boolean;
}

export function Pill({
  active,
  size = 'md',
  leadingIcon,
  count,
  iconOnly,
  className,
  children,
  ...rest
}: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex items-center rounded-pill border font-medium transition-[transform,background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] active:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-50',
        iconOnly ? 'justify-center' : 'gap-1.5',
        iconOnly
          ? size === 'sm'
            ? 'h-8 w-8 p-0'
            : 'h-10 w-10 p-0'
          : size === 'sm'
            ? 'h-8 px-3 text-[12px]'
            : 'h-10 px-4 text-[13px]',
        active
          ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm'
          : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)]',
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
      {/* Phase 13 DS-07: count chip — decorative; count semantic is in surrounding label */}
      {count !== undefined && (
        <span
          aria-hidden
          className={cn(
            'ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold tabular-nums',
            active
              ? 'bg-white/20 text-[var(--color-primary-foreground)]'
              : 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export interface PillGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Phase 13 DS-07: render as a joined segmented control (role="tablist"),
   * with adjacent pills sharing borders and outer pills retaining the pill radius.
   */
  segmented?: boolean;
}

export function PillGroup({ children, className, segmented, ...rest }: PillGroupProps) {
  return (
    <div
      role={segmented ? 'tablist' : 'group'}
      className={cn(
        segmented
          ? 'inline-flex [&>button]:rounded-none [&>button:first-child]:rounded-l-pill [&>button:last-child]:rounded-r-pill [&>button:not(:first-child)]:-ml-px'
          : 'flex flex-wrap gap-1.5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
