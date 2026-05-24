/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall tests (Surface B — 6-screen
 * onboarding-flow mid-trial paywall).
 *
 * Behaviour gates (D-14 + UI-SPEC):
 *  - Renders exactly 6 screens in fixed order: value-pillar-1 / value-pillar-2 /
 *    value-pillar-3 / social-proof / pricing / final-CTA.
 *  - Progress dot count = 6.
 *  - sr-only "Step N of 6" updates as user advances.
 *  - Screen 6 (final-CTA) heading uses .font-display class (Fraunces accent).
 *  - Dismiss mid-flow shows inline confirm Card (NOT a Modal-on-Modal).
 *  - consent=false renders null (Hard Constraint #6).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { OnboardingFlowPaywall, SCREENS } from '../index';

describe('OnboardingFlowPaywall', () => {
  beforeEach(() => {
    trackingConsentMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      data: { variant_id: 'control', config: {} },
      error: null,
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SCREENS constant has exactly 6 entries in fixed D-14 order', () => {
    expect(SCREENS).toEqual([
      'value-pillar-1',
      'value-pillar-2',
      'value-pillar-3',
      'social-proof',
      'pricing',
      'final-CTA',
    ]);
    expect(SCREENS.length).toBe(6);
  });

  it('renders null when consent=false (Hard Constraint #6)', async () => {
    trackingConsentMock.mockReturnValue(false);
    const { container } = render(
      <OnboardingFlowPaywall open={true} onClose={() => undefined} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('renders 6 progress dots and starts on screen 1 of 6', async () => {
    trackingConsentMock.mockReturnValue(true);
    render(<OnboardingFlowPaywall open={true} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText(/Step 1 of 6/i)).toBeTruthy();
    });
    const dots = screen
      .getByTestId('paywall-progress-dots')
      .querySelectorAll('[data-dot]');
    expect(dots.length).toBe(6);
  });

  it('advances through all 6 screens via Next button; sr-only progress updates', async () => {
    trackingConsentMock.mockReturnValue(true);
    render(<OnboardingFlowPaywall open={true} onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByText(/Step 1 of 6/i)).toBeTruthy());

    for (let i = 1; i < 6; i += 1) {
      const nextBtn = screen.getByRole('button', { name: /^Next$/i });
      fireEvent.click(nextBtn);
      await waitFor(() => {
        expect(screen.getByText(new RegExp(`Step ${i + 1} of 6`, 'i'))).toBeTruthy();
      });
    }
  });

  it('Screen 6 final-CTA heading uses .font-display (Fraunces accent per UI-SPEC)', async () => {
    trackingConsentMock.mockReturnValue(true);
    render(<OnboardingFlowPaywall open={true} onClose={() => undefined} />);

    // Advance to final screen.
    for (let i = 0; i < 5; i += 1) {
      await waitFor(() => screen.getByRole('button', { name: /^Next$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    }
    await waitFor(() => expect(screen.getByText(/Step 6 of 6/i)).toBeTruthy());
    const heading = screen.getByTestId('final-cta-heading');
    expect(heading.className).toContain('font-display');
  });

  it('Dismiss mid-flow shows inline confirm Card (NOT a Modal-on-Modal)', async () => {
    trackingConsentMock.mockReturnValue(true);
    render(<OnboardingFlowPaywall open={true} onClose={() => undefined} />);

    await waitFor(() => screen.getByText(/Step 1 of 6/i));

    fireEvent.click(screen.getByRole('button', { name: /Not now/i }));

    // Inline confirm card surfaces — assert via testid (NOT a second dialog).
    await waitFor(() => {
      expect(screen.getByTestId('dismiss-confirm-card')).toBeTruthy();
    });
    // Exactly ONE dialog total (the outer Modal) — confirm UI is a Card.
    const dialogs = screen.queryAllByRole('dialog');
    expect(dialogs.length).toBe(1);
  });
});
