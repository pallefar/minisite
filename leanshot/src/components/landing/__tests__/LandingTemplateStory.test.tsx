/**
 * Phase 19 Plan 19-08 — `LandingTemplateStory` vitest assertions.
 *
 * T4: renders pull-quote with exact `testimonial_quote` text
 * T1: InitialsAvatar attribution rendered (size md)
 * T6: footer contains "Referred by {display_name}"
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AffiliatePublicRow } from '@/components/landing/LandingTemplateCoach';
import { LandingTemplateStory } from '@/components/landing/LandingTemplateStory';

const STORY: AffiliatePublicRow = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  display_name: 'Sam Lee',
  photo_path: null,
  blurb: 'Coaching GLP-1 patients full-time.',
  calendly_url: null,
  testimonial_quote: 'I lost 40 lb and tracked every shot — no guesswork.',
  template_choice: 'story',
  referral_code: 'samlee',
};

describe('LandingTemplateStory', () => {
  it('T4: renders the testimonial_quote verbatim inside the hero blockquote', () => {
    render(<LandingTemplateStory affiliate={STORY} />);
    expect(
      screen.getByText(/I lost 40 lb and tracked every shot — no guesswork\./i),
    ).toBeInTheDocument();
  });

  it('renders InitialsAvatar attribution + display_name', () => {
    render(<LandingTemplateStory affiliate={STORY} />);
    expect(screen.getByLabelText(/avatar for sam lee/i)).toBeInTheDocument();
    // display_name appears in attribution + final-CTA footer; assert ≥1.
    expect(screen.getAllByText(/sam lee/i).length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to default quote when testimonial_quote is empty', () => {
    render(<LandingTemplateStory affiliate={{ ...STORY, testimonial_quote: '' }} />);
    expect(screen.getByText(/LeanShot helped me track every shot/i)).toBeInTheDocument();
  });

  it('T6: footer contains "Referred by {display_name}"', () => {
    render(<LandingTemplateStory affiliate={STORY} />);
    expect(screen.getByText(/referred by sam lee/i)).toBeInTheDocument();
  });

  it('CTA href = /signup?aff={referral_code}', () => {
    render(<LandingTemplateStory affiliate={STORY} />);
    const ctas = screen.getAllByRole('link', { name: /start your free trial/i });
    expect(ctas[0]!.getAttribute('href')).toBe('/signup?aff=samlee');
  });
});
