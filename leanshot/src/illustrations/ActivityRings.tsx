/**
 * Activity rings inline JSX — 3 concentric Apple-Watch-style rings
 * (Move / Exercise / Stand). Optional slow rotation, gated on
 * useReducedMotion().
 *
 * Visual source: .planning/design-system/project/assets/activity-rings.svg
 *
 * Hex literals in gradient stops below are deliberate brand-locked
 * tri-color (coral / teal / sky). Permitted per CLAUDE.md gradient-stop
 * exception.
 */

import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface ActivityRingsProps {
  className?: string;
  /** Force-disable rotation (e.g. inside a Card where surrounding motion owns animation). */
  staticOnly?: boolean;
}

export function ActivityRings({ className, staticOnly }: ActivityRingsProps) {
  const reduced = useReducedMotion();
  const motion = !reduced && !staticOnly;

  return (
    <svg
      viewBox="0 0 88 88"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="ar-move" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f2a893" />
          <stop offset="100%" stopColor="#cf5454" />
        </linearGradient>
        <linearGradient id="ar-ex" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a8cdc4" />
          <stop offset="100%" stopColor="#1b4842" />
        </linearGradient>
        <linearGradient id="ar-stand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5ab7c7" />
          <stop offset="100%" stopColor="#2f665e" />
        </linearGradient>
      </defs>

      {/* Move ring (outer) */}
      <g
        className={motion ? 'animate-orbit-slow' : undefined}
        style={{ transformOrigin: '44px 44px' }}
      >
        <circle
          cx="44"
          cy="44"
          r="36"
          stroke="var(--color-rose)"
          strokeOpacity="0.15"
          strokeWidth="8"
        />
        <circle
          cx="44"
          cy="44"
          r="36"
          stroke="url(#ar-move)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="226"
          strokeDashoffset="45"
          transform="rotate(-90 44 44)"
        />
      </g>

      {/* Exercise ring (middle) */}
      <circle
        cx="44"
        cy="44"
        r="25"
        stroke="var(--color-teal-200)"
        strokeOpacity="0.18"
        strokeWidth="8"
      />
      <circle
        cx="44"
        cy="44"
        r="25"
        stroke="url(#ar-ex)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="157"
        strokeDashoffset="63"
        transform="rotate(-90 44 44)"
      />

      {/* Stand ring (inner) */}
      <circle
        cx="44"
        cy="44"
        r="14"
        stroke="var(--color-sky)"
        strokeOpacity="0.18"
        strokeWidth="8"
      />
      <circle
        cx="44"
        cy="44"
        r="14"
        stroke="url(#ar-stand)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="88"
        strokeDashoffset="0"
        transform="rotate(-90 44 44)"
      />
    </svg>
  );
}
