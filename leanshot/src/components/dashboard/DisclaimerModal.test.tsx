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

  it('renders at top-layer z-index so it stacks above GuidedTour (z-[150])', () => {
    // Regression for the Phase 2 UAT bug: D-11 fallback was visible but unclickable
    // because GuidedTour's z-[150] overlay intercepted pointer events. The fix
    // is `topLayer` on Modal (sets z-[160]). Stacking is hard to assert visually
    // in jsdom, so we assert the className contract instead.
    render(<DisclaimerModal open onAcknowledge={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/z-\[160\]/);
    expect(dialog.className).not.toMatch(/z-\[100\]/);
  });
});

describe('DisclaimerBody', () => {
  it('renders the same copy without Modal chrome', () => {
    render(<DisclaimerBody onAcknowledge={() => {}} />);
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i understand/i })).toBeInTheDocument();
  });
});
