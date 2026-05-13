/**
 * v2 body diagram with zone labels + numbered rotation dots.
 *
 * Visual source: .planning/design-system/project/assets/body-diagram.svg
 *
 * DS-09: 8 injection sites, each rendered as a numbered dot (1..8 in
 * deterministic SITES order) colored by recency status. Zone labels
 * ("ABDOMEN", "ARM", "ARM", "THIGH") give context. The site marked
 * "next" gets a pulsing ring (gated through useReducedMotion — improves
 * on the v1 inline SVG which animated unconditionally).
 *
 * Site->coordinate map matches the v1 inline SVG layout in
 * SiteRotationCard.tsx but is repositioned over the v2 body silhouette.
 */

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SITES } from '@/lib/constants';
import type { InjectionSite } from '@/types';

export type SiteStatus = 'recent' | 'older' | 'next' | 'empty';

export interface SiteRotationProps {
  status: Record<InjectionSite, SiteStatus>;
  className?: string;
}

/** Site position on the 220x360 body silhouette, plus 1-based rotation number. */
const SITE_LAYOUT: Record<InjectionSite, { x: number; y: number; n: number }> = {
  'abdomen-ul': { x: 92, y: 124, n: 1 },
  'abdomen-ur': { x: 128, y: 124, n: 2 },
  'abdomen-ll': { x: 92, y: 160, n: 3 },
  'abdomen-lr': { x: 128, y: 160, n: 4 },
  'thigh-l': { x: 86, y: 252, n: 5 },
  'thigh-r': { x: 134, y: 252, n: 6 },
  'arm-l': { x: 48, y: 135, n: 7 },
  'arm-r': { x: 172, y: 135, n: 8 },
};

function dotFill(s: SiteStatus): string {
  switch (s) {
    case 'recent':
      return 'var(--color-warning)';
    case 'older':
      return 'var(--color-amber)';
    case 'next':
      return 'var(--color-success)';
    case 'empty':
    default:
      return 'var(--color-border-strong)';
  }
}

export function SiteRotation({ status, className }: SiteRotationProps) {
  const reduced = useReducedMotion();
  const motion = !reduced;

  return (
    <svg
      viewBox="0 0 220 360"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Body diagram with injection sites"
      aria-hidden="false"
    >
      <defs>
        <linearGradient id="sr-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-cream-50)" />
          <stop offset="50%" stopColor="var(--color-surface)" />
          <stop offset="100%" stopColor="var(--color-cream-200)" />
        </linearGradient>
        <radialGradient id="sr-zone-abdomen" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </radialGradient>
        <filter id="sr-dot-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.7" />
          <feOffset dy="1" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.35" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* body silhouette (head -> neck -> torso -> arms -> legs) */}
      <g stroke="var(--color-border-strong)" strokeWidth="1.4" fill="url(#sr-body)">
        {/* head */}
        <circle cx="110" cy="40" r="28" />
        {/* neck */}
        <path d="M 100 66 Q 110 70 120 66 L 122 78 L 98 78 Z" />
        {/* torso */}
        <path
          d="M 70 80
             Q 110 75 150 80
             L 158 90
             Q 150 102 148 130
             L 148 196
             Q 110 192 72 196
             L 72 130
             Q 70 102 62 90 Z"
        />
        {/* left arm */}
        <path d="M 62 90 L 38 180 L 50 188 L 72 130 Z" />
        <path d="M 38 180 L 30 226 L 44 230 L 50 188 Z" />
        {/* right arm */}
        <path d="M 158 90 L 182 180 L 170 188 L 148 130 Z" />
        <path d="M 182 180 L 190 226 L 176 230 L 170 188 Z" />
        {/* hips */}
        <path d="M 72 196 Q 110 200 148 196 L 152 220 Q 110 216 68 220 Z" />
        {/* left leg */}
        <path d="M 78 220 L 70 320 L 92 322 L 102 220 Z" />
        {/* right leg */}
        <path d="M 118 220 L 128 322 L 150 320 L 142 220 Z" />
      </g>

      {/* center line */}
      <line
        x1="110"
        y1="80"
        x2="110"
        y2="218"
        stroke="var(--color-border)"
        strokeWidth="0.6"
        strokeDasharray="2 3"
      />

      {/* abdomen zone tint */}
      <ellipse cx="110" cy="148" rx="46" ry="40" fill="url(#sr-zone-abdomen)" />

      {/* numbered rotation dots */}
      <g filter="url(#sr-dot-shadow)">
        {SITES.map((site) => {
          const layout = SITE_LAYOUT[site];
          const s = status[site];
          const fill = dotFill(s);
          const isNext = s === 'next';
          const isEmpty = s === 'empty';

          return (
            <g key={site}>
              {/* next-site pulsing ring (gated on reduced-motion) */}
              {isNext && (
                <>
                  <circle
                    cx={layout.x}
                    cy={layout.y}
                    r="13"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="1.6"
                    opacity="0.5"
                  >
                    {motion && (
                      <animate
                        attributeName="r"
                        from="9"
                        to="17"
                        dur="1.6s"
                        repeatCount="indefinite"
                      />
                    )}
                    {motion && (
                      <animate
                        attributeName="opacity"
                        from="0.6"
                        to="0"
                        dur="1.6s"
                        repeatCount="indefinite"
                      />
                    )}
                  </circle>
                  <circle
                    cx={layout.x}
                    cy={layout.y}
                    r="17"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="1"
                    opacity="0.25"
                  />
                </>
              )}
              <circle
                cx={layout.x}
                cy={layout.y}
                r={isNext ? 10 : 9}
                fill={fill}
                stroke="var(--color-surface)"
                strokeWidth={isNext ? 2.4 : 2}
              >
                <title>
                  {site.replace('-', ' ')} — {s} (site {layout.n})
                </title>
              </circle>
              {/* number label (or star for next) */}
              <text
                x={layout.x}
                y={layout.y + 3.5}
                textAnchor="middle"
                fontFamily="var(--font-sans)"
                fontSize="9"
                fontWeight="800"
                fill={isEmpty ? 'var(--color-text-on-hero)' : 'var(--color-text-on-hero)'}
              >
                {isNext ? '★' : layout.n}
              </text>
            </g>
          );
        })}
      </g>

      {/* zone labels */}
      <g
        fontFamily="var(--font-sans)"
        fontSize="8"
        fontWeight="700"
        fill="var(--color-text-tertiary)"
        letterSpacing="0.06em"
      >
        <text x="110" y="100" textAnchor="middle">
          ABDOMEN
        </text>
        <text x="40" y="118" textAnchor="middle">
          ARM
        </text>
        <text x="180" y="118" textAnchor="middle">
          ARM
        </text>
        <text x="110" y="240" textAnchor="middle">
          THIGH
        </text>
      </g>
    </svg>
  );
}
