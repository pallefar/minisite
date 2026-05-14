/**
 * Phase 14 Plan 14-06 — PastDueBanner unit tests.
 *
 * 5 cases covering: null renders for non-past_due tiers, role="alert" render,
 * portal invoke + window.open on click, and reduced-motion fallback.
 *
 * vi.mock() calls are hoisted by vitest to module scope.
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

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// Mock framer-motion so AnimatePresence/motion.div render without JSDOM warnings
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div data-testid="motion-div" {...props}>
        {children}
      </div>
    ),
  },
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

// ─── Tests ────────────────────────────────────────────────────────────────────

// Lazy import to avoid issues with module resolution before mocks are set up
async function renderBanner() {
  const { PastDueBanner } = await import('./PastDueBanner');
  return render(<PastDueBanner />);
}

describe('PastDueBanner', () => {
  it('case 1: renders null when tier=free', async () => {
    setTier('free');
    mockUseReducedMotion.mockReturnValue(false);
    const { container } = await renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('case 2: renders null when tier=paid', async () => {
    setTier('paid');
    mockUseReducedMotion.mockReturnValue(false);
    const { container } = await renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('case 3: renders banner with role="alert" when tier=past_due', async () => {
    setTier('past_due');
    mockUseReducedMotion.mockReturnValue(false);
    await renderBanner();
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(screen.getByText(/Update card/i)).toBeDefined();
  });

  it('case 4: clicking Update card calls supabase.functions.invoke with stripe-checkout/portal AND calls window.open with returned url', async () => {
    setTier('past_due');
    mockUseReducedMotion.mockReturnValue(false);
    const portalUrl = 'https://billing.stripe.com/session/test123';
    mockInvoke.mockResolvedValueOnce({ data: { url: portalUrl }, error: null });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await renderBanner();
    const button = screen.getByRole('button', { name: /Update card/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout/portal', { body: {} });
      expect(openSpy).toHaveBeenCalledWith(portalUrl, '_blank', 'noopener,noreferrer');
    });
  });

  it('case 5: reduced-motion=true renders banner as static block (no motion-div wrapper)', async () => {
    setTier('past_due');
    mockUseReducedMotion.mockReturnValue(true);
    await renderBanner();
    // With reduced motion, AnimatePresence/motion.div should NOT be used
    // Banner should still be in DOM
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    // No motion-div when reduced motion is active
    expect(screen.queryByTestId('motion-div')).toBeNull();
  });
});
