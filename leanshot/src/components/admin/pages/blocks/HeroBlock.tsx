/**
 * Phase 15 Plan 15-04 — HeroBlock visual contract.
 *
 * The editor renders this preview when a Hero block is selected (and the
 * full PreviewPane iframe in 15-05 will reuse the same component). The
 * published page is rendered by `supabase/functions/page-render/render.ts`'s
 * Deno HTML builder — NOT this component — but the styling tokens here
 * MUST match the renderer so the WYSIWYG impression stays accurate.
 *
 * Style is token-bounded per CONTEXT D-05: `backgroundTone` maps to a CSS
 * custom-property class; `spacingDensity` maps to one of three exact px
 * values (48/64/96); raw hex is forbidden (acceptance criteria).
 */
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface HeroBlockProps {
  block: BlockNode;
}

interface HeroContent {
  heading?: string;
  subheading?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function HeroBlock({ block }: HeroBlockProps) {
  const content = (block.content ?? {}) as HeroContent;
  const tone = block.style.backgroundTone ?? 'brand';
  const align = block.style.alignment ?? 'center';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;

  return (
    <section
      className={
        backgroundToneClass(tone) +
        ' w-full px-6 ' +
        (hideOnMobile ? 'hidden md:block ' : '') +
        (align === 'center' ? 'text-center ' : align === 'right' ? 'text-end ' : 'text-start ')
      }
      style={{ paddingTop: paddingForDensity(density), paddingBottom: paddingForDensity(density) }}
    >
      <div className="max-w-3xl mx-auto">
        <h1
          className="font-[Fraunces,serif] italic"
          style={{ fontSize: 'clamp(32px, 5vw, 56px)', lineHeight: 1.1 }}
        >
          {content.heading ?? 'Hero heading'}
        </h1>
        {content.subheading && <p className="mt-4 text-[16px] opacity-80">{content.subheading}</p>}
        {content.ctaLabel && (
          <a
            href={safeHref(content.ctaHref)}
            className="inline-block mt-6 px-6 py-3 rounded-pill font-medium bg-[var(--color-bg)] text-[var(--color-text)]"
          >
            {content.ctaLabel}
          </a>
        )}
      </div>
    </section>
  );
}

function safeHref(href: unknown): string {
  if (typeof href !== 'string') return '#';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('#') || href.startsWith('/')) return href;
  return '#';
}
