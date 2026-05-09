import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/helpers';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: 'sm' | 'md';
  leadingIcon?: ReactNode;
}

export function Pill({ active, size = 'md', leadingIcon, className, children, ...rest }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border font-medium transition-[transform,background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] active:translate-y-[0.5px]',
        size === 'sm' ? 'h-8 px-3 text-[12px]' : 'h-10 px-4 text-[13px]',
        active
          ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm'
          : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)]',
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  );
}

export function PillGroup({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="group" className={cn('flex flex-wrap gap-1.5', className)} {...rest}>
      {children}
    </div>
  );
}
