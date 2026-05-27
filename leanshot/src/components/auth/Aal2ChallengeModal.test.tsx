/**
 * Phase 66 Plan 66-04 — <Aal2ChallengeModal> unit tests.
 *
 * Covers the four behaviours the planner locked in Task 1:
 *   T1 — Renders with the correct purpose-specific subtitle (3 cases)
 *   T2 — Submitting a 6-digit code calls onSubmit with that code
 *   T3 — Cancel button calls onCancel (and does NOT call onSubmit)
 *   T4 — Invalid code → modal shows error + clears input + stays open
 *
 * Tests run under the `src-ui-unit` vitest project (jsdom + React
 * plugin + test-setup.ts). No mocks needed beyond Vitest spies — the
 * modal is a pure component over its props; no Supabase/network calls.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Aal2ChallengeModal } from './Aal2ChallengeModal';

afterEach(() => {
  vi.restoreAllMocks();
  // Modal sets body.overflow='hidden' on open; reset between tests so
  // the next render doesn't inherit a locked body.
  document.body.style.overflow = '';
});

describe('Aal2ChallengeModal — subtitle per purpose', () => {
  const cases: Array<{
    purpose: 'delete-account' | 'export-all-data' | 'change-email';
    expect: string;
  }> = [
    { purpose: 'delete-account', expect: 'to delete your account' },
    { purpose: 'export-all-data', expect: 'to export your data' },
    { purpose: 'change-email', expect: 'to change your email' },
  ];

  for (const c of cases) {
    it(`renders subtitle for purpose=${c.purpose}`, () => {
      render(
        <Aal2ChallengeModal
          open
          purpose={c.purpose}
          onSubmit={vi.fn().mockResolvedValue({ ok: true })}
          onCancel={vi.fn()}
        />,
      );

      // Title is always the same; subtitle varies per purpose.
      expect(screen.getByText(/confirm your identity/i)).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(c.expect, 'i')),
      ).toBeInTheDocument();
    });
  }
});

describe('Aal2ChallengeModal — submit + cancel flow', () => {
  it('submitting a 6-digit code calls onSubmit with that code', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <Aal2ChallengeModal
        open
        purpose="delete-account"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByLabelText(
      /6-digit authenticator code/i,
    ) as HTMLInputElement;
    await user.type(input, '123456');
    expect(input.value).toBe('123456');

    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).not.toBeDisabled();
    await user.click(confirm);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('123456');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Cancel button calls onCancel (and does not call onSubmit)', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <Aal2ChallengeModal
        open
        purpose="export-all-data"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Confirm button is disabled until 6 digits are entered', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    render(
      <Aal2ChallengeModal
        open
        purpose="change-email"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText(
      /6-digit authenticator code/i,
    ) as HTMLInputElement;
    await user.type(input, '12345');
    expect(confirm).toBeDisabled();

    await user.type(input, '6');
    expect(confirm).not.toBeDisabled();
  });

  it('non-digit characters are stripped from input (paste-friendly)', async () => {
    const user = userEvent.setup();

    render(
      <Aal2ChallengeModal
        open
        purpose="delete-account"
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(
      /6-digit authenticator code/i,
    ) as HTMLInputElement;
    await user.type(input, 'a1b2-c3 4');
    // Only digits remain.
    expect(input.value).toBe('1234');
  });
});

describe('Aal2ChallengeModal — error states', () => {
  it('invalid code → shows error, clears input, stays open', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'invalid_code' });
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <Aal2ChallengeModal
        open
        purpose="delete-account"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByLabelText(
      /6-digit authenticator code/i,
    ) as HTMLInputElement;
    await user.type(input, '000000');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    // onSubmit was called.
    expect(onSubmit).toHaveBeenCalledWith('000000');

    // Error is visible.
    expect(
      await screen.findByText(/didn’t match|did not match/i),
    ).toBeInTheDocument();

    // Input was cleared so the user can re-enter without backspacing.
    expect(input.value).toBe('');

    // Modal stayed open (parent controls `open`; we don't call onCancel).
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('session_stale reason surfaces a sign-in error message', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'session_stale' });
    const user = userEvent.setup();

    render(
      <Aal2ChallengeModal
        open
        purpose="change-email"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.type(
      screen.getByLabelText(/6-digit authenticator code/i),
      '111111',
    );
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(
      await screen.findByText(/session expired|sign in again/i),
    ).toBeInTheDocument();
  });
});
