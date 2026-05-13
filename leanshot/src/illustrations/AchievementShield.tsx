/**
 * Achievement shield inline JSX — laurel-wreath shield with central star.
 * Visual source: .planning/design-system/project/assets/achievement-shield.svg
 *
 * Used on milestone achievements + onboarding "ready" surfaces.
 *
 * Hex literals in gradient stops below are brand-locked gold/teal palettes
 * (deliberate trophy aesthetic). Permitted per CLAUDE.md gradient-stop
 * exception. All other fill/stroke values use design tokens.
 */

export interface AchievementShieldProps {
  className?: string;
}

export function AchievementShield({ className }: AchievementShieldProps) {
  return (
    <svg
      viewBox="0 0 80 88"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="as-glow" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0%" stopColor="#dceae5" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#dceae5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="as-shield" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#2f665e" />
          <stop offset="50%" stopColor="#1b4842" />
          <stop offset="100%" stopColor="#0f302c" />
        </linearGradient>
        <linearGradient id="as-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbe89a" />
          <stop offset="50%" stopColor="#e3b653" />
          <stop offset="100%" stopColor="#b88a2b" />
        </linearGradient>
      </defs>

      <circle cx="40" cy="44" r="40" fill="url(#as-glow)" />

      {/* laurel wreath - left + right */}
      <g
        stroke="var(--color-success)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        opacity="0.9"
      >
        <path d="M 8 60 Q 6 44 14 30 Q 22 18 30 14" />
        <path d="M 10 52 Q 14 50 18 52 M 12 44 Q 16 42 20 44 M 16 36 Q 20 34 24 36 M 22 28 Q 26 26 30 28" />
        <path d="M 72 60 Q 74 44 66 30 Q 58 18 50 14" />
        <path d="M 70 52 Q 66 50 62 52 M 68 44 Q 64 42 60 44 M 64 36 Q 60 34 56 36 M 58 28 Q 54 26 50 28" />
      </g>

      {/* shield body */}
      <path
        d="M 40 12 L 60 22 L 60 48 Q 60 64 40 76 Q 20 64 20 48 L 20 22 Z"
        fill="url(#as-shield)"
        stroke="url(#as-rim)"
        strokeWidth="2"
      />
      {/* inner highlight */}
      <path
        d="M 40 18 L 56 26 L 56 48 Q 56 60 40 70 Q 24 60 24 48 L 24 26 Z"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="0.8"
      />

      {/* star */}
      <path
        d="M 40 32 L 43 41 L 52 41 L 45 47 L 47 56 L 40 50 L 33 56 L 35 47 L 28 41 L 37 41 Z"
        fill="url(#as-rim)"
        stroke="rgba(0,0,0,0.2)"
        strokeWidth="0.4"
      />
      {/* star glint */}
      <path
        d="M 40 33 L 42.5 40 L 49 40"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="0.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
