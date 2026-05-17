/**
 * Empty state — no symptoms logged. "That's a good sign."
 * Rising-sun motif with horizon line.
 */
export function EmptySymptoms({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="es-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-amber)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--color-amber)" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="es-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-amber)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-amber)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* glow halo */}
      <ellipse cx="100" cy="100" rx="80" ry="40" fill="url(#es-glow)" />
      {/* sun rays */}
      <g stroke="var(--color-amber)" strokeLinecap="round" opacity="0.7">
        <line x1="100" y1="40" x2="100" y2="28" strokeWidth="1.4" />
        <line x1="64" y1="56" x2="56" y2="48" strokeWidth="1.4" />
        <line x1="136" y1="56" x2="144" y2="48" strokeWidth="1.4" />
        <line x1="48" y1="80" x2="36" y2="80" strokeWidth="1.4" />
        <line x1="152" y1="80" x2="164" y2="80" strokeWidth="1.4" />
      </g>
      {/* sun arc */}
      <path
        d="M64 100 Q100 50 136 100 Z"
        fill="url(#es-sun)"
        stroke="var(--color-amber)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* horizon */}
      <line
        x1="28"
        y1="100"
        x2="172"
        y2="100"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="36"
        y1="112"
        x2="60"
        y2="112"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <line
        x1="76"
        y1="112"
        x2="124"
        y2="112"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <line
        x1="140"
        y1="112"
        x2="164"
        y2="112"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
