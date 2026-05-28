/**
 * Phase 25 Plan 25-09 — BaaChainTable RTL coverage.
 * HIPAA-12: BAA chain status table + edit-status modal.
 *
 * Tests:
 *   T1: Renders 6 vendor rows from seed data.
 *   T2: Status badge for 'pending' row shows correct styling.
 *   T3: Edit modal opens on Edit button click.
 *   T4: Submit modal calls vendor_baa_chain_update RPC with correct args.
 *   T5: After successful update, table refreshes.
 *   T6: RPC returns 'forbidden' error → error message shown in modal.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaaChainTable } from '@/components/admin/compliance/BaaChainTable';

// ── Mock supabase ─────────────────────────────────────────────────────────────
const mockRpc = vi.fn();
const mockVendorChainOrder = vi.fn();

const SEED_ROWS = [
  {
    vendor_name: 'Supabase',
    baa_signed_at: null,
    baa_expiry_at: null,
    monthly_cost_usd: 924,
    scope_summary: 'DB + Auth + Storage',
    status: 'pending',
  },
  {
    vendor_name: 'Vercel',
    baa_signed_at: null,
    baa_expiry_at: null,
    monthly_cost_usd: 350,
    scope_summary: 'Hosting + Edge Runtime',
    status: 'pending',
  },
  {
    vendor_name: 'Sentry',
    baa_signed_at: null,
    baa_expiry_at: null,
    monthly_cost_usd: 80,
    scope_summary: 'Error monitoring',
    status: 'pending',
  },
  {
    vendor_name: 'Anthropic',
    baa_signed_at: null,
    baa_expiry_at: null,
    monthly_cost_usd: 1500,
    scope_summary: 'LLM',
    status: 'pending',
  },
  {
    vendor_name: 'AWS SES',
    baa_signed_at: null,
    baa_expiry_at: null,
    monthly_cost_usd: 10,
    scope_summary: 'Email',
    status: 'pending',
  },
  {
    vendor_name: 'PostHog',
    baa_signed_at: null,
    baa_expiry_at: null,
    monthly_cost_usd: 0,
    scope_summary: 'Analytics',
    status: 'pending',
  },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: Record<string, unknown>) => mockRpc(name, params),
    from: (table: string) => {
      if (table === 'vendor_baa_chain') {
        return {
          select: () => ({
            order: () => mockVendorChainOrder(),
          }),
        };
      }
      return {};
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: 6 vendors, all pending.
  mockVendorChainOrder.mockResolvedValue({ data: SEED_ROWS, error: null });
  // Default: RPC succeeds.
  mockRpc.mockResolvedValue({ error: null });
});

describe('BaaChainTable', () => {
  it('T1: renders 6 vendor rows from seed data', async () => {
    render(<BaaChainTable />);

    await waitFor(() => {
      expect(screen.getByText('Supabase')).toBeInTheDocument();
      expect(screen.getByText('Vercel')).toBeInTheDocument();
      expect(screen.getByText('Sentry')).toBeInTheDocument();
      expect(screen.getByText('Anthropic')).toBeInTheDocument();
      expect(screen.getByText('AWS SES')).toBeInTheDocument();
      expect(screen.getByText('PostHog')).toBeInTheDocument();
    });
  });

  it('T2: status badge for pending row shows gray styling', async () => {
    render(<BaaChainTable />);

    await waitFor(() => {
      // All rows are pending; find the first badge.
      const badges = screen.getAllByText('pending');
      expect(badges.length).toBeGreaterThan(0);
      // Pending badge has gray classes.
      badges.forEach((badge) => {
        expect(badge.className).toMatch(/bg-gray/);
      });
    });
  });

  it('T3: Edit modal opens on Edit button click', async () => {
    const user = userEvent.setup();
    render(<BaaChainTable />);

    await waitFor(() => {
      expect(screen.getByText('Supabase')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit BAA status for Supabase' });
    await user.click(editBtn);

    // Modal should be visible.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Update BAA — Supabase/)).toBeInTheDocument();
  });

  it('T4: submitting modal calls vendor_baa_chain_update RPC with correct args', async () => {
    const user = userEvent.setup();
    render(<BaaChainTable />);

    await waitFor(() => {
      expect(screen.getByText('Supabase')).toBeInTheDocument();
    });

    // Open modal for Supabase.
    await user.click(screen.getByRole('button', { name: 'Edit BAA status for Supabase' }));

    const dialog = screen.getByRole('dialog');

    // Use fireEvent.change for date inputs — userEvent.type doesn't reliably
    // update jsdom date input values (no text-based key sequence maps to ISO dates).
    const signedInput = within(dialog).getByLabelText('BAA Signed Date');
    const expiryInput = within(dialog).getByLabelText('BAA Expiry Date');

    fireEvent.change(signedInput, { target: { value: '2026-01-01' } });
    fireEvent.change(expiryInput, { target: { value: '2027-01-01' } });

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'vendor_baa_chain_update',
        expect.objectContaining({
          p_vendor_name: 'Supabase',
        }),
      );
    });
  });

  it('T5: after successful update, table re-fetches data', async () => {
    const user = userEvent.setup();

    // After the RPC, the second fetch returns updated data.
    const UPDATED_ROWS = SEED_ROWS.map((r) =>
      r.vendor_name === 'Supabase'
        ? {
            ...r,
            status: 'signed',
            baa_signed_at: '2026-01-01T00:00:00Z',
            baa_expiry_at: '2027-01-01T00:00:00Z',
          }
        : r,
    );

    mockVendorChainOrder
      .mockResolvedValueOnce({ data: SEED_ROWS, error: null }) // initial load
      .mockResolvedValueOnce({ data: UPDATED_ROWS, error: null }); // after save

    render(<BaaChainTable />);

    await waitFor(() => {
      expect(screen.getAllByText('pending').length).toBe(6);
    });

    await user.click(screen.getByRole('button', { name: 'Edit BAA status for Supabase' }));

    const dialog = screen.getByRole('dialog');
    const signedInput = within(dialog).getByLabelText('BAA Signed Date');
    const expiryInput = within(dialog).getByLabelText('BAA Expiry Date');

    // Use fireEvent.change for date inputs (userEvent.type is not reliable for date inputs in jsdom).
    fireEvent.change(signedInput, { target: { value: '2026-01-01' } });
    fireEvent.change(expiryInput, { target: { value: '2027-01-01' } });

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    // After save, table should reload with signed status.
    await waitFor(() => {
      // 5 pending remain; Supabase is now signed.
      expect(screen.getAllByText('pending').length).toBe(5);
    });
  });

  it('T6: RPC returns forbidden error → error message shown in modal', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'forbidden' } });

    const user = userEvent.setup();
    render(<BaaChainTable />);

    await waitFor(() => {
      expect(screen.getByText('Supabase')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Edit BAA status for Supabase' }));

    const dialog = screen.getByRole('dialog');
    const signedInput = within(dialog).getByLabelText('BAA Signed Date');
    const expiryInput = within(dialog).getByLabelText('BAA Expiry Date');

    fireEvent.change(signedInput, { target: { value: '2026-01-01' } });
    fireEvent.change(expiryInput, { target: { value: '2027-01-01' } });

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('forbidden');
    });

    // Modal should remain open after error.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
