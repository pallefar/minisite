/**
 * Phase 14 Plan 14-06 — UpgradeCTA unit tests.
 *
 * 5 cases: null renders for paid/past_due, renders 2 plan buttons for free,
 * monthly checkout invoke + redirect, yearly checkout invoke + redirect,
 * and reduced-motion no-crash.
 *
 * vi.mock() calls hoisted by vitest.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function setTier(tier: 'free' | 'paid' | 'past_due') {
  mockUseStore.mockImplementation((selector: (s: { tier: typeof tier }) => typeof tier) =>
    selector({ tier }),
  );
}

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

describe('UpgradeCTA', () => {
  async function renderComponent() {
    const { UpgradeCTA } = await import('./UpgradeCTA');
    return render(<UpgradeCTA />);
  }

  it('case 1: renders null when tier=paid', async () => {
    setTier('paid');
    const { container } = await renderComponent();
    expect(container.firstChild).toBeNull();
  });

  it('case 2: renders null when tier=past_due', async () => {
    setTier('past_due');
    const { container } = await renderComponent();
    expect(container.firstChild).toBeNull();
  });

  it('case 3: renders 2 plan buttons when tier=free', async () => {
    setTier('free');
    await renderComponent();
    // Check both pricing buttons are present
    expect(screen.getByText(/\$12\.99\/mo/i)).toBeDefined();
    expect(screen.getByText(/\$132\.49\/yr/i)).toBeDefined();
  });

  it('case 4: clicking monthly button invokes session endpoint with { plan: plus_monthly } AND sets window.location.href', async () => {
    setTier('free');
    const checkoutUrl = 'https://checkout.stripe.com/session/monthly123';
    mockInvoke.mockResolvedValueOnce({ data: { url: checkoutUrl }, error: null });

    await renderComponent();
    const monthlyBtn = screen.getByText(/\$12\.99\/mo/i).closest('button');
    expect(monthlyBtn).toBeDefined();
    fireEvent.click(monthlyBtn!);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout/session', {
        body: { plan: 'plus_monthly' },
      });
      expect(window.location.href).toBe(checkoutUrl);
    });
  });

  it('case 5: clicking yearly button invokes session endpoint with { plan: plus_yearly } AND sets window.location.href', async () => {
    setTier('free');
    const checkoutUrl = 'https://checkout.stripe.com/session/yearly456';
    mockInvoke.mockResolvedValueOnce({ data: { url: checkoutUrl }, error: null });

    await renderComponent();
    const yearlyBtn = screen.getByText(/\$132\.49\/yr/i).closest('button');
    expect(yearlyBtn).toBeDefined();
    fireEvent.click(yearlyBtn!);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout/session', {
        body: { plan: 'plus_yearly' },
      });
      expect(window.location.href).toBe(checkoutUrl);
    });
  });

  it('case 6: renders without crashing when useReducedMotion toggles', async () => {
    setTier('free');
    mockUseReducedMotion.mockReturnValue(true);
    await renderComponent();
    expect(screen.getByText(/\$12\.99\/mo/i)).toBeDefined();
  });
});
