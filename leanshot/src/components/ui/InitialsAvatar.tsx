/**
 * Phase 19 Plan 19-05 — `<InitialsAvatar>` primitive.
 *
 * Phase 19's ONLY new UI primitive. Deterministic gradient avatar derived
 * from a `name` string. Used in 5 places per UI-SPEC §"Used by":
 *   1. /partner/links live-preview when photo_path is null
 *   2. /r/{code} coach template hero (lg size)
 *   3. /r/{code} story template attribution card (md size)
 *   4. /r/{code} method template attribution card (md size)
 *   5. /admin/affiliates table avatar column (sm size)
 *
 * API contract (UI-SPEC §"New Primitive"):
 *   - 3 sizes (sm 40 / md 80 / lg 120-200 responsive) — DO NOT add a 4th.
 *     The UI-checker traps `>4 sizes per surface` absolutely; keeping the
 *     primitive itself to ≤3 keeps every consumer surface in budget.
 *   - Rounded options: `card` (default) or `full`.
 *   - Background: `linear-gradient(135deg, hsl(H,65%,55%), hsl(H+30,65%,45%))`
 *     where H = hashStringToHue(name) % 360. White foreground always
 *     passes contrast against the saturated background (no dark-mode
 *     override needed).
 *   - Accessibility: role="img" + aria-label="Avatar for {name}"; not
 *     focusable (tabIndex=-1).
 *
 * No hardcoded hex values in this file. The `hsl(...)` calls produce
 * dynamic colours (not tokens); `text-white` resolves to a Tailwind
 * default token. CLAUDE.md "Anti-Patterns (Hard-coding colors)" honored.
 */

import { type ReactElement } from 'react';
import { cn } from '@/lib/helpers';

export interface InitialsAvatarProps {
  /** Used to derive initial + gradient hue. */
  name: string;
  /** sm=40px, md=80px, lg=120-200px (default md). */
  size?: 'sm' | 'md' | 'lg';
  /** Force-circular instead of `rounded-card`. */
  rounded?: 'card' | 'full';
  className?: string;
}

/**
 * Pure deterministic hash → 0..359 hue.
 *
 * Property tested by `InitialsAvatar.test.tsx`:
 *   - same input → same output (idempotency)
 *   - distinct inputs typically yield distinct outputs (collision-light)
 *
 * The `>>> 0` coerces the 32-bit signed result back to unsigned so the
 * modulo is stable on negative-overflow inputs.
 */
export function hashStringToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-10 h-10 text-lg',
  md: 'w-20 h-20 text-3xl',
  // Mobile-first: 120px on <md; 200px on md+. Inline px values via
  // arbitrary Tailwind utilities (allowed by UI-SPEC §"Layout Contracts
  // / Spacing Scale" — explicit pixel values that remain multiples of 4
  // are documented as acceptable for image/avatar dimensions).
  lg: 'w-[120px] h-[120px] text-5xl md:w-[200px] md:h-[200px] md:text-display',
};

const ROUNDED_CLASSES: Record<'card' | 'full', string> = {
  card: 'rounded-card',
  full: 'rounded-full',
};

export function InitialsAvatar({
  name,
  size = 'md',
  rounded = 'card',
  className,
}: InitialsAvatarProps): ReactElement {
  const trimmed = name.trim();
  // First Unicode code point, uppercased. Falls back to `?` on empty.
  const initial = (() => {
    if (!trimmed) return '?';
    const cp = trimmed.codePointAt(0);
    return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
  })();

  const hue = hashStringToHue(trimmed || '?');
  const bg = `linear-gradient(135deg, hsl(${hue}, 65%, 55%) 0%, hsl(${(hue + 30) % 360}, 65%, 45%) 100%)`;

  return (
    <div
      role="img"
      aria-label={`Avatar for ${name}`}
      tabIndex={-1}
      className={cn(
        'inline-flex items-center justify-center text-white font-semibold select-none shrink-0',
        SIZE_CLASSES[size],
        ROUNDED_CLASSES[rounded],
        // Fraunces display font for the initial — already loaded via
        // <link> in index.html (Phase 13 design system v2).
        'font-[var(--font-display)]',
        className,
      )}
      style={{ background: bg }}
    >
      {initial}
    </div>
  );
}

export default InitialsAvatar;
