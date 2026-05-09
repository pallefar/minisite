import { type ReactNode } from 'react';
import { cn } from '@/lib/helpers';

export interface EmptyStateProps {
  illustration?: ReactNode;
  title: string;
  body?: string;
  cta?: ReactNode;
  className?: string;
  /** When true, no surface — meant to live inside a card. */
  inline?: boolean;
}

export function EmptyState({ illustration, title, body, cta, className, inline }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center gap-3',
        inline ? 'py-6 px-4' : 'py-10 px-6',
        className,
      )}
    >
      {illustration && (
        <div className="text-[var(--color-text-tertiary)] motion-safe:animate-rise">{illustration}</div>
      )}
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold text-[var(--color-text)]">{title}</h3>
        {body && <p className="text-[13px] text-[var(--color-text-secondary)] max-w-[34ch] leading-snug">{body}</p>}
      </div>
      {cta && <div className="mt-1">{cta}</div>}
    </div>
  );
}
