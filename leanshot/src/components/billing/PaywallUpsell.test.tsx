/**
 * Phase 14 Plan 14-09 — PaywallUpsell unit tests (CR-02 gap closure).
 *
 * 4 behavior cases per the plan's <behavior> block:
 *   1. Default plan — clicking Upgrade invokes stripe-checkout/session with
 *      { plan: 'plus_monthly' } when no plan prop is provided
 *   2. Explicit plan prop — { plan: 'plus_yearly' } forwarded correctly
 *   3. Success invoke — window.location.href assigned to data.url
 *   4. Error invoke — no redirect; console.error called; no throw
 *
 * Mirrors UpgradeCTA.test.tsx mock style for supabase.functions.invoke.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { supabase } from '@/lib/supabase';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: vi.fn(),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid="card" {...props}>{children}</div>
  ),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
    [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      {...props}
    >
      {children}
    </button>
  ),
}));

const mockUseReducedMotion = useReducedMotion as unknown as ReturnType<typeof vi.fn>;
const mockInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { href: '' },
    writable: true,
  });
  mockUseReducedMotion.mockReturnValue(false);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaywallUpsell', () => {
  async function renderOverlay(props: Record<string, unknown> = {}) {
    const { PaywallUpsell } = await import('./PaywallUpsell');
    return render(
      <PaywallUpsell variant="overlay" feature="pharma-forecast" {...props} />,
    );
  }

  it('case 1: default plan — Upgrade click invokes stripe-checkout/session with { plan: plus_monthly }', async () => {
    const checkoutUrl = 'https://checkout.stripe.test/default-monthly';
    mockInvoke.mockResolvedValueOnce({ data: { url: checkoutUrl }, error: null });

    await renderOverlay(); // no plan prop → default 'plus_monthly'

    const upgradeBtn = screen.getByRole('button', { name: /upgrade/i });
    fireEvent.click(upgradeBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout/session', {
        body: { plan: 'plus_monthly' },
      });
    });
  });

  it('case 2: explicit plan prop — { plan: plus_yearly } forwarded to invoke', async () => {
    const checkoutUrl = 'https://checkout.stripe.test/yearly';
    mockInvoke.mockResolvedValueOnce({ data: { url: checkoutUrl }, error: null });

    await renderOverlay({ plan: 'plus_yearly' });

    const upgradeBtn = screen.getByRole('button', { name: /upgrade/i });
    fireEvent.click(upgradeBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout/session', {
        body: { plan: 'plus_yearly' },
      });
    });
  });

  it('case 3: successful invoke → window.location.href assigned to data.url', async () => {
    const checkoutUrl = 'https://checkout.stripe.test/success-redirect';
    mockInvoke.mockResolvedValueOnce({ data: { url: checkoutUrl }, error: null });

    await renderOverlay();

    const upgradeBtn = screen.getByRole('button', { name: /upgrade/i });
    fireEvent.click(upgradeBtn);

    await waitFor(() => {
      expect(window.location.href).toBe(checkoutUrl);
    });
  });

  it('case 4: invoke error → no redirect, console.error called, no throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'invoke-error' } });

    await renderOverlay();

    const upgradeBtn = screen.getByRole('button', { name: /upgrade/i });
    fireEvent.click(upgradeBtn);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(window.location.href).toBe('');
  });

  // Phase 43 Plan 05 — MEMBER-04 D-11 additive gating_reason variant.
  // These three cases verify the OPTIONAL prop extension:
  //   - default (omitted) preserves Phase 39 activation-paywall copy
  //   - 'pro_only_resource' renders pro-only-resource copy mentioning resource_name
  //   - resource_name omitted falls back to "This content"
  it('case 5: default gating_reason — no copy regression vs Phase 39 baseline', async () => {
    const { PaywallUpsell } = await import('./PaywallUpsell');
    render(<PaywallUpsell variant="overlay" feature="pharma-forecast" />);
    // Default copy retained: 7-day forecast headline (existing default headline path).
    expect(screen.getByText(/7-day forecast/i)).toBeTruthy();
    // Activation-paywall trial copy still rendered (no Phase 43 hijack).
    expect(screen.getByText(/7-day free trial/i)).toBeTruthy();
  });

  it('case 6: gating_reason=pro_only_resource — renders pro-only-resource copy with resource_name', async () => {
    const { PaywallUpsell } = await import('./PaywallUpsell');
    render(
      <PaywallUpsell
        variant="overlay"
        feature="advanced-ai"
        gating_reason="pro_only_resource"
        resource_type="community"
        resource_name="GLP-1 Starters"
      />,
    );
    expect(screen.getByText(/GLP-1 Starters is Pro-only/i)).toBeTruthy();
    expect(screen.getByText(/Unlock the full community library with Pro/i)).toBeTruthy();
  });

  it('case 7: gating_reason=pro_only_resource without resource_name falls back to "This content"', async () => {
    const { PaywallUpsell } = await import('./PaywallUpsell');
    render(
      <PaywallUpsell
        variant="overlay"
        feature="advanced-ai"
        gating_reason="pro_only_resource"
      />,
    );
    expect(screen.getByText(/This content is Pro-only/i)).toBeTruthy();
    // resource_type omitted → falls back to "resource"
    expect(screen.getByText(/Unlock the full resource library with Pro/i)).toBeTruthy();
  });
});
