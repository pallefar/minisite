/**
 * Phase 22 Plan 22-06 — AdminMembersPage RTL coverage.
 *
 * Covers behavior bullets from 22-06-PLAN Task 1:
 *   T1: renders nothing while is_staff resolves (initial undefined probe)
 *   T2: non-staff user → renders NotAuthorizedCard, NO data fetch
 *   T3: staff user → fetches via admin_list_members and renders table
 *   T4: Pill click "Paid" → re-invokes RPC with p_tier='paid'
 *   T5: search input change → debounced re-invoke with p_search=string
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminMembersPage } from '@/components/admin/pages/AdminMembersPage';

const mockAuthGetUser = vi.fn();
const mockAssertAal2 = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  // AdminLayout's runProbe gates child render on assertAal2(); seedStaff()
  // helpers (and per-test mockAssertAal2.mockResolvedValue(true)) drive it.
  assertAal2: () => mockAssertAal2(),
  supabase: {
    auth: {
      getUser: () => mockAuthGetUser(),
    },
    // AdminShell anomaly realtime-channel calls supabase.channel().on().subscribe()
    // at mount; without this stub the render throws an uncaught TypeError.
    channel: () => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
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
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  },
}));

const SAMPLE = [
  {
    user_id: 'u-1',
    email: 'alice@example.com',
    tier: 'paid',
    signup_date: '2026-05-01T00:00:00Z',
    last_active_at: '2026-05-15T12:00:00Z',
    clinic_name: null,
    country: 'US',
    stripe_status: 'active',
  },
  {
    user_id: 'u-2',
    email: 'bob@example.com',
    tier: 'free',
    signup_date: '2026-04-20T00:00:00Z',
    last_active_at: null,
    clinic_name: null,
    country: 'GB',
    stripe_status: 'none',
  },
];

describe('<AdminMembersPage /> — Phase 22 Plan 22-06', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/admin/members');
  });
  it('T1 — renders nothing while is_staff probe is pending', async () => {
    // getUser never resolves during this assertion window.
    let resolveProbe: (v: unknown) => void = () => {};
    mockAuthGetUser.mockReturnValue(
      new Promise((r) => {
        resolveProbe = r;
      }),
    );

    const { container } = render(<AdminMembersPage />);
    // Empty container = component returned null.
    expect(container.firstChild).toBeNull();

    // Cleanup: resolve the probe so the unmount cleanup runs cleanly.
    resolveProbe({ data: { user: null } });
  });

  it('T2 — non-staff user renders forbidden state and does NOT call RPC', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'u-x' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: false }, error: null });

    render(<AdminMembersPage />);
    await waitFor(() =>
      expect(screen.getByText(/This area is for admins only/i)).toBeInTheDocument(),
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('T3 — staff user → fetches admin_list_members + renders table rows', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true, has_totp: true, admin_role: null }, error: null });
    mockAssertAal2.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: SAMPLE, error: null });

    render(<AdminMembersPage />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Members/i })).toBeInTheDocument(),
    );

    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith('admin_list_members', {
      p_search: null,
      p_tier: null,
      p_page: 1,
      p_size: 50,
    });

    // Rows render.
    await waitFor(() => expect(screen.getByTestId('member-row-u-1')).toBeInTheDocument());
    expect(screen.getByTestId('member-row-u-2')).toBeInTheDocument();
  });

  it('T4 — clicking "Paid" filter re-invokes RPC with p_tier="paid"', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true, has_totp: true, admin_role: null }, error: null });
    mockAssertAal2.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: SAMPLE, error: null });

    const user = userEvent.setup();
    render(<AdminMembersPage />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    mockRpc.mockClear();

    const paidPill = await screen.findByRole('tab', { name: 'Paid' });
    await user.click(paidPill);

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        'admin_list_members',
        expect.objectContaining({ p_tier: 'paid', p_page: 1 }),
      ),
    );
  });

  it('T5 — search input debounced re-invokes RPC with p_search', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true, has_totp: true, admin_role: null }, error: null });
    mockAssertAal2.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: SAMPLE, error: null });

    const user = userEvent.setup();
    render(<AdminMembersPage />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    mockRpc.mockClear();

    const input = await screen.findByPlaceholderText(/Search by email or name/i);
    await user.type(input, 'alice');
    // Wait for the 300ms debounce (real timers).
    await waitFor(
      () =>
        expect(mockRpc).toHaveBeenCalledWith(
          'admin_list_members',
          expect.objectContaining({ p_search: 'alice' }),
        ),
      { timeout: 1500 },
    );
  });
});
