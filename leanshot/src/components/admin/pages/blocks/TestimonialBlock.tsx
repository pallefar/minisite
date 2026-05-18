/**
 * Phase 15 Plan 15-05 — TestimonialBlock visual contract.
 *
 * Fraunces 22px italic quote (UI-SPEC editorial moment) + 48x48 circular
 * author photo (only rendered when both URL and non-empty alt are provided —
 * a11y gate, mirrors render.ts).
 */
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface TestimonialBlockProps {
  block: BlockNode;
}

interface TestimonialQuote {
  quote?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  authorPhotoAlt?: string;
}

interface TestimonialContent {
  eyebrow?: string;
  heading?: string;
  quotes?: TestimonialQuote[];
}

export function TestimonialBlock({ block }: TestimonialBlockProps) {
  const content = (block.content ?? {}) as TestimonialContent;
  const tone = block.style.backgroundTone ?? 'default';
  const align = block.style.alignment ?? 'center';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const quotes = Array.isArray(content.quotes) ? content.quotes : [];

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
        {content.eyebrow && (
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] mb-2 opacity-70">
            {content.eyebrow}
          </p>
        )}
        {content.heading && (
          <h2 className="text-[32px] font-semibold tracking-tight leading-[1.15] mb-8">
            {content.heading}
          </h2>
        )}
        <div className="flex flex-col gap-8">
          {quotes.map((q, i) => {
            const hasPhoto = !!q.authorPhotoUrl && !!q.authorPhotoAlt && q.authorPhotoAlt.trim() !== '';
            return (
              <figure key={i} className="flex flex-col gap-3">
                <blockquote
                  className="block-testimonial__quote font-[Fraunces,Georgia,serif] italic text-[22px] leading-[1.4] m-0"
                >
                  {q.quote ?? ''}
                </blockquote>
                <figcaption className="flex items-center gap-3 text-[13px] font-semibold">
                  {hasPhoto && (
                    <img
                      src={q.authorPhotoUrl}
                      alt={q.authorPhotoAlt}
                      width={48}
                      height={48}
                      className="size-12 rounded-full object-cover"
                    />
                  )}
                  <span>{q.authorName ?? ''}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
