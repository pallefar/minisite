/**
 * Six abstract onboarding illustrations — one per step, plus a shared
 * "ready" / starting-snapshot wrap. Continuous-line, single-stroke, soft
 * fills. Designed for full-bleed display behind step content (not behind
 * inputs).
 *
 * Style rules:
 *  - 320×200 viewbox so it sits as a banner above the form
 *  - Stroke uses --color-primary; fills use very light primary tints
 *  - Subtle gradient washes so they read as illustrations, not diagrams
 */

interface IllProps {
  className?: string;
}

const grad = (id: string) => (
  <defs>
    <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.04" />
    </linearGradient>
    <linearGradient id={`${id}-glow`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="var(--color-amber)" stopOpacity="0.32" />
      <stop offset="100%" stopColor="var(--color-amber)" stopOpacity="0" />
    </linearGradient>
  </defs>
);

const baseProps = {
  viewBox: '0 0 320 200',
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none' as const,
  'aria-hidden': true,
};

/** 1. Welcome — three petal forms gathering around a center. */
export function OnboardWelcome({ className }: IllProps) {
  return (
    <svg {...baseProps} className={className}>
      {grad('w')}
      <ellipse cx="160" cy="100" rx="140" ry="80" fill="url(#w-glow)" />
      <path
        d="M160 30 C200 60 200 110 160 140 C120 110 120 60 160 30 Z"
        fill="url(#w-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M70 100 C100 70 130 70 158 92 C130 122 100 122 70 100 Z"
        fill="url(#w-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path
        d="M250 100 C220 70 190 70 162 92 C190 122 220 122 250 100 Z"
        fill="url(#w-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <circle cx="160" cy="100" r="8" fill="var(--color-primary)" />
      <circle cx="160" cy="100" r="3" fill="white" />
    </svg>
  );
}

/** 2. Medication — pen + drop trail. */
export function OnboardMedication({ className }: IllProps) {
  return (
    <svg {...baseProps} className={className}>
      {grad('m')}
      <ellipse cx="160" cy="110" rx="130" ry="60" fill="url(#m-glow)" />
      <g transform="rotate(-18 160 100)">
        <rect
          x="78"
          y="86"
          width="160"
          height="28"
          rx="14"
          fill="url(#m-fill)"
          stroke="var(--color-primary)"
          strokeWidth="1.6"
        />
        <rect
          x="84"
          y="92"
          width="32"
          height="16"
          rx="3"
          fill="var(--color-primary)"
          opacity="0.18"
        />
        <rect
          x="120"
          y="92"
          width="6"
          height="16"
          rx="1"
          fill="var(--color-primary)"
          opacity="0.4"
        />
        <line
          x1="238"
          y1="100"
          x2="262"
          y2="100"
          stroke="var(--color-primary)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>
      {/* drops */}
      <path
        d="M80 150 Q76 156 80 162 Q84 156 80 150 Z"
        fill="var(--color-primary)"
        opacity="0.55"
      />
      <path
        d="M104 162 Q101 167 104 172 Q107 167 104 162 Z"
        fill="var(--color-primary)"
        opacity="0.4"
      />
      <path d="M52 142 Q49 147 52 152 Q55 147 52 142 Z" fill="var(--color-primary)" opacity="0.3" />
    </svg>
  );
}

/** 3. Body — abstract proportions with a horizon. */
export function OnboardBody({ className }: IllProps) {
  return (
    <svg {...baseProps} className={className}>
      {grad('b')}
      <ellipse cx="160" cy="110" rx="130" ry="60" fill="url(#b-glow)" />
      <circle
        cx="160"
        cy="60"
        r="22"
        fill="url(#b-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
      />
      <path
        d="M120 88 Q160 78 200 88 L208 158 Q160 150 112 158 Z"
        fill="url(#b-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="160" cy="124" r="3" fill="var(--color-primary)" />
      <line
        x1="60"
        y1="170"
        x2="260"
        y2="170"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.45"
      />
      <text
        x="80"
        y="184"
        fontSize="11"
        fontFamily="var(--font-mono)"
        fill="var(--color-text-tertiary)"
        opacity="0.7"
      >
        75
      </text>
      <text
        x="226"
        y="184"
        fontSize="11"
        fontFamily="var(--font-mono)"
        fill="var(--color-text-tertiary)"
        opacity="0.7"
      >
        88
      </text>
    </svg>
  );
}

/** 4. Goals — target rings + arrow arc. */
export function OnboardGoals({ className }: IllProps) {
  return (
    <svg {...baseProps} className={className}>
      {grad('g')}
      <ellipse cx="160" cy="110" rx="130" ry="60" fill="url(#g-glow)" />
      <circle
        cx="160"
        cy="100"
        r="50"
        fill="url(#g-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
      />
      <circle cx="160" cy="100" r="32" stroke="var(--color-primary)" strokeWidth="1.6" />
      <circle cx="160" cy="100" r="14" stroke="var(--color-primary)" strokeWidth="1.6" />
      <circle cx="160" cy="100" r="4" fill="var(--color-primary)" />
      <path
        d="M70 168 Q120 110 156 100"
        stroke="var(--color-primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="3 4"
      />
      <path d="M156 100 L148 96 L150 104 Z" fill="var(--color-primary)" />
    </svg>
  );
}

/** 5. Routine — calendar weave. */
export function OnboardRoutine({ className }: IllProps) {
  return (
    <svg {...baseProps} className={className}>
      {grad('r')}
      <ellipse cx="160" cy="110" rx="130" ry="60" fill="url(#r-glow)" />
      <rect
        x="80"
        y="46"
        width="160"
        height="120"
        rx="14"
        fill="url(#r-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
      />
      <line x1="80" y1="74" x2="240" y2="74" stroke="var(--color-primary)" strokeWidth="1.4" />
      <circle cx="100" cy="60" r="3" fill="var(--color-primary)" />
      <circle cx="220" cy="60" r="3" fill="var(--color-primary)" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3, 4, 5, 6].map((col) => {
          const isActive = (row * 7 + col) % 5 === 2;
          return (
            <rect
              key={`${row}-${col}`}
              x={88 + col * 22}
              y={84 + row * 20}
              width="14"
              height="14"
              rx="3"
              fill={isActive ? 'var(--color-primary)' : 'var(--color-primary)'}
              opacity={isActive ? 0.9 : 0.18}
            />
          );
        }),
      )}
    </svg>
  );
}

/** 6. Ready — stylized rocket arc / launch curve. */
export function OnboardReady({ className }: IllProps) {
  return (
    <svg {...baseProps} className={className}>
      {grad('rd')}
      <ellipse cx="160" cy="110" rx="130" ry="60" fill="url(#rd-glow)" />
      <path
        d="M40 170 Q120 60 270 60"
        stroke="var(--color-primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="3 5"
        fill="none"
      />
      <g transform="rotate(-30 220 80)">
        <path
          d="M210 60 L240 60 L255 80 L240 100 L210 100 Q198 80 210 60 Z"
          fill="url(#rd-fill)"
          stroke="var(--color-primary)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="232" cy="80" r="6" fill="var(--color-primary)" opacity="0.3" />
        <circle cx="232" cy="80" r="3" fill="var(--color-primary)" />
        <path
          d="M210 70 L196 70 M210 90 L196 90"
          stroke="var(--color-primary)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
      <circle cx="40" cy="170" r="5" fill="var(--color-primary)" />
      <circle cx="80" cy="148" r="3" fill="var(--color-primary)" opacity="0.5" />
      <circle cx="60" cy="120" r="2" fill="var(--color-primary)" opacity="0.35" />
    </svg>
  );
}

/** 7. Starting snapshot wrap — used on the final preview screen. */
export function OnboardSnapshot({ className }: IllProps) {
  return (
    <svg {...baseProps} className={className}>
      {grad('s')}
      <ellipse cx="160" cy="110" rx="130" ry="60" fill="url(#s-glow)" />
      <rect
        x="64"
        y="44"
        width="192"
        height="120"
        rx="16"
        fill="url(#s-fill)"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
      />
      <line
        x1="64"
        y1="76"
        x2="256"
        y2="76"
        stroke="var(--color-primary)"
        strokeWidth="1.2"
        opacity="0.6"
      />
      <circle cx="84" cy="60" r="3" fill="var(--color-primary)" opacity="0.5" />
      <circle cx="100" cy="60" r="3" fill="var(--color-primary)" opacity="0.5" />
      <circle cx="116" cy="60" r="3" fill="var(--color-primary)" opacity="0.5" />
      <path
        d="M80 140 Q110 100 144 118 Q178 132 220 92"
        stroke="var(--color-primary)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="80" cy="140" r="3" fill="var(--color-primary)" />
      <circle cx="220" cy="92" r="4" fill="var(--color-primary)" />
      <text
        x="84"
        y="160"
        fontSize="9"
        fontFamily="var(--font-mono)"
        fill="var(--color-text-tertiary)"
        opacity="0.7"
      >
        today
      </text>
      <text
        x="200"
        y="160"
        fontSize="9"
        fontFamily="var(--font-mono)"
        fill="var(--color-text-tertiary)"
        opacity="0.7"
      >
        week 12
      </text>
    </svg>
  );
}
