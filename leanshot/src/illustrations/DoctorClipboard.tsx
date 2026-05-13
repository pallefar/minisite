/**
 * Doctor clipboard inline JSX — clipboard with chart + "CLEAR" stamp.
 * Visual source: .planning/design-system/project/assets/doctor-clipboard.svg
 *
 * Used on doctor-report + share-report surfaces.
 */

export interface DoctorClipboardProps {
  className?: string;
}

export function DoctorClipboard({ className }: DoctorClipboardProps) {
  return (
    <svg
      viewBox="0 0 120 140"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="dc-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-surface)" />
          <stop offset="100%" stopColor="var(--color-cream-200)" />
        </linearGradient>
      </defs>

      {/* shadow */}
      <ellipse cx="60" cy="132" rx="42" ry="3" fill="rgba(0,0,0,0.08)" />

      {/* clipboard backing */}
      <rect x="12" y="14" width="96" height="116" rx="6" fill="var(--color-teal-700)" />

      {/* clip */}
      <rect x="40" y="8" width="40" height="14" rx="3" fill="var(--color-teal-900)" />
      <rect x="48" y="11" width="24" height="8" rx="2" fill="var(--color-teal-300)" />

      {/* paper */}
      <rect
        x="20"
        y="24"
        width="80"
        height="100"
        rx="4"
        fill="url(#dc-paper)"
        stroke="var(--color-border-strong)"
        strokeWidth="0.6"
      />

      {/* header bars */}
      <rect x="26" y="32" width="48" height="4" rx="2" fill="var(--color-teal-700)" />
      <rect x="26" y="40" width="32" height="3" rx="1.5" fill="var(--color-text-tertiary)" />

      {/* chart area */}
      <rect x="26" y="50" width="68" height="36" rx="3" fill="var(--color-cream-50)" />
      <path
        d="M 30 78 Q 40 72 48 74 T 64 60 T 80 54 L 88 50"
        stroke="var(--color-teal-700)"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 30 78 Q 40 72 48 74 T 64 60 T 80 54 L 88 50 L 88 82 L 30 82 Z"
        fill="var(--color-teal-700)"
        opacity="0.10"
      />
      <circle cx="48" cy="74" r="1.6" fill="var(--color-teal-700)" />
      <circle cx="64" cy="60" r="1.6" fill="var(--color-teal-700)" />
      <circle cx="80" cy="54" r="1.6" fill="var(--color-rose)" />

      {/* body lines */}
      <g fill="var(--color-text-tertiary)">
        <rect x="26" y="92" width="68" height="2.5" rx="1" />
        <rect x="26" y="98" width="52" height="2.5" rx="1" />
        <rect x="26" y="104" width="60" height="2.5" rx="1" />
      </g>

      {/* CLEAR stamp */}
      <g transform="translate(80 110) rotate(-12)">
        <rect
          x="-16"
          y="-7"
          width="32"
          height="14"
          rx="2"
          fill="none"
          stroke="var(--color-success)"
          strokeWidth="1.4"
        />
        <text
          x="0"
          y="3"
          textAnchor="middle"
          fontFamily="var(--font-sans)"
          fontSize="7"
          fontWeight="800"
          fill="var(--color-success)"
          letterSpacing="0.05em"
        >
          CLEAR
        </text>
      </g>
    </svg>
  );
}
