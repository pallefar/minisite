/**
 * Phase 39 Plan 39-04 — PaywallGate tests.
 *
 * The gate cascades:
 *   1. phaCheck(content) called inside try/catch (D-06 layer 2 — never crash render).
 *   2. content.safety_category non-null → render children directly (D-05 carveout).
 *   3. consent-adapter returns false → render children directly (cookie-consent gate).
 *   4. consent=true + non-safety → invoke variant-resolver; render paywall slot when variant resolves.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaywallGate } from './PaywallGate';

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

// Pretend phaCheck throws when safety_category present (loud-in-test). The
// gate's try/catch must absorb this and fall through to safety carveout.
vi.mock('@/lib/pharma/phaCheck', () => ({
  phaCheck: (content: { safety_category?: string | null }) => {
    if (content?.safety_category) {
      throw new Error('phaCheck violation: ' + content.safety_category);
    }
  },
}));


describe('PaywallGate', () => {
  beforeEach(() => {
    trackingConsentMock.mockReset();
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('D-05: renders children directly when content has safety_category (never paywalls safety info)', async () => {
    trackingConsentMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ data: { variant_id: 'control', config: {} }, error: null });

    render(
      <PaywallGate content={{ safety_category: 'overdose-warning' }}>
        <p>SAFETY-FREE-CONTENT</p>
      </PaywallGate>,
    );

    await waitFor(() => {
      expect(screen.getByText('SAFETY-FREE-CONTENT')).toBeTruthy();
    });
    // variant-resolver MUST NOT be called for safety content
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('Cookie consent gate: renders children directly when tracking consent is false', async () => {
    trackingConsentMock.mockReturnValue(false);

    render(
      <PaywallGate content={{ safety_category: null }}>
        <p>FREE-CONTENT</p>
      </PaywallGate>,
    );

    await waitFor(() => {
      expect(screen.getByText('FREE-CONTENT')).toBeTruthy();
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('consent=true + non-safety + variant resolved: renders paywall slot', async () => {
    trackingConsentMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      data: { variant_id: 'control', config: { headline: 'Upgrade now' } },
      error: null,
    });

    render(
      <PaywallGate content={{ safety_category: null }}>
        <p>FREE-CONTENT</p>
      </PaywallGate>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('paywall-content')).toBeTruthy();
    });
    expect(invokeMock).toHaveBeenCalledWith('variant-resolver', { body: { surface: 'paywall' } });
  });

  it('variant-resolver returns error: silently falls through to children (no crash)', async () => {
    trackingConsentMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ data: null, error: new Error('unreachable') });

    render(
      <PaywallGate content={{ safety_category: null }}>
        <p>FALLBACK-CHILDREN</p>
      </PaywallGate>,
    );

    await waitFor(() => {
      expect(screen.getByText('FALLBACK-CHILDREN')).toBeTruthy();
    });
    // paywall slot MUST NOT render when resolver errors
    expect(screen.queryByTestId('paywall-content')).toBeNull();
  });

  it('phaCheck throws but content has no safety_category: still falls through safely (defense-in-depth)', async () => {
    // Synthesize a phaCheck failure that doesn't come from safety_category.
    // (e.g. corrupted content). The gate's try/catch must absorb it.
    const consoleErr = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    trackingConsentMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ data: { variant_id: 'control', config: {} }, error: null });

    // Force phaCheck to throw by re-mocking only for this test
    const phaCheckModule = await import('@/lib/pharma/phaCheck');
    const spy = vi.spyOn(phaCheckModule, 'phaCheck').mockImplementation(() => {
      throw new Error('synthetic phaCheck error');
    });

    render(
      <PaywallGate content={{ safety_category: null }}>
        <p>STILL-RENDERS</p>
      </PaywallGate>,
    );

    await waitFor(() => {
      expect(screen.getByText('STILL-RENDERS')).toBeTruthy();
    });
    consoleErr.mockRestore();
    spy.mockRestore();
  });
});
