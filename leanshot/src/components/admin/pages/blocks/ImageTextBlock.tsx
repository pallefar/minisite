/**
 * Phase 15 Plan 15-05 — ImageTextBlock visual contract.
 *
 * 2-col layout (stacks to 1-col on mobile). Image side controlled by
 * block.style.alignment ('left' = image first; 'right' = text first). The
 * <img> is omitted entirely when imageAlt is blank — a11y gate that mirrors
 * the published renderer (Threat T-15-05-02).
 */
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface ImageTextBlockProps {
  block: BlockNode;
}

interface ImageTextContent {
  heading?: string;
  body?: string;
  imageUrl?: string;
  imageAlt?: string;
}

export function ImageTextBlock({ block }: ImageTextBlockProps) {
  const content = (block.content ?? {}) as ImageTextContent;
  const tone = block.style.backgroundTone ?? 'default';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const align = block.style.alignment ?? 'left';
  const imageAlt = typeof content.imageAlt === 'string' ? content.imageAlt.trim() : '';
  const imageUrl = typeof content.imageUrl === 'string' ? content.imageUrl.trim() : '';
  const showImage = imageAlt !== '' && imageUrl !== '';

  const imageEl = showImage ? (
    <img
      src={imageUrl}
      alt={imageAlt}
      width={600}
      height={400}
      className="w-full max-w-[600px] aspect-[3/2] object-cover rounded-xl"
    />
  ) : null;

  const textEl = (
    <div className="flex flex-col gap-3">
      {content.heading && (
        <h2 className="text-[22px] font-semibold tracking-tight leading-[1.35]">
          {content.heading}
        </h2>
      )}
      {content.body && <p className="text-[16px] leading-[1.55] opacity-80">{content.body}</p>}
    </div>
  );

  return (
    <section
      className={
        backgroundToneClass(tone) + ' w-full px-6 ' + (hideOnMobile ? 'hidden md:block ' : '')
      }
      style={{ paddingTop: paddingForDensity(density), paddingBottom: paddingForDensity(density) }}
    >
      <div className="max-w-5xl mx-auto grid gap-8 grid-cols-1 md:grid-cols-2 items-center">
        {align === 'right' ? (
          <>
            {textEl}
            {imageEl}
          </>
        ) : (
          <>
            {imageEl}
            {textEl}
          </>
        )}
      </div>
    </section>
  );
}
