/**
 * Phase 39 Plan 39-07 Task 1 — ShipWinnerConfirmModal typed-confirm tests (D-12).
 *
 * Contract:
 *   - Confirm button disabled until BOTH:
 *     (a) input string === "ship-below-95" (exact match — no whitespace tolerance)
 *     (b) reason.trim().length > 0
 *   - Confirm action invokes onConfirm(reason)
 *   - input has aria-describedby pointing to the explanatory body
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipWinnerConfirmModal } from './ShipWinnerConfirmModal';

describe('ShipWinnerConfirmModal (D-12)', () => {
  const baseProps = {
    open: true,
    variantId: 'v1',
    variantName: 'Variant A',
    posterior: 0.82,
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open=true', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    expect(screen.getByText('Ship variant below 95% confidence?')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    render(<ShipWinnerConfirmModal {...baseProps} open={false} />);
    expect(screen.queryByText('Ship variant below 95% confidence?')).not.toBeInTheDocument();
  });

  it('Confirm button disabled initially', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const confirm = screen.getByRole('button', { name: 'Ship variant' });
    expect(confirm).toBeDisabled();
  });

  it('typing "ship-below-95" alone does NOT enable confirm (reason empty)', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const input = screen.getByPlaceholderText('ship-below-95');
    fireEvent.change(input, { target: { value: 'ship-below-95' } });
    const confirm = screen.getByRole('button', { name: 'Ship variant' });
    expect(confirm).toBeDisabled();
  });

  it('filling reason alone does NOT enable confirm (wrong typed)', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const reason = screen.getByLabelText(/Reason/);
    fireEvent.change(reason, { target: { value: 'data is good enough' } });
    const confirm = screen.getByRole('button', { name: 'Ship variant' });
    expect(confirm).toBeDisabled();
  });

  it('BOTH typed exact + non-empty reason → confirm enabled', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const input = screen.getByPlaceholderText('ship-below-95');
    const reason = screen.getByLabelText(/Reason/);
    fireEvent.change(input, { target: { value: 'ship-below-95' } });
    fireEvent.change(reason, { target: { value: 'segment data validates it' } });
    const confirm = screen.getByRole('button', { name: 'Ship variant' });
    expect(confirm).not.toBeDisabled();
  });

  it('clicking confirm calls onConfirm(reason)', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const input = screen.getByPlaceholderText('ship-below-95');
    const reason = screen.getByLabelText(/Reason/);
    fireEvent.change(input, { target: { value: 'ship-below-95' } });
    fireEvent.change(reason, { target: { value: 'segment data validates it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ship variant' }));
    expect(baseProps.onConfirm).toHaveBeenCalledWith('segment data validates it');
  });

  it('typing "ship below 95" (spaces) does NOT enable confirm — exact match contract', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const input = screen.getByPlaceholderText('ship-below-95');
    const reason = screen.getByLabelText(/Reason/);
    fireEvent.change(input, { target: { value: 'ship below 95' } });
    fireEvent.change(reason, { target: { value: 'reason given' } });
    const confirm = screen.getByRole('button', { name: 'Ship variant' });
    expect(confirm).toBeDisabled();
  });

  it('whitespace-only reason does NOT enable confirm (trim contract)', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const input = screen.getByPlaceholderText('ship-below-95');
    const reason = screen.getByLabelText(/Reason/);
    fireEvent.change(input, { target: { value: 'ship-below-95' } });
    fireEvent.change(reason, { target: { value: '   ' } });
    const confirm = screen.getByRole('button', { name: 'Ship variant' });
    expect(confirm).toBeDisabled();
  });

  it('typed input has aria-describedby pointing to explanatory body', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    const input = screen.getByPlaceholderText('ship-below-95');
    const describedById = input.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)).toBeInTheDocument();
  });

  it('Cancel button calls onClose', () => {
    render(<ShipWinnerConfirmModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
