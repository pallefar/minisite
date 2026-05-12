/**
 * Phase 7 Plan 07-07 — DeleteAccountModal component tests.
 *
 * RTL-level coverage for the typed-confirm gate, error mapping, and the
 * success path. Mocks @/lib/account-delete so the modal can be exercised
 * without hitting Supabase, and mocks @/lib/store so the email-from-store
 * read returns a fixed sentinel.
 *
 * Was RED at land-time per the TDD invariant — the DeleteAccountModal
 * component is created by Task 3, which closes the file with these
 * assertions in place.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteAccountModal } from '@/components/dashboard/settings/DeleteAccountModal';
import { AccountDeleteError } from '@/lib/account-delete';
import type * as AccountDeleteModule from '@/lib/account-delete';
import { useStore } from '@/lib/store';

const mockInitiate = vi.fn();
const mockToast = vi.fn();

vi.mock('@/lib/account-delete', async () => {
  const actual = await vi.importActual<typeof AccountDeleteModule>('@/lib/account-delete');
  return {
    ...actual,
    initiateAccountDeletion: (...args: unknown[]) => mockInitiate(...args),
  };
});

vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

// The modal reads signedIn.user.email from the store. Inject via setState
// rather than mocking the entire module so reactive subscriptions still work.
const SENTINEL_EMAIL = 'user@example.com';

beforeEach(() => {
  mockInitiate.mockReset();
  mockToast.mockReset();
  useStore.setState({
    signedIn: {
      // Test sentinel — a partial SupabaseUser shape is enough for the modal,
      // which only reads `signedIn.user.email`. Cast through unknown so the
      // intent (we're feeding a deliberately-partial fixture) is explicit.
      user: { email: SENTINEL_EMAIL } as unknown as NonNullable<
        ReturnType<typeof useStore.getState>['signedIn']
      >['user'],
      verified: true,
    },
  });
});

afterEach(() => {
  useStore.setState({ signedIn: null });
});

describe('DeleteAccountModal', () => {
  it('renders the title and 3-paragraph body copy', () => {
    render(<DeleteAccountModal open onClose={() => {}} />);
    expect(screen.getByText(/Delete my account/i)).toBeTruthy();
    expect(screen.getByText(/30-day soft-delete/i)).toBeTruthy();
    expect(screen.getByText(/locked location/i)).toBeTruthy();
    expect(screen.getByText(/Same-email re-signup/i)).toBeTruthy();
  });

  it('starts with the destructive button disabled', () => {
    render(<DeleteAccountModal open onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps button disabled when typed value does not match email', async () => {
    const user = userEvent.setup();
    render(<DeleteAccountModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Type your email to confirm/i);
    await user.type(input, 'wrong@x.com');
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the button on exact typed email match', async () => {
    const user = userEvent.setup();
    render(<DeleteAccountModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Type your email to confirm/i);
    await user.type(input, SENTINEL_EMAIL);
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('enables the button on case-insensitive + whitespace-trimmed match', async () => {
    const user = userEvent.setup();
    render(<DeleteAccountModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Type your email to confirm/i);
    await user.type(input, '  USER@example.com  ');
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls initiateAccountDeletion on confirm + fires success toast + closes modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInitiate.mockResolvedValueOnce(undefined);
    render(<DeleteAccountModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Type your email to confirm/i);
    await user.type(input, SENTINEL_EMAIL);
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    await user.click(btn);
    expect(mockInitiate).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringMatching(/scheduled for deletion in 30 days/i),
      'success',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('on recent_auth_required keeps the modal open and shows inline error', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInitiate.mockRejectedValueOnce(new AccountDeleteError('recent_auth_required'));
    render(<DeleteAccountModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Type your email to confirm/i);
    await user.type(input, SENTINEL_EMAIL);
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    await user.click(btn);
    // Inline error visible; modal stays open (onClose not called).
    expect(
      await screen.findByText(/sign out and sign back in within the last 5 minutes/i),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on already_pending fires a toast and closes the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInitiate.mockRejectedValueOnce(new AccountDeleteError('already_pending'));
    render(<DeleteAccountModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Type your email to confirm/i);
    await user.type(input, SENTINEL_EMAIL);
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    await user.click(btn);
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringMatching(/already scheduled for deletion/i),
      expect.any(String),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('on unknown error fires a generic toast', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInitiate.mockRejectedValueOnce(new AccountDeleteError('unknown'));
    render(<DeleteAccountModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Type your email to confirm/i);
    await user.type(input, SENTINEL_EMAIL);
    const btn = screen.getByRole('button', { name: /Schedule deletion in 30 days/i });
    await user.click(btn);
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringMatching(/Could not start account deletion/i),
      'error',
    );
    expect(onClose).toHaveBeenCalled();
  });
});
