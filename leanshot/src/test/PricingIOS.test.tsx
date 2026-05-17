/**
 * Phase 16 Plan 16-05 Task 2 — PricingIOS component tests.
 *
 * Asserts the platform-aware paywall variants:
 *   • Renders null on web (the SPA bundle reaches PricingIOS via lazy
 *     getPricingComponent which itself returns null on web, but the
 *     component is defensively null-renderable too).
 *   • Clinic-owner branch (D-24) renders the "Clinic billing" heading +
 *     "Go to Billing Portal" CTA and NO "Subscribe" button.
 *   • Non-clinic-owner branch (D-13) renders the paywall + Subscribe CTA.
 *   • Trial-eligibility (D-22): "Start with 7 days free" copy ONLY when
 *     RC reports the device is intro-eligible for the selected plan.
 *   • Anti-steering (T-16-05-08): the non-clinic-owner rendered DOM
 *     contains zero matches for /stripe/i or /leanshot\.app\/pricing/i —
 *     this is the Apple §3.1.1 grep gate enforced by unit test.
 *   • Subscribe → calls purchaseSubscription with the selected productId.
 *   • Restore → calls restorePurchases.
 *   • userCancelled purchase result → no error toast fired.
 */
import type { User } from '@supabase/supabase-js';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockConfigureRC = vi.fn(async () => undefined);
const mockGetOfferings = vi.fn(async () => ({
  identifier: 'default',
  monthlyPackage: {
    identifier: '$rc_monthly',
    productIdentifier: 'app.leanshot.plus.monthly',
    priceString: '$12.99',
  },
  yearlyPackage: {
    identifier: '$rc_annual',
    productIdentifier: 'app.leanshot.plus.yearly',
    priceString: '$132.49',
  },
}));
const mockPurchaseSubscription = vi.fn(async (_productId: string) => ({
  customerInfo: { entitlements: { active: { plus: {} } } },
  cancelled: false,
}));
const mockRestorePurchases = vi.fn(async () => undefined);
const mockCheckTrialEligibility = vi.fn(async () => ({
  monthlyEligible: true,
  yearlyEligible: true,
}));
const mockDetectPlatform = vi.fn(() => 'ios' as 'ios' | 'android' | 'web' | 'capacitor-web');
const mockBrowserOpen = vi.fn(async () => undefined);

vi.mock('@/lib/native/iap', () => ({
  configureRC: (...args: unknown[]) => mockConfigureRC(...(args as [string])),
  getOfferings: () => mockGetOfferings(),
  purchaseSubscription: (id: string) => mockPurchaseSubscription(id),
  restorePurchases: () => mockRestorePurchases(),
  checkTrialEligibility: () => mockCheckTrialEligibility(),
}));

vi.mock('@/lib/native/platform', () => ({
  detectPlatform: () => mockDetectPlatform(),
}));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: (args: unknown) => mockBrowserOpen(args as never) },
}));

// ─── Test helpers ───────────────────────────────────────────────────────────

function seedSignedIn(role: string | undefined): void {
  const user = {
    id: 'u1',
    email: 'test@example.com',
    app_metadata: role ? { role } : {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    is_anonymous: false,
    email_confirmed_at: '2026-01-01T00:00:00Z',
  } as unknown as User;
  useStore.setState({
    signedIn: { user, session: null, verified: true },
  });
}

function clearSignedIn(): void {
  useStore.setState({ signedIn: null });
}

beforeEach(() => {
  mockConfigureRC.mockReset().mockResolvedValue(undefined);
  mockGetOfferings.mockReset().mockResolvedValue({
    identifier: 'default',
    monthlyPackage: {
      identifier: '$rc_monthly',
      productIdentifier: 'app.leanshot.plus.monthly',
      priceString: '$12.99',
    },
    yearlyPackage: {
      identifier: '$rc_annual',
      productIdentifier: 'app.leanshot.plus.yearly',
      priceString: '$132.49',
    },
  });
  mockPurchaseSubscription.mockReset().mockResolvedValue({
    customerInfo: { entitlements: { active: { plus: {} } } },
    cancelled: false,
  });
  mockRestorePurchases.mockReset().mockResolvedValue(undefined);
  mockCheckTrialEligibility.mockReset().mockResolvedValue({
    monthlyEligible: true,
    yearlyEligible: true,
  });
  mockDetectPlatform.mockReset().mockReturnValue('ios');
  mockBrowserOpen.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  clearSignedIn();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PricingIOS', () => {
  it('renders null on web', async () => {
    mockDetectPlatform.mockReturnValue('web');
    seedSignedIn(undefined);
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    const { container } = render(<PricingIOS />);
    expect(container.innerHTML).toBe('');
  });

  it('clinic-owner branch renders "Clinic billing" heading + portal CTA, no Subscribe', async () => {
    seedSignedIn('clinic_owner');
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /clinic billing/i })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /go to billing portal/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^subscribe$/i })).toBeNull();
  });

  it('clinic-owner CTA opens @capacitor/browser with portal URL', async () => {
    seedSignedIn('clinic_owner');
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    const btn = await screen.findByRole('button', { name: /go to billing portal/i });
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mockBrowserOpen).toHaveBeenCalled();
    });
    const call = mockBrowserOpen.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(call?.url).toMatch(/clinic\/billing$/);
  });

  it('non-clinic-owner trial-eligible renders "Start with 7 days free" + Subscribe', async () => {
    seedSignedIn(undefined);
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeTruthy();
    });
    expect(screen.getByText(/start with 7 days free/i)).toBeTruthy();
  });

  it('non-clinic-owner trial-ineligible omits "Start with 7 days free"', async () => {
    seedSignedIn(undefined);
    mockCheckTrialEligibility.mockResolvedValue({
      monthlyEligible: false,
      yearlyEligible: false,
    });
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeTruthy();
    });
    expect(screen.queryByText(/start with 7 days free/i)).toBeNull();
  });

  it('ANTI-STEERING grep: non-clinic-owner DOM contains no /stripe/ or /leanshot.app/pricing/', async () => {
    seedSignedIn(undefined);
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    const { container } = render(<PricingIOS />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeTruthy();
    });
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toMatch(/stripe/);
    expect(html).not.toMatch(/leanshot\.app\/pricing/);
  });

  it('Subscribe click invokes purchaseSubscription with the selected (default yearly) productId', async () => {
    seedSignedIn(undefined);
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    const subscribeBtn = await screen.findByRole('button', { name: /^subscribe$/i });
    await userEvent.click(subscribeBtn);
    await waitFor(() => {
      expect(mockPurchaseSubscription).toHaveBeenCalledWith('app.leanshot.plus.yearly');
    });
  });

  it('Subscribe userCancelled result → no error toast fired', async () => {
    seedSignedIn(undefined);
    mockPurchaseSubscription.mockResolvedValueOnce({
      customerInfo: { entitlements: { active: {} } },
      cancelled: true,
    });
    const showToastSpy = vi.fn();
    useStore.setState({ showToast: showToastSpy });
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    const subscribeBtn = await screen.findByRole('button', { name: /^subscribe$/i });
    await userEvent.click(subscribeBtn);
    await waitFor(() => {
      expect(mockPurchaseSubscription).toHaveBeenCalled();
    });
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it('Subscribe error throw → showToast called with error variant', async () => {
    seedSignedIn(undefined);
    mockPurchaseSubscription.mockRejectedValueOnce(new Error('network'));
    const showToastSpy = vi.fn();
    useStore.setState({ showToast: showToastSpy });
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    const subscribeBtn = await screen.findByRole('button', { name: /^subscribe$/i });
    await userEvent.click(subscribeBtn);
    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalled();
    });
    const args = showToastSpy.mock.calls[0];
    expect(args?.[1]).toBe('error');
  });

  it('Restore Purchases click invokes restorePurchases', async () => {
    seedSignedIn(undefined);
    const { default: PricingIOS } = await import('@/components/PricingIOS');
    render(<PricingIOS />);
    const restoreBtn = await screen.findByRole('button', { name: /restore purchases/i });
    await userEvent.click(restoreBtn);
    await waitFor(() => {
      expect(mockRestorePurchases).toHaveBeenCalledTimes(1);
    });
  });
});
