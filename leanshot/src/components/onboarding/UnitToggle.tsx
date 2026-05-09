import { motion } from 'framer-motion';
import type { Units } from '@/types';
import { cn } from '@/lib/helpers';

/** Sliding pill toggle for the unit system — replaces the v1 pill-group. */
export function UnitToggle({ value, onChange }: { value: Units; onChange: (u: Units) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Unit system"
      className="relative inline-flex w-full p-1 rounded-pill bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
    >
      {(['metric', 'imperial'] as const).map((u) => {
        const active = value === u;
        const label = u === 'metric' ? 'Metric · kg, cm' : 'Imperial · lb, in';
        return (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(u)}
            className={cn(
              'relative flex-1 h-11 rounded-pill text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] z-10 transition-colors',
              active ? 'text-[var(--color-primary-foreground)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
            )}
          >
            {active && (
              <motion.span
                layoutId="ut-active"
                className="absolute inset-0 rounded-pill bg-[var(--color-primary)] shadow-sm -z-10"
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}
