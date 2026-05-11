import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DisclaimerBody, DisclaimerModal } from './DisclaimerModal';

describe('DisclaimerModal', () => {
  it('renders required copy floor (D-12)', () => {
    render(<DisclaimerModal open onAcknowledge={() => {}} />);
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
    expect(screen.getByText(/your data stays on this device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i understand/i })).toBeInTheDocument();
  });

  it('calls onAcknowledge when "I understand" clicked', async () => {
    const onAcknowledge = vi.fn();
    const user = userEvent.setup();
    render(<DisclaimerModal open onAcknowledge={onAcknowledge} />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onAcknowledge on Escape (D-09 — no decline path)', async () => {
    const onAcknowledge = vi.fn();
    const user = userEvent.setup();
    render(<DisclaimerModal open onAcknowledge={onAcknowledge} />);
    await user.keyboard('{Escape}');
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('does NOT render a close (X) button (D-09)', () => {
    render(<DisclaimerModal open onAcknowledge={() => {}} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });
});

describe('DisclaimerBody', () => {
  it('renders the same copy without Modal chrome', () => {
    render(<DisclaimerBody onAcknowledge={() => {}} />);
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i understand/i })).toBeInTheDocument();
  });
});
