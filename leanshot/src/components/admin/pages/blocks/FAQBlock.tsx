/**
 * Phase 15 Plan 15-05 — FAQBlock visual contract.
 *
 * Editor preview of a FAQ section: section heading + accordion items. Each item
 * is a <button> trigger with `aria-expanded` + `aria-controls` and a sibling
 * <div role="region"> panel with matching id. Open/close is local state; the
 * published HTML is rendered by `supabase/functions/page-render/render.ts`'s
 * Deno renderFaq() branch — token classes here must align with that output.
 *
 * Style is token-bounded (D-05): backgroundTone maps to a CSS custom-property
 * class via block-style-helpers; no raw hex.
 */
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface FAQBlockProps {
  block: BlockNode;
}

interface FaqItem {
  q?: string;
  a?: string;
}

interface FAQContent {
  eyebrow?: string;
  heading?: string;
  items?: FaqItem[];
}

export function FAQBlock({ block }: FAQBlockProps) {
  const content = (block.content ?? {}) as FAQContent;
  const tone = block.style.backgroundTone ?? 'default';
  const align = block.style.alignment ?? 'left';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const items = Array.isArray(content.items) ? content.items : [];
  const reduceMotion = useReducedMotion();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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
        <h2 className="text-[32px] font-semibold tracking-tight leading-[1.15]">
          {content.heading ?? 'Frequently asked questions'}
        </h2>
        <div className="mt-6 flex flex-col">
          {items.map((item, i) => {
            const panelId = `faq-${block.id}-${i}`;
            const isOpen = openIndex === i;
            return (
              <div
                key={i}
                className="block-faq__item border-b border-[var(--color-border)]"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 py-4 text-start text-[16px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] rounded"
                >
                  <span>{item.q ?? ''}</span>
                  <ChevronDown
                    aria-hidden
                    className={
                      'size-5 shrink-0 ' +
                      (reduceMotion ? '' : 'transition-transform duration-200 ease-out ') +
                      (isOpen ? 'rotate-180' : '')
                    }
                  />
                </button>
                <div
                  id={panelId}
                  role="region"
                  hidden={!isOpen}
                  className="pb-4 text-[16px] leading-[1.55] opacity-80"
                >
                  <p>{item.a ?? ''}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
