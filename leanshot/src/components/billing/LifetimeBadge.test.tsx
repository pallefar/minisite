/**
 * Phase 43 Plan 05 — LifetimeBadge component tests (MEMBER-01 D-01).
 *
 * Four behavior gates:
 *   T1 — tier_label='lifetime' → renders LIFETIME pill.
 *   T2 — tier_label='pro' → renders nothing (returns null).
 *   T3 — userId=null → renders nothing immediately, no fetch.
 *   T4 — loading state initially → renders nothing (no flash of LIFETIME).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockTierLabel: string | null = null;
let maybeSingleCallCount = 0;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => {
        maybeSingleCallCount += 1;
        return {
          data: mockTierLabel !== null ? { tier_label: mockTierLabel } : null,
          error: null,
        };
      }),
    })),
  },
}));

beforeEach(() => {
  mockTierLabel = null;
  maybeSingleCallCount = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LifetimeBadge', () => {
  it('T1: tier_label=lifetime → renders LIFETIME pill', async () => {
    mockTierLabel = 'lifetime';
    const { LifetimeBadge } = await import('./LifetimeBadge');
    render(<LifetimeBadge userId="user-A" />);
    await waitFor(() => {
      expect(screen.getByText('LIFETIME')).toBeTruthy();
    });
    expect(screen.getByLabelText(/lifetime member/i)).toBeTruthy();
  });

  it('T2: tier_label=pro → renders nothing', async () => {
    mockTierLabel = 'pro';
    const { LifetimeBadge } = await import('./LifetimeBadge');
    const { container } = render(<LifetimeBadge userId="user-B" />);
    // Wait long enough for the effect to run and resolve.
    await waitFor(() => expect(maybeSingleCallCount).toBe(1));
    expect(screen.queryByText('LIFETIME')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('T3: userId=null → renders nothing immediately, no fetch', async () => {
    const { LifetimeBadge } = await import('./LifetimeBadge');
    const { container } = render(<LifetimeBadge userId={null} />);
    expect(screen.queryByText('LIFETIME')).toBeNull();
    expect(container.textContent).toBe('');
    // No fetch should have happened.
    expect(maybeSingleCallCount).toBe(0);
  });

  it('T4: loading state initially renders nothing (no flash of LIFETIME)', async () => {
    mockTierLabel = 'lifetime';
    const { LifetimeBadge } = await import('./LifetimeBadge');
    const { container } = render(<LifetimeBadge userId="user-C" />);
    // Synchronously before effect resolves — nothing should be rendered yet.
    expect(screen.queryByText('LIFETIME')).toBeNull();
    expect(container.textContent).toBe('');
    // After resolution, the pill appears.
    await waitFor(() => {
      expect(screen.getByText('LIFETIME')).toBeTruthy();
    });
  });
});
