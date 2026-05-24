/**
 * Phase 39 Plan 39-05 Task 2 — PharmaContentBlock tests.
 *
 * Cascade order (any one branch matching wins):
 *   (a) isPharmaRegionBlocked() === true            → full content (D-07 carveout)
 *   (b) content.safety_category != null             → full content + SafetyInfoBadge (D-05)
 *   (c) getContentTier() === 'pro'                  → full content
 *   (d) free tier non-safety non-region             → summary + inline CTA + PaywallGate wrapper
 *
 * Plus the Pro+safety overlap: (e) Pro tier + safety_category → full + SafetyInfoBadge
 * (badge ALWAYS rendered alongside safety content per UI-SPEC).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PharmaContentBlock } from './PharmaContentBlock';

const isPharmaRegionBlockedMock = vi.fn<() => boolean>();
const getContentTierMock = vi.fn<() => Promise<'pro' | 'free'>>();

vi.mock('@/lib/pharma/region-detect', () => ({
  isPharmaRegionBlocked: () => isPharmaRegionBlockedMock(),
}));
vi.mock('@/lib/pharma/get-content-tier', () => ({
  getContentTier: () => getContentTierMock(),
}));

// Stub the gate to a transparent wrapper so the inline CTA + summary copy
// + data-surface attribute are directly assertable without exercising the
// real cookie-consent / variant-resolver round-trip (those have their own
// dedicated test suite in PaywallGate.test.tsx — Plan 39-04).
vi.mock('@/components/paywall/PaywallGate', () => ({
  PaywallGate: ({
    children,
    surface,
  }: {
    children: React.ReactNode;
    surface?: 'pharma' | 'paywall';
    content?: unknown;
  }) => (
    <div data-testid="paywall-gate-wrapper" data-surface={surface ?? 'paywall'}>
      {children}
    </div>
  ),
}));

const baseNonSafety = {
  id: 'pc-1',
  slug: 'dosing-tirzepatide',
  summary: 'A short 1-2 sentence summary line.',
  full_content: 'FULL_PHARMA_BODY_TEXT — only Pro members see this.',
  safety_category: null,
  category: 'dosing',
};

const baseSafety = {
  id: 'pc-2',
  slug: 'overdose-tirzepatide',
  summary: 'A short 1-2 sentence summary line.',
  full_content: 'FULL_SAFETY_BODY_TEXT — never paywalled (D-05).',
  safety_category: 'overdose-warning',
  category: 'safety',
};

async function flushAsync(getContentTierFn: Mock) {
  // wait for the useEffect resolution
  await waitFor(() => {
    expect(getContentTierFn).toHaveBeenCalled();
  });
  // and the resulting setState
  await new Promise((r) => setTimeout(r, 0));
}

describe('PharmaContentBlock', () => {
  beforeEach(() => {
    isPharmaRegionBlockedMock.mockReset();
    getContentTierMock.mockReset();
    isPharmaRegionBlockedMock.mockReturnValue(false);
    getContentTierMock.mockResolvedValue('free');
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('(a) region-blocked WA/CT user gets FULL content (no PaywallGate, no badge)', async () => {
    isPharmaRegionBlockedMock.mockReturnValue(true);
    render(<PharmaContentBlock content={baseNonSafety} />);
    await waitFor(() => {
      expect(screen.getByText(/FULL_PHARMA_BODY_TEXT/)).toBeTruthy();
    });
    expect(screen.queryByTestId('paywall-gate-wrapper')).toBeNull();
    expect(screen.queryByText('Safety info — always free')).toBeNull();
    expect(screen.queryByText(/Upgrade to Pro/)).toBeNull();
  });

  it('(b) safety-category content for FREE user gets FULL + SafetyInfoBadge (NEVER paywalled — D-05)', async () => {
    getContentTierMock.mockResolvedValue('free');
    render(<PharmaContentBlock content={baseSafety} />);
    await waitFor(() => {
      expect(screen.getByText(/FULL_SAFETY_BODY_TEXT/)).toBeTruthy();
    });
    expect(screen.getByText('Safety info — always free')).toBeTruthy();
    expect(screen.queryByTestId('paywall-gate-wrapper')).toBeNull();
    expect(screen.queryByText(/Upgrade to Pro/)).toBeNull();
  });

  it('(c) Pro tier non-safety → FULL content (no badge, no CTA, no wrapper)', async () => {
    getContentTierMock.mockResolvedValue('pro');
    render(<PharmaContentBlock content={baseNonSafety} />);
    await waitFor(() => {
      expect(screen.getByText(/FULL_PHARMA_BODY_TEXT/)).toBeTruthy();
    });
    expect(screen.queryByText('Safety info — always free')).toBeNull();
    expect(screen.queryByText(/Upgrade to Pro/)).toBeNull();
    expect(screen.queryByTestId('paywall-gate-wrapper')).toBeNull();
  });

  it('(d) FREE tier non-safety → SUMMARY + inline upgrade CTA wrapped in PaywallGate (surface=pharma)', async () => {
    getContentTierMock.mockResolvedValue('free');
    render(<PharmaContentBlock content={baseNonSafety} />);
    await flushAsync(getContentTierMock);
    expect(screen.getByText(/A short 1-2 sentence summary line/)).toBeTruthy();
    // UI-SPEC copy verbatim
    expect(screen.getByText(/Upgrade to Pro for full dosing details/)).toBeTruthy();
    const wrapper = screen.getByTestId('paywall-gate-wrapper');
    expect(wrapper).toBeTruthy();
    expect(wrapper.getAttribute('data-surface')).toBe('pharma');
    // full content must NOT be present in DOM for free user
    expect(screen.queryByText(/FULL_PHARMA_BODY_TEXT/)).toBeNull();
  });

  it('(e) Pro tier + safety_category → FULL + SafetyInfoBadge (badge ALWAYS alongside safety content)', async () => {
    getContentTierMock.mockResolvedValue('pro');
    render(<PharmaContentBlock content={baseSafety} />);
    await waitFor(() => {
      expect(screen.getByText(/FULL_SAFETY_BODY_TEXT/)).toBeTruthy();
    });
    expect(screen.getByText('Safety info — always free')).toBeTruthy();
    expect(screen.queryByTestId('paywall-gate-wrapper')).toBeNull();
  });

  it('UI-SPEC strict typography: free-tier path renders text-sm tertiary suffix and text-base summary line', async () => {
    getContentTierMock.mockResolvedValue('free');
    const { container } = render(<PharmaContentBlock content={baseNonSafety} />);
    await flushAsync(getContentTierMock);
    const html = container.innerHTML;
    // Positive assertions: required UI-SPEC tokens present in OUR markup.
    expect(html.includes('text-base')).toBe(true);
    expect(html.includes('text-sm')).toBe(true);
    expect(html.includes('text-text-tertiary')).toBe(true);
  });
});
