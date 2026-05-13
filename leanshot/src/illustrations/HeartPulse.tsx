/**
 * Heart pulse inline JSX — heart glyph with EKG sweep + soft glow.
 * Visual source: .planning/design-system/project/assets/heart-pulse.svg
 *
 * Animation: subtle pulse-soft on the heart fill, gated on useReducedMotion.
 *
 * Hex literals in gradient stops are brand-locked rose/coral palette;
 * permitted per CLAUDE.md gradient-stop exception.
 */

import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface HeartPulseProps {
  className?: string;
  staticOnly?: boolean;
}

export function HeartPulse({ className, staticOnly }: HeartPulseProps) {
  const reduced = useReducedMotion();
  const motion = !reduced && !staticOnly;

  return (
    <svg
      viewBox="0 0 200 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="hp-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fbe1d7" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fbe1d7" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hp-heart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f2a893" />
          <stop offset="100%" stopColor="#cf5454" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="138" rx="50" ry="4" fill="rgba(0,0,0,0.06)" />
      <circle cx="100" cy="78" r="56" fill="url(#hp-glow)" />

      {/* heart */}
      <path
        d="M 100 110 C 70 92 56 76 56 60 C 56 46 66 38 78 38 C 88 38 96 44 100 52 C 104 44 112 38 122 38 C 134 38 144 46 144 60 C 144 76 130 92 100 110 Z"
        fill="url(#hp-heart)"
        stroke="var(--color-danger)"
        strokeWidth="1"
        strokeLinejoin="round"
        className={motion ? 'animate-pulse-soft' : undefined}
        style={motion ? { transformOrigin: '100px 74px' } : undefined}
      />
      {/* heart highlight */}
      <path
        d="M 76 48 Q 90 44 96 56"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* EKG sweep */}
      <path
        d="M 30 78 L 64 78 L 76 60 L 88 96 L 100 50 L 112 96 L 124 70 L 136 78 L 170 78"
        stroke="var(--color-text-on-hero)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
