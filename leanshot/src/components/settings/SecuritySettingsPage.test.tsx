/**
 * Phase 66 Plan 66-03 — SecuritySettingsPage tests.
 *
 * Covers:
 *   - MFA-not-enrolled state mounts <TotpEnrollFlow mode="consumer">
 *   - MFA-enrolled state shows "On since <date>" badge + Re-enroll CTA
 *   - Re-enroll button triggers unenrollFactor + re-renders enroll flow
 *   - Error state renders a recoverable Try again CTA
 */

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TotpShared from '@/lib/auth/totp-shared';
import SecuritySettingsPage from './SecuritySettingsPage';

const mocks = vi.hoisted(() => ({
  listEnrolledFactors: vi.fn(),
  unenrollFactor: vi.fn(),
}));

vi.mock('@/lib/auth/totp-shared', async () => {
  const actual = await vi.importActual<typeof TotpShared>(
    '@/lib/auth/totp-shared',
  );
  return {
    ...actual,
    listEnrolledFactors: mocks.listEnrolledFactors,
    unenrollFactor: mocks.unenrollFactor,
  };
});

// Stub TotpEnrollFlow so SecuritySettingsPage tests don't have to thread
// through the full enrollment UX (covered by TotpEnrollFlow.test.tsx).
vi.mock('@/components/auth/TotpEnrollFlow', () => ({
  default: ({ mode, onSuccess }: { mode: string; onSuccess: () => void }) => (
    <div data-testid="totp-enroll-flow-stub" data-mode={mode}>
      <button onClick={onSuccess}>Stub: finish enroll</button>
    </div>
  ),
}));


beforeEach(() => {
  mocks.listEnrolledFactors.mockReset();
  mocks.unenrollFactor.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<SecuritySettingsPage> — not-enrolled state', () => {
  it('renders Security heading + mounts TotpEnrollFlow with mode="consumer"', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([]);
    render(<SecuritySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Security')).toBeTruthy();
    });
    const stub = screen.getByTestId('totp-enroll-flow-stub');
    expect(stub.getAttribute('data-mode')).toBe('consumer');
  });

  it('does NOT render Trusted devices section when not enrolled', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([]);
    render(<SecuritySettingsPage />);
    await waitFor(() => screen.getByTestId('totp-enroll-flow-stub'));
    expect(screen.queryByText('Trusted devices')).toBeNull();
  });

  it('renders Active sessions section always', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([]);
    render(<SecuritySettingsPage />);
    await waitFor(() => screen.getByText('Active sessions'));
  });
});

describe('<SecuritySettingsPage> — enrolled state', () => {
  it('shows "On since <date>" badge when listEnrolledFactors returns a factor', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([
      {
        id: 'factor-1',
        factor_type: 'totp',
        status: 'verified',
        created_at: '2026-05-10T12:00:00Z',
      },
    ]);
    render(<SecuritySettingsPage />);

    await waitFor(() => {
      const badge = screen.getByTestId('mfa-enrolled-badge');
      expect(badge.textContent).toMatch(/On since /);
    });
    // Should NOT show the enroll flow stub
    expect(screen.queryByTestId('totp-enroll-flow-stub')).toBeNull();
  });

  it('renders Re-enroll button when enrolled', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([
      {
        id: 'factor-1',
        factor_type: 'totp',
        status: 'verified',
        created_at: '2026-05-10T12:00:00Z',
      },
    ]);
    render(<SecuritySettingsPage />);

    await waitFor(() => screen.getByRole('button', { name: 'Re-enroll' }));
  });

  it('renders Trusted devices section when enrolled', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([
      {
        id: 'factor-1',
        factor_type: 'totp',
        status: 'verified',
        created_at: '2026-05-10T12:00:00Z',
      },
    ]);
    render(<SecuritySettingsPage />);
    await waitFor(() => screen.getByText('Trusted devices'));
    expect(screen.getByText('No trusted devices yet.')).toBeTruthy();
  });

  it('clicking Re-enroll → Yes calls unenrollFactor and re-renders enroll flow', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([
      {
        id: 'factor-1',
        factor_type: 'totp',
        status: 'verified',
        created_at: '2026-05-10T12:00:00Z',
      },
    ]);
    mocks.unenrollFactor.mockResolvedValue(undefined);

    render(<SecuritySettingsPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Re-enroll' }));

    fireEvent.click(screen.getByRole('button', { name: 'Re-enroll' }));
    // Confirmation dialog
    expect(screen.getByText('Re-enroll 2FA?')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, re-enroll' }));
    });

    await waitFor(() => {
      expect(mocks.unenrollFactor).toHaveBeenCalledWith('factor-1');
    });
    // Should now show the enroll flow stub again
    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-flow-stub')).toBeTruthy();
    });
  });

  it('clicking Re-enroll → Cancel keeps the enrolled view', async () => {
    mocks.listEnrolledFactors.mockResolvedValue([
      {
        id: 'factor-1',
        factor_type: 'totp',
        status: 'verified',
        created_at: '2026-05-10T12:00:00Z',
      },
    ]);
    render(<SecuritySettingsPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Re-enroll' }));

    fireEvent.click(screen.getByRole('button', { name: 'Re-enroll' }));
    expect(screen.getByText('Re-enroll 2FA?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Re-enroll 2FA?')).toBeNull();
    expect(mocks.unenrollFactor).not.toHaveBeenCalled();
  });
});

describe('<SecuritySettingsPage> — error state', () => {
  it('renders Try again CTA when listEnrolledFactors throws', async () => {
    mocks.listEnrolledFactors.mockRejectedValue(new Error('rpc failed'));
    render(<SecuritySettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('rpc failed');
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('Try again button re-runs listEnrolledFactors', async () => {
    mocks.listEnrolledFactors.mockRejectedValueOnce(new Error('transient'));
    mocks.listEnrolledFactors.mockResolvedValueOnce([]);

    render(<SecuritySettingsPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Try again' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-flow-stub')).toBeTruthy();
    });
    expect(mocks.listEnrolledFactors).toHaveBeenCalledTimes(2);
  });
});
