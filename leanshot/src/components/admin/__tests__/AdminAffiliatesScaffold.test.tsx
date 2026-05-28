/**
 * Phase 19 Plan 19-05 — AdminAffiliatesScaffold RTL coverage.
 *
 * Coverage:
 *   T1: non-admin user → renders forbidden state, NO data fetch
 *   T2: admin user → fetches affiliates table; filter pills render with counts
 *   T3: filter pill click → re-renders table with status filter applied
 *   T4: empty result → EmptyState renders
 *   T5: row contains 6 columns including InitialsAvatar
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAffiliatesScaffold } from '@/components/admin/AdminAffiliatesScaffold';

// ---------------------------------------------------------------------------
// Mock supabase with a configurable query chain.
// ---------------------------------------------------------------------------

const mockAuthGetUser = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockAffiliatesLimit = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockAuthGetUser(),
    },
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
      if (table === 'affiliates') {
        return {
          select: () => ({
            order: () => ({
              limit: (n: number) => mockAffiliatesLimit(n),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

const SAMPLE_ROWS = [
  {
    id: 'aff-1',
    email: 'alice@example.com',
    display_name: 'Alice',
    audience_type: 'Instagram',
    audience_size: 12000,
    status: 'pending' as const,
    applied_at: '2026-05-15T10:00:00Z',
  },
  {
    id: 'aff-2',
    email: 'bob@example.com',
    display_name: 'Bob',
    audience_type: 'YouTube',
    audience_size: 8000,
    status: 'approved' as const,
    applied_at: '2026-05-14T10:00:00Z',
  },
  {
    id: 'aff-3',
    email: 'cara@example.com',
    display_name: 'Cara',
    audience_type: 'Newsletter',
    audience_size: 4000,
    status: 'pending' as const,
    applied_at: '2026-05-13T10:00:00Z',
  },
];

describe('<AdminAffiliatesScaffold /> — Plan 19-05', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1 — non-admin user renders forbidden state and does not fetch data', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: false }, error: null });

    render(<AdminAffiliatesScaffold />);
    await waitFor(() =>
      expect(screen.getByText(/This area is for admins only/i)).toBeInTheDocument(),
    );
    expect(mockAffiliatesLimit).not.toHaveBeenCalled();
  });

  it('T2 — admin user fetches affiliates + filter pills render with counts', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
    mockAffiliatesLimit.mockResolvedValue({ data: SAMPLE_ROWS, error: null });

    render(<AdminAffiliatesScaffold />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Affiliate applications/i })).toBeInTheDocument(),
    );
    expect(mockAffiliatesLimit).toHaveBeenCalledWith(50);

    // Filter pills: 5 segmented pills (All / Pending / Approved / Rejected / Suspended).
    const pills = screen.getAllByRole('tab');
    expect(pills).toHaveLength(5);
    // "All" pill should have count 3.
    const allPill = pills.find((p) => /^All/.test(p.textContent ?? ''))!;
    expect(allPill.textContent).toContain('3');
    const pendingPill = pills.find((p) => /^Pending/.test(p.textContent ?? ''))!;
    expect(pendingPill.textContent).toContain('2');
    const approvedPill = pills.find((p) => /^Approved/.test(p.textContent ?? ''))!;
    expect(approvedPill.textContent).toContain('1');
  });

  it('T3 — filter pill click → re-renders table with status filter applied', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
    mockAffiliatesLimit.mockResolvedValue({ data: SAMPLE_ROWS, error: null });

    const user = userEvent.setup();
    render(<AdminAffiliatesScaffold />);
    await waitFor(() =>
      expect(screen.getByTestId('affiliate-applications-table')).toBeInTheDocument(),
    );
    // Initially 3 rows.
    expect(screen.getByTestId('affiliate-row-aff-1')).toBeInTheDocument();
    expect(screen.getByTestId('affiliate-row-aff-2')).toBeInTheDocument();
    expect(screen.getByTestId('affiliate-row-aff-3')).toBeInTheDocument();

    // Click "Approved" filter pill.
    const approvedPill = screen
      .getAllByRole('tab')
      .find((p) => /^Approved/.test(p.textContent ?? ''))!;
    await user.click(approvedPill);

    // Only the approved row (aff-2) should remain.
    await waitFor(() => {
      expect(screen.queryByTestId('affiliate-row-aff-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('affiliate-row-aff-2')).toBeInTheDocument();
      expect(screen.queryByTestId('affiliate-row-aff-3')).not.toBeInTheDocument();
    });
  });

  it('T4 — empty result → EmptyState renders', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
    mockAffiliatesLimit.mockResolvedValue({ data: [], error: null });

    render(<AdminAffiliatesScaffold />);
    await waitFor(() => expect(screen.getByText(/No applications yet/i)).toBeInTheDocument());
    expect(screen.queryByTestId('affiliate-applications-table')).not.toBeInTheDocument();
  });

  it('T5 — row contains 6 columns including InitialsAvatar', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
    mockAffiliatesLimit.mockResolvedValue({ data: [SAMPLE_ROWS[0]], error: null });

    render(<AdminAffiliatesScaffold />);
    const row = await screen.findByTestId('affiliate-row-aff-1');
    // Six <td> cells per row.
    const cells = within(row).getAllByRole('cell');
    expect(cells).toHaveLength(6);
    // First cell contains the InitialsAvatar (role="img").
    const avatar = within(cells[0]!).getByRole('img');
    expect(avatar.getAttribute('aria-label')).toContain('Alice');
  });
});
