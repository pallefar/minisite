import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Hero illustration — abstract orbital + leaf form. Used inside the dark
 * teal hero card. Positioned absolutely; accepts a className for sizing.
 *
 * Style: continuous-line single-stroke, soft fills, two slow orbital
 * rotations layered on a static center for depth.
 */
export interface HeroOrbitalProps {
  className?: string;
  /** Force-disable motion (e.g. for the public marketing hero where parallax owns the motion). */
  staticOnly?: boolean;
}

export function HeroOrbital({ className, staticOnly }: HeroOrbitalProps) {
  const reduced = useReducedMotion();
  const motion = !reduced && !staticOnly;

  return (
    <svg
      viewBox="0 0 320 320"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="hero-glow" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0%" stopColor="rgba(255,255,255,0.42)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <linearGradient id="hero-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.08)" />
        </linearGradient>
        <linearGradient id="hero-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.45)" />
        </linearGradient>
      </defs>

      {/* Soft glow background */}
      <circle cx="160" cy="160" r="120" fill="url(#hero-glow)" />

      {/* Outer orbital — slowly rotating */}
      <g
        className={motion ? 'animate-orbit-slow' : undefined}
        style={{ transformOrigin: '160px 160px' }}
      >
        <ellipse
          cx="160"
          cy="160"
          rx="138"
          ry="55"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="1.2"
          strokeDasharray="3 7"
          transform="rotate(-22 160 160)"
        />
        <circle cx="36" cy="160" r="5" fill="white" opacity="0.96" />
        <circle cx="56" cy="92" r="2.5" fill="white" opacity="0.7" />
      </g>

      {/* Inner orbital — counter-rotating */}
      <g
        className={motion ? 'animate-orbit-fast' : undefined}
        style={{ transformOrigin: '160px 160px', animationDirection: 'reverse' }}
      >
        <ellipse
          cx="160"
          cy="160"
          rx="138"
          ry="55"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.1"
          strokeDasharray="2 8"
          transform="rotate(22 160 160)"
        />
        <circle cx="284" cy="160" r="3.5" fill="white" opacity="0.85" />
        <circle cx="248" cy="240" r="2" fill="white" opacity="0.55" />
      </g>

      {/* Concentric pulses */}
      <circle cx="160" cy="160" r="100" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      <circle cx="160" cy="160" r="74" stroke="rgba(255,255,255,0.32)" strokeWidth="1" />

      {/* Center leaf form — the brand primitive */}
      <path
        d="M160 80 C200 110 208 140 200 168 C194 198 178 226 160 244 C142 226 126 198 120 168 C112 140 120 110 160 80 Z"
        fill="url(#hero-leaf)"
        stroke="url(#hero-stroke)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M160 92 L160 232"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M160 130 Q172 138 178 152 M160 130 Q148 138 142 152 M160 168 Q174 178 182 196 M160 168 Q146 178 138 196"
        stroke="rgba(255,255,255,0.36)"
        strokeWidth="1"
        strokeLinecap="round"
      />

      {/* Center glow dot */}
      <circle cx="160" cy="160" r="14" fill="rgba(255,255,255,0.18)" />
      <circle cx="160" cy="160" r="4" fill="white" />
    </svg>
  );
}
