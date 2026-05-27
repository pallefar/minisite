/**
 * Phase 39 Plan 39-04 — PaywallModal tests (Surface A — single-screen
 * mid-trial paywall).
 *
 * Behaviour gates:
 *  - open=false        → renders null.
 *  - open=true + consent=false → renders null (UI-SPEC Hard Constraint #6).
 *  - open=true + consent=true + variant resolved → renders Modal with
 *    variant.config.headline as heading + "Start subscription" primary CTA
 *    + "Maybe later" secondary action.
 *  - Modal inherits role="dialog" + aria-modal="true" from primitive.
 *  - vendor_unconfigured response → renders soft banner (Pattern A).
 */

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaywallModal } from './PaywallModal';

const trackingConsentMock = vi.fn<() => boolean>();
vi.mock('@/lib/paywall/consent-adapter', () => ({
  getPaywallTrackingConsent: () => trackingConsentMock(),
}));

const invokeMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));


describe('PaywallModal', () => {
  beforeEach(() => {
    trackingConsentMock.mockReset();
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when open=false', () => {
    trackingConsentMock.mockReturnValue(true);
    const { container } = render(<PaywallModal open={false} onClose={() => undefined} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders null when consent=false even if open=true (Hard Constraint #6)', async () => {
    trackingConsentMock.mockReturnValue(false);
    invokeMock.mockResolvedValue({
      data: { variant_id: 'control', config: { headline: 'Should not render' } },
      error: null,
    });
    const { container } = render(<PaywallModal open={true} onClose={() => undefined} />);
    // Wait a tick to confirm no async render happens
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('renders Modal with variant headline + primary CTA + secondary CTA when consent=true + variant resolved', async () => {
    trackingConsentMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      data: { variant_id: 'control', config: { headline: 'Keep your trial momentum' } },
      error: null,
    });
    render(<PaywallModal open={true} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    expect(screen.getByText('Keep your trial momentum')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Start subscription$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Maybe later$/i })).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith('variant-resolver', { body: { surface: 'paywall' } });
  });

  it('renders vendor_unconfigured soft banner when variant-resolver returns 503', async () => {
    trackingConsentMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      data: { error: 'vendor_unconfigured', service: 'posthog' },
      error: null,
    });
    render(<PaywallModal open={true} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText(/vendor not yet configured|not yet configured/i)).toBeTruthy();
    });
  });

  it('Modal dialog has role="dialog" + aria-modal="true" (inherited from primitive)', async () => {
    trackingConsentMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      data: { variant_id: 'control', config: { headline: 'X' } },
      error: null,
    });
    render(<PaywallModal open={true} onClose={() => undefined} />);
    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
    });
  });
});
