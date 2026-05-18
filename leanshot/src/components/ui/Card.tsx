import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '@/lib/helpers';

export type CardVariant =
  | 'default'
  | 'elevated'
  | 'interactive'
  | 'hero'
  | 'flat'
  | 'selected'
  | 'clickable'
  | 'tonal'
  | 'footer';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Span across the 12-col bento grid. */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 12;
  /** When true, applies the rise animation on mount. */
  enter?: boolean;
}

const variantClasses: Record<CardVariant, string> = {
  default:
    'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)]',
  elevated: 'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow)]',
  interactive:
    'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow)] hover:-translate-y-[2px] hover:border-[var(--color-primary-soft)] transition-[transform,box-shadow,border-color] cursor-pointer',
  hero: '',
  flat: 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)]',
  // Phase 13 D-01: additive variants for v2 design system. Defaults unchanged.
  selected:
    'bg-[var(--color-surface-elevated)] border-2 border-[var(--color-primary)] shadow-[0_0_0_4px_var(--color-primary-soft)]',
  clickable:
    'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow)] hover:-translate-y-[2px] hover:border-[var(--color-primary-soft)] transition-[transform,box-shadow,border-color] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
  tonal:
    'bg-[var(--color-primary-soft)] border border-[var(--color-primary-soft)] text-[var(--color-text)]',
  footer:
    'bg-[var(--color-surface-elevated)] border-t border-[var(--color-border)] rounded-t-none',
};

const paddingClasses: Record<NonNullable<CardProps['padding']>, string> = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-7',
};

const spanClasses: Record<NonNullable<CardProps['span']>, string> = {
  3: 'lg:col-span-3 md:col-span-6 col-span-12',
  4: 'lg:col-span-4 md:col-span-6 col-span-12',
  5: 'lg:col-span-5 md:col-span-6 col-span-12',
  6: 'lg:col-span-6 md:col-span-6 col-span-12',
  7: 'lg:col-span-7 col-span-12',
  8: 'lg:col-span-8 col-span-12',
  12: 'col-span-12',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'default', padding = 'md', span, enter, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-card relative',
        variantClasses[variant],
        paddingClasses[padding],
        span && spanClasses[span],
        enter && 'animate-rise',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

/* Header convention used by most cards. */
export interface CardHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}
export function CardHeader({ title, icon, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3 mb-4', className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <span className="size-8 rounded-xl bg-[var(--color-surface-elevated)] text-[var(--color-primary)] inline-flex items-center justify-center shrink-0">
            {icon}
          </span>
        )}
        <h2 className="text-[14px] font-semibold text-[var(--color-text)] truncate">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A skinny stat tile used on tab tops. */
export interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: { value: string; tone: 'success' | 'warning' | 'neutral' };
  span?: CardProps['span'];
}
export function StatTile({ label, value, unit, delta, span = 3 }: StatTileProps) {
  return (
    <Card span={span} padding="md" variant="default">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className="mt-1.5 text-[26px] font-bold leading-tight numerals-tabular tracking-tight">
        {value}
        {unit && (
          <span className="ms-1 text-[12px] font-medium text-[var(--color-text-secondary)]">
            {unit}
          </span>
        )}
      </div>
      {delta && (
        <div
          className={cn(
            'mt-1 text-[11px] font-semibold',
            delta.tone === 'success' && 'text-[var(--color-success)]',
            delta.tone === 'warning' && 'text-[var(--color-warning)]',
            delta.tone === 'neutral' && 'text-[var(--color-text-secondary)]',
          )}
        >
          {delta.value}
        </div>
      )}
    </Card>
  );
}
