/**
 * Phase 22 plan 22-09 — ImpersonationBanner tests (ADMIN-03).
 *
 * Behaviors (per 22-09-PLAN.md task 2 + 22-UI-SPEC.md §284-297 + §552-560):
 *   1. returns null when useImpersonation().active === false
 *   2. renders sticky/red/h-12 container with body text + End CTA
 *   3. body text matches `Impersonating {email} · Read-only · {N}m {S}s remaining`
 *   4. End-impersonation button onClick invokes useImpersonation().endImpersonation
 *   5. role="alert" + aria-live="assertive" on container; countdown span aria-live="off"
 *   6. countdown re-render with new secondsRemaining updates text
 *   7. pulse animation in last 60s; suppressed when useReducedMotion=true
 *   8. auto-end at 0 fires endImpersonation once + toast "Impersonation session expired."
 *   9. icon `lucide:UserCog` with aria-hidden
 */
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImpersonationBanner } from '@/components/impersonation/ImpersonationBanner';

const mockUseImpersonation = vi.fn();
const mockUseReducedMotion = vi.fn(() => false);
const mockShowToast = vi.fn();

vi.mock('@/components/impersonation/useImpersonation', () => ({
  useImpersonation: () => mockUseImpersonation(),
}));
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockShowToast,
}));

describe('ImpersonationBanner (Phase 22 ADMIN-03 / plan 22-09)', () => {
  beforeEach(() => {
    mockUseImpersonation.mockReset();
    mockUseReducedMotion.mockReset();
    mockUseReducedMotion.mockReturnValue(false);
    mockShowToast.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function activeState(overrides: {
    secondsRemaining?: number;
    targetEmail?: string;
    endImpersonation?: () => Promise<void>;
  } = {}) {
    return {
      active: true,
      impersonatorId: '11111111-1111-4111-8111-111111111111',
      targetEmail: overrides.targetEmail ?? 'patient@example.com',
      targetUserId: '22222222-2222-4222-8222-222222222222',
      secondsRemaining: overrides.secondsRemaining ?? 1800,
      endImpersonation: overrides.endImpersonation ?? vi.fn().mockResolvedValue(undefined),
    };
  }

  it('returns null when useImpersonation().active === false', () => {
    mockUseImpersonation.mockReturnValue({
      active: false,
      impersonatorId: null,
      targetEmail: null,
      targetUserId: null,
      secondsRemaining: 0,
      endImpersonation: vi.fn(),
    });
    const { container } = render(<ImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders sticky top-0 z-[60] bg-[var(--color-danger)] h-12 container with role="alert" + aria-live="assertive"', () => {
    mockUseImpersonation.mockReturnValue(activeState());
    render(<ImpersonationBanner />);
    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'assertive');
    const cls = banner.className;
    expect(cls).toMatch(/sticky/);
    expect(cls).toMatch(/top-0/);
    expect(cls).toMatch(/z-\[60\]/);
    expect(cls).toMatch(/bg-\[var\(--color-danger\)\]/);
    expect(cls).toMatch(/text-white/);
    expect(cls).toMatch(/h-12/);
  });

  it('body text matches "Impersonating {email} · Read-only · {N}m {S}s remaining"', () => {
    mockUseImpersonation.mockReturnValue(
      activeState({ targetEmail: 'jane@example.com', secondsRemaining: 1800 }),
    );
    render(<ImpersonationBanner />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('Impersonating');
    expect(banner.textContent).toContain('jane@example.com');
    expect(banner.textContent).toContain('Read-only');
    expect(banner.textContent).toContain('30m 0s');
    expect(banner.textContent).toContain('remaining');
  });

  it('End-impersonation button labeled "End impersonation" + onClick invokes useImpersonation().endImpersonation', async () => {
    const endFn = vi.fn().mockResolvedValue(undefined);
    mockUseImpersonation.mockReturnValue(activeState({ endImpersonation: endFn }));
    render(<ImpersonationBanner />);
    const btn = screen.getByRole('button', { name: /end impersonation/i });
    expect(btn).toBeInTheDocument();
    await act(async () => {
      btn.click();
    });
    expect(endFn).toHaveBeenCalledTimes(1);
  });

  it('countdown span has aria-live="off" (don\'t announce every tick)', () => {
    mockUseImpersonation.mockReturnValue(activeState());
    render(<ImpersonationBanner />);
    const countdown = screen.getByTestId('impersonation-countdown');
    expect(countdown).toHaveAttribute('aria-live', 'off');
  });

  it('countdown text reflects current secondsRemaining; re-render with new value updates text', () => {
    mockUseImpersonation.mockReturnValue(activeState({ secondsRemaining: 75 }));
    const { rerender } = render(<ImpersonationBanner />);
    expect(screen.getByTestId('impersonation-countdown').textContent).toBe('1m 15s');

    mockUseImpersonation.mockReturnValue(activeState({ secondsRemaining: 30 }));
    rerender(<ImpersonationBanner />);
    expect(screen.getByTestId('impersonation-countdown').textContent).toBe('0m 30s');
  });

  it('pulse class added when secondsRemaining < 60 and reducedMotion=false', () => {
    mockUseReducedMotion.mockReturnValue(false);
    mockUseImpersonation.mockReturnValue(activeState({ secondsRemaining: 45 }));
    render(<ImpersonationBanner />);
    const countdown = screen.getByTestId('impersonation-countdown');
    expect(countdown.className).toMatch(/animate-pulse/);
  });

  it('pulse class SUPPRESSED when useReducedMotion=true even if secondsRemaining < 60', () => {
    mockUseReducedMotion.mockReturnValue(true);
    mockUseImpersonation.mockReturnValue(activeState({ secondsRemaining: 45 }));
    render(<ImpersonationBanner />);
    const countdown = screen.getByTestId('impersonation-countdown');
    expect(countdown.className).not.toMatch(/animate-pulse/);
  });

  it('auto-expire at 0 fires endImpersonation + shows toast "Impersonation session expired."', async () => {
    const endFn = vi.fn().mockResolvedValue(undefined);
    // Start with 1s — auto-expire effect should NOT fire yet.
    mockUseImpersonation.mockReturnValue(
      activeState({ secondsRemaining: 1, endImpersonation: endFn }),
    );
    const { rerender } = render(<ImpersonationBanner />);
    expect(endFn).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();

    // Transition to 0 — effect fires once.
    mockUseImpersonation.mockReturnValue(
      activeState({ secondsRemaining: 0, endImpersonation: endFn }),
    );
    await act(async () => {
      rerender(<ImpersonationBanner />);
    });
    expect(endFn).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('Impersonation session expired.', 'info');
  });

  it('icon lucide:UserCog rendered with aria-hidden', () => {
    mockUseImpersonation.mockReturnValue(activeState());
    render(<ImpersonationBanner />);
    const icon = screen.getByTestId('impersonation-icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
