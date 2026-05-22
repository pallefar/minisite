/**
 * Phase 36 Plan 36-03 Task 2 — DetractorFeedbackModal (Surface C) tests.
 *
 * Coverage:
 *   - Renders textarea + Submit + Skip; submit disabled until value.trim() >= 10.
 *   - Inline hint visible when submit disabled, hidden when enabled.
 *   - Submit click → submitNpsFeedback called with trimmed value;
 *     aria-busy on the submit button while loading; textarea disabled.
 *   - Success view: Check icon + "Thanks — we'll be in touch" + auto-dismiss
 *     after 3000ms.
 *   - Submit rejection → error pill rendered ("Couldn't send...").
 *   - Skip → onDismiss invoked.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSubmit = vi.fn<(text: string) => Promise<{ ticket_id: string }>>();
vi.mock('@/lib/nps/decide-client', () => ({
  submitNpsFeedback: (text: string) => mockSubmit(text),
}));

import { DetractorFeedbackModal } from '../DetractorFeedbackModal';

describe('<DetractorFeedbackModal /> — Plan 36-03 Task 2', () => {
  beforeEach(() => {
    mockSubmit.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders title + body + textarea + Submit + Skip', () => {
    render(<DetractorFeedbackModal open onDismiss={vi.fn()} />);
    expect(screen.getByText(/What could we do better/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Tell us what's frustrating/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send feedback/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip/i })).toBeInTheDocument();
  });

  it('Submit disabled while value.trim().length < 10; hint visible when disabled', async () => {
    const user = userEvent.setup();
    render(<DetractorFeedbackModal open onDismiss={vi.fn()} />);
    const submit = screen.getByRole('button', { name: /Send feedback/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/At least a sentence helps/i)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Tell us what's/i), 'short');
    expect(submit).toBeDisabled();
    // Now type past 10 chars
    await user.type(
      screen.getByPlaceholderText(/Tell us what's/i),
      ' more text to pass the bar',
    );
    expect(submit).toBeEnabled();
    expect(screen.queryByText(/At least a sentence helps/i)).toBeNull();
  });

  it('Submit click → submitNpsFeedback(trimmedValue), aria-busy on submit, textarea disabled', async () => {
    const user = userEvent.setup();
    let resolve!: (v: { ticket_id: string }) => void;
    mockSubmit.mockImplementation(
      () =>
        new Promise<{ ticket_id: string }>((r) => {
          resolve = r;
        }),
    );
    render(<DetractorFeedbackModal open onDismiss={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/Tell us what's/i);
    await user.type(textarea, '   This is detailed feedback for the team   ');
    await user.click(screen.getByRole('button', { name: /Send feedback/i }));
    // aria-busy + textarea disabled while pending.
    const submit = screen.getByRole('button', { name: /Send feedback/i });
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(textarea).toBeDisabled();
    // Submit was called with TRIMMED value.
    expect(mockSubmit).toHaveBeenCalledWith('This is detailed feedback for the team');
    // Resolve to unstick the test.
    await act(async () => {
      resolve({ ticket_id: 't-1' });
    });
  });

  it('Success view renders Thanks message + auto-dismisses after 3000ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockSubmit.mockResolvedValue({ ticket_id: 't-OK' });
    const onDismiss = vi.fn();
    render(<DetractorFeedbackModal open onDismiss={onDismiss} />);
    await user.type(
      screen.getByPlaceholderText(/Tell us what's/i),
      'Detailed feedback exceeds ten chars',
    );
    await user.click(screen.getByRole('button', { name: /Send feedback/i }));
    await waitFor(() =>
      expect(screen.getByText(/Thanks — we'll be in touch/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/created a support ticket/i),
    ).toBeInTheDocument();
    // Auto-dismiss at 3000ms.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('Submit rejection → error pill rendered', async () => {
    const user = userEvent.setup();
    mockSubmit.mockRejectedValue(new Error('boom'));
    render(<DetractorFeedbackModal open onDismiss={vi.fn()} />);
    await user.type(
      screen.getByPlaceholderText(/Tell us what's/i),
      'Detailed feedback exceeds ten chars',
    );
    await user.click(screen.getByRole('button', { name: /Send feedback/i }));
    await waitFor(() =>
      expect(screen.getByText(/Couldn't send/i)).toBeInTheDocument(),
    );
  });

  it('Skip → onDismiss invoked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<DetractorFeedbackModal open onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: /Skip/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
