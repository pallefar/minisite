import { useCountUp } from '@/hooks/useCountUp';

/**
 * Animated onboarding progress — both a percentage that ticks up and a
 * thin track. Replaces the v1 dot-group.
 */
export function ProgressIndicator({ step, total }: { step: number; total: number }) {
  const target = Math.round((step / total) * 100);
  const display = useCountUp(target, { duration: 600 });

  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="flex-1 h-1.5 rounded-pill bg-[var(--color-surface-elevated)] overflow-hidden">
        <div
          className="h-full rounded-pill bg-[var(--color-primary)] transition-[width] duration-500 ease-out"
          style={{ width: `${target}%` }}
        />
      </div>
      <div className="text-[12px] font-mono font-semibold text-[var(--color-text-secondary)] tabular-nums w-12 text-end">
        {Math.round(display)}%
      </div>
    </div>
  );
}
