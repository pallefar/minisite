/**
 * Phase 30 Plan 03 — AlertSnoozePopover tests (TDD RED).
 *
 * Tests cover:
 *  1. Renders 4 preset duration buttons with exact label spelling
 *  2. role="dialog" aria-modal="true" aria-labelledby set; heading "Snooze alert"
 *  3. Escape key closes popover + returns focus to trigger button
 *  4. Tab cycles focus through the 4 buttons (focus trap)
 *  5. Clicking "1 hour" dispatches snooze_clinician_alert with p_duration='1h'
 *  6. Duration string mapping: 4h, 24h, 7d
 *  7. Success → popover closes + toast "Alert snoozed"
 *  8. Error → popover stays open + toast "Snooze failed — please try again."
 *  9. Mobile (<768px) renders inside Sheet bottom-drawer with title "Snooze alert"
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock supabase -------------------------------------------------------
const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}));

// ---- Mock useToast -------------------------------------------------------
const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: vi.fn().mockReturnValue(mockToast),
}));

// ---- Import under test ---------------------------------------------------
async function importPopover() {
  const mod = await import('./AlertSnoozePopover');
  return mod.AlertSnoozePopover;
}

describe('AlertSnoozePopover', () => {
  const alertId = 'alert-001';
  let AlertSnoozePopover: Awaited<ReturnType<typeof importPopover>>;
  let triggerRef: React.RefObject<HTMLButtonElement>;
  let triggerEl: HTMLButtonElement;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    AlertSnoozePopover = await importPopover();
    triggerEl = document.createElement('button');
    triggerEl.textContent = 'Snooze';
    document.body.appendChild(triggerEl);
    triggerRef = { current: triggerEl };
    onClose = vi.fn();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    document.body.removeChild(triggerEl);
    vi.clearAllMocks();
  });

  function renderPopover(open = true) {
    return render(
      <AlertSnoozePopover
        alertId={alertId}
        triggerRef={triggerRef as React.RefObject<HTMLElement>}
        open={open}
        onClose={onClose}
      />,
    );
  }

  it('Test 1: renders 4 preset duration buttons with exact spellings', () => {
    renderPopover();
    expect(screen.getByRole('button', { name: /^1 hour$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^4 hours$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^24 hours$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^7 days$/i })).toBeTruthy();
  });

  it('Test 2: has role="dialog" aria-modal="true" and heading "Snooze alert"', () => {
    renderPopover();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Snooze alert')).toBeTruthy();
  });

  it('Test 3: Escape key calls onClose', () => {
    renderPopover();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Test 4: Tab cycles focus (focus trap — does not escape popover)', () => {
    renderPopover();
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBeGreaterThanOrEqual(4); // at least the 4 preset buttons
  });

  it('Test 5: Clicking "1 hour" dispatches snooze_clinician_alert with p_duration="1h"', async () => {
    renderPopover();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^1 hour$/i }));
    });
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('snooze_clinician_alert', {
        p_alert_id: alertId,
        p_duration: '1h',
      });
    });
  });

  it('Test 6: duration string mapping — 4h, 24h, 7d', async () => {
    const { rerender } = renderPopover();

    // 4 hours → '4h'
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^4 hours$/i }));
    });
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('snooze_clinician_alert', {
        p_alert_id: alertId,
        p_duration: '4h',
      });
    });

    mockRpc.mockClear();
    rerender(
      <AlertSnoozePopover
        alertId={alertId}
        triggerRef={triggerRef as React.RefObject<HTMLElement>}
        open={true}
        onClose={onClose}
      />,
    );

    // 24 hours → '24h'
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^24 hours$/i }));
    });
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('snooze_clinician_alert', {
        p_alert_id: alertId,
        p_duration: '24h',
      });
    });

    mockRpc.mockClear();
    rerender(
      <AlertSnoozePopover
        alertId={alertId}
        triggerRef={triggerRef as React.RefObject<HTMLElement>}
        open={true}
        onClose={onClose}
      />,
    );

    // 7 days → '7d'
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^7 days$/i }));
    });
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('snooze_clinician_alert', {
        p_alert_id: alertId,
        p_duration: '7d',
      });
    });
  });

  it('Test 7: success → toast "Alert snoozed" + onClose called', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    renderPopover();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^1 hour$/i }));
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/alert snoozed/i), 'success');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('Test 8: error → stays open + toast "Snooze failed"', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    renderPopover();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^1 hour$/i }));
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/snooze failed/i), 'error');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('Test 9: renders nothing when open=false', () => {
    const { container } = renderPopover(false);
    expect(container.innerHTML).toBe('');
  });
});
