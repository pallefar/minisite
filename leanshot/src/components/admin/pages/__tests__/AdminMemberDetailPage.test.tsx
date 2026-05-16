/**
 * Phase 22 Plan 22-06 — AdminMemberDetailPage RTL coverage.
 *
 * Covers behavior bullets from 22-06-PLAN Task 2:
 *   T1: header renders avatar + name + email + tier badge + Stripe badge
 *   T2: tab bar renders 6 tabs in declared order; ?tab= URL persists
 *   T3: arrow-key navigation moves between tabs
 *   T4: Profile tab renders read-only field list
 *   T5: empty states wired (activity, stripe charges, audit)
 *
 * Flags tab + RPC verification covered in MemberFlagsTab.test.tsx.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminMemberDetailPage } from '@/components/admin/pages/AdminMemberDetailPage';

const mockAuthGetUser = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockRpc = vi.fn();
const mockAuditOrder = vi.fn();
const mockSubsMaybeSingle = vi.fn();
const mockActivityOrder = vi.fn();
const mockFeatureFlagsSelect = vi.fn();
const mockOverridesEq = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockAuthGetUser(),
    },
    rpc: (name: string, params: unknown) => mockRpc(name, params),
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => mockProfilesMaybeSingle() }),
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => mockSubsMaybeSingle() }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: () => ({
            // .or(...) for activity feed
            or: () => ({
              order: () => ({ limit: () => mockActivityOrder() }),
            }),
            // .eq(...) for audit tab
            eq: () => ({
              order: () => ({ limit: () => mockAuditOrder() }),
            }),
          }),
        };
      }
      if (table === 'feature_flags') {
        return { select: () => mockFeatureFlagsSelect() };
      }
      if (table === 'feature_flag_overrides') {
        return {
          select: () => ({ eq: () => mockOverridesEq() }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

const SAMPLE_MEMBER = {
  user_id: 'u-1',
  email: 'alice@example.com',
  tier: 'paid',
  signup_date: '2026-05-01T00:00:00Z',
  last_active_at: '2026-05-15T12:00:00Z',
  clinic_name: null,
  country: 'US',
  stripe_status: 'active',
};

function seedStaffOk() {
  mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
  mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
  mockRpc.mockResolvedValue({ data: [SAMPLE_MEMBER], error: null });
  // Tab data defaults — empty results so empty states fire.
  mockSubsMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockActivityOrder.mockResolvedValue({ data: [], error: null });
  mockAuditOrder.mockResolvedValue({ data: [], error: null });
  mockFeatureFlagsSelect.mockResolvedValue({ data: [], error: null });
  mockOverridesEq.mockResolvedValue({ data: [], error: null });
}

describe('<AdminMemberDetailPage /> — Phase 22 Plan 22-06', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/admin/members/u-1');
  });

  it('T1 — header renders avatar + email + tier + Stripe badge', async () => {
    seedStaffOk();
    render(<AdminMemberDetailPage userId="u-1" />);
    const header = await screen.findByTestId('member-detail-header');
    expect(within(header).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(header).getByText('u-1')).toBeInTheDocument();
    expect(within(header).getByText('paid')).toBeInTheDocument();
    expect(within(header).getByText('active')).toBeInTheDocument();
  });

  it('T2 — tab bar renders 6 tabs in order; ?tab= URL persists', async () => {
    seedStaffOk();
    const user = userEvent.setup();
    render(<AdminMemberDetailPage userId="u-1" />);
    await screen.findByTestId('member-detail-header');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      'Profile',
      'Billing',
      'Activity',
      'Stripe',
      'Flags',
      'Audit',
    ]);

    // No ?tab= for "profile" (default).
    expect(window.location.search).toBe('');

    await user.click(tabs[3]!); // Stripe
    await waitFor(() => expect(window.location.search).toBe('?tab=stripe'));

    await user.click(tabs[0]!); // back to Profile
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('T3 — arrow-right key advances active tab', async () => {
    seedStaffOk();
    const user = userEvent.setup();
    render(<AdminMemberDetailPage userId="u-1" />);
    await screen.findByTestId('member-detail-header');
    // Focus the active Profile pill, then send ArrowRight — the key handler
    // lives on the wrapping div so bubble-up reaches it.
    const profilePill = screen.getByRole('tab', { name: 'Profile' });
    profilePill.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(window.location.search).toBe('?tab=billing'));
  });

  it('T4 — Profile tab renders the read-only field list', async () => {
    seedStaffOk();
    render(<AdminMemberDetailPage userId="u-1" />);
    const profile = await screen.findByTestId('member-profile-tab');
    expect(within(profile).getByText('User ID')).toBeInTheDocument();
    expect(within(profile).getByText('Email')).toBeInTheDocument();
    expect(within(profile).getByText('Signup date')).toBeInTheDocument();
    expect(within(profile).getByText('Last active')).toBeInTheDocument();
  });

  it('T5a — switching to Activity with no rows shows "No activity yet"', async () => {
    seedStaffOk();
    const user = userEvent.setup();
    render(<AdminMemberDetailPage userId="u-1" />);
    await screen.findByTestId('member-detail-header');
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    await waitFor(() =>
      expect(screen.getByText(/No activity yet/i)).toBeInTheDocument(),
    );
  });

  it('T5b — switching to Stripe shows "No charges in the last 90 days"', async () => {
    seedStaffOk();
    const user = userEvent.setup();
    render(<AdminMemberDetailPage userId="u-1" />);
    await screen.findByTestId('member-detail-header');
    await user.click(screen.getByRole('tab', { name: 'Stripe' }));
    await waitFor(() =>
      expect(screen.getByText(/No charges in the last 90 days/i)).toBeInTheDocument(),
    );
  });

  it('T5c — switching to Audit shows "No audit entries"', async () => {
    seedStaffOk();
    const user = userEvent.setup();
    render(<AdminMemberDetailPage userId="u-1" />);
    await screen.findByTestId('member-detail-header');
    await user.click(screen.getByRole('tab', { name: 'Audit' }));
    await waitFor(() =>
      expect(screen.getByText(/No audit entries/i)).toBeInTheDocument(),
    );
  });
});
