/**
 * Phase 15 Plan 15-07 — LeadFormBlock editor preview.
 *
 * Editor-side preview only. The real interactive form (with the inline
 * submit script + `lead-capture` POST) lives in `supabase/functions/
 * page-render/render.ts` `renderBlock()` `case 'lead-form'`. This component
 * shows what the form will look like in the editor — inputs are display
 * only; there is NO submit handler.
 *
 * Token-bounded (D-05):
 *   - backgroundTone → backgroundToneClass()
 *   - spacingDensity → paddingForDensity()
 *   - alignment → text-* utility
 *   - hideOnMobile → hidden md:block
 *   No raw hex anywhere.
 */
import type { BlockNode } from '@/lib/page-builder/block-schema';
import {
  DEFAULT_LEAD_FORM_CONTENT,
  type LeadFormContent,
} from '@/lib/page-builder/lead-form-content';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface LeadFormBlockProps {
  block: BlockNode;
}

export function LeadFormBlock({ block }: LeadFormBlockProps) {
  const raw = (block.content ?? {}) as Partial<LeadFormContent>;
  const heading = raw.heading ?? DEFAULT_LEAD_FORM_CONTENT.heading;
  const description = raw.description ?? DEFAULT_LEAD_FORM_CONTENT.description;
  const buttonLabel = raw.buttonLabel ?? DEFAULT_LEAD_FORM_CONTENT.buttonLabel;
  const collectName = raw.collectName ?? DEFAULT_LEAD_FORM_CONTENT.collectName;

  const tone = block.style.backgroundTone ?? 'default';
  const align = block.style.alignment ?? 'left';
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
      style={{
        paddingTop: paddingForDensity(density),
        paddingBottom: paddingForDensity(density),
      }}
    >
      <div className="max-w-md mx-auto">
        <h2
          className="font-[Geist,sans-serif] font-semibold"
          style={{ fontSize: '22px', lineHeight: 1.3 }}
        >
          {heading}
        </h2>
        {description && <p className="mt-2 text-[16px] opacity-80">{description}</p>}
        {/* Editor preview form — display only, no submit handler. */}
        <div className="mt-6 space-y-3 text-start">
          {collectName && (
            <label className="block">
              <span className="block text-[14px] font-medium mb-1">Name</span>
              <input
                type="text"
                name="name"
                placeholder="Your name"
                readOnly
                className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
              />
            </label>
          )}
          <label className="block">
            <span className="block text-[14px] font-medium mb-1">Email</span>
            <input
              type="email"
              name="email"
              placeholder="your@email.com"
              readOnly
              className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
            />
          </label>
          <button
            type="button"
            disabled
            className="w-full mt-2 px-6 py-3 rounded-pill font-medium bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
