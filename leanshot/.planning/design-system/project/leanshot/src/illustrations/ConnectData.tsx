/**
 * "Connect your data" illustration — used by the Apple Health import card
 * and any data-source onboarding sheets.
 */
export function ConnectData({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="cd-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {/* left node */}
      <rect
        x="20"
        y="48"
        width="44"
        height="44"
        rx="10"
        fill="url(#cd-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.4"
      />
      <path
        d="M30 70 L40 70 M44 70 L54 70"
        stroke="var(--color-primary)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="42" cy="62" r="2" fill="var(--color-primary)" />
      {/* bridge dots */}
      <g fill="var(--color-primary)">
        <circle cx="78" cy="70" r="2.6" />
        <circle cx="92" cy="70" r="2.2" opacity="0.7" />
        <circle cx="106" cy="70" r="1.8" opacity="0.5" />
      </g>
      {/* arrow tail */}
      <path
        d="M64 70 Q100 30 138 70"
        stroke="var(--color-primary)"
        strokeWidth="1.4"
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
      {/* right node — leanshot */}
      <rect
        x="136"
        y="48"
        width="44"
        height="44"
        rx="10"
        fill="var(--color-primary)"
        stroke="var(--color-primary)"
        strokeWidth="1.4"
      />
      <path
        d="M150 70 L156 70 L162 64 L158 76 L164 70 L170 70"
        stroke="white"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
