/**
 * Phase 15 Plan 15-04 — CTABlock visual contract.
 *
 * Full-width call-to-action block with heading + body + button. Background
 * defaults to `brand`; supports all four tones plus `subtle` (per UI-SPEC).
 */
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface CTABlockProps {
  block: BlockNode;
}

interface CTAContent {
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function CTABlock({ block }: CTABlockProps) {
  const content = (block.content ?? {}) as CTAContent;
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
      <div className="max-w-2xl mx-auto">
        <h2 className="text-[22px] font-semibold tracking-tight">
          {content.heading ?? 'Call to action'}
        </h2>
        {content.body && <p className="mt-3 text-[16px] opacity-80">{content.body}</p>}
        {content.ctaLabel && (
          <a
            href={safeHref(content.ctaHref)}
            className="inline-block mt-6 px-6 py-3 rounded-pill font-medium bg-[var(--color-text)] text-[var(--color-bg)]"
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
