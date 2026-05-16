/**
 * Phase 22 plan 22-07 — RefundModal (ADMIN-04) RTL coverage.
 *
 * Tests the 3-step gated refund flow:
 *   T1: Step 1 (Pick charge) — renders "Step 1 of 3", charge selector, Continue disabled
 *       until selection.
 *   T2: Step 2 (Amount) — renders amount input, Pill quick-fill (Full/Half/Custom), Continue
 *       disabled if amount empty or > charge.amount.
 *   T3: Step 3 (Confirm) — renders typed-confirm "REFUND $X.XX" gate; Submit enabled only on
 *       exact match.
 *   T4: Submit success — invokes admin-stripe-action Edge Fn; modal closes; toast success.
 *   T5: Stripe error — renders inline error per UI-SPEC line 680.
 *   T6: Back button on step 2 preserves charge selection.
 *   T7: CancelSubModal smoke — confirm copy + invoke cancel operation.
 *   T8: CompSubModal smoke — Pill quick-fill renders + invoke comp operation with comp_days.
 *   T9: typedConfirmMatches helper — exact-match, case-sensitive.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelSubModal } from '@/components/admin/members/CancelSubModal';
import { CompSubModal } from '@/components/admin/members/CompSubModal';
import { RefundModal } from '@/components/admin/members/RefundModal';
import { typedConfirmMatchesRefund } from '@/lib/admin/admin-stripe-actions';

// --- Mock the Edge Function invoke layer --------------------------------------------------
const mockInvoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

// --- Mock the toast hook (avoid pulling store) --------------------------------------------
const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

beforeEach(() => {
  mockInvoke.mockReset();
  mockToast.mockReset();
});

const CHARGES = [
  {
    id: 'ch_recent',
    amount: 4900,
    created: 1715000000,
    descriptor: 'LeanShot Monthly',
  },
  {
    id: 'ch_older',
    amount: 4900,
    created: 1712000000,
    descriptor: 'LeanShot Monthly',
  },
];

const SAMPLE_PROPS = {
  isOpen: true,
  charges: CHARGES,
  targetUserId: '11111111-1111-4111-8111-111111111111',
  targetUserEmail: 'user@example.com',
};

describe('RefundModal (Phase 22 ADMIN-04)', () => {
  it('T1: step 1 — renders "Step 1 of 3" heading + charge selector; Continue disabled until selection', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <RefundModal {...SAMPLE_PROPS} onClose={onClose} onSuccess={onSuccess} />,
    );

    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
    const continueBtn = screen.getByRole('button', { name: /Continue/i });
    expect(continueBtn).toBeDisabled();
    // Selecting a charge enables Continue.
    const select = screen.getByLabelText(/Pick a charge/i);
    await userEvent.selectOptions(select, 'ch_recent');
    expect(continueBtn).not.toBeDisabled();
  });

  it('T2: step 2 — renders amount + Pill (Full/Half/Custom); Continue disabled when amount > charge.amount', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <RefundModal {...SAMPLE_PROPS} onClose={onClose} onSuccess={onSuccess} />,
    );
    const select = screen.getByLabelText(/Pick a charge/i);
    await userEvent.selectOptions(select, 'ch_recent');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
    // Pill quick-fill
    expect(screen.getByRole('button', { name: /^Full$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Half$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Custom$/i })).toBeInTheDocument();

    const amountInput = screen.getByLabelText(/Refund amount \(USD\)/i) as HTMLInputElement;
    // Above max disables Continue.
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '500');
    const continueBtn = screen.getByRole('button', { name: /Continue/i });
    expect(continueBtn).toBeDisabled();
    // Within range enables.
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '25');
    expect(continueBtn).not.toBeDisabled();
  });

  it('T3: step 3 — typed-confirm "REFUND $25.00" enables Submit only on exact match', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <RefundModal {...SAMPLE_PROPS} onClose={onClose} onSuccess={onSuccess} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/Pick a charge/i), 'ch_recent');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));
    const amountInput = screen.getByLabelText(/Refund amount \(USD\)/i);
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '25');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /^Issue refund$/i });
    expect(submitBtn).toBeDisabled();

    const typedInput = screen.getByLabelText(/Type REFUND \$25\.00/i);
    await userEvent.type(typedInput, 'refund $25.00'); // wrong case
    expect(submitBtn).toBeDisabled();
    await userEvent.clear(typedInput);
    await userEvent.type(typedInput, 'REFUND $25.00');
    expect(submitBtn).not.toBeDisabled();
  });

  it('T4: Submit invokes admin-stripe-action and closes modal on success', async () => {
    mockInvoke.mockResolvedValue({ data: { refund_id: 're_123', amount_refunded: 2500 }, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <RefundModal {...SAMPLE_PROPS} onClose={onClose} onSuccess={onSuccess} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/Pick a charge/i), 'ch_recent');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await userEvent.clear(screen.getByLabelText(/Refund amount \(USD\)/i));
    await userEvent.type(screen.getByLabelText(/Refund amount \(USD\)/i), '25');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await userEvent.type(screen.getByLabelText(/Type REFUND \$25\.00/i), 'REFUND $25.00');
    await userEvent.click(screen.getByRole('button', { name: /^Issue refund$/i }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    const [fnName, options] = mockInvoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fnName).toBe('admin-stripe-action');
    expect(options.body).toMatchObject({
      operation: 'refund',
      target_user_id: SAMPLE_PROPS.targetUserId,
      charge_id: 'ch_recent',
      amount_cents: 2500,
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('re_123'));
    expect(onClose).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining('Refund of $25.00 issued to user@example.com'),
      'success',
    );
  });

  it('T5: Stripe error renders inline error per UI-SPEC line 680', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'stripe error', context: { body: '{"error":"stripe_charge_already_refunded"}' } } });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <RefundModal {...SAMPLE_PROPS} onClose={onClose} onSuccess={onSuccess} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/Pick a charge/i), 'ch_recent');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await userEvent.clear(screen.getByLabelText(/Refund amount \(USD\)/i));
    await userEvent.type(screen.getByLabelText(/Refund amount \(USD\)/i), '25');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await userEvent.type(screen.getByLabelText(/Type REFUND \$25\.00/i), 'REFUND $25.00');
    await userEvent.click(screen.getByRole('button', { name: /^Issue refund$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Stripe rejected the refund/i),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('T6: Back on step 2 returns to step 1 with selection preserved', async () => {
    render(
      <RefundModal {...SAMPLE_PROPS} onClose={() => {}} onSuccess={() => {}} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/Pick a charge/i), 'ch_recent');
    await userEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Back$/i }));
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
    const select = screen.getByLabelText(/Pick a charge/i) as HTMLSelectElement;
    expect(select.value).toBe('ch_recent');
  });

  it('T7: typedConfirmMatchesRefund helper — exact-match case-sensitive', () => {
    expect(typedConfirmMatchesRefund('REFUND $25.00', 2500)).toBe(true);
    expect(typedConfirmMatchesRefund('refund $25.00', 2500)).toBe(false);
    expect(typedConfirmMatchesRefund('REFUND $25', 2500)).toBe(false);
    expect(typedConfirmMatchesRefund('', 2500)).toBe(false);
  });
});

describe('CancelSubModal (Phase 22 ADMIN-04)', () => {
  it('renders confirm copy + invokes cancel operation on confirm', async () => {
    mockInvoke.mockResolvedValue({ data: { subscription_id: 'sub_42' }, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <CancelSubModal
        isOpen
        targetUserId="11111111-1111-4111-8111-111111111111"
        targetUserEmail="user@example.com"
        subscriptionId="sub_42"
        periodEnd="2026-06-15"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    expect(
      screen.getByText(
        /Cancel user@example\.com's subscription\? They'll keep access until/i,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Cancel subscription/i }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    const [fnName, options] = mockInvoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fnName).toBe('admin-stripe-action');
    expect(options.body).toMatchObject({ operation: 'cancel', subscription_id: 'sub_42' });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});

describe('CompSubModal (Phase 22 ADMIN-04)', () => {
  it('renders Pill quick-fill (1mo/3mo/6mo/Custom) + invokes comp with comp_days', async () => {
    mockInvoke.mockResolvedValue({ data: { subscription_id: 'sub_42' }, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <CompSubModal
        isOpen
        targetUserId="11111111-1111-4111-8111-111111111111"
        targetUserEmail="user@example.com"
        subscriptionId="sub_42"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    expect(screen.getByRole('button', { name: /1 month/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3 months/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /6 months/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Custom/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /3 months/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Grant comp$/i }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    const [, options] = mockInvoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toMatchObject({
      operation: 'comp',
      subscription_id: 'sub_42',
      comp_days: 90,
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});
