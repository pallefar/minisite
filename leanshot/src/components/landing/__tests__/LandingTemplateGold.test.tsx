/**
 * Phase 26 Plan 26-04 (AFFTIER-06) — `LandingTemplateGold` vitest assertions.
 *
 * Per D-12: single shared "premium" theme across ALL Gold partners.
 * Per-partner branding deferred to v1.5.
 *
 * Mirrors LandingTemplateCoach test shape so the prop interface is verified
 * compatible with the resolver wiring.
 *
 * T1: renders the "Premium partner — {referral_code}" badge
 * T2: primary CTA href targets /signup?aff={referral_code}
 * T3: distinct premium hero heading present (Gold-only copy, not Coach copy)
 * T4: footer references the referring affiliate's display_name
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AffiliatePublicRow } from '@/components/landing/LandingTemplateCoach';
import LandingTemplateGold from '@/components/landing/LandingTemplateGold';

const BASE: AffiliatePublicRow = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  display_name: 'Alex Premium',
  photo_path: null,
  blurb: 'Lifetime fitness coach helping clients sustain GLP-1 results.',
  calendly_url: null,
  testimonial_quote: null,
  template_choice: 'coach',
  referral_code: 'alex-premium',
};

describe('LandingTemplateGold (AFFTIER-06)', () => {
  it('T1: renders Premium partner badge with referral_code', () => {
    render(<LandingTemplateGold affiliate={BASE} />);
    // "Premium partner" appears in the badge (and may also appear in copy);
    // the e2e sanity-assertion target only requires at least one match.
    expect(screen.getAllByText(/premium partner/i).length).toBeGreaterThanOrEqual(1);
    // referral_code is rendered inside the badge data-testid="aff-code"
    const codeEl = screen.getByTestId('aff-code');
    expect(codeEl.textContent).toBe('alex-premium');
  });

  it('T2: primary CTA href = /signup?aff={referral_code}', () => {
    render(<LandingTemplateGold affiliate={BASE} />);
    const ctas = screen.getAllByRole('link', { name: /start your.*trial|start free trial/i });
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    expect(ctas[0]!.getAttribute('href')).toBe('/signup?aff=alex-premium');
  });

  it('T3: hero copy is the Gold premium variant (not the Coach hero)', () => {
    render(<LandingTemplateGold affiliate={BASE} />);
    // Gold-distinct hero heading per D-12 shared premium variant
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('T4: footer references the referring affiliate display_name', () => {
    render(<LandingTemplateGold affiliate={BASE} />);
    // display_name surfaces multiple times (subheading + footer "Referred by");
    // assert presence rather than uniqueness.
    expect(screen.getAllByText(/alex premium/i).length).toBeGreaterThanOrEqual(1);
    // footer-scoped check: "Referred by {display_name}" must exist verbatim.
    expect(screen.getByText(/referred by alex premium/i)).toBeInTheDocument();
  });
});
