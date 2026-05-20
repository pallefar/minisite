/**
 * Phase 34 Plan 34-07 (ONBOARD-13) — FirstActionSurface 3-card hybrid UI.
 *
 * Covers: goal-driven card set, recommended visual emphasis, tap → fire +
 * dispatch CustomEvent, busy state, mobile grid, tap-target sizing,
 * accessibility landmark, DOM order.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Hoisted mock for fireActivation ────────────────────────────────────────
const { mockFireActivation } = vi.hoisted(() => ({
  mockFireActivation: vi.fn(),
}));

vi.mock('@/lib/onboarding/activation-hooks', () => ({
  fireActivation: mockFireActivation,
}));

import FirstActionSurface from './FirstActionSurface';

// ── Helpers ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFireActivation.mockReset();
  mockFireActivation.mockResolvedValue({ activated: true });
});

// ───────────────────────────────────────────────────────────────────────────

describe('FirstActionSurface: card rendering', () => {
  it('renders 3 cards for lose-weight; first card has "Recommended for your goal" badge', () => {
    render(<FirstActionSurface goal="lose-weight" />);
    expect(screen.getByText(/Recommended for your goal/i)).toBeInTheDocument();
    // recommended action label appears
    expect(screen.getByText(/Log your first weight/i)).toBeInTheDocument();
    // and the 2 fallback labels
    expect(screen.getByText(/Log your first injection/i)).toBeInTheDocument();
    expect(screen.getByText(/Log your first workout/i)).toBeInTheDocument();
  });

  it('family-supporter renders waitlist card as recommended', () => {
    render(<FirstActionSurface goal="family-supporter" />);
    expect(screen.getByText(/Join the waitlist/i)).toBeInTheDocument();
    // and the waitlist card carries the recommended badge
    expect(screen.getByText(/Recommended for your goal/i)).toBeInTheDocument();
  });

  it('region landmark + aria-label present', () => {
    render(<FirstActionSurface goal="lose-weight" />);
    expect(
      screen.getByRole('region', { name: /Choose your first action/i }),
    ).toBeInTheDocument();
  });

  it('recommended card is first in DOM order', () => {
    const { container } = render(<FirstActionSurface goal="build-muscle" />);
    const buttons = container.querySelectorAll('button');
    // First button should be the recommended one — build-muscle → first_workout_log
    expect(buttons[0].getAttribute('aria-label') ?? buttons[0].textContent ?? '').toMatch(
      /workout|Recommended/i,
    );
  });
});

describe('FirstActionSurface: tap handlers', () => {
  it('tapping recommended fires activation with correct goal_type + action_type', async () => {
    render(<FirstActionSurface goal="lose-weight" />);
    const startBtn = screen.getByRole('button', { name: /Recommended:.*Log your first weight/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });
    expect(mockFireActivation).toHaveBeenCalledTimes(1);
    expect(mockFireActivation).toHaveBeenCalledWith({
      goal_type: 'lose-weight',
      action_type: 'first_weight_log',
    });
  });

  it('tapping a fallback card fires activation with that fallback action_type', async () => {
    render(<FirstActionSurface goal="lose-weight" />);
    // workout-log is one of the 2 fallbacks for lose-weight
    const fallbackBtn = screen.getByRole('button', { name: /^Log your first workout/i });
    await act(async () => {
      fireEvent.click(fallbackBtn);
    });
    expect(mockFireActivation).toHaveBeenCalledWith({
      goal_type: 'lose-weight',
      action_type: 'first_workout_log',
    });
  });

  it('successful tap dispatches CustomEvent leanshot:open-surface with surface detail', async () => {
    const handler = vi.fn();
    window.addEventListener('leanshot:open-surface', handler as EventListener);
    try {
      render(<FirstActionSurface goal="lose-weight" />);
      const btn = screen.getByRole('button', {
        name: /Recommended:.*Log your first weight/i,
      });
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(handler).toHaveBeenCalledTimes(1);
      const ev = handler.mock.calls[0][0] as CustomEvent;
      expect(ev.detail).toEqual({ surface: 'modal:weight-log' });
    } finally {
      window.removeEventListener('leanshot:open-surface', handler as EventListener);
    }
  });
});

describe('FirstActionSurface: a11y / layout', () => {
  it('all action buttons meet the 44px tap-target minimum', () => {
    const { container } = render(<FirstActionSurface goal="lose-weight" />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    buttons.forEach((b) => {
      expect(b.className).toMatch(/min-h-\[44px\]/);
    });
  });

  it('uses a mobile-stacked / desktop-3col responsive grid', () => {
    const { container } = render(<FirstActionSurface goal="lose-weight" />);
    const region = container.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    // base (mobile) stacking + sm:grid-cols-3 at the responsive breakpoint
    expect(region!.className).toContain('sm:grid-cols-3');
    expect(region!.className).toMatch(/space-y-3|gap-3|sm:grid|grid/);
  });

  it('button loading prop is true while fireActivation is in-flight', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    mockFireActivation.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    const { container } = render(<FirstActionSurface goal="lose-weight" />);
    const btn = screen.getByRole('button', {
      name: /Recommended:.*Log your first weight/i,
    });
    await act(async () => {
      fireEvent.click(btn);
    });
    // While inflight, the Button primitive sets aria-busy="true" via the
    // `loading` prop (see Button.tsx:81).
    const busyBtn = container.querySelector('button[aria-busy="true"]');
    expect(busyBtn).toBeTruthy();
    await act(async () => {
      resolveFn({ activated: true });
    });
  });
});
