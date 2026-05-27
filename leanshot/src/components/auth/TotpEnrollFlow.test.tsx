/**
 * Phase 66 Plan 66-03 — TotpEnrollFlow shared component tests.
 *
 * Covers per-mode copy divergence, stage transitions (idle → enrolling →
 * awaiting-code → showing-codes → done), download CTA, and the "I've saved
 * these" confirmation gate before onSuccess fires.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted spies so vi.mock factories can grab them safely.
const mocks = vi.hoisted(() => ({
  enrollTotp: vi.fn(),
  verifyTotpChallenge: vi.fn(),
  listFactors: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/totp-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/totp-shared')>(
    '@/lib/auth/totp-shared',
  );
  return {
    ...actual,
    enrollTotp: mocks.enrollTotp,
    verifyTotpChallenge: mocks.verifyTotpChallenge,
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      mfa: {
        listFactors: (...args: unknown[]) => mocks.listFactors(...args),
      },
    },
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));

import TotpEnrollFlow from './TotpEnrollFlow';

const FAKE_QR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const FAKE_FACTOR_ID = 'factor-uuid-abc';
const FAKE_CODES = [
  'ABCD-EFGH-JKMN', 'PQRS-TUVW-XYZ2', 'KMNP-QRST-UVWX', 'BCDE-FGHJ-KMNP',
  'QRST-UVWX-YZ23', 'CDEF-GHJK-MNPQ', 'RSTU-VWXY-Z234', 'DEFG-HJKM-NPQR',
  'STUV-WXYZ-2345', 'EFGH-JKMN-PQRS',
];

function mockEnrollSuccess() {
  mocks.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  mocks.enrollTotp.mockResolvedValue({
    data: { id: FAKE_FACTOR_ID, totp: { qr_code: FAKE_QR } },
    error: null,
  });
}

beforeEach(() => {
  mocks.enrollTotp.mockReset();
  mocks.verifyTotpChallenge.mockReset();
  mocks.listFactors.mockReset();
  mocks.rpc.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<TotpEnrollFlow mode> — copy divergence (UI-SPEC §66-03)', () => {
  it('admin mode auto-enrolls and shows admin-specific heading', async () => {
    mockEnrollSuccess();
    render(<TotpEnrollFlow mode="admin" onSuccess={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Set up MFA for admin access')).toBeTruthy();
    });
    expect(mocks.enrollTotp).toHaveBeenCalledTimes(1);
    expect(mocks.enrollTotp).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: 'LeanShot Admin' }),
    );
  });

  it('consumer mode starts at idle with consumer-specific heading + Start setup CTA', () => {
    render(<TotpEnrollFlow mode="consumer" onSuccess={vi.fn()} />);
    expect(screen.getByText('Add 2-factor authentication')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeTruthy();
    // Should NOT have auto-called enroll
    expect(mocks.enrollTotp).not.toHaveBeenCalled();
  });

  it('consumer mode calls enrollTotp only after Start setup click', async () => {
    mockEnrollSuccess();
    render(<TotpEnrollFlow mode="consumer" onSuccess={vi.fn()} />);
    expect(mocks.enrollTotp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));

    await waitFor(() => {
      expect(mocks.enrollTotp).toHaveBeenCalledTimes(1);
    });
    expect(mocks.enrollTotp).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: 'LeanShot' }),
    );
  });
});

describe('<TotpEnrollFlow> — verify + backup-codes flow', () => {
  it('shows QR code after enrollment succeeds', async () => {
    mockEnrollSuccess();
    render(<TotpEnrollFlow mode="admin" onSuccess={vi.fn()} />);
    await waitFor(() => {
      const img = screen.getByAltText('Scan with your authenticator app') as HTMLImageElement;
      expect(img.src).toContain('data:image/svg+xml');
    });
  });

  it('Verify and continue calls verifyTotpChallenge with the typed 6-digit code', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({ ok: true, aal: 'aal2' });
    mocks.rpc.mockResolvedValue({ data: FAKE_CODES, error: null });

    render(<TotpEnrollFlow mode="admin" onSuccess={vi.fn()} />);
    await waitFor(() => screen.getByLabelText('6-digit authenticator code'));

    const input = screen.getByLabelText('6-digit authenticator code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456' } });
    expect(input.value).toBe('123456');

    fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));

    await waitFor(() => {
      expect(mocks.verifyTotpChallenge).toHaveBeenCalledWith({
        factorId: FAKE_FACTOR_ID,
        code: '123456',
      });
    });
  });

  it('admin mode calls issue_backup_codes RPC after verify', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({ ok: true, aal: 'aal2' });
    mocks.rpc.mockResolvedValue({ data: FAKE_CODES, error: null });

    render(<TotpEnrollFlow mode="admin" onSuccess={vi.fn()} />);
    await waitFor(() => screen.getByLabelText('6-digit authenticator code'));

    fireEvent.change(screen.getByLabelText('6-digit authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('issue_backup_codes');
    });
  });

  it('consumer mode calls consumer_backup_codes_issue RPC after verify', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({ ok: true, aal: 'aal2' });
    mocks.rpc.mockResolvedValue({ data: FAKE_CODES, error: null });

    render(<TotpEnrollFlow mode="consumer" onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
    await waitFor(() => screen.getByLabelText('6-digit authenticator code'));

    fireEvent.change(screen.getByLabelText('6-digit authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('consumer_backup_codes_issue');
    });
  });

  it('shows backup codes panel after verify success', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({ ok: true, aal: 'aal2' });
    mocks.rpc.mockResolvedValue({ data: FAKE_CODES, error: null });

    render(<TotpEnrollFlow mode="consumer" onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
    await waitFor(() => screen.getByLabelText('6-digit authenticator code'));
    fireEvent.change(screen.getByLabelText('6-digit authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));

    await waitFor(() => {
      expect(screen.getByText('Save your backup codes')).toBeTruthy();
    });
    const list = screen.getByTestId('backup-codes-list');
    expect(list.children.length).toBe(10);
    expect(list.textContent).toContain(FAKE_CODES[0]);
  });

  it('Download codes button triggers a TXT blob download', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({ ok: true, aal: 'aal2' });
    mocks.rpc.mockResolvedValue({ data: FAKE_CODES, error: null });

    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    try {
      render(<TotpEnrollFlow mode="consumer" onSuccess={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
      await waitFor(() => screen.getByLabelText('6-digit authenticator code'));
      fireEvent.change(screen.getByLabelText('6-digit authenticator code'), {
        target: { value: '123456' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));
      await waitFor(() => screen.getByText('Save your backup codes'));

      fireEvent.click(screen.getByRole('button', { name: 'Download codes' }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('does NOT fire onSuccess until "I\'ve saved these" is checked + clicked', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({ ok: true, aal: 'aal2' });
    mocks.rpc.mockResolvedValue({ data: FAKE_CODES, error: null });

    const onSuccess = vi.fn();
    render(<TotpEnrollFlow mode="consumer" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
    await waitFor(() => screen.getByLabelText('6-digit authenticator code'));
    fireEvent.change(screen.getByLabelText('6-digit authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));
    await waitFor(() => screen.getByText('Save your backup codes'));

    // Button disabled while checkbox unchecked
    const confirmBtn = screen.getByRole('button', {
      name: /I've saved these/i,
    }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();

    // Check the box
    fireEvent.click(
      screen.getByLabelText('I have saved these backup codes in a safe place'),
    );
    expect(confirmBtn.disabled).toBe(false);

    // Click I've saved these
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('admin mode calls set_has_totp_true RPC on confirm', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({ ok: true, aal: 'aal2' });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'issue_backup_codes') {
        return Promise.resolve({ data: FAKE_CODES, error: null });
      }
      if (name === 'set_has_totp_true') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unexpected rpc' } });
    });

    const onSuccess = vi.fn();
    render(<TotpEnrollFlow mode="admin" onSuccess={onSuccess} />);
    await waitFor(() => screen.getByLabelText('6-digit authenticator code'));
    fireEvent.change(screen.getByLabelText('6-digit authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));
    await waitFor(() => screen.getByText('Save your backup codes'));

    fireEvent.click(
      screen.getByLabelText('I have saved these backup codes in a safe place'),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I've saved these/i }));
    });

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('set_has_totp_true');
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an error message + Try again CTA when verify returns ok:false', async () => {
    mockEnrollSuccess();
    mocks.verifyTotpChallenge.mockResolvedValue({
      ok: false,
      aal: null,
      error: { message: 'Invalid code' },
    });

    render(<TotpEnrollFlow mode="admin" onSuccess={vi.fn()} />);
    await waitFor(() => screen.getByLabelText('6-digit authenticator code'));
    fireEvent.change(screen.getByLabelText('6-digit authenticator code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Invalid code');
    });
  });
});

describe('<TotpEnrollFlow> — consumer cancel surface', () => {
  it('renders Cancel button at idle when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<TotpEnrollFlow mode="consumer" onSuccess={vi.fn()} onCancel={onCancel} />);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render Cancel when onCancel is omitted', () => {
    render(<TotpEnrollFlow mode="consumer" onSuccess={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
