import { useId } from 'react';
import { cn } from '@/lib/helpers';

export interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
  /** Highlight the most recent point with a dot. */
  showLastDot?: boolean;
  className?: string;
  /** Optional accessible label (otherwise the sparkline is hidden from AT). */
  label?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 36,
  color = 'var(--color-primary)',
  fill = 'transparent',
  showLastDot = true,
  className,
  label,
}: SparklineProps) {
  const id = useId();
  const numeric = values.map((v) => (v == null ? NaN : v));
  const finite = numeric.filter(Number.isFinite) as number[];
  if (finite.length === 0)
    return <svg className={className} aria-hidden width={width} height={height} />;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = Math.max(0.0001, max - min);
  const stepX = width / Math.max(1, numeric.length - 1);

  const pts = numeric.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return { x, y };
  });
  const path = pts
    .map((p, i) =>
      p == null ? '' : i === 0 || pts[i - 1] == null ? `M${p.x},${p.y}` : `L${p.x},${p.y}`,
    )
    .join(' ');
  const area = `${path} L ${width},${height} L 0,${height} Z`;
  const last = [...pts].reverse().find((p) => p != null);

  return (
    <svg
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn(className)}
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={fill === 'gradient' ? `url(#sg-${id})` : fill} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showLastDot && last && (
        <circle
          cx={last.x}
          cy={last.y}
          r={2.5}
          fill={color}
          stroke="var(--color-surface)"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}
