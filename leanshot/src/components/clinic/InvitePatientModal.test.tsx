/**
 * Phase 9 Plan 09-02 — InvitePatientModal RTL coverage.
 *
 * D-02 anti-enumeration invariant + W-1 invite_id-server-side shape are
 * the load-bearing assertions. The other 7 tests cover the State
 * Coverage Checklist rows from UI-SPEC 705-754.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_TYPE_KEYS, DATA_TYPE_LABELS } from '@/types/clinic';
import { InvitePatientModal } from './InvitePatientModal';

const mockSendInvite = vi.fn();
const mockToastFn = vi.fn();

vi.mock('@/lib/clinic', () => ({
  sendInvite: (...args: unknown[]) => mockSendInvite(...args),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToastFn,
}));

beforeEach(() => {
  mockSendInvite.mockReset();
  mockToastFn.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('InvitePatientModal — compose state', () => {
  it('focuses the email input on open and all 10 scope checkboxes start checked', async () => {
    render(<InvitePatientModal open orgId="org-1" onClose={() => {}} />);
    const emailInput = await screen.findByLabelText(/Patient email/i);
    expect(document.activeElement).toBe(emailInput);

    // 10 checkboxes from DATA_TYPE_KEYS, all checked
    expect(DATA_TYPE_KEYS.length).toBe(10);
    for (const k of DATA_TYPE_KEYS) {
      const cb = screen.getByLabelText(
        new RegExp(DATA_TYPE_LABELS[k].label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ) as HTMLInputElement;
      expect(cb.checked).toBe(true);
    }
  });

  it('Send invitation is disabled until a valid email is typed', async () => {
    render(<InvitePatientModal open orgId="org-1" onClose={() => {}} />);
    const submitBtn = screen.getByRole('button', { name: /send invitation/i });
    expect(submitBtn).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Patient email/i), 'invalid');
    expect(submitBtn).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/Patient email/i));
    await userEvent.type(screen.getByLabelText(/Patient email/i), 'karsten@example.com');
    expect(submitBtn).toBeEnabled();
  });

  it('toggles a scope checkbox off when clicked', async () => {
    render(<InvitePatientModal open orgId="org-1" onClose={() => {}} />);
    const photos = screen.getByLabelText(/Body photos/i) as HTMLInputElement;
    expect(photos.checked).toBe(true);
    await userEvent.click(photos);
    expect(photos.checked).toBe(false);
  });
});

describe('InvitePatientModal — D-02 anti-enumeration + W-1 invite_id shape', () => {
  it('after successful sendInvite, shows universal "Invitation sent" copy regardless of email existence', async () => {
    const onInviteSent = vi.fn();
    mockSendInvite.mockResolvedValueOnce({
      ok: true,
      data: { invite_id: 'inv-uuid-123' },
    });

    render(
      <InvitePatientModal
        open
        orgId="org-1"
        onClose={() => {}}
        onInviteSent={onInviteSent}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Patient email/i), 'karsten@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }));

    // Universal post-send copy (D-02 invariant — must not branch on email existence)
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument();
    expect(
      screen.getByText(/We sent an invitation to karsten@example\.com/i),
    ).toBeInTheDocument();
    // W-1: invite_id is captured by parent regardless
    expect(onInviteSent).toHaveBeenCalledWith('inv-uuid-123');
    // Sanity: sendInvite was called with lowercased + trimmed email
    expect(mockSendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'karsten@example.com', org_id: 'org-1' }),
    );
  });

  it('on network error, keeps form state and toasts; modal stays open', async () => {
    mockSendInvite.mockResolvedValueOnce({ ok: false, error: 'network' });
    render(<InvitePatientModal open orgId="org-1" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Patient email/i), 'karsten@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() => {
      expect(mockToastFn).toHaveBeenCalledWith(
        "Couldn't send invitation. Check your connection and try again.",
        'error',
      );
    });
    // Compose state preserved — email still in input
    expect((screen.getByLabelText(/Patient email/i) as HTMLInputElement).value).toBe(
      'karsten@example.com',
    );
    // Post-send heading should NOT appear
    expect(screen.queryByText('Invitation sent')).not.toBeInTheDocument();
  });

  it('"Invite another patient" returns from post-send back to compose state', async () => {
    mockSendInvite.mockResolvedValueOnce({
      ok: true,
      data: { invite_id: 'inv-1' },
    });
    render(<InvitePatientModal open orgId="org-1" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Patient email/i), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }));
    await screen.findByText('Invitation sent');
    await userEvent.click(screen.getByRole('button', { name: /invite another patient/i }));
    // Compose state again — email input cleared
    expect((screen.getByLabelText(/Patient email/i) as HTMLInputElement).value).toBe('');
  });
});
