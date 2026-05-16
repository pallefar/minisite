/**
 * Phase 22 Plan 22-05 — SoftDeleteCountdownBanner tests (DEL-01).
 *
 * Covers the 8 behaviors from 22-05-PLAN Task 3:
 *   1. Returns null when no pending_account_deletions row exists.
 *   2. Renders banner with role=alert + aria-live=polite when row exists.
 *   3. Text matches "Account scheduled for deletion in N days." (ceil of
 *      initiated_at + 7d - now() / 1day).
 *   4. Cancel CTA labeled "Cancel deletion".
 *   5. With a ?cancel_token=… query param, clicking Cancel invokes
 *      supabase.rpc('cancel_account_deletion', {p_token: ...}).
 *   6. On success, banner unmounts + toast "Deletion canceled. Welcome back!".
 *   7. Banner has the UI-SPEC layout classes (bg-danger-soft, text-danger,
 *      sticky top-0 z-[60], h-12).
 *   8. When impersonation is active (session.user.app_metadata.impersonator_id
 *      is set), banner is NOT mounted (priority per UI-SPEC line 317).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoftDeleteCountdownBanner } from '@/components/soft-delete/SoftDeleteCountdownBanner';

const SENTINEL_USER_ID = '11111111-1111-1111-1111-111111111111';

// Mutable fixture state so each test can adjust what supabase returns.
interface Fixture {
  session: {
    user: { id: string; app_metadata?: Record<string, unknown> } | null;
  } | null;
  pendingRow: { initiated_at: string } | null;
  rpcResponse: { data: unknown; error: { message: string } | null };
}

const fixture: Fixture = {
  session: null,
  pendingRow: null,
  rpcResponse: { data: null, error: null },
};

const mockToast = vi.fn();

vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: fixture.session },
        error: null,
      }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: fixture.pendingRow, error: null }),
        }),
      }),
    }),
    rpc: async (..._args: unknown[]) => fixture.rpcResponse,
  },
}));

beforeEach(() => {
  fixture.session = {
    user: { id: SENTINEL_USER_ID, app_metadata: {} },
  };
  fixture.pendingRow = null;
  fixture.rpcResponse = { data: null, error: null };
  mockToast.mockReset();
  // Reset URL query — each test sets its own if needed.
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('SoftDeleteCountdownBanner (Phase 22 Plan 22-05 DEL-01)', () => {
  // B1
  it('returns null when no pending_account_deletions row exists', async () => {
    fixture.pendingRow = null;
    const { container } = render(<SoftDeleteCountdownBanner />);
    // Wait for the effect to settle — initially null, stays null.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="soft-delete-countdown-banner"]')).toBeNull();
    });
  });

  // B2 — renders with role=alert + aria-live=polite
  it('renders banner with role="alert" and aria-live="polite" when row exists', async () => {
    fixture.pendingRow = { initiated_at: new Date().toISOString() };
    render(<SoftDeleteCountdownBanner />);
    const banner = await screen.findByTestId('soft-delete-countdown-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  // B3 — text matches "Account scheduled for deletion in N days."
  it('shows ceil((initiated_at + 7d - now()) / 1day) in days remaining', async () => {
    // initiated 2 days ago → 5 days remaining (7 - 2).
    const initiated = new Date(Date.now() - 2 * 86_400_000);
    fixture.pendingRow = { initiated_at: initiated.toISOString() };
    render(<SoftDeleteCountdownBanner />);
    expect(
      await screen.findByText('Account scheduled for deletion in 5 days.'),
    ).toBeTruthy();
  });

  // B4 — Cancel CTA labeled "Cancel deletion"
  it('renders the Cancel deletion CTA', async () => {
    fixture.pendingRow = { initiated_at: new Date().toISOString() };
    render(<SoftDeleteCountdownBanner />);
    expect(await screen.findByRole('button', { name: /Cancel deletion/ })).toBeTruthy();
  });

  // B5 — with ?cancel_token=… in URL, click invokes rpc
  it('with ?cancel_token=… in URL, clicking Cancel invokes cancel_account_deletion RPC', async () => {
    window.history.replaceState({}, '', '/?cancel_token=abc.123.def');
    fixture.pendingRow = { initiated_at: new Date().toISOString() };
    const rpcSpy = vi.fn(async (..._args: unknown[]) => ({ data: null, error: null }));
    // Re-mock supabase.rpc to spy this test only.
    const supabaseModule = await import('@/lib/supabase');
    (supabaseModule.supabase as unknown as { rpc: typeof rpcSpy }).rpc = rpcSpy;
    render(<SoftDeleteCountdownBanner />);
    const btn = await screen.findByRole('button', { name: /Cancel deletion/ });
    const user = userEvent.setup();
    await user.click(btn);
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('cancel_account_deletion', {
        p_token: 'abc.123.def',
      });
    });
  });

  // B6 — on success banner unmounts + toast fires
  it('on RPC success unmounts banner and fires success toast', async () => {
    window.history.replaceState({}, '', '/?cancel_token=abc.123.def');
    fixture.pendingRow = { initiated_at: new Date().toISOString() };
    fixture.rpcResponse = { data: null, error: null };
    render(<SoftDeleteCountdownBanner />);
    const btn = await screen.findByRole('button', { name: /Cancel deletion/ });
    const user = userEvent.setup();
    await user.click(btn);
    await waitFor(() => {
      expect(screen.queryByTestId('soft-delete-countdown-banner')).toBeNull();
    });
    expect(mockToast).toHaveBeenCalledWith('Deletion canceled. Welcome back!', 'success');
  });

  // B7 — UI-SPEC layout classes
  it('has the UI-SPEC layout classes (sticky top-0 z-[60] h-12, danger color tokens)', async () => {
    fixture.pendingRow = { initiated_at: new Date().toISOString() };
    render(<SoftDeleteCountdownBanner />);
    const banner = await screen.findByTestId('soft-delete-countdown-banner');
    const cls = banner.className;
    expect(cls).toMatch(/sticky/);
    expect(cls).toMatch(/top-0/);
    expect(cls).toMatch(/z-\[60\]/);
    expect(cls).toMatch(/h-12/);
    expect(cls).toMatch(/bg-\[var\(--color-danger-soft\)\]/);
    expect(cls).toMatch(/text-\[var\(--color-danger\)\]/);
  });

  // B8 — impersonation wins (priority per UI-SPEC line 317)
  it('when impersonating (session.user.app_metadata.impersonator_id set), banner is NOT mounted', async () => {
    fixture.session = {
      user: {
        id: SENTINEL_USER_ID,
        app_metadata: { impersonator_id: 'admin-uid' },
      },
    };
    fixture.pendingRow = { initiated_at: new Date().toISOString() };
    const { container } = render(<SoftDeleteCountdownBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="soft-delete-countdown-banner"]')).toBeNull();
    });
  });
});
