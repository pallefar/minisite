/**
 * Empty-state — no meals logged. Plate + steam wisps + fork/spoon.
 * Visual source: .planning/design-system/project/assets/empty-plate.svg
 */

export interface EmptyPlateProps {
  className?: string;
}

export function EmptyPlate({ className }: EmptyPlateProps) {
  return (
    <svg
      viewBox="0 0 200 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="ep-plate" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0%" stopColor="var(--color-surface)" />
          <stop offset="100%" stopColor="var(--color-cream-200)" />
        </radialGradient>
      </defs>

      {/* shadow */}
      <ellipse cx="100" cy="138" rx="60" ry="6" fill="rgba(0,0,0,0.08)" />

      {/* plate stacked ellipses */}
      <ellipse
        cx="100"
        cy="80"
        rx="72"
        ry="18"
        fill="url(#ep-plate)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.2"
      />
      <ellipse
        cx="100"
        cy="78"
        rx="62"
        ry="13"
        fill="none"
        stroke="var(--color-border)"
        strokeWidth="0.8"
      />
      <ellipse
        cx="100"
        cy="76"
        rx="56"
        ry="10"
        fill="var(--color-cream-50)"
        stroke="var(--color-border)"
        strokeWidth="0.6"
      />

      {/* steam wisps */}
      <path
        d="M 84 56 Q 80 48 86 42 Q 92 36 88 28"
        stroke="var(--color-teal-200)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
      <path
        d="M 100 52 Q 96 44 102 38 Q 108 32 104 24"
        stroke="var(--color-teal-200)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      <path
        d="M 116 56 Q 112 48 118 42 Q 124 36 120 28"
        stroke="var(--color-teal-200)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />

      {/* utensils */}
      <g stroke="var(--color-text-tertiary)" strokeWidth="1.4" strokeLinecap="round" fill="none">
        <line x1="36" y1="100" x2="36" y2="138" />
        <path d="M 30 100 L 30 110 M 36 100 L 36 110 M 42 100 L 42 110 M 30 110 Q 30 116 36 116 Q 42 116 42 110" />
        <line x1="164" y1="100" x2="164" y2="138" />
        <ellipse cx="164" cy="106" rx="5" ry="9" fill="var(--color-surface)" />
      </g>
    </svg>
  );
}
