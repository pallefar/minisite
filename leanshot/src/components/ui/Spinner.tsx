/**
 * Phase 28 Plan 03 — Spinner UI primitive.
 *
 * A minimal accessible spinner used for async-propagation UX (e.g. JWT
 * claim propagation after workspace switch per CONTEXT D-10). Sizes map to:
 *   xs  → 12px (inline chip affordance — WorkspaceSwitcher JWT spinner)
 *   sm  → 16px (button-level feedback)
 *   md  → 20px (card / section level loading)
 *   lg  → 32px (page-level loading)
 *
 * Usage:
 *   <Spinner size="xs" data-testid="ws-jwt-spinner" />
 *
 * Accessibility: renders with role="status" and aria-label="Loading"
 * so screen readers announce it as a live region.
 */

import { Loader2 } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/helpers';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /** Accessible label. Defaults to "Loading". */
  label?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'size-3',   // 12px
  sm: 'size-4',   // 16px
  md: 'size-5',   // 20px
  lg: 'size-8',   // 32px
};

export function Spinner({ size = 'md', label = 'Loading', className, ...rest }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-flex items-center justify-center text-[var(--color-text-secondary)]', className)}
      {...rest}
    >
      <Loader2
        className={cn(sizeClasses[size], 'animate-spin')}
        aria-hidden
      />
    </span>
  );
}

export default Spinner;
