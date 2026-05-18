import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/helpers';

// Phase 13 D-01 / DS-06: tonal variant for grouped/secondary CTAs.
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'success'
  | 'inverse'
  | 'tonal';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
  /**
   * Phase 13 DS-06: optional right-aligned count chip rendered after children.
   * Decorative (aria-hidden); count semantic must live in the surrounding label.
   */
  count?: number | string;
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-pill transition-[transform,box-shadow,background-color,color,border-color] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] ' +
  'disabled:pointer-events-none disabled:opacity-50 active:translate-y-[0.5px] whitespace-nowrap select-none';

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-11 px-5 text-[14px]',
  lg: 'h-13 px-7 text-[15px] gap-2.5',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)] hover:-translate-y-[1px] hover:shadow-md shadow-sm',
  secondary:
    'bg-transparent text-[var(--color-text)] border border-[var(--color-border-strong)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
  ghost:
    'bg-[var(--color-surface-elevated)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
  destructive:
    'bg-[var(--color-danger)] text-white hover:brightness-95 hover:-translate-y-[1px] shadow-sm',
  success:
    'bg-[var(--color-success)] text-white hover:brightness-95 hover:-translate-y-[1px] shadow-sm',
  inverse: 'bg-white text-[var(--color-hero-bg)] hover:bg-white/90 shadow-sm',
  tonal:
    'bg-[var(--color-primary-soft)] text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] hover:brightness-95 hover:-translate-y-[1px] shadow-none border border-transparent',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    leadingIcon,
    trailingIcon,
    block,
    className,
    children,
    disabled,
    count,
    ...rest
  },
  ref,
) {
  // Phase 13 DS-06: chip inverts on dark/saturated variants so it stays legible
  // on top of primary/destructive/success backgrounds. Tonal/secondary/ghost/inverse
  // pick up the default soft-on-primary chip.
  const chipOnDark = variant === 'primary' || variant === 'destructive' || variant === 'success';
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        leadingIcon && <span className="inline-flex shrink-0">{leadingIcon}</span>
      )}
      <span className="inline-flex items-center">{children}</span>
      {count !== undefined && (
        <span
          aria-hidden
          className={cn(
            'ms-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums',
            chipOnDark
              ? 'bg-white/20 text-[var(--color-primary-foreground)]'
              : 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]',
          )}
        >
          {count}
        </span>
      )}
      {!loading && trailingIcon && <span className="inline-flex shrink-0">{trailingIcon}</span>}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* IconButton — square hit-area, primarily for toolbar/header actions */
/* ------------------------------------------------------------------ */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'solid' | 'inverse';
  size?: 'sm' | 'md' | 'lg';
  /** REQUIRED — every icon-only button must have an accessible name. */
  'aria-label': string;
}

const iconBase =
  'inline-flex items-center justify-center rounded-xl transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] ' +
  'disabled:pointer-events-none disabled:opacity-50';

const iconSizes: Record<NonNullable<IconButtonProps['size']>, string> = {
  sm: 'size-9',
  md: 'size-11',
  lg: 'size-12',
};

const iconVariants: Record<NonNullable<IconButtonProps['variant']>, string> = {
  ghost:
    'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]',
  solid:
    'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)]',
  inverse: 'bg-white/15 text-white hover:bg-white/25',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(iconBase, iconSizes[size], iconVariants[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
});
