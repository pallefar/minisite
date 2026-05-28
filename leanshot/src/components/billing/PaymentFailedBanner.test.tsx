/**
 * Phase 65 Plan 65-09 — PaymentFailedBanner unit tests.
 *
 * 8 cases covering: null states (no subscription / 'cancelled_for_payment'),
 * 3 dunning state copy variants, CTA wiring to stripe-checkout/portal, NO close
 * button, and warning surface token usage. The banner is intentionally NOT
 * dismissible per UI-SPEC §1.
 *
 * Mocks the useSubscription hook so we control subscription.dunning_state.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/lib/supabase';

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

const mockUseSubscription = useSubscription as unknown as ReturnType<typeof vi.fn>;
const mockInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

function setSubscription(dunning_state: string | null) {
  mockUseSubscription.mockReturnValue({
    subscription: dunning_state === null ? null : { id: 'sub_test', dunning_state },
    loading: false,
    refresh: vi.fn(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function renderBanner() {
  const { PaymentFailedBanner } = await import('./PaymentFailedBanner');
  return render(<PaymentFailedBanner />);
}

describe('PaymentFailedBanner', () => {
  it('case 1: renders nothing when dunning_state is null (no active dunning)', async () => {
    setSubscription(null);
    const { container } = await renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("case 2: renders nothing when dunning_state is 'cancelled_for_payment' (terminal)", async () => {
    setSubscription('cancelled_for_payment');
    const { container } = await renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("case 3: renders first_failed copy when dunning_state='first_failed'", async () => {
    setSubscription('first_failed');
    await renderBanner();
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText(/We couldn't process your last payment/i)).toBeDefined();
  });

  it("case 4: renders second_failed copy when dunning_state='second_failed'", async () => {
    setSubscription('second_failed');
    await renderBanner();
    expect(screen.getByText(/Second payment attempt failed/i)).toBeDefined();
  });

  it("case 5: renders final_warning copy when dunning_state='final_warning'", async () => {
    setSubscription('final_warning');
    await renderBanner();
    expect(
      screen.getByText(
        /Your subscription will be cancelled if payment isn't updated within 24 hours/i,
      ),
    ).toBeDefined();
  });

  it('case 6: primary CTA "Update payment method" invokes stripe-checkout/portal and redirects', async () => {
    setSubscription('first_failed');
    mockInvoke.mockResolvedValueOnce({
      data: { url: 'https://billing.stripe.com/session/abc' },
      error: null,
    });
    // Stub navigation: redefine window.location.href via spy
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        set href(v: string) {
          hrefSetter(v);
        },
        get href() {
          return '';
        },
      },
    });

    await renderBanner();
    const btn = screen.getByRole('button', { name: /Update payment method/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout/portal', { body: {} });
      expect(hrefSetter).toHaveBeenCalledWith('https://billing.stripe.com/session/abc');
    });
  });

  it('case 7: banner is NOT dismissible — no close/dismiss button rendered', async () => {
    setSubscription('first_failed');
    await renderBanner();
    // No button with name matching close/dismiss/×
    expect(screen.queryByRole('button', { name: /close|dismiss/i })).toBeNull();
  });

  it('case 8: banner uses the rose-soft warning surface token (no hardcoded hex)', async () => {
    setSubscription('first_failed');
    await renderBanner();
    const alert = screen.getByRole('alert');
    // The className should reference the rose-soft token (warning surface per UI-SPEC §1).
    expect(alert.className).toMatch(/color-rose-soft/);
    // No hardcoded hex literals in className
    expect(alert.className).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
