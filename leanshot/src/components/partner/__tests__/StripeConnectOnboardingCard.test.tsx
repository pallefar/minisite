/**
 * Phase 19 Plan 19-06b — StripeConnectOnboardingCard vitest tests.
 *
 * 5 assertions covering the 4-state machine + CTA wiring:
 *   T1: state='active' → renders nothing
 *   T2: state='pending' → heading + CTA "Start onboarding"
 *   T3: state='needs_info' + requirements → body lists first 3 + "+0 more"
 *   T4: state='restricted' + disabled_reason → body contains the reason + "Contact support"
 *   T5: CTA click → fetch POST /stripe-connect-onboard + url opened in new tab
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeConnectOnboardingCard } from '@/components/partner/StripeConnectOnboardingCard';

// Mock supabase auth session — every CTA fetch needs a JWT.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'fake-jwt' } },
        error: null,
      }),
    },
  },
}));

const originalFetch = globalThis.fetch;
const originalOpen = window.open;
let fetchMock: ReturnType<typeof vi.fn>;
let openMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ url: 'https://stripe.com/connect/onboarding/abc123' }),
  } as Response);
  // @ts-expect-error — test fetch mock
  globalThis.fetch = fetchMock;
  openMock = vi.fn();
  // @ts-expect-error — test window.open mock
  window.open = openMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.open = originalOpen;
});

describe('StripeConnectOnboardingCard', () => {
  // ── T1 ──
  it("T1 — state='active' → renders nothing", () => {
    const { container } = render(
      <StripeConnectOnboardingCard state="active" requirements={[]} disabledReason={null} />,
    );
    expect(container.textContent).toBe('');
  });

  // ── T2 ──
  it("T2 — state='pending' → heading + 'Start onboarding' CTA", () => {
    render(
      <StripeConnectOnboardingCard state="pending" requirements={[]} disabledReason={null} />,
    );
    expect(screen.getByText(/Complete tax onboarding to receive payouts/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start onboarding/i })).toBeTruthy();
  });

  // ── T3 ──
  it("T3 — state='needs_info' + 3 requirements → body lists them + '+0 more'", () => {
    render(
      <StripeConnectOnboardingCard
        state="needs_info"
        requirements={['legal_entity', 'tax_id', 'bank']}
        disabledReason={null}
      />,
    );
    expect(screen.getByText(/Stripe needs more info/)).toBeTruthy();
    // Body should mention the first 3 entries and end with "+0 more"
    expect(screen.getByText(/legal_entity, tax_id, bank/)).toBeTruthy();
    expect(screen.getByText(/\+0 more/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue onboarding/i })).toBeTruthy();
  });

  // ── T4 ──
  it("T4 — state='restricted' + disabled_reason → body has reason + 'Contact support' CTA", () => {
    render(
      <StripeConnectOnboardingCard
        state="restricted"
        requirements={[]}
        disabledReason="requirements.past_due"
      />,
    );
    expect(screen.getByText(/Your payout account is on hold/)).toBeTruthy();
    expect(screen.getByText(/requirements\.past_due/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Contact support/i })).toBeTruthy();
  });

  // ── T5 ──
  it('T5 — CTA click → POST /stripe-connect-onboard + url opened in new tab', async () => {
    render(
      <StripeConnectOnboardingCard state="pending" requirements={[]} disabledReason={null} />,
    );
    const btn = screen.getByRole('button', { name: /Start onboarding/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url.endsWith('/functions/v1/stripe-connect-onboard')).toBe(true);
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fake-jwt');

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1);
    });
    expect(openMock).toHaveBeenCalledWith(
      'https://stripe.com/connect/onboarding/abc123',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
