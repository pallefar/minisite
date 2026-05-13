/**
 * Pen-injector inline JSX illustration — the LeanShot-branded pen.
 * Visual source: .planning/design-system/project/assets/pen-injector.svg
 *
 * Used on marketing surfaces + medication empty/header states.
 *
 * Hex literals in gradient stops below are brand-locked pen-body colors
 * (cream highlights + teal cap). Permitted per CLAUDE.md gradient-stop
 * exception. All ad-hoc fill/stroke values use design-token CSS variables.
 */

export interface PenInjectorProps {
  className?: string;
}

export function PenInjector({ className }: PenInjectorProps) {
  return (
    <svg
      viewBox="0 0 80 240"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="pen-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ebe5d4" />
          <stop offset="30%" stopColor="#fefcf7" />
          <stop offset="70%" stopColor="#fefcf7" />
          <stop offset="100%" stopColor="#c8c0aa" />
        </linearGradient>
        <linearGradient id="pen-cap" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0f302c" />
          <stop offset="50%" stopColor="#1b4842" />
          <stop offset="100%" stopColor="#0a1413" />
        </linearGradient>
        <linearGradient id="pen-window" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(0,0,0,0.15)" />
          <stop offset="50%" stopColor="rgba(0,0,0,0.05)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.4)" />
        </linearGradient>
      </defs>

      {/* shadow */}
      <ellipse cx="40" cy="232" rx="28" ry="3" fill="rgba(0,0,0,0.10)" />

      {/* cap */}
      <rect x="22" y="6" width="36" height="42" rx="6" fill="url(#pen-cap)" />
      <rect x="22" y="6" width="36" height="6" rx="3" fill="rgba(255,255,255,0.18)" />
      <rect x="24" y="14" width="32" height="1.5" fill="rgba(255,255,255,0.25)" />
      <rect x="22" y="46" width="36" height="3" fill="rgba(0,0,0,0.4)" />

      {/* body */}
      <rect
        x="20"
        y="49"
        width="40"
        height="148"
        rx="6"
        fill="url(#pen-body)"
        stroke="var(--color-border-strong)"
        strokeWidth="0.8"
      />

      {/* dose window */}
      <rect x="26" y="64" width="28" height="20" rx="3" fill="var(--color-hero-bg)" />
      <rect x="26" y="64" width="28" height="20" rx="3" fill="url(#pen-window)" />
      <text
        x="40"
        y="79"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="13"
        fontWeight="700"
        fill="var(--color-teal-300)"
        letterSpacing="-0.04em"
      >
        5.0
      </text>

      {/* label panel */}
      <rect x="24" y="98" width="32" height="44" fill="var(--color-teal-700)" rx="2" />
      <text
        x="40"
        y="115"
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontSize="8"
        fontWeight="800"
        fill="var(--color-text-on-hero)"
        letterSpacing="0.05em"
      >
        LEAN
      </text>
      <text
        x="40"
        y="125"
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontSize="8"
        fontWeight="800"
        fill="var(--color-text-on-hero)"
        letterSpacing="0.05em"
      >
        SHOT
      </text>
      <line x1="28" y1="130" x2="52" y2="130" stroke="var(--color-teal-300)" strokeWidth="1.4" />
      <text
        x="40"
        y="138"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="6"
        fontWeight="600"
        fill="var(--color-teal-200)"
      >
        2.5mg/0.5ml
      </text>

      {/* tick marks */}
      <g stroke="var(--color-text-tertiary)" strokeWidth="0.6">
        <line x1="22" y1="150" x2="26" y2="150" />
        <line x1="22" y1="156" x2="24" y2="156" />
        <line x1="22" y1="162" x2="26" y2="162" />
        <line x1="22" y1="168" x2="24" y2="168" />
        <line x1="22" y1="174" x2="26" y2="174" />
        <line x1="22" y1="180" x2="24" y2="180" />
        <line x1="22" y1="186" x2="26" y2="186" />
      </g>

      {/* base */}
      <rect x="20" y="197" width="40" height="14" rx="3" fill="var(--color-teal-700)" />
      <line x1="24" y1="200" x2="56" y2="200" stroke="var(--color-teal-300)" strokeWidth="0.8" opacity="0.6" />
      <line x1="24" y1="208" x2="56" y2="208" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />

      {/* button */}
      <rect x="26" y="211" width="28" height="12" rx="3" fill="var(--color-teal-300)" />
      <rect x="26" y="211" width="28" height="3" rx="3" fill="rgba(255,255,255,0.5)" />
      <circle cx="40" cy="217" r="2" fill="var(--color-text-on-hero)" opacity="0.8" />
    </svg>
  );
}
