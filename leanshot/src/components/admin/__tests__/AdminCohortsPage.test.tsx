/**
 * Phase 22 Plan 22-08 — AdminCohortsPage RTL coverage (RED phase).
 *
 * Coverage:
 *   T1: staff user — calls admin_get_cohort_retention with p_weeks=13 by default.
 *   T2: "Show all weeks" toggle re-fetches with p_weeks=52 per D-04.
 *   T3: header renders "Cohort retention".
 *   T4: non-staff — renders forbidden card.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCohortsPage } from '@/components/admin/pages/AdminCohortsPage';

const mockAuthGetUser = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockAuthGetUser() },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockProfilesMaybeSingle(),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const SAMPLE_ROWS = [
  {
    cohort_week: '2026-05-04',
    day_offset: 0,
    active_users: 50,
    retention_pct: 50,
    cohort_size: 100,
  },
  {
    cohort_week: '2026-05-04',
    day_offset: 1,
    active_users: 40,
    retention_pct: 40,
    cohort_size: 100,
  },
];

function primeStaff() {
  mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
  mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
}

describe('<AdminCohortsPage /> — Plan 22-08', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1 — staff user fetches cohort retention with default p_weeks=13', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: SAMPLE_ROWS, error: null });
    render(<AdminCohortsPage />);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('admin_get_cohort_retention', { p_weeks: 13 }),
    );
  });

  it('T2 — "Show all weeks" toggle re-fetches with p_weeks=52', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: SAMPLE_ROWS, error: null });
    const user = userEvent.setup();
    render(<AdminCohortsPage />);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('admin_get_cohort_retention', { p_weeks: 13 }),
    );
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: SAMPLE_ROWS, error: null });
    const toggle = await screen.findByRole('button', { name: /Show all weeks/i });
    await user.click(toggle);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('admin_get_cohort_retention', { p_weeks: 52 }),
    );
  });

  it('T3 — staff user sees "Cohort retention" heading', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: SAMPLE_ROWS, error: null });
    render(<AdminCohortsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Cohort retention/i }),
      ).toBeInTheDocument(),
    );
  });

  it('T4 — non-staff user renders forbidden card', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: false }, error: null });
    render(<AdminCohortsPage />);
    await waitFor(() =>
      expect(screen.getByText(/This area is for admins only/i)).toBeInTheDocument(),
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
