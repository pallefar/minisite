/**
 * Phase 19 Plan 19-08 — `LandingTemplateMethod` vitest assertions.
 *
 * T5: renders 5 bullet items without any <img> above the fold
 * Footer: contains "Referred by {display_name}"
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AffiliatePublicRow } from '@/components/landing/LandingTemplateCoach';
import { LandingTemplateMethod } from '@/components/landing/LandingTemplateMethod';

const METHOD: AffiliatePublicRow = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  display_name: 'Pat Kim',
  // Even when photo_path is set, the method template MUST NOT render it
  // above the fold (UI-SPEC §"method" line 250-252).
  photo_path: 'https://cdn.example/pat.jpg',
  blurb: 'Why I recommend LeanShot to my GLP-1 community.',
  calendly_url: 'https://calendly.com/patkim/15',
  testimonial_quote: null,
  template_choice: 'method',
  referral_code: 'patkim',
};

describe('LandingTemplateMethod', () => {
  it('T5: renders 5 bullet items in the hero list', () => {
    const { container } = render(<LandingTemplateMethod affiliate={METHOD} />);
    const heroBullets = container.querySelector('section ul')?.querySelectorAll('li') ?? [];
    expect(heroBullets.length).toBe(5);
  });

  it('T5b: NO <img> in the hero section (no above-fold photo)', () => {
    const { container } = render(<LandingTemplateMethod affiliate={METHOD} />);
    // The first <section> is the hero; assert no <img> inside it.
    const hero = container.querySelector('section');
    expect(hero).not.toBeNull();
    expect(hero!.querySelector('img')).toBeNull();
  });

  it('attribution card uses InitialsAvatar (size md) BELOW the hero', () => {
    render(<LandingTemplateMethod affiliate={METHOD} />);
    expect(screen.getByLabelText(/avatar for pat kim/i)).toBeInTheDocument();
    expect(screen.getByText(/brought to you by pat kim/i)).toBeInTheDocument();
  });

  it('calendly link in attribution card has target="_blank" + noopener', () => {
    render(<LandingTemplateMethod affiliate={METHOD} />);
    const cta = screen.getByRole('link', { name: /book a 1:1/i });
    expect(cta.getAttribute('target')).toBe('_blank');
    expect(cta.getAttribute('rel')).toContain('noopener');
  });

  it('footer contains "Referred by {display_name}"', () => {
    render(<LandingTemplateMethod affiliate={METHOD} />);
    expect(screen.getByText(/referred by pat kim/i)).toBeInTheDocument();
  });
});
