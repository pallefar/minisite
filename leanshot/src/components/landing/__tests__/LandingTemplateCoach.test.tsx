/**
 * Phase 19 Plan 19-08 — `LandingTemplateCoach` vitest assertions.
 *
 * T1: renders with photo_path=null → InitialsAvatar fallback visible;
 *     CTA href = /signup?aff={referral_code}
 * T2: with photo_path set → <img> renders with src
 * T3: without calendly_url → secondary CTA hidden
 * T4: footer contains "Referred by {display_name}"
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LandingTemplateCoach } from '@/components/landing/LandingTemplateCoach';
import type { AffiliatePublicRow } from '@/components/landing/LandingTemplateCoach';

const BASE: AffiliatePublicRow = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  display_name: 'Jane Doe',
  photo_path: null,
  blurb: 'GLP-1 nurse coach with 5 years of experience.',
  calendly_url: null,
  testimonial_quote: null,
  template_choice: 'coach',
  referral_code: 'janedoe',
};

describe('LandingTemplateCoach', () => {
  it('T1: with photo_path=null renders InitialsAvatar + CTA points at /signup?aff={code}', () => {
    render(<LandingTemplateCoach affiliate={BASE} />);
    // Fallback InitialsAvatar — accessibility label "Avatar for Jane Doe"
    expect(screen.getByLabelText(/avatar for jane doe/i)).toBeInTheDocument();
    // No <img> in the hero
    expect(screen.queryByAltText(/portrait/i)).not.toBeInTheDocument();
    // Primary CTA href is correct (there are 2 occurrences — hero + final)
    const ctas = screen.getAllByRole('link', { name: /start your free trial|start free trial/i });
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    expect(ctas[0]!.getAttribute('href')).toBe('/signup?aff=janedoe');
  });

  it('T2: with photo_path set renders <img> with the src', () => {
    render(
      <LandingTemplateCoach affiliate={{ ...BASE, photo_path: 'https://cdn.example/jane.jpg' }} />,
    );
    const img = screen.getByAltText(/jane doe portrait/i);
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBe('https://cdn.example/jane.jpg');
  });

  it('T3: without calendly_url, secondary CTA is hidden', () => {
    render(<LandingTemplateCoach affiliate={BASE} />);
    expect(screen.queryByRole('link', { name: /book a 1:1/i })).not.toBeInTheDocument();
  });

  it('T3b: with calendly_url, secondary CTA is shown with target=_blank', () => {
    render(
      <LandingTemplateCoach
        affiliate={{ ...BASE, calendly_url: 'https://calendly.com/janedoe/30' }}
      />,
    );
    const cta = screen.getByRole('link', { name: /book a 1:1/i });
    expect(cta).toBeInTheDocument();
    expect(cta.getAttribute('target')).toBe('_blank');
    expect(cta.getAttribute('rel')).toContain('noopener');
  });

  it('T4: footer contains "Referred by {display_name}"', () => {
    render(<LandingTemplateCoach affiliate={BASE} />);
    expect(screen.getByText(/referred by jane doe/i)).toBeInTheDocument();
  });
});
