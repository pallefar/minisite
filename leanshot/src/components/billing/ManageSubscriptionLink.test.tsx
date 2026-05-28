/**
 * Phase 14 Plan 14-06 — ManageSubscriptionLink unit tests.
 *
 * 3 cases: portal invoke on click, same-tab redirect (window.location.href),
 * aria-busy loading state, and reduced-motion no-crash.
 *
 * vi.mock() calls hoisted by vitest.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// ─── Mocks ───────────────────────────────────────────────────────────────────

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
  // ManageSubscriptionLink doesn't read tier — but useStore may be called
  // by child Card; mock with selector passthrough
  mockUseStore.mockImplementation((selector: (s: { tier: 'paid' }) => unknown) =>
    selector({ tier: 'paid' }),
  );
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ManageSubscriptionLink', () => {
  async function renderComponent() {
    const { ManageSubscriptionLink } = await import('./ManageSubscriptionLink');
    return render(<ManageSubscriptionLink />);
  }

  it('case 1: clicking Open Stripe button invokes stripe-checkout/portal AND redirects window.location.href', async () => {
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

  it('case 2: button shows aria-busy=true while fetch is in-flight', async () => {
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

  it('case 3: renders without crashing when useReducedMotion toggles', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    mockInvoke.mockResolvedValueOnce({ data: { url: 'https://example.com' }, error: null });
    await renderComponent();
    // Just assert the component renders correctly with reduced-motion toggled
    expect(screen.getByRole('button', { name: /Open Stripe/i })).toBeDefined();
  });
});
