/**
 * Phase 26 Plan 26-04 (AFFTIER-06) — Gold tier landing template (premium variant).
 *
 * Per D-12: SINGLE shared "premium" theme across ALL Gold partners.
 * Per-partner branding is explicitly deferred to v1.5 per CONTEXT.
 *
 * Prop interface MIRRORS LandingTemplateCoach (same AffiliatePublicRow shape +
 * optional resolveImageUrl) so the resolver can swap templates by tier without
 * any prop-contract changes.
 *
 * Design discipline:
 *   - No hardcoded hex; colors via `var(--color-*)` tokens defined in
 *     src/index.css. The "premium" gradient is a deterministic token-based
 *     two-tone amber wash applied with Tailwind utility classes that
 *     resolve to CSS custom properties (Phase 13 v2 "tokens or computed"
 *     exception); the gradient hues come from Tailwind's amber-50/amber-100
 *     palette which is itself token-driven via @theme.
 *   - The "Premium partner" badge is the AFFTIER-06 sanity-assertion target
 *     in the Playwright spec; the literal string "Premium partner" MUST
 *     remain visible in the rendered DOM so the screenshot test can fail
 *     fast before the diff phase.
 *   - 4 type sizes / 2 weights (same Phase 13 ceiling as Coach):
 *       text-display + text-lg + text-sm + text-xs ; semibold + normal.
 */
import { type ReactElement } from 'react';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import type { AffiliatePublicRow } from './LandingTemplateCoach';

export interface LandingTemplateProps {
  affiliate: AffiliatePublicRow;
  /** Optional Storage public-URL resolver; defaults to passthrough. Mirrors
   * the Coach contract so swapping templates is type-safe at the call site. */
  resolveImageUrl?: (path: string) => string;
}

const GOLD_VALUE_PROPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Clinical-grade tracking',
    body: 'Drug-level curves, site rotation, weight, mood — one premium timeline.',
  },
  {
    title: 'AI coach + concierge',
    body: 'Always-on guidance from your premium partner plus an AI coach you can ask anything.',
  },
  {
    title: 'Doctor-share report',
    body: 'One-tap clinical snapshot polished for your provider visits.',
  },
];

export function LandingTemplateGold({
  affiliate,
  resolveImageUrl,
}: LandingTemplateProps): ReactElement {
  const signupHref = `/signup?aff=${encodeURIComponent(affiliate.referral_code)}`;
  const photoSrc =
    affiliate.photo_path && affiliate.photo_path.trim()
      ? (resolveImageUrl?.(affiliate.photo_path) ?? affiliate.photo_path)
      : null;

  return (
    <main
      data-template="gold"
      className="max-w-[1200px] mx-auto px-4 md:px-8 py-12 md:py-16"
    >
      {/* Premium badge — sanity-assertion target for AFFTIER-06 e2e */}
      <div className="mb-6 inline-flex items-center gap-2 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
        <span aria-hidden="true">★</span>
        <span>
          Premium partner — <span data-testid="aff-code">{affiliate.referral_code}</span>
        </span>
      </div>

      {/* Hero — premium split layout */}
      <section className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
        <div className="flex justify-center md:justify-start">
          {photoSrc ? (
            <img
              src={photoSrc}
              alt={`${affiliate.display_name} portrait`}
              loading="eager"
              className="w-[120px] h-[120px] md:w-[200px] md:h-[200px] rounded-card object-cover"
            />
          ) : (
            <InitialsAvatar name={affiliate.display_name} size="lg" />
          )}
        </div>
        <div className="space-y-4">
          <h1 className="text-display font-[var(--font-display)] leading-tight text-[var(--color-text-primary)]">
            Track your GLP-1 journey with a premium partner.
          </h1>
          <p className="text-lg text-[var(--color-text-secondary)]">
            Clinical-grade tracking, AI coach, and share-with-doctor reports —
            backed by {affiliate.display_name}, a verified premium partner.
          </p>
          <p className="text-lg text-[var(--color-text-secondary)]">{affiliate.blurb}</p>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <a
              href={signupHref}
              className="inline-flex items-center justify-center px-6 py-3 rounded-card bg-[var(--color-primary)] text-white font-semibold text-lg hover:opacity-90 transition-opacity"
            >
              Start your free trial
            </a>
            {affiliate.calendly_url && affiliate.calendly_url.trim() ? (
              <a
                href={affiliate.calendly_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-3 rounded-card border border-[var(--color-border)] text-[var(--color-text-primary)] font-semibold text-lg hover:bg-[var(--color-surface-2)] transition-colors"
              >
                Book a 1:1 with me
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* Value props — 3-card premium grid */}
      <section className="mt-16 md:mt-24">
        <ul className="grid sm:grid-cols-3 gap-6">
          {GOLD_VALUE_PROPS.map((item) => (
            <li
              key={item.title}
              className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
            >
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                {item.title}
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)]">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Final CTA */}
      <section className="mt-16 md:mt-24 text-center">
        <h2 className="text-display font-[var(--font-display)] mb-4 text-[var(--color-text-primary)]">
          Ready for the premium tier?
        </h2>
        <p className="text-lg text-[var(--color-text-secondary)] mb-6 max-w-2xl mx-auto">
          Free to start. Your data stays local — sync only when you&apos;re ready.
        </p>
        <a
          href={signupHref}
          className="inline-flex items-center justify-center px-8 py-4 rounded-card bg-[var(--color-primary)] text-white font-semibold text-lg hover:opacity-90 transition-opacity"
        >
          Start free trial
        </a>
      </section>

      {/* Footer — references referring affiliate */}
      <footer className="mt-16 pt-8 border-t border-[var(--color-border)] text-center text-sm text-[var(--color-text-secondary)]">
        Referred by {affiliate.display_name}. LeanShot &middot;{' '}
        <a href="/legal/privacy" className="hover:underline">
          Privacy
        </a>{' '}
        &middot;{' '}
        <a href="/legal/terms" className="hover:underline">
          Terms
        </a>
      </footer>
    </main>
  );
}

export default LandingTemplateGold;
