/**
 * Empty-state — no insights yet. Document + magnifier + sparkles.
 * Visual source: .planning/design-system/project/assets/empty-insights.svg
 */

export interface EmptyInsightsProps {
  className?: string;
}

export function EmptyInsights({ className }: EmptyInsightsProps) {
  return (
    <svg
      viewBox="0 0 200 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="ei-glow" cx="0.4" cy="0.4" r="0.5">
          <stop offset="0%" stopColor="var(--color-teal-100)" />
          <stop offset="100%" stopColor="var(--color-teal-200)" />
        </radialGradient>
      </defs>

      {/* shadow */}
      <ellipse cx="100" cy="138" rx="50" ry="4" fill="rgba(0,0,0,0.08)" />

      {/* document */}
      <rect
        x="30"
        y="40"
        width="120"
        height="74"
        rx="10"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.2"
      />
      <rect x="38" y="48" width="40" height="3" rx="1.5" fill="var(--color-teal-700)" />
      <rect x="38" y="55" width="28" height="2.5" rx="1.25" fill="var(--color-text-tertiary)" />

      {/* trend line */}
      <path
        d="M 38 96 Q 56 90 70 92 T 96 82 T 124 76 L 142 70"
        stroke="var(--color-teal-200)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        strokeDasharray="3 3"
      />

      {/* magnifier */}
      <g transform="translate(130 90) rotate(20)">
        <circle cx="0" cy="0" r="22" fill="url(#ei-glow)" opacity="0.35" />
        <circle cx="0" cy="0" r="22" fill="none" stroke="var(--color-teal-700)" strokeWidth="3" />
        <circle cx="0" cy="0" r="18" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
        <line
          x1="16"
          y1="16"
          x2="28"
          y2="28"
          stroke="var(--color-teal-700)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>

      {/* sparkles */}
      <path
        d="M 50 28 L 52 34 L 58 36 L 52 38 L 50 44 L 48 38 L 42 36 L 48 34 Z"
        fill="var(--color-amber)"
        opacity="0.9"
      />
      <path
        d="M 170 50 L 171 53 L 174 54 L 171 55 L 170 58 L 169 55 L 166 54 L 169 53 Z"
        fill="var(--color-success)"
        opacity="0.9"
      />
    </svg>
  );
}
