/**
 * Phase 65 Plan 65-09 — RefundRequestForm unit tests.
 *
 * 9 cases covering: eligibility fetch on mount, eligible / ineligible states,
 * reason textarea + character counter, confirmation modal verbatim UI-SPEC §3
 * copy, "Keep my subscription" secondary CTA, submit path, success state,
 * 409 already-processed error branch, 500 fallback.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRefundEligibility, requestRefund } from '@/lib/billing/refund-client';

vi.mock('@/lib/billing/refund-client', () => ({
  checkRefundEligibility: vi.fn(),
  requestRefund: vi.fn(),
}));

const mockEligibility = checkRefundEligibility as unknown as ReturnType<typeof vi.fn>;
const mockRequest = requestRefund as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockEligibility.mockReset();
  mockRequest.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderForm(onClose: () => void = () => {}) {
  const { RefundRequestForm } = await import('./RefundRequestForm');
  return render(<RefundRequestForm onClose={onClose} />);
}

describe('RefundRequestForm', () => {
  it('case 1: fetches eligibility on mount', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    await renderForm();
    await waitFor(() => {
      expect(mockEligibility).toHaveBeenCalledTimes(1);
    });
  });

  it('case 2: eligible state shows eligibility message + reason textarea + primary CTA', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    await renderForm();
    await waitFor(() => {
      expect(screen.getByText(/Your subscription is eligible for refund/i)).toBeDefined();
    });
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByRole('button', { name: /Request refund/i })).toBeDefined();
  });

  it('case 3: ineligible state shows friendly message + support email link', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: false,
      reason: 'window_expired',
    });
    await renderForm();
    await waitFor(() => {
      const link = screen.getByRole('link', {
        name: /billing-support@leanshot\.app/i,
      });
      expect(link.getAttribute('href')).toBe('mailto:billing-support@leanshot.app');
    });
  });

  it('case 4: character counter updates as user types', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    await renderForm();
    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Cancelled by mistake' } });
    expect(screen.getByText(/20\s*\/\s*2000/)).toBeDefined();
  });

  it('case 5: primary CTA opens confirmation modal with verbatim UI-SPEC §3 copy', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    await renderForm();
    const submitBtn = await screen.findByRole('button', { name: /Request refund/i });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(
        screen.getByText(
          /Request a refund\? Your subscription will be cancelled immediately and a credit will be issued to your original payment method within 5-10 business days\./,
        ),
      ).toBeDefined();
    });
  });

  it('case 6: confirmation modal cancel CTA reads "Keep my subscription" (not generic Cancel)', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    await renderForm();
    const submitBtn = await screen.findByRole('button', { name: /Request refund/i });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      const keepButtons = screen.getAllByRole('button', {
        name: /Keep my subscription/i,
      });
      // Both the form's secondary CTA and the modal's cancel CTA read this.
      expect(keepButtons.length).toBeGreaterThanOrEqual(1);
    });
    // And there is NO generic "Cancel" button
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).toBeNull();
  });

  it('case 7: confirm-submit path posts then shows success state with formatted amount', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    mockRequest.mockResolvedValueOnce({
      ok: true,
      refund_id: 're_test',
      amount_cents: 1999,
      status: 'succeeded',
    });
    await renderForm();
    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Cancelled by mistake' } });
    fireEvent.click(screen.getByRole('button', { name: /Request refund/i }));
    // Confirm modal opens, click the confirm button (the inner "Request refund" in the modal footer)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Request refund/i }).length).toBeGreaterThan(1);
    });
    const buttons = screen.getAllByRole('button', { name: /Request refund/i });
    // The last "Request refund" button is the modal confirm.
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith('Cancelled by mistake');
      expect(screen.getByText(/Your refund of \$19\.99 has been processed/i)).toBeDefined();
      expect(screen.getByText(/Allow 5-10 business days for funds to appear/i)).toBeDefined();
    });
  });

  it('case 8: 409 already-processed shows informative message', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    mockRequest.mockResolvedValueOnce({
      ok: false,
      error: 'refund_already_processed',
    });
    await renderForm();
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request refund/i }));
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /Request refund/i });
      fireEvent.click(buttons[buttons.length - 1]);
    });
    await waitFor(() => {
      expect(screen.getByText(/Already refunded/i)).toBeDefined();
    });
  });

  it('case 9: 500 generic failure shows support email fallback', async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
    mockRequest.mockResolvedValueOnce({
      ok: false,
      error: 'refund_failed',
    });
    await renderForm();
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request refund/i }));
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /Request refund/i });
      fireEvent.click(buttons[buttons.length - 1]);
    });
    await waitFor(() => {
      const link = screen.getByRole('link', {
        name: /billing-support@leanshot\.app/i,
      });
      expect(link).toBeDefined();
    });
  });
});
