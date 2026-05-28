/**
 * Phase 34 Plan 34-06 (ONBOARD-12) — social-proof component tests.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSignupCounter, SOCIAL_PROOF_OPTOUT_KEY } from './LiveSignupCounter';
import { TestimonialRotator } from './TestimonialRotator';

// ──────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────

const rpcMock = vi.fn(async () => ({ data: 42 as number | null, error: null as unknown }));
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (name: string) => rpcMock(name as never) },
}));

let reducedMotionState = false;
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => reducedMotionState,
}));

// ──────────────────────────────────────────────────────────────────────────
// Test scaffolding
// ──────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockImplementation(async () => ({ data: 42, error: null }));
  reducedMotionState = false;
  try {
    localStorage.removeItem(SOCIAL_PROOF_OPTOUT_KEY);
  } catch {
    /* noop */
  }
  // Default to 'visible' tab.
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ──────────────────────────────────────────────────────────────────────────
// LiveSignupCounter
// ──────────────────────────────────────────────────────────────────────────

describe('LiveSignupCounter', () => {
  it('T1: renders "{N} people joined this week" after RPC resolves', async () => {
    render(<LiveSignupCounter />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('get_rolling_signup_count'));
    await waitFor(() => expect(screen.getByText(/42 people joined this week/)).toBeTruthy());
  });

  it('T2: setInterval fires after 30s → rpc called twice', async () => {
    vi.useFakeTimers();
    render(<LiveSignupCounter />);
    // Initial tick fires under the microtask queue
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('T3: opt-out flag set → renders null', () => {
    localStorage.setItem(SOCIAL_PROOF_OPTOUT_KEY, 'true');
    const { container } = render(<LiveSignupCounter />);
    expect(container.firstChild).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('T7: document.visibilityState === "hidden" → no rpc call when interval fires', async () => {
    vi.useFakeTimers();
    render(<LiveSignupCounter />);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcMock).toHaveBeenCalledTimes(1); // initial tick still fires
    // Hide tab
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    // No additional call while hidden
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// TestimonialRotator
// ──────────────────────────────────────────────────────────────────────────

describe('TestimonialRotator', () => {
  it('T4: reduced-motion off → idx advances after 30s', async () => {
    vi.useFakeTimers();
    render(<TestimonialRotator />);
    const first = screen.getByRole('figure').textContent;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const after = screen.getByRole('figure').textContent;
    expect(first).not.toBe(after);
  });

  it('T5: reduced-motion on → idx stays at 0 after 60s', async () => {
    reducedMotionState = true;
    vi.useFakeTimers();
    render(<TestimonialRotator />);
    const first = screen.getByRole('figure').textContent;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole('figure').textContent).toBe(first);
  });

  it('T6: opt-out flag set → renders null', () => {
    localStorage.setItem(SOCIAL_PROOF_OPTOUT_KEY, 'true');
    const { container } = render(<TestimonialRotator />);
    expect(container.firstChild).toBeNull();
  });
});
