/**
 * Phase 14 Plan 14-06 — ManageSubscriptionLink unit tests.
 *
 * Stripe (web) path: portal invoke on click, same-tab redirect, aria-busy state.
 * H2 RevenueCat path: provider='revenuecat' routes to the platform store
 * (App Store / Play) via @capacitor/browser — NOT the Stripe portal.
 *
 * vi.mock() calls hoisted by vitest.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDetectPlatform = vi.fn(() => 'web' as 'ios' | 'android' | 'web' | 'capacitor-web');
const mockBrowserOpen = vi.fn(async () => undefined);

vi.mock('@/lib/store', () => ({
  useStore: vi.fn(),
}));

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

vi.mock('@/lib/native/platform', () => ({
  detectPlatform: () => mockDetectPlatform(),
}));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: (args: unknown) => mockBrowserOpen(args as never) },
}));

// Mock Card and Button to avoid full design system in unit tests
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
    'aria-busy': ariaBusy,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    'aria-busy'?: boolean;
    [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled ?? loading}
      aria-busy={ariaBusy ?? loading}
      {...props}
    >
      {children}
    </button>
  ),
}));

const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
const mockUseReducedMotion = useReducedMotion as unknown as ReturnType<typeof vi.fn>;
const mockInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

type StoreSlice = { tier: string; provider: string | null };

function seedStore(provider: string | null): void {
  mockUseStore.mockImplementation((selector: (s: StoreSlice) => unknown) =>
    selector({ tier: 'paid', provider }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// Patch window.location before each test
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { href: '' },
    writable: true,
  });
  mockUseReducedMotion.mockReturnValue(false);
  mockDetectPlatform.mockReturnValue('web');
  mockBrowserOpen.mockReset().mockResolvedValue(undefined);
  // Default: Stripe (web) subscriber.
  seedStore('stripe');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ManageSubscriptionLink', () => {
  async function renderComponent() {
    const { ManageSubscriptionLink } = await import('./ManageSubscriptionLink');
    return render(<ManageSubscriptionLink />);
  }

  it('case 1 (stripe): clicking Open Stripe invokes stripe-checkout/portal AND redirects window.location.href', async () => {
    const portalUrl = 'https://billing.stripe.com/portal/test456';
    mockInvoke.mockResolvedValueOnce({ data: { url: portalUrl }, error: null });

    await renderComponent();
    const button = screen.getByRole('button', { name: /Open Stripe/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout/portal', { body: {} });
      expect(window.location.href).toBe(portalUrl);
    });
  });

  it('case 2 (stripe): button shows aria-busy=true while fetch is in-flight', async () => {
    // Never resolves during the test
    mockInvoke.mockReturnValue(new Promise(() => {}));

    await renderComponent();
    const button = screen.getByRole('button', { name: /Open Stripe/i });
    fireEvent.click(button);

    await waitFor(() => {
      const btn = screen.getByRole('button');
      expect(btn.getAttribute('aria-busy')).toBe('true');
      expect(btn).toBeDisabled();
    });
  });

  it('case 3 (stripe): renders without crashing when useReducedMotion toggles', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    mockInvoke.mockResolvedValueOnce({ data: { url: 'https://example.com' }, error: null });
    await renderComponent();
    expect(screen.getByRole('button', { name: /Open Stripe/i })).toBeDefined();
  });

  it('H2 (revenuecat/ios): renders "Open App Store" + opens App Store, NOT the Stripe portal', async () => {
    seedStore('revenuecat');
    mockDetectPlatform.mockReturnValue('ios');

    await renderComponent();
    const button = screen.getByRole('button', { name: /Open App Store/i });
    expect(screen.queryByRole('button', { name: /Open Stripe/i })).toBeNull();
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockBrowserOpen).toHaveBeenCalled();
    });
    const call = mockBrowserOpen.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(call?.url).toMatch(/apps\.apple\.com\/account\/subscriptions/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('H2 (revenuecat/android): renders "Open Google Play" + opens Play subscriptions', async () => {
    seedStore('revenuecat');
    mockDetectPlatform.mockReturnValue('android');

    await renderComponent();
    const button = screen.getByRole('button', { name: /Open Google Play/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockBrowserOpen).toHaveBeenCalled();
    });
    const call = mockBrowserOpen.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(call?.url).toMatch(/play\.google\.com\/store\/account\/subscriptions/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
