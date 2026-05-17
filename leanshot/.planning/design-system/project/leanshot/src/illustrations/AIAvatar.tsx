import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * AI avatar — gradient orb with three concentric rings. Used as the chat
 * hero and as the "thinking" indicator (with a subtle pulse).
 */
export interface AIAvatarProps {
  size?: number;
  className?: string;
  /** When true, the orb pulses to indicate it's thinking. */
  thinking?: boolean;
}

export function AIAvatar({ size = 56, className, thinking }: AIAvatarProps) {
  const reduced = useReducedMotion();
  const animate = thinking && !reduced;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="aiav-core" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0%" stopColor="var(--color-text-on-hero)" stopOpacity="0.95" />
          <stop offset="50%" stopColor="var(--color-primary-soft)" />
          <stop offset="100%" stopColor="var(--color-primary)" />
        </radialGradient>
        <linearGradient id="aiav-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      <circle cx="28" cy="28" r="26" stroke="url(#aiav-ring)" strokeWidth="0.8" opacity="0.6" />
      <circle cx="28" cy="28" r="22" stroke="url(#aiav-ring)" strokeWidth="0.8" opacity="0.7" />
      <circle
        cx="28"
        cy="28"
        r="16"
        fill="url(#aiav-core)"
        className={animate ? 'animate-pulse-soft' : undefined}
        style={animate ? { transformOrigin: '28px 28px' } : undefined}
      />
      {/* highlight glint */}
      <ellipse cx="22" cy="22" rx="5" ry="3" fill="white" opacity="0.45" />
    </svg>
  );
}
