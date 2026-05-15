/**
 * Phase 15 Plan 15-04 — token-bounded style helpers shared by the 3 Slice-1
 * block components. Token-bounded (D-05): no raw hex; backgroundTone maps to
 * a CSS-custom-property class; spacingDensity maps to one of three exact px
 * values; alignment maps to a Tailwind text-* utility.
 */
import type { BlockStyle } from '@/lib/page-builder/block-schema';

export function backgroundToneClass(tone: NonNullable<BlockStyle['backgroundTone']>): string {
  switch (tone) {
    case 'subtle':
      return 'bg-[var(--color-surface)] text-[var(--color-text)]';
    case 'brand':
      return 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]';
    case 'dark':
      return 'bg-[var(--color-text)] text-[var(--color-bg)]';
    case 'default':
    default:
      return 'bg-[var(--color-bg)] text-[var(--color-text)]';
  }
}

export function paddingForDensity(
  density: NonNullable<BlockStyle['spacingDensity']>,
): string {
  switch (density) {
    case 'compact':
      return '48px';
    case 'spacious':
      return '96px';
    case 'default':
    default:
      return '64px';
  }
}
