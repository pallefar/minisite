import { cn } from '@/lib/helpers';

export interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  /** Color CSS variable, e.g. 'var(--color-primary)'. */
  color?: string;
  /** Track color CSS variable. */
  trackColor?: string;
  /** Inner content — usually a number. */
  children?: React.ReactNode;
  className?: string;
  label?: string;
}

export function ProgressRing({
  value,
  max = 100,
  size = 80,
  strokeWidth = 6,
  color = 'var(--color-primary)',
  trackColor = 'var(--color-surface-elevated)',
  children,
  className,
  label,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / max));
  const dashOffset = circumference * (1 - pct);

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role={label ? 'img' : 'presentation'}
        aria-label={label}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: 'stroke-dashoffset var(--duration-deliberate) var(--ease-out-quart)',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  className?: string;
  /** Heights: 'thin' (3px), 'normal' (5px), 'thick' (8px) */
  thickness?: 'thin' | 'normal' | 'thick';
  label?: string;
}

export function ProgressBar({
  value,
  max = 100,
  color = 'var(--color-primary)',
  thickness = 'normal',
  className,
  label,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const heights = { thin: 'h-[3px]', normal: 'h-[5px]', thick: 'h-2' };
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        'w-full bg-[var(--color-surface-elevated)] rounded-pill overflow-hidden',
        heights[thickness],
        className,
      )}
    >
      <div
        className="h-full rounded-pill transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
