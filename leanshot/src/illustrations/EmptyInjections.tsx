/** Empty state — no injections logged yet. Hand + pen + radial sparkle. */
export function EmptyInjections({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="ej-pen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {/* radial spark */}
      <g stroke="var(--color-text-tertiary)" strokeLinecap="round" opacity="0.5">
        <line x1="40" y1="80" x2="28" y2="80" strokeWidth="1.2" />
        <line x1="46" y1="60" x2="38" y2="52" strokeWidth="1.2" />
        <line x1="46" y1="100" x2="38" y2="108" strokeWidth="1.2" />
        <line x1="60" y1="46" x2="56" y2="38" strokeWidth="1.2" />
      </g>
      {/* pen body */}
      <g transform="rotate(-22 110 80)">
        <rect
          x="60"
          y="68"
          width="100"
          height="24"
          rx="12"
          fill="url(#ej-pen)"
          stroke="var(--color-primary)"
          strokeWidth="1.4"
        />
        <rect
          x="64"
          y="74"
          width="20"
          height="12"
          rx="3"
          fill="var(--color-primary)"
          opacity="0.18"
        />
        <circle cx="146" cy="80" r="3" fill="var(--color-primary)" />
        <line
          x1="160"
          y1="80"
          x2="176"
          y2="80"
          stroke="var(--color-primary)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
      {/* drop catching the light */}
      <path
        d="M178 96 Q174 102 178 108 Q182 102 178 96 Z"
        fill="var(--color-primary)"
        opacity="0.7"
      />
    </svg>
  );
}
