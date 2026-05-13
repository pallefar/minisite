/**
 * Phase 9 Plan 09-04 — InviteSignupForm RTL coverage.
 *
 * Covers:
 *   - email pre-filled + readOnly
 *   - password < 8 chars → inline error
 *   - submit → supabase.auth.signUp
 *   - "already registered" → onAlreadyRegistered() (Pitfall #1 → State C)
 *   - confirmation-pending state copy
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { InviteSignupForm } from './InviteSignupForm';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      resend: vi.fn(),
    },
  },
}));

const mockedSignUp = vi.mocked(supabase.auth.signUp);

describe('InviteSignupForm — Plan 09-04', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email as readOnly + heading copy', () => {
    render(
      <InviteSignupForm
        email="alice@example.com"
        orgName="Acme Clinic"
        onAlreadyRegistered={() => {}}
      />,
    );
    expect(
      screen.getByRole('heading', { name: /Create your LeanShot account/i }),
    ).toBeInTheDocument();
    const emailInput = screen.getByDisplayValue('alice@example.com') as HTMLInputElement;
    expect(emailInput.readOnly).toBe(true);
  });

  it('password < 8 chars renders inline validation error', async () => {
    const user = userEvent.setup();
    render(
      <InviteSignupForm
        email="alice@example.com"
        orgName="Acme Clinic"
        onAlreadyRegistered={() => {}}
      />,
    );
    const password = screen.getByLabelText(/Password/i);
    await user.type(password, 'short');
    await user.click(screen.getByRole('button', { name: /Create account and continue/i }));
    await waitFor(() =>
      expect(screen.getByText(/At least 8 characters\./)).toBeInTheDocument(),
    );
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('valid submit calls supabase.auth.signUp + renders confirmation-pending state', async () => {
    mockedSignUp.mockResolvedValue({
      data: { user: { identities: [{ id: 'ident-1' }] } as never, session: null },
      error: null,
    } as never);
    const user = userEvent.setup();
    render(
      <InviteSignupForm
        email="alice@example.com"
        orgName="Acme Clinic"
        onAlreadyRegistered={() => {}}
      />,
    );
    await user.type(screen.getByLabelText(/Password/i), 'longenough');
    await user.click(screen.getByRole('button', { name: /Create account and continue/i }));
    await waitFor(() => expect(mockedSignUp).toHaveBeenCalledTimes(1));
    expect(mockedSignUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.com', password: 'longenough' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Check your email at alice@example\.com/i }),
      ).toBeInTheDocument(),
    );
  });

  it('"already registered" error fires onAlreadyRegistered (Pitfall #1)', async () => {
    mockedSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    } as never);
    const onAlreadyRegistered = vi.fn();
    const user = userEvent.setup();
    render(
      <InviteSignupForm
        email="alice@example.com"
        orgName="Acme Clinic"
        onAlreadyRegistered={onAlreadyRegistered}
      />,
    );
    await user.type(screen.getByLabelText(/Password/i), 'longenough');
    await user.click(screen.getByRole('button', { name: /Create account and continue/i }));
    await waitFor(() => expect(onAlreadyRegistered).toHaveBeenCalledTimes(1));
  });

  it('empty identities array on success also fires onAlreadyRegistered (Supabase signal)', async () => {
    mockedSignUp.mockResolvedValue({
      data: { user: { identities: [] } as never, session: null },
      error: null,
    } as never);
    const onAlreadyRegistered = vi.fn();
    const user = userEvent.setup();
    render(
      <InviteSignupForm
        email="alice@example.com"
        orgName="Acme Clinic"
        onAlreadyRegistered={onAlreadyRegistered}
      />,
    );
    await user.type(screen.getByLabelText(/Password/i), 'longenough');
    await user.click(screen.getByRole('button', { name: /Create account and continue/i }));
    await waitFor(() => expect(onAlreadyRegistered).toHaveBeenCalledTimes(1));
  });
});
