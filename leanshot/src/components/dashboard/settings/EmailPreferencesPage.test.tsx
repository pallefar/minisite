/**
 * Phase 22 plan 22-11 — EmailPreferencesPage tests (ON-03).
 *
 * 6 behaviors from 22-11-PLAN.md task 3:
 *   1. Renders 6 categories per UI-SPEC (Transactional locked + 5 toggleable, affiliate-gated).
 *   2. Transactional toggle is disabled with title tooltip.
 *   3. Affiliate row hidden when user is NOT an affiliate; visible when user IS an affiliate.
 *   4. Save invokes supabase.functions.invoke('lifecycle-preference-update', body={categories: ...}).
 *   5. Save success → 'Preferences saved' toast.
 *   6. Save error → "Couldn't save. Try again." toast.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock supabase (network) ──────────────────────────────────────────────────

const mockConsentBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};
const mockAffiliatesBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};
const mockFrom = vi.fn((table: string) => {
  if (table === 'affiliates') return mockAffiliatesBuilder;
  return mockConsentBuilder;
});

const mockInvoke = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

// ─── Mock Zustand store ───────────────────────────────────────────────────────

const mockUserId = '00000000-0000-0000-0000-0000000000aa';
const mockSignedIn = {
  user: { id: mockUserId, email: 'patient@example.com', is_anonymous: false },
  verified: true,
};
vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: { signedIn: typeof mockSignedIn }) => unknown) =>
    selector({ signedIn: mockSignedIn }),
}));

// ─── Toast capture ────────────────────────────────────────────────────────────

const toastSpy = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => toastSpy,
}));

// ─── Imports under test (after mocks are wired) ───────────────────────────────

import { EmailPreferencesPage } from '@/components/dashboard/settings/EmailPreferencesPage';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no consent_records row, not an affiliate.
  mockConsentBuilder.select.mockReturnThis();
  mockConsentBuilder.eq.mockReturnThis();
  mockConsentBuilder.order.mockReturnThis();
  mockConsentBuilder.limit.mockResolvedValue({ data: [], error: null });
  mockAffiliatesBuilder.select.mockReturnThis();
  mockAffiliatesBuilder.eq.mockReturnThis();
  mockAffiliatesBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmailPreferencesPage (Phase 22 ON-03)', () => {
  it('Test 1: renders 5 categories (Transactional locked + 4 toggleable; affiliate hidden by default)', async () => {
    render(<EmailPreferencesPage />);
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('affiliates'));
    expect(screen.getByTestId('email-pref-row-transactional')).toBeTruthy();
    expect(screen.getByTestId('email-pref-row-welcome')).toBeTruthy();
    expect(screen.getByTestId('email-pref-row-behavior_triggered')).toBeTruthy();
    expect(screen.getByTestId('email-pref-row-retention')).toBeTruthy();
    expect(screen.getByTestId('email-pref-row-weekly_digest')).toBeTruthy();
    expect(screen.queryByTestId('email-pref-row-affiliate')).toBeNull();
  });

  it('Test 2: Transactional toggle is disabled with title tooltip', async () => {
    render(<EmailPreferencesPage />);
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('affiliates'));
    const row = screen.getByTestId('email-pref-row-transactional');
    const onPill = row.querySelector('button[disabled]');
    expect(onPill).toBeTruthy();
    expect(onPill?.getAttribute('title')).toMatch(/Required — these relate to your account/);
  });

  it('Test 3: Affiliate row renders only when user IS an affiliate', async () => {
    mockAffiliatesBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: 'aff-id' },
      error: null,
    });
    render(<EmailPreferencesPage />);
    await waitFor(() => expect(screen.queryByTestId('email-pref-row-affiliate')).toBeTruthy());
  });

  it('Test 4-5: Save invokes lifecycle-preference-update with categories body + success toast', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    render(<EmailPreferencesPage />);
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('affiliates'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls[0];
    expect(call?.[0]).toBe('lifecycle-preference-update');
    const body = (call?.[1] as { body: { categories: Record<string, boolean> } }).body;
    expect(body.categories).toBeDefined();
    expect(body.categories).toHaveProperty('welcome');
    expect(body.categories).toHaveProperty('behavior_triggered');
    expect(body.categories).toHaveProperty('retention');
    expect(body.categories).toHaveProperty('weekly_digest');
    expect(body.categories).toHaveProperty('affiliate');
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('Preferences saved', 'success'),
    );
  });

  it('Test 6: Save error → "Couldn\'t save. Try again." toast', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'persist_failed' } });
    render(<EmailPreferencesPage />);
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('affiliates'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith("Couldn't save. Try again.", 'error'),
    );
  });

  it('Test 7: seeds toggle state from consent_records.email_preferences when present', async () => {
    // weekly_digest=true override (non-default) — Off pill should be inactive after load.
    mockConsentBuilder.limit.mockResolvedValueOnce({
      data: [{ email_preferences: { weekly_digest: true, welcome: false } }],
      error: null,
    });
    render(<EmailPreferencesPage />);
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('consent_records'));
    const weeklyRow = screen.getByTestId('email-pref-row-weekly_digest');
    const onPill = weeklyRow.querySelector(
      'button[aria-label="Weekly digest on"]',
    ) as HTMLButtonElement | null;
    expect(onPill?.getAttribute('aria-pressed')).toBe('true');
  });
});
