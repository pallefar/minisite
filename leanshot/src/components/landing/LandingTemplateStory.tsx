/**
 * Phase 19 Plan 19-08 — `story` landing-page template renderer.
 *
 * UI-SPEC §"Template variant: story" — testimonial-forward hero:
 *   - Large pull-quote (`text-4xl` Fraunces italic) of `testimonial_quote`
 *   - Attribution row: `<InitialsAvatar size="md">` + display_name
 *   - Primary CTA + optional Calendly secondary
 * Below hero: 3-card benefit grid (UI-SPEC defaults).
 * Final CTA + footer attribution.
 *
 * Type budget (UI-SPEC §Typography, 4 sizes / 2 weights for story):
 *   text-4xl  (pull-quote, Fraunces italic) + font-semibold (CTAs)
 *   text-lg   (subhead / CTA body)          + font-normal   (body)
 *   text-sm
 *   text-xs
 */
import { type ReactElement } from 'react';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import type { LandingTemplateProps } from './LandingTemplateCoach';

const STORY_BENEFITS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Injections',
    body: 'Every shot + site rotation, automatically.',
  },
  {
    title: 'Body + mood',
    body: 'Weight, symptoms, sleep, food noise.',
  },
  {
    title: 'Doctor share',
    body: 'A clean snapshot in one tap.',
  },
];

export function LandingTemplateStory({ affiliate }: LandingTemplateProps): ReactElement {
  const signupHref = `/signup?aff=${encodeURIComponent(affiliate.referral_code)}`;
  const quote =
    affiliate.testimonial_quote && affiliate.testimonial_quote.trim()
      ? affiliate.testimonial_quote
      : 'LeanShot helped me track every shot, side effect, and milestone in one place.';

  return (
    <main
      data-template="story"
      className="max-w-[1200px] mx-auto px-4 md:px-8 py-12 md:py-16"
    >
      {/* Hero — testimonial-forward */}
      <section className="text-center max-w-3xl mx-auto">
        <blockquote className="text-4xl font-[var(--font-display)] italic text-[var(--color-text-primary)] leading-snug">
          &ldquo;{quote}&rdquo;
        </blockquote>
        <div className="mt-8 flex items-center justify-center gap-3">
          <InitialsAvatar name={affiliate.display_name} size="md" />
          <span className="text-lg font-semibold text-[var(--color-text-primary)]">
            {affiliate.display_name}
          </span>
        </div>
        {affiliate.blurb ? (
          <p className="mt-4 text-lg text-[var(--color-text-secondary)]">{affiliate.blurb}</p>
        ) : null}
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
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
      </section>

      {/* 3-card benefit grid */}
      <section className="mt-16 md:mt-24">
        <h2 className="text-4xl font-semibold text-center mb-8 text-[var(--color-text-primary)]">
          What you&apos;ll track
        </h2>
        <ul className="grid sm:grid-cols-3 gap-6">
          {STORY_BENEFITS.map((item) => (
            <li
              key={item.title}
              className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
            >
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                {item.title}
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Final CTA */}
      <section className="mt-16 md:mt-24 text-center">
        <h2 className="text-4xl font-semibold mb-4 text-[var(--color-text-primary)]">
          Try LeanShot free
        </h2>
        <a
          href={signupHref}
          className="inline-flex items-center justify-center px-8 py-4 rounded-card bg-[var(--color-primary)] text-white font-semibold text-lg hover:opacity-90 transition-opacity"
        >
          Start your free trial
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

export default LandingTemplateStory;
