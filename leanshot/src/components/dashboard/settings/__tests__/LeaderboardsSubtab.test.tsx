/**
 * Phase 35 Plan 35-08 (GAME-04) — LeaderboardsSubtab RTL unit tests.
 *
 * Covers:
 *   - Lists leaderboard-enabled cohorts the user belongs to
 *   - Suggest button populates handle from RPC (suggestLeaderboardHandle)
 *   - Invalid handle rejected inline (validateHandle client-side feedback)
 *
 * Mock strategy: supabase returns an already-opted-in cohort so the handle
 * picker is visible from the start. This avoids needing to simulate the
 * full opt-in RPC flow just to show the handle input.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardsSubtab } from '../LeaderboardsSubtab';

// --- mocks -------------------------------------------------------------------

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((selector: (s: { signedIn: { user: { id: string } } | null }) => unknown) =>
    selector({ signedIn: { user: { id: 'u-1' } } }),
  ),
}));

// Supabase mock returns cohort with user already opted-in (active=true) so handle picker shows
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'c-1',
                name: 'GLP-1 Veterans 6mo+',
                leaderboard_enabled: true,
                cohort_membership: [{ user_id: 'u-1' }],
                // User is already opted-in → handle picker renders on load
                leaderboard_optin: [{ user_id: 'u-1', handle: 'ExistingHandle-1234', active: true }],
              },
            ],
          }),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/gamification/leaderboard', () => ({
  setLeaderboardOptin: vi.fn().mockResolvedValue(undefined),
  suggestLeaderboardHandle: vi.fn().mockResolvedValue('PeptidePioneer-7841'),
  LeaderboardApiError: class LeaderboardApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'LeaderboardApiError';
    }
  },
}));

vi.mock('@/hooks/useToast', () => ({ useToast: () => vi.fn() }));

// Inline mocks for UI primitives to avoid full design-system dependency in unit tests
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    'aria-label'?: string;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({
    id,
    'aria-label': ariaLabel,
    value,
    onChange,
    placeholder,
    disabled,
    'aria-invalid': ariaInvalid,
  }: {
    id?: string;
    'aria-label'?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    disabled?: boolean;
    'aria-invalid'?: boolean;
  }) => (
    <input
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={ariaInvalid}
    />
  ),
}));

// -----------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LeaderboardsSubtab (GAME-04)', () => {
  it('lists leaderboard-enabled cohorts the user belongs to', async () => {
    render(<LeaderboardsSubtab />);
    await waitFor(() =>
      expect(screen.getByText(/GLP-1 Veterans 6mo\+/)).toBeInTheDocument(),
    );
  });

  it('suggest button populates handle input from RPC', async () => {
    const { suggestLeaderboardHandle } = await import('@/lib/gamification/leaderboard');
    render(<LeaderboardsSubtab />);

    // Wait for cohort to load — user is opted-in, so handle picker is visible from the start
    await waitFor(() => screen.getByText(/GLP-1 Veterans 6mo\+/));

    // Handle input should be visible because cohort.hasOptedIn = true
    const input = screen.getByLabelText(/Handle for GLP-1 Veterans 6mo\+/);
    expect(input).toBeInTheDocument();

    // Click suggest button → populates the handle from RPC
    fireEvent.click(screen.getByRole('button', { name: /suggest/i }));

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('PeptidePioneer-7841');
    });
    expect(suggestLeaderboardHandle).toHaveBeenCalled();
  });

  it('rejects invalid handle with inline error message (real-name / spaces)', async () => {
    render(<LeaderboardsSubtab />);
    await waitFor(() => screen.getByText(/GLP-1 Veterans 6mo\+/));

    // Handle picker is visible (opted-in cohort)
    const input = screen.getByLabelText(/Handle for GLP-1 Veterans 6mo\+/);

    // Type a handle with spaces (invalid — real-name shape blocked by D-13 regex)
    fireEvent.change(input, { target: { value: 'John Smith' } });

    // Inline validation error should appear
    await waitFor(() =>
      expect(screen.getByText(/6.24 alphanumeric/)).toBeInTheDocument(),
    );
  });
});
