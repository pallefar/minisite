/**
 * Phase 14 Plan 14-05 — TierGate.tsx unit tests.
 *
 * 8 cases: 3 modes × 2 tier states + reduced-motion fallback + past_due passthrough.
 * Mocks: useStore (returns tier), useReducedMotion (returns boolean).
 *
 * Import order: external first, then @/ aliases (import-x/order convention).
 * vi.mock() calls are hoisted by vitest to module scope regardless of their
 * textual position — the imported bindings below refer to the mocked versions.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStore } from '@/lib/store';
import { TierGate } from './TierGate';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the store so tests control tier without a real Zustand store.
vi.mock('@/lib/store', () => ({
  useStore: vi.fn(),
}));

// Mock useReducedMotion so tests control the reduced-motion flag.
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: vi.fn(),
}));

// Mock PaywallUpsell to avoid rendering the full card/button in TierGate tests.
vi.mock('./PaywallUpsell', () => ({
  PaywallUpsell: ({ variant, feature }: { variant: string; feature: string }) => (
    <div data-testid="paywall-upsell" data-variant={variant} data-feature={feature} />
  ),
}));

const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
const mockUseReducedMotion = useReducedMotion as unknown as ReturnType<typeof vi.fn>;

function setTier(tier: 'free' | 'paid' | 'past_due') {
  mockUseStore.mockReturnValue(tier);
}
function setReducedMotion(reduced: boolean) {
  mockUseReducedMotion.mockReturnValue(reduced);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TierGate — paid user sees all content', () => {
  it('case 1: tier=paid + mode=blur-upsell → children rendered, no overlay', () => {
    setTier('paid');
    setReducedMotion(false);
    render(
      <TierGate tier="paid" mode="blur-upsell" feature="pharma-forecast">
        <span data-testid="child">forecast</span>
      </TierGate>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.queryByTestId('paywall-upsell')).toBeNull();
  });

  it('case 2: tier=paid + mode=hard-block-no-ui → children rendered', () => {
    setTier('paid');
    setReducedMotion(false);
    render(
      <TierGate tier="paid" mode="hard-block-no-ui" feature="pharma-forecast">
        <span data-testid="child">content</span>
      </TierGate>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.queryByTestId('paywall-upsell')).toBeNull();
  });

  it('case 3: tier=paid + mode=hard-block-cta → children rendered', () => {
    setTier('paid');
    setReducedMotion(false);
    render(
      <TierGate tier="paid" mode="hard-block-cta" feature="advanced-ai">
        <span data-testid="child">selector</span>
      </TierGate>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.queryByTestId('paywall-upsell')).toBeNull();
  });
});

describe('TierGate — free user blocked', () => {
  it('case 4: tier=free + mode=blur-upsell + no-reduced-motion → blur wrapper + overlay', () => {
    setTier('free');
    setReducedMotion(false);
    const { container } = render(
      <TierGate tier="paid" mode="blur-upsell" feature="pharma-forecast">
        <span data-testid="child">forecast</span>
      </TierGate>,
    );
    // Child is wrapped in aria-hidden blur wrapper
    const ariaHiddenWrapper = container.querySelector('[aria-hidden="true"]');
    expect(ariaHiddenWrapper).not.toBeNull();
    // Blur class present
    expect(ariaHiddenWrapper?.className).toContain('blur-[10px]');
    // Upsell overlay rendered
    expect(screen.getByTestId('paywall-upsell')).toBeDefined();
    expect(screen.getByTestId('paywall-upsell').dataset.variant).toBe('overlay');
  });

  it('case 5: tier=free + mode=blur-upsell + reduced-motion=true → opacity-60, NO blur-[10px]', () => {
    setTier('free');
    setReducedMotion(true);
    const { container } = render(
      <TierGate tier="paid" mode="blur-upsell" feature="pharma-forecast">
        <span data-testid="child">forecast</span>
      </TierGate>,
    );
    const ariaHiddenWrapper = container.querySelector('[aria-hidden="true"]');
    expect(ariaHiddenWrapper).not.toBeNull();
    expect(ariaHiddenWrapper?.className).toContain('opacity-60');
    expect(ariaHiddenWrapper?.className).not.toContain('blur-[10px]');
  });

  it('case 6: tier=free + mode=hard-block-no-ui → renders null (nothing mounted)', () => {
    setTier('free');
    setReducedMotion(false);
    const { container } = render(
      <TierGate tier="paid" mode="hard-block-no-ui" feature="pharma-forecast">
        <span data-testid="child">content</span>
      </TierGate>,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('child')).toBeNull();
    expect(screen.queryByTestId('paywall-upsell')).toBeNull();
  });

  it('case 7: tier=free + mode=hard-block-cta → PaywallUpsell variant=cta, children NOT rendered', () => {
    setTier('free');
    setReducedMotion(false);
    render(
      <TierGate tier="paid" mode="hard-block-cta" feature="advanced-ai">
        <span data-testid="child">selector</span>
      </TierGate>,
    );
    expect(screen.queryByTestId('child')).toBeNull();
    const upsell = screen.getByTestId('paywall-upsell');
    expect(upsell).toBeDefined();
    expect(upsell.dataset.variant).toBe('cta');
    expect(upsell.dataset.feature).toBe('advanced-ai');
  });
});

describe('TierGate — past_due passthrough (no double-gate)', () => {
  it('case 8: tier=past_due + mode=blur-upsell → children rendered (Plan 14-06 handles dunning)', () => {
    setTier('past_due');
    setReducedMotion(false);
    render(
      <TierGate tier="paid" mode="blur-upsell" feature="pharma-forecast">
        <span data-testid="child">forecast</span>
      </TierGate>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.queryByTestId('paywall-upsell')).toBeNull();
  });
});
