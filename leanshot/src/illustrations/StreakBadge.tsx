/**
 * Streak milestone badges — three variants for 7d / 30d / 90d. Designed
 * to feel like medals without looking like Fitbit-style game-y trophies.
 *
 * 7d  — single petal (warm-up).
 * 30d — three petals (core).
 * 90d — full bloom (mastery).
 */

interface BadgeProps {
  variant: '7d' | '30d' | '90d';
  className?: string;
  /** Pre-streak (locked) appearance. */
  locked?: boolean;
}

export function StreakBadge({ variant, className, locked }: BadgeProps) {
  const labels = { '7d': '7', '30d': '30', '90d': '90' } as const;
  const fill = locked ? 'var(--color-surface-elevated)' : 'var(--color-primary-soft)';
  const stroke = locked ? 'var(--color-border-strong)' : 'var(--color-primary)';
  const text = locked ? 'var(--color-text-tertiary)' : 'var(--color-primary)';

  return (
    <svg
      viewBox="0 0 96 96"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      {/* outer ring */}
      <circle
        cx="48"
        cy="48"
        r="44"
        stroke={stroke}
        strokeWidth="1.5"
        opacity={locked ? 0.5 : 0.85}
      />
      <circle
        cx="48"
        cy="48"
        r="38"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
        opacity={locked ? 0.6 : 1}
      />

      {/* petals */}
      {variant === '7d' && (
        <path
          d="M48 18 C58 28 60 38 56 50 C52 38 44 28 48 18 Z"
          fill={stroke}
          opacity={locked ? 0.35 : 0.6}
          strokeLinejoin="round"
        />
      )}
      {variant === '30d' && (
        <g fill={stroke} opacity={locked ? 0.35 : 0.6}>
          <path d="M48 18 C56 26 58 34 54 44 C50 34 44 26 48 18 Z" />
          <path d="M22 56 C32 56 38 60 44 70 C36 70 28 64 22 56 Z" />
          <path d="M74 56 C68 64 60 70 52 70 C58 60 64 56 74 56 Z" />
        </g>
      )}
      {variant === '90d' && (
        <g fill={stroke} opacity={locked ? 0.35 : 0.6}>
          <path d="M48 14 C56 22 58 32 54 42 C50 32 44 22 48 14 Z" />
          <path d="M16 50 C28 50 36 54 44 64 C34 66 24 60 16 50 Z" />
          <path d="M80 50 C72 60 62 66 52 64 C60 54 68 50 80 50 Z" />
          <path d="M30 22 L42 38 L46 32 Z" />
          <path d="M66 22 L54 38 L50 32 Z" />
        </g>
      )}

      {/* inner disc with day count */}
      <circle
        cx="48"
        cy="56"
        r="18"
        fill="var(--color-surface)"
        stroke={stroke}
        strokeWidth="1.4"
      />
      <text
        x="48"
        y="62"
        textAnchor="middle"
        fontSize="16"
        fontWeight={700}
        fill={text}
        fontFamily="var(--font-mono)"
      >
        {labels[variant]}d
      </text>
    </svg>
  );
}
