/**
 * Streak milestone badges — 4 tiers (bronze / silver / gold / locked).
 *
 * Visual source of truth:
 * .planning/design-system/project/assets/streak-{bronze,silver,gold,locked}.svg
 *
 * Tier mapping (consumer mapping example from StreaksCard.tsx):
 *   locked        - pre-streak (< 7 days OR explicitly locked)
 *   bronze        - 7d milestone
 *   silver        - 30d milestone
 *   gold          - 90d milestone
 *
 * Hex literals in the gradient stops below are brand-locked tier palettes
 * (warm bronze / cool silver / hot gold). Per CLAUDE.md "Anti-Patterns
 * (Hard-coding colors)", hex is permitted inside <linearGradient>/<radialGradient>
 * <stop stopColor="..."/> definitions for deliberate brand colors; ad-hoc
 * fill/stroke uses the design-token CSS variables.
 *
 * Animations: none (StreakBadge is static). When 13-06's reduced-motion
 * snapshot is captured, no gating required here.
 */

export type StreakTier = 'bronze' | 'silver' | 'gold' | 'locked';

export interface StreakBadgeProps {
  tier: StreakTier;
  className?: string;
}

interface TierPalette {
  /** outer ring gradient stops */
  ringFrom: string;
  ringTo: string;
  /** face radial gradient stops (light highlight -> mid -> deep shadow) */
  faceLight: string;
  faceMid: string;
  faceDeep: string;
  /** flame gradient stops (light tip -> warm body) */
  flameLight: string;
  flameWarm: string;
  /** glow halo stop */
  glow: string;
  /** corner-badge fill */
  cornerFill: string;
  /** corner-badge day label */
  cornerLabel: string;
}

const PALETTES: Record<Exclude<StreakTier, 'locked'>, TierPalette> = {
  bronze: {
    ringFrom: '#c98a4b',
    ringTo: '#a26432',
    faceLight: '#f6c89a',
    faceMid: '#c98a4b',
    faceDeep: '#8b4f23',
    flameLight: '#fff7e6',
    flameWarm: '#fbdca0',
    glow: '#ffd591',
    cornerFill: '#a26432',
    cornerLabel: '7',
  },
  silver: {
    ringFrom: '#d5dce0',
    ringTo: '#9aa4ad',
    faceLight: '#f1f3f5',
    faceMid: '#c2cad1',
    faceDeep: '#7d8892',
    flameLight: '#fdfdfd',
    flameWarm: '#d8e4ee',
    glow: '#cfd9e3',
    cornerFill: '#9aa4ad',
    cornerLabel: '30',
  },
  gold: {
    ringFrom: '#f0c75a',
    ringTo: '#b88a2b',
    faceLight: '#fbe89a',
    faceMid: '#e3b653',
    faceDeep: '#8a6418',
    flameLight: '#fff8d6',
    flameWarm: '#fbd87a',
    glow: '#fde196',
    cornerFill: '#b88a2b',
    cornerLabel: '90',
  },
};

export function StreakBadge({ tier, className }: StreakBadgeProps) {
  if (tier === 'locked') {
    return (
      <svg
        viewBox="0 0 80 80"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        fill="none"
        aria-hidden
      >
        <defs>
          <radialGradient id="sb-locked-face" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0%" stopColor="var(--color-surface-elevated)" />
            <stop offset="100%" stopColor="var(--color-border-strong)" />
          </radialGradient>
        </defs>
        {/* dimmed outer ring */}
        <circle cx="40" cy="40" r="34" fill="var(--color-border-strong)" />
        <circle
          cx="40"
          cy="40"
          r="33"
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="0.4"
        />
        {/* face */}
        <circle cx="40" cy="40" r="28" fill="url(#sb-locked-face)" />
        {/* padlock glyph */}
        <g transform="translate(40 40)" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" fill="none">
          <rect
            x="-7"
            y="-1"
            width="14"
            height="11"
            rx="2"
            fill="var(--color-text-tertiary)"
            opacity="0.35"
            stroke="none"
          />
          <path d="M -4 -1 V -5 a 4 4 0 0 1 8 0 V -1" />
        </g>
      </svg>
    );
  }

  const p = PALETTES[tier];
  const slug = `sb-${tier}`;

  return (
    <svg
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id={`${slug}-glow`} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0%" stopColor={p.glow} stopOpacity="0.55" />
          <stop offset="60%" stopColor={p.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${slug}-ring`} x1="0.2" y1="0.1" x2="0.8" y2="0.9">
          <stop offset="0%" stopColor={p.ringFrom} />
          <stop offset="100%" stopColor={p.ringTo} />
        </linearGradient>
        <radialGradient id={`${slug}-face`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0%" stopColor={p.faceLight} />
          <stop offset="55%" stopColor={p.faceMid} />
          <stop offset="100%" stopColor={p.faceDeep} />
        </radialGradient>
        <linearGradient id={`${slug}-flame`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.flameLight} />
          <stop offset="100%" stopColor={p.flameWarm} />
        </linearGradient>
      </defs>

      {/* soft glow */}
      <circle cx="40" cy="40" r="38" fill={`url(#${slug}-glow)`} />

      {/* outer rim */}
      <circle cx="40" cy="40" r="34" fill={`url(#${slug}-ring)`} />
      <circle
        cx="40"
        cy="40"
        r="33"
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="0.4"
        strokeDasharray="0.8 1.4"
      />
      <circle
        cx="40"
        cy="40"
        r="35"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="0.4"
      />

      {/* face */}
      <circle cx="40" cy="40" r="28" fill={`url(#${slug}-face)`} />
      {/* highlight arc */}
      <path
        d="M 18 40 A 22 22 0 0 1 56 22"
        fill="none"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* shadow arc */}
      <path
        d="M 22 56 A 22 22 0 0 0 58 56"
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="1"
        strokeLinecap="round"
      />

      {/* flame glyph */}
      <g transform="translate(40 42)">
        <path
          d="M 0 -14 C 5 -8 9 -4 9 2 C 9 8 5 13 0 13 C -5 13 -9 8 -9 2 C -9 -1 -7 -3 -5 -3 C -3 -3 -3 -1 -3 1 C -1 -3 -1 -9 0 -14 Z"
          fill={`url(#${slug}-flame)`}
          stroke="rgba(0,0,0,0.15)"
          strokeWidth="0.4"
          strokeLinejoin="round"
        />
        <path
          d="M 0 -6 C 3 -2 5 0 5 3 C 5 7 2 9 0 9 C -2 9 -5 7 -5 3 C -5 1 -4 0 -3 0 C -2 0 -2 1 -2 2 C -1 -1 -1 -3 0 -6 Z"
          fill="rgba(255,255,255,0.7)"
        />
      </g>

      {/* corner day-count badge */}
      <g transform="translate(58 58)">
        <circle
          cx="0"
          cy="0"
          r="11"
          fill={p.cornerFill}
          stroke="var(--color-text-on-hero)"
          strokeWidth="1.4"
        />
        <circle
          cx="0"
          cy="0"
          r="9"
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="0.6"
        />
        <text
          x="0"
          y="3.5"
          textAnchor="middle"
          fontFamily="var(--font-sans)"
          fontWeight={800}
          fontSize="9"
          fill="var(--color-text-on-hero)"
          letterSpacing="-0.04em"
        >
          {p.cornerLabel}
        </text>
      </g>
    </svg>
  );
}
