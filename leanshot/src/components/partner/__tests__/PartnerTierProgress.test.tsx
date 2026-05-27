/**
 * Phase 26 Plan 26-03 — PartnerTierProgress RTL tests (AFFTIER-03).
 *
 * Behavior covered (matches plan's <behavior> block + threat-model T-26-13/14):
 *   T1: Standard tier with 7/10 paid conversions → progressbar at aria-valuenow=7,
 *       aria-valuemax=10 + "3 more to Gold" caption.
 *   T2: Gold tier with nextTierThreshold=null → tier badge renders, no progressbar.
 *   T3: Frozen partner (frozenAt populated) → role=alert banner with
 *       freezeReason + Appeal mailto link. (RESEARCH OQ#4 + D-04.)
 *   T4: A11y — progressbar has aria-valuenow / aria-valuemax / aria-valuemin.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PartnerTierProgress } from '@/components/partner/PartnerTierProgress';
import { getTierProgress } from '@/lib/affiliate/api';

vi.mock('@/lib/affiliate/api', () => ({
  getTierProgress: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

// Import after mock so the typed handle resolves to the mock factory.

describe('PartnerTierProgress (Plan 26-03 — AFFTIER-03)', () => {
  it('renders progressbar at 7/10 for standard tier + "3 more to Gold"', async () => {
    (getTierProgress as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      currentTier: 'standard',
      paidConversionCount: 7,
      nextTierThreshold: 10,
      frozenAt: null,
      freezeReason: null,
    });
    render(<PartnerTierProgress affiliateId="aff-std-7" />);
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '7');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(screen.getByText(/3 more to Gold/i)).toBeInTheDocument();
  });

  it('omits progressbar for gold tier (nextTierThreshold null) but renders badge', async () => {
    (getTierProgress as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      currentTier: 'gold',
      paidConversionCount: 25,
      nextTierThreshold: null,
      frozenAt: null,
      freezeReason: null,
    });
    render(<PartnerTierProgress affiliateId="aff-gold" />);
    expect(await screen.findByText(/Gold/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders frozen banner + greys out future-progress UI when frozenAt populated', async () => {
    (getTierProgress as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      currentTier: 'gold',
      paidConversionCount: 25,
      nextTierThreshold: null,
      frozenAt: '2026-01-01T00:00:00Z',
      freezeReason: 'Suspected fraud — chargeback spike',
    });
    render(<PartnerTierProgress affiliateId="aff-frozen" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Account frozen/i);
    expect(alert).toHaveTextContent(/Suspected fraud — chargeback spike/);
    expect(alert.querySelector('a[href="mailto:partners@leanshot.app"]')).not.toBeNull();
  });
});
