/**
 * Phase 15 Plan 15-05 — PricingBlock visual contract.
 *
 * Editor preview: section heading + one or more plan cards. The dollar amount
 * uses Geist Mono (UI-SPEC); feature bullets use a lucide Check in success
 * token; the Checkout CTA renders with Button-primary token classes. This is
 * VISUAL ONLY — 15-10 will wire the Checkout button to stripe-checkout.
 *
 * Recommended plans get the DS Card `selected` variant teal-ring marker.
 */
import { Check } from 'lucide-react';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface PricingBlockProps {
  block: BlockNode;
}

interface PricingPlan {
  name?: string;
  price?: string;
  cadence?: string;
  features?: string[];
  ctaLabel?: string;
  recommended?: boolean;
}

interface PricingContent {
  eyebrow?: string;
  heading?: string;
  plans?: PricingPlan[];
}

export function PricingBlock({ block }: PricingBlockProps) {
  const content = (block.content ?? {}) as PricingContent;
  const tone = block.style.backgroundTone ?? 'default';
  const align = block.style.alignment ?? 'center';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const plans = Array.isArray(content.plans) ? content.plans : [];

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
      <div className="max-w-5xl mx-auto">
        {content.eyebrow && (
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] mb-2 opacity-70">
            {content.eyebrow}
          </p>
        )}
        <h2 className="text-[32px] font-semibold tracking-tight leading-[1.15]">
          {content.heading ?? 'Pricing'}
        </h2>
        <div className="mt-8 grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 items-stretch">
          {plans.map((plan, i) => {
            const recommended = plan.recommended === true;
            const features = Array.isArray(plan.features) ? plan.features : [];
            const planClass = recommended
              ? 'block-pricing__plan block-pricing__plan--recommended bg-[var(--color-surface-elevated)] border-2 border-[var(--color-primary)] shadow-[0_0_0_4px_var(--color-primary-soft)] rounded-xl p-6 flex flex-col text-start'
              : 'block-pricing__plan bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] rounded-xl p-6 flex flex-col text-start';
            const ariaLabel =
              plan.ctaLabel && plan.name
                ? `${plan.ctaLabel} — ${plan.name}`
                : plan.ctaLabel ?? `Get started — ${plan.name ?? 'plan'}`;
            return (
              <div key={i} className={planClass}>
                {plan.name && (
                  <p className="text-[14px] font-semibold uppercase tracking-[0.06em] opacity-70">
                    {plan.name}
                  </p>
                )}
                <p className="block-pricing__price font-[Geist_Mono,ui-monospace,SFMono-Regular,Menlo,monospace] mt-2 flex items-baseline gap-1">
                  <span className="text-[40px] font-semibold leading-none">{plan.price ?? ''}</span>
                  <span className="text-[14px] opacity-70">{plan.cadence ?? ''}</span>
                </p>
                {features.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-2 flex-1">
                    {features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2 text-[14px]">
                        <Check
                          aria-hidden
                          className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
                        />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {plan.ctaLabel && (
                  <button
                    type="button"
                    aria-label={ariaLabel}
                    className="block-pricing__cta mt-6 inline-flex items-center justify-center h-11 px-5 rounded-pill font-semibold text-[14px] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] transition"
                  >
                    {plan.ctaLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
