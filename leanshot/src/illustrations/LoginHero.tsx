/**
 * Login hero illustration — large dark-teal hero with central leaf form
 * and animated mesh drift / counter-orbital rings. Designed for the
 * Plan 13-04 split-screen login surface; suitable for any hero-scale
 * marketing surface as well.
 *
 * Visual source: .planning/design-system/project/assets/login-hero.svg
 *
 * Animation: gentle mesh-drift on the glow, slow + reverse orbital
 * rotation on the ring layers. All motion gated through
 * useReducedMotion() and the `staticOnly` opt-out (matches HeroOrbital
 * pattern).
 *
 * The illustration uses `rgba(255, 255, 255, ...)` and `rgba(168, 205, 196, ...)`
 * literals (not #hex) because the hero card backdrop is `--color-hero-bg`
 * (dark teal) and the strokes/fills are intentionally white-on-dark
 * tints. These match the HeroOrbital prototype's color discipline and
 * pass the hex-literal audit (no `#xxxxxx` outside gradient stops).
 */

import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface LoginHeroProps {
  className?: string;
  /** Force-disable motion even when reduced-motion is false. */
  staticOnly?: boolean;
}

export function LoginHero({ className, staticOnly }: LoginHeroProps) {
  const reduced = useReducedMotion();
  const motion = !reduced && !staticOnly;

  return (
    <svg
      viewBox="0 0 520 520"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="lh-glow" cx="0.5" cy="0.45" r="0.6">
          <stop offset="0%" stopColor="rgba(168,205,196,0.45)" />
          <stop offset="55%" stopColor="rgba(168,205,196,0.08)" />
          <stop offset="100%" stopColor="rgba(168,205,196,0)" />
        </radialGradient>
        <linearGradient id="lh-leaf" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.42)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
        </linearGradient>
        <linearGradient id="lh-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
        </linearGradient>
        <linearGradient id="lh-curve-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="100%" stopColor="rgba(168,205,196,0.95)" />
        </linearGradient>
        <linearGradient id="lh-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id="lh-vial-glass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.08)" />
        </linearGradient>
        <linearGradient id="lh-vial-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(168,205,196,0.9)" />
          <stop offset="100%" stopColor="rgba(15,48,44,0.8)" />
        </linearGradient>
      </defs>

      {/* soft glow background — animated mesh-drift */}
      <circle
        cx="260"
        cy="240"
        r="200"
        fill="url(#lh-glow)"
        className={motion ? 'animate-mesh-drift' : undefined}
        style={motion ? { transformOrigin: '260px 240px' } : undefined}
      />

      {/* counter-orbiting ellipses */}
      <g opacity="0.7">
        <g
          className={motion ? 'animate-orbit-slow' : undefined}
          style={{ transformOrigin: '260px 260px' }}
        >
          <ellipse
            cx="260"
            cy="260"
            rx="230"
            ry="92"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="1.2"
            strokeDasharray="3 9"
            transform="rotate(-18 260 260)"
          />
        </g>
        <g
          className={motion ? 'animate-orbit-fast' : undefined}
          style={{ transformOrigin: '260px 260px' }}
        >
          <ellipse
            cx="260"
            cy="260"
            rx="200"
            ry="80"
            stroke="rgba(255,255,255,0.30)"
            strokeWidth="1"
            strokeDasharray="2 10"
            transform="rotate(18 260 260)"
          />
        </g>
      </g>

      {/* concentric pulses */}
      <circle cx="260" cy="260" r="160" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
      <circle cx="260" cy="260" r="124" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />

      {/* center leaf form */}
      <path
        d="M 260 100 C 330 150 348 200 332 260 C 322 320 296 380 260 416 C 224 380 198 320 188 260 C 172 200 190 150 260 100 Z"
        fill="url(#lh-leaf)"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M 260 116 L 260 408" stroke="rgba(255,255,255,0.32)" strokeWidth="0.8" />
      <path
        d="M 260 178 Q 282 192 292 218 M 260 178 Q 238 192 228 218 M 260 232 Q 286 248 298 280 M 260 232 Q 234 248 222 280 M 260 290 Q 282 304 290 332 M 260 290 Q 238 304 230 332"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="0.8"
        strokeLinecap="round"
      />

      {/* satellite — vial */}
      <g transform="translate(80 88) rotate(-12)">
        <rect x="-2" y="0" width="48" height="14" rx="3" fill="rgba(255,255,255,0.95)" />
        <rect x="-4" y="14" width="52" height="8" rx="2" fill="rgba(220,214,196,0.95)" />
        <rect
          x="0"
          y="22"
          width="44"
          height="110"
          rx="6"
          fill="rgba(255,255,255,0.10)"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="1.4"
        />
        <rect x="2" y="68" width="40" height="62" rx="4" fill="url(#lh-vial-fill)" opacity="0.85" />
        <rect x="0" y="22" width="44" height="110" rx="6" fill="url(#lh-vial-glass)" />
        <rect x="6" y="84" width="32" height="22" fill="rgba(255,255,255,0.90)" rx="1" />
        <text
          x="22"
          y="94"
          fontFamily="var(--font-sans)"
          fontSize="6"
          fontWeight="700"
          fill="var(--color-teal-700)"
          textAnchor="middle"
          letterSpacing="0.08em"
        >
          LEANSHOT
        </text>
        <text
          x="22"
          y="102"
          fontFamily="var(--font-mono)"
          fontSize="6"
          fontWeight="600"
          fill="var(--color-text)"
          textAnchor="middle"
        >
          2.5mg/0.5ml
        </text>
      </g>

      {/* satellite — GLP-1 level card */}
      <g transform="translate(320 64)">
        <rect
          x="0"
          y="0"
          width="160"
          height="80"
          rx="14"
          fill="url(#lh-card)"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />
        <text
          x="14"
          y="22"
          fontFamily="var(--font-sans)"
          fontSize="9"
          fontWeight="700"
          fill="rgba(255,255,255,0.7)"
          letterSpacing="0.08em"
        >
          GLP-1 LEVEL
        </text>
        <text
          x="14"
          y="52"
          fontFamily="var(--font-sans)"
          fontSize="32"
          fontWeight="800"
          fill="rgba(255,255,255,1)"
          letterSpacing="-0.04em"
        >
          82%
        </text>
        <text
          x="62"
          y="52"
          fontFamily="var(--font-sans)"
          fontSize="11"
          fontWeight="600"
          fill="rgba(255,255,255,0.6)"
        >
          peak now
        </text>
        <path
          d="M 14 70 Q 38 56 62 60 T 110 50 T 146 64"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="62" cy="60" r="2" fill="rgba(255,255,255,1)" />
        <circle cx="146" cy="64" r="2.5" fill="rgba(242,168,147,1)" />
      </g>

      {/* satellite — streak chip */}
      <g transform="translate(396 384)">
        <circle
          cx="0"
          cy="0"
          r="32"
          fill="rgba(255,255,255,0.10)"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="1"
        />
        <circle cx="0" cy="0" r="22" fill="rgba(243,201,90,0.4)" />
        <circle cx="0" cy="0" r="14" fill="rgba(240,199,90,1)" />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fontFamily="var(--font-sans)"
          fontWeight="800"
          fontSize="14"
          fill="rgba(90,65,8,1)"
          letterSpacing="-0.04em"
        >
          30
        </text>
      </g>

      {/* satellite — LOST card */}
      <g transform="translate(72 410)">
        <rect
          x="0"
          y="0"
          width="150"
          height="56"
          rx="14"
          fill="url(#lh-card)"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />
        <text
          x="14"
          y="18"
          fontFamily="var(--font-sans)"
          fontSize="8"
          fontWeight="700"
          fill="rgba(255,255,255,0.7)"
          letterSpacing="0.08em"
        >
          LOST
        </text>
        <text
          x="14"
          y="44"
          fontFamily="var(--font-sans)"
          fontSize="22"
          fontWeight="800"
          fill="rgba(255,255,255,1)"
          letterSpacing="-0.04em"
        >
          4.2
        </text>
        <text
          x="50"
          y="44"
          fontFamily="var(--font-sans)"
          fontSize="12"
          fontWeight="500"
          fill="rgba(255,255,255,0.6)"
        >
          kg
        </text>
        <path
          d="M 90 42 L 100 36 L 110 38 L 120 28 L 130 30 L 138 22"
          stroke="rgba(111,203,184,1)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* sparkles */}
      <circle cx="40" cy="220" r="4" fill="rgba(255,255,255,1)" opacity="0.6" />
      <circle cx="490" cy="280" r="3" fill="rgba(255,255,255,1)" opacity="0.5" />
      <circle cx="120" cy="40" r="2" fill="rgba(255,255,255,1)" opacity="0.7" />
      <circle cx="470" cy="170" r="2" fill="rgba(255,255,255,1)" opacity="0.5" />
    </svg>
  );
}
