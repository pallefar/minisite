import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/helpers';

export type BadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'inverse';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  leadingIcon?: ReactNode;
  pulse?: boolean;
}

const toneClasses: Record<BadgeTone, string> = {
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  neutral:
    'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]',
  inverse: 'bg-white/15 text-white border border-white/20',
};

export function Badge({
  tone = 'neutral',
  leadingIcon,
  pulse,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {pulse && (
        <span aria-hidden className="relative flex size-1.5">
          <span className="absolute inset-0 rounded-full bg-current opacity-60 animate-ping" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {leadingIcon}
      {children}
    </span>
  );
}
