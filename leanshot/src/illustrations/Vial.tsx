/**
 * Vial-shaped SVG with liquid-fill animation.
 * Renders the silhouette of a glass vial with a stopper, filled to the
 * given percentage. The fill rises from the bottom on mount.
 */
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface VialIllustrationProps {
  /** 0-100. */
  fillPct: number;
  size?: number;
  warning?: boolean;
  className?: string;
}

export function VialIllustration({ fillPct, size = 64, warning, className }: VialIllustrationProps) {
  const reduced = useReducedMotion();
  const stroke = warning ? 'var(--color-warning)' : 'var(--color-primary)';
  const liquid = warning ? 'var(--color-warning)' : 'var(--color-primary)';
  const w = (size * 56) / 88;

  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 56 88"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label={`Vial ${Math.round(fillPct)} percent full`}
    >
      <defs>
        <clipPath id={`vial-clip-${size}`}>
          <path d="M16 22 H40 Q44 22 44 26 V74 Q44 80 38 80 H18 Q12 80 12 74 V26 Q12 22 16 22 Z" />
        </clipPath>
        <linearGradient id={`vial-fill-${size}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={liquid} stopOpacity="0.85" />
          <stop offset="100%" stopColor={liquid} stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* stopper / cap */}
      <rect x="14" y="6" width="28" height="10" rx="3" fill={stroke} opacity="0.9" />
      <rect x="20" y="14" width="16" height="6" rx="2" fill={stroke} opacity="0.5" />

      {/* glass body */}
      <path
        d="M16 22 H40 Q44 22 44 26 V74 Q44 80 38 80 H18 Q12 80 12 74 V26 Q12 22 16 22 Z"
        fill="var(--color-surface-elevated)"
        stroke={stroke}
        strokeWidth="1.6"
      />

      {/* liquid */}
      <g clipPath={`url(#vial-clip-${size})`}>
        <rect
          x="0"
          y={80 - (fillPct / 100) * 58}
          width="56"
          height="60"
          fill={`url(#vial-fill-${size})`}
          style={{
            transition: !reduced ? 'y 700ms cubic-bezier(0.25, 1, 0.5, 1)' : undefined,
          }}
        />
        {/* meniscus highlight */}
        <ellipse
          cx="28"
          cy={80 - (fillPct / 100) * 58}
          rx="16"
          ry="2.2"
          fill="white"
          opacity="0.32"
        />
      </g>

      {/* glass shine */}
      <line x1="18" y1="30" x2="18" y2="68" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
