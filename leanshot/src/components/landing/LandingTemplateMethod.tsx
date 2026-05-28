/**
 * Phase 19 Plan 19-08 — `method` landing-page template renderer.
 *
 * UI-SPEC §"Template variant: method" — benefits-list, NO above-fold photo:
 *   - Hero: `text-4xl` headline + 5-bullet value list (lucide Check icons)
 *   - Attribution card BELOW hero: `<InitialsAvatar size="md">` + display_name
 *   - Optional Calendly CTA in attribution card
 * Final CTA + footer attribution.
 *
 * Type budget (4 sizes / 2 weights):
 *   text-4xl  (hero headline)   + font-semibold (CTAs / headlines)
 *   text-lg   (bullet body)     + font-normal   (body)
 *   text-sm
 *   text-xs
 */
import { Check } from 'lucide-react';
import { type ReactElement } from 'react';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import type { LandingTemplateProps } from './LandingTemplateCoach';

const METHOD_BULLETS: ReadonlyArray<string> = [
  'Stop guessing the curve — see your real drug level day by day',
  'Rotate injection sites without a notebook',
  'Watch your weight, mood, and symptoms in one view',
  'Send your doctor a clean snapshot in one tap',
  'Ask the AI coach anything in plain English',
];

export function LandingTemplateMethod({ affiliate }: LandingTemplateProps): ReactElement {
  const signupHref = `/signup?aff=${encodeURIComponent(affiliate.referral_code)}`;

  return (
    <main data-template="method" className="max-w-[1200px] mx-auto px-4 md:px-8 py-12 md:py-16">
      {/* Hero — bullet list, no above-fold photo */}
      <section className="max-w-3xl">
        <h1 className="text-4xl font-semibold text-[var(--color-text-primary)] mb-8 leading-tight">
          How I work with LeanShot
        </h1>
        <ul className="space-y-4">
          {METHOD_BULLETS.map((bullet) => (
            <li key={bullet} className="flex items-start gap-3 text-lg">
              <Check
                aria-hidden="true"
                className="size-6 shrink-0 text-[var(--color-primary)] mt-0.5"
              />
              <span className="text-[var(--color-text-primary)]">{bullet}</span>
            </li>
          ))}
        </ul>
        <div className="mt-10">
          <a
            href={signupHref}
            className="inline-flex items-center justify-center px-6 py-3 rounded-card bg-[var(--color-primary)] text-white font-semibold text-lg hover:opacity-90 transition-opacity"
          >
            Start your free trial
          </a>
        </div>
      </section>

      {/* Attribution card */}
      <section className="mt-16 md:mt-20">
        <div className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 md:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
          <InitialsAvatar name={affiliate.display_name} size="md" />
          <div className="flex-1 space-y-2">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Brought to you by {affiliate.display_name}
            </h2>
            {affiliate.blurb ? (
              <p className="text-sm text-[var(--color-text-secondary)]">{affiliate.blurb}</p>
            ) : null}
            {affiliate.calendly_url && affiliate.calendly_url.trim() ? (
              <a
                href={affiliate.calendly_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm font-semibold text-[var(--color-primary)] hover:underline"
              >
                Book a 1:1 with me &rarr;
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mt-16 md:mt-24 text-center">
        <h2 className="text-4xl font-semibold mb-4 text-[var(--color-text-primary)]">
          Track your GLP-1 journey
        </h2>
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

export default LandingTemplateMethod;
