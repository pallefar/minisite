/** Empty state — no progress photos yet. Camera + sparkle. */
export function EmptyPhotos({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="ep-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {/* camera body */}
      <rect
        x="50"
        y="58"
        width="100"
        height="68"
        rx="14"
        fill="url(#ep-body)"
        stroke="var(--color-primary)"
        strokeWidth="1.4"
      />
      {/* lens hump */}
      <path
        d="M82 58 L84 48 H116 L118 58 Z"
        fill="var(--color-primary)"
        opacity="0.15"
        stroke="var(--color-primary)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* lens */}
      <circle cx="100" cy="92" r="20" stroke="var(--color-primary)" strokeWidth="1.4" />
      <circle cx="100" cy="92" r="11" fill="var(--color-primary)" opacity="0.16" />
      <circle cx="106" cy="86" r="3" fill="white" />
      {/* indicator light */}
      <circle cx="138" cy="74" r="2.4" fill="var(--color-rose)" />
      {/* sparkles */}
      <g stroke="var(--color-text-tertiary)" strokeLinecap="round" opacity="0.55">
        <path d="M40 40 l4 4 M44 40 l-4 4" strokeWidth="1.2" />
        <path d="M170 50 l4 4 M174 50 l-4 4" strokeWidth="1.2" />
        <path d="M168 116 l3 3 M171 116 l-3 3" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
