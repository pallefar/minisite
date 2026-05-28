/**
 * Calendar-dose inline JSX — month calendar with weekly highlighted
 * injection day. Visual source:
 * .planning/design-system/project/assets/calendar-dose.svg
 *
 * Used on routine/onboarding surfaces.
 */

export interface CalendarDoseProps {
  className?: string;
}

export function CalendarDose({ className }: CalendarDoseProps) {
  return (
    <svg
      viewBox="0 0 120 140"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="cd-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-surface)" />
          <stop offset="100%" stopColor="var(--color-cream-50)" />
        </linearGradient>
      </defs>

      {/* shadow */}
      <ellipse cx="60" cy="134" rx="44" ry="3" fill="rgba(0,0,0,0.08)" />

      {/* calendar body */}
      <rect
        x="10"
        y="18"
        width="100"
        height="112"
        rx="10"
        fill="url(#cd-paper)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.2"
      />

      {/* header band */}
      <path
        d="M 10 28 Q 10 18 20 18 L 100 18 Q 110 18 110 28 L 110 40 L 10 40 Z"
        fill="var(--color-teal-700)"
      />
      <text
        x="60"
        y="33"
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontSize="9"
        fontWeight="800"
        fill="var(--color-text-on-hero)"
        letterSpacing="0.08em"
      >
        NOVEMBER
      </text>

      {/* binding rings */}
      <rect x="28" y="10" width="6" height="14" rx="3" fill="var(--color-teal-900)" />
      <rect x="86" y="10" width="6" height="14" rx="3" fill="var(--color-teal-900)" />

      {/* weekday header */}
      <g
        fontFamily="var(--font-sans)"
        fontSize="8"
        fontWeight="600"
        fill="var(--color-text-tertiary)"
      >
        <text x="22" y="52" textAnchor="middle">
          M
        </text>
        <text x="36" y="52" textAnchor="middle">
          T
        </text>
        <text x="50" y="52" textAnchor="middle">
          W
        </text>
        <text x="64" y="52" textAnchor="middle">
          T
        </text>
        <text x="78" y="52" textAnchor="middle">
          F
        </text>
        <text x="92" y="52" textAnchor="middle">
          S
        </text>
      </g>

      {/* week 1 — Mon highlighted (recent dose marker) */}
      <g fontFamily="var(--font-sans)" fontSize="8" fontWeight="600" fill="var(--color-text)">
        <circle cx="22" cy="74.5" r="6" fill="var(--color-teal-100)" />
        <text x="22" y="77" textAnchor="middle" fill="var(--color-primary)" fontWeight="700">
          2
        </text>
        <text x="36" y="77" textAnchor="middle">
          3
        </text>
        <text x="50" y="77" textAnchor="middle">
          4
        </text>
        <text x="64" y="77" textAnchor="middle">
          5
        </text>
        <text x="78" y="77" textAnchor="middle">
          6
        </text>

        {/* week 2 — Mon = today (filled chip) */}
        <circle cx="22" cy="87.5" r="6" fill="var(--color-teal-700)" />
        <text x="22" y="90" textAnchor="middle" fill="var(--color-text-on-hero)" fontWeight="800">
          9
        </text>
        <text x="36" y="90" textAnchor="middle">
          10
        </text>
        <text x="50" y="90" textAnchor="middle">
          11
        </text>
        <text x="64" y="90" textAnchor="middle">
          12
        </text>
        <text x="78" y="90" textAnchor="middle">
          13
        </text>

        {/* week 3 — Mon upcoming */}
        <circle cx="22" cy="100.5" r="6" fill="var(--color-teal-100)" />
        <text x="22" y="103" textAnchor="middle" fill="var(--color-primary)" fontWeight="700">
          16
        </text>
        <text x="36" y="103" textAnchor="middle">
          17
        </text>
        <text x="50" y="103" textAnchor="middle">
          18
        </text>
        <text x="64" y="103" textAnchor="middle">
          19
        </text>
        <text x="78" y="103" textAnchor="middle">
          20
        </text>

        {/* week 4 — Mon upcoming */}
        <circle cx="22" cy="113.5" r="6" fill="var(--color-teal-100)" />
        <text x="22" y="116" textAnchor="middle" fill="var(--color-primary)" fontWeight="700">
          23
        </text>
        <text x="36" y="116" textAnchor="middle">
          24
        </text>
        <text x="50" y="116" textAnchor="middle">
          25
        </text>
        <text x="64" y="116" textAnchor="middle">
          26
        </text>
        <text x="78" y="116" textAnchor="middle">
          27
        </text>
      </g>
    </svg>
  );
}
