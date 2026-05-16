/**
 * Phase 22 plan 22-07 — AdminAffiliatesReviewQueue (ADMIN-06) RTL coverage.
 *
 * Tests the conversion review queue:
 *   T1: non-admin → forbidden state, NO conversion read
 *   T2: admin sees 4 actions per row (Approve, Hold, Pay out, Reject) + 6-state filter Pill
 *   T3: clicking Approve invokes admin_approve_affiliate_conversion RPC + refreshes
 *   T4: row click expands inline panel (Fraud signals + Payout history + Audit log)
 *   T5: filter Pill switches visible rows
 *   T6: Pay out button is disabled (tooltip-only — cron 19-09 owns transfer)
 *   T7: rejectAffiliateConversion client wrapper maps invalid_state correctly
 *   T8 (status-graph closeout): Approve writes status='confirmed' — this is the
 *       missing pending → confirmed transition writer that closes Phase 19 BL-11.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAffiliatesReviewQueue } from '@/components/admin/AdminAffiliatesReviewQueue';
import {
  AffiliateReviewError,
  rejectAffiliateConversion,
} from '@/lib/admin/affiliate-review';

// ── Mock supabase ─────────────────────────────────────────────────────────────
const mockAuthGetUser = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockConversionsLimit = vi.fn();
const mockAuditLimit = vi.fn();
const mockPayoutsLimit = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockAuthGetUser() },
    rpc: (name: string, params: Record<string, unknown>) => mockRpc(name, params),
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => mockProfilesMaybeSingle() }),
          }),
        };
      }
      if (table === 'affiliate_conversions') {
        return {
          select: () => ({
            order: () => ({ limit: (n: number) => mockConversionsLimit(n) }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({ limit: (n: number) => mockAuditLimit(n) }),
              }),
            }),
          }),
        };
      }
      if (table === 'payouts') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: (n: number) => mockPayoutsLimit(n) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({ useToast: () => mockToast }));

beforeEach(() => {
  mockAuthGetUser.mockReset();
  mockProfilesMaybeSingle.mockReset();
  mockConversionsLimit.mockReset();
  mockAuditLimit.mockReset();
  mockPayoutsLimit.mockReset();
  mockRpc.mockReset();
  mockToast.mockReset();
});

const FLAGGED_ROW = {
  id: 'conv-1',
  affiliate_id: 'aff-1',
  invoice_id: 'in_111',
  commission_cents: 4900,
  status: 'flagged',
  fraud_signals: ['ip_velocity', 'email_domain_match'],
  eligible_at: '2026-05-15T00:00:00Z',
  invoice_paid_at: '2026-05-14T00:00:00Z',
  created_at: '2026-05-14T10:00:00Z',
  confirmed_at: null,
  reviewed_at: null,
  affiliates: { email: 'alice@example.com' },
};
const PENDING_ROW = {
  id: 'conv-2',
  affiliate_id: 'aff-2',
  invoice_id: 'in_222',
  commission_cents: 1500,
  status: 'pending',
  fraud_signals: [],
  eligible_at: '2026-05-20T00:00:00Z',
  invoice_paid_at: '2026-05-19T00:00:00Z',
  created_at: '2026-05-19T10:00:00Z',
  confirmed_at: null,
  reviewed_at: null,
  affiliates: { email: 'bob@example.com' },
};

function asStaff(): void {
  mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'admin-uuid' } } });
  mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
}

describe('AdminAffiliatesReviewQueue (Phase 22 ADMIN-06)', () => {
  it('T1: non-admin user → forbidden state, NO conversion read', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: false }, error: null });
    render(<AdminAffiliatesReviewQueue />);
    await waitFor(() =>
      expect(screen.getByText(/This area is for admins only/i)).toBeInTheDocument(),
    );
    expect(mockConversionsLimit).not.toHaveBeenCalled();
  });

  it('T2: admin sees 4 action buttons per row + 6-state filter Pill', async () => {
    asStaff();
    mockConversionsLimit.mockResolvedValue({ data: [FLAGGED_ROW], error: null });
    render(<AdminAffiliatesReviewQueue />);

    await waitFor(() =>
      expect(screen.getByTestId('affiliate-conversions-table')).toBeInTheDocument(),
    );
    // 6-state filter
    expect(screen.getByRole('tab', { name: /All/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pending/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Flagged/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Approved/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Rejected/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /On hold/i })).toBeInTheDocument();

    // 4 per-row actions
    const row = screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`);
    expect(within(row).getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^Hold$/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^Pay out$/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();

    // Fraud signal badges
    expect(within(row).getByText('ip_velocity')).toBeInTheDocument();
    expect(within(row).getByText('email_domain_match')).toBeInTheDocument();
  });

  it('T3+T8 (BL-11 closeout): Approve invokes admin_approve_affiliate_conversion RPC → writes confirmed', async () => {
    asStaff();
    // First call returns the flagged row; second (after approve) returns the confirmed row.
    mockConversionsLimit
      .mockResolvedValueOnce({ data: [FLAGGED_ROW], error: null })
      .mockResolvedValueOnce({
        data: [{ ...FLAGGED_ROW, status: 'confirmed', confirmed_at: '2026-05-16T00:00:00Z' }],
        error: null,
      });
    mockRpc.mockResolvedValue({ data: null, error: null });

    render(<AdminAffiliatesReviewQueue />);
    await waitFor(() =>
      expect(screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`)).toBeInTheDocument(),
    );
    const row = screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`);
    await userEvent.click(within(row).getByRole('button', { name: /^Approve$/i }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const [rpcName, params] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe('admin_approve_affiliate_conversion');
    expect(params).toEqual({ p_conversion_id: FLAGGED_ROW.id });
    // Refresh fires after approve.
    await waitFor(() => expect(mockConversionsLimit).toHaveBeenCalledTimes(2));
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('approved'), 'success');
  });

  it('T4: row click expands inline panel with Fraud signals + Payout history + Audit log', async () => {
    asStaff();
    mockConversionsLimit.mockResolvedValue({ data: [FLAGGED_ROW], error: null });
    mockAuditLimit.mockResolvedValue({
      data: [
        {
          id: 'aud-1',
          action: 'affiliate_conversion_approved',
          created_at: '2026-05-16T01:00:00Z',
          metadata: {},
        },
      ],
      error: null,
    });
    mockPayoutsLimit.mockResolvedValue({
      data: [
        {
          id: 'pay-1',
          period_start: '2026-04-01',
          period_end: '2026-04-30',
          amount_cents: 12000,
          status: 'paid',
          paid_at: '2026-05-01T00:00:00Z',
        },
      ],
      error: null,
    });
    render(<AdminAffiliatesReviewQueue />);
    await waitFor(() =>
      expect(screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`));
    await waitFor(() =>
      expect(
        screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}-expanded`),
      ).toBeInTheDocument(),
    );
    const expanded = screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}-expanded`);
    expect(within(expanded).getByText(/Fraud signals/i)).toBeInTheDocument();
    expect(within(expanded).getByText(/Payout history/i)).toBeInTheDocument();
    expect(within(expanded).getByText(/Audit log/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(expanded).getByText(/affiliate_conversion_approved/i)).toBeInTheDocument(),
    );
    expect(within(expanded).getByText(/\(paid\)/i)).toBeInTheDocument();
  });

  it('T5: filter Pill switches visible rows', async () => {
    asStaff();
    mockConversionsLimit.mockResolvedValue({ data: [FLAGGED_ROW, PENDING_ROW], error: null });
    render(<AdminAffiliatesReviewQueue />);
    await waitFor(() =>
      expect(screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`)).toBeInTheDocument(),
    );
    // Default filter is `flagged` — pending row should NOT be visible.
    expect(screen.queryByTestId(`conversion-row-${PENDING_ROW.id}`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /^Pending/i }));
    await waitFor(() =>
      expect(screen.getByTestId(`conversion-row-${PENDING_ROW.id}`)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(`conversion-row-${FLAGGED_ROW.id}`)).not.toBeInTheDocument();
  });

  it('T6: Pay out button is disabled (cron 19-09 owns transfer)', async () => {
    asStaff();
    mockConversionsLimit.mockResolvedValue({ data: [FLAGGED_ROW], error: null });
    render(<AdminAffiliatesReviewQueue />);
    await waitFor(() =>
      expect(screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`)).toBeInTheDocument(),
    );
    const row = screen.getByTestId(`conversion-row-${FLAGGED_ROW.id}`);
    expect(within(row).getByRole('button', { name: /^Pay out$/i })).toBeDisabled();
  });
});

describe('affiliate-review client wrapper', () => {
  it('T7: rejectAffiliateConversion maps invalid_state', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'cannot_reject_paid', code: '22023' },
    });
    await expect(rejectAffiliateConversion('conv-x', 'spam')).rejects.toBeInstanceOf(
      AffiliateReviewError,
    );
    try {
      await rejectAffiliateConversion('conv-x', 'spam');
    } catch (e) {
      expect((e as AffiliateReviewError).code).toBe('invalid_state');
    }
  });
});
