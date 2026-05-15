/**
 * Phase 19 Plan 19-08 — `coach` landing-page template renderer.
 *
 * UI-SPEC §"Template variant: coach" — photo-forward split hero:
 *   - Left col: photo if `photo_path` set, else `<InitialsAvatar size="lg">`
 *     (responsive — 120px mobile, 200px desktop via InitialsAvatar size token)
 *   - Right col: display_name (Fraunces display, 64px), blurb (lg body),
 *     primary CTA to /signup?aff={referral_code}, optional secondary CTA
 *     to {calendly_url} (only when present)
 * Below hero: 3-item value-prop list (clone of UI-SPEC defaults; affiliate
 * customization of value props is deferred to v1.3).
 * Final CTA section + footer attribution.
 *
 * Type budget (UI-SPEC §Typography lines 92-101): 4 sizes / 2 weights:
 *   text-display (display)  + font-semibold (CTAs)
 *   text-lg (subhead/CTA)   + font-normal (body)
 *   text-sm (footer)
 *   text-xs (fineprint)
 *
 * Color discipline: NO hardcoded hex; only `var(--color-*)` tokens.
 * The InitialsAvatar gradient is a deterministic HSL — Phase 13 v2
 * "tokens or computed" exception per CLAUDE.md.
 */
import { type ReactElement } from 'react';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';

export interface AffiliatePublicRow {
  id: string;
  display_name: string;
  photo_path: string | null;
  blurb: string;
  calendly_url: string | null;
  testimonial_quote: string | null;
  template_choice: 'coach' | 'story' | 'method';
  referral_code: string;
}

export interface LandingTemplateProps {
  affiliate: AffiliatePublicRow;
  /** Optional Storage public-URL resolver. Defaults to passthrough. Phase 5
   * supabase client + Phase 13 marketing-assets bucket already serve public
   * read for `photo_path` strings stored as full public URLs. When the
   * stored `photo_path` is a Storage object path (no scheme), the partner
   * profile UI is responsible for converting it; the renderer just renders
   * whatever string is on the row. */
  resolveImageUrl?: (path: string) => string;
}

const COACH_VALUE_PROPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Every shot tracked',
    body: 'Injections, side effects, and weight — one unified timeline.',
  },
  {
    title: 'Built-in coach',
    body: 'Rule-based insights plus an AI coach you can ask anything.',
  },
  {
    title: 'Doctor-share view',
    body: 'One-tap snapshot for clinic visits — no manual data dump.',
  },
];

export function LandingTemplateCoach({
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
      data-template="coach"
      className="max-w-[1200px] mx-auto px-4 md:px-8 py-12 md:py-16"
    >
      {/* Hero — split layout (single column on <md) */}
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
            {affiliate.display_name}
          </h1>
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

      {/* Value props — 3-card grid */}
      <section className="mt-16 md:mt-24">
        <ul className="grid sm:grid-cols-3 gap-6">
          {COACH_VALUE_PROPS.map((item) => (
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
          Track your GLP-1 journey
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

      {/* Footer */}
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

export default LandingTemplateCoach;
