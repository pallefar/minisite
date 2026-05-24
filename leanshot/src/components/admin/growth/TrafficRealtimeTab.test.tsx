/**
 * Phase 51 Plan 51-09 (TRAFFIC-12) — TrafficRealtimeTab unit tests.
 *
 * T1: Mounts + fires initial fetch; renders total visits + top 5 channels.
 * T2: setInterval poll triggers a second fetch after 5 minutes (fake timers).
 * T3: Stale pip transitions to 'stale' once age ≥10 minutes (30s tick).
 */
import { render, screen, act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock supabase ────────────────────────────────────────────────────────────

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// ─── Mock useStore — admin role by default ───────────────────────────────────

let storeShape: { signedIn: null | { user: { app_metadata?: Record<string, unknown> } } } = {
  signedIn: { user: { app_metadata: { role: 'admin' } } },
};

vi.mock('@/lib/store', () => ({
  useStore: <T,>(selector: (s: typeof storeShape) => T): T => selector(storeShape),
}));

const sampleRows = [
  { channel_group: 'Paid Search', audience: 'consumer', visits: 120, signups: 14, activations: 5, paids: 1 },
  { channel_group: 'Organic Search', audience: 'consumer', visits: 80, signups: 9, activations: 3, paids: 0 },
  { channel_group: 'Direct', audience: 'consumer', visits: 60, signups: 6, activations: 2, paids: 0 },
  { channel_group: 'Email', audience: 'consumer', visits: 40, signups: 4, activations: 1, paids: 0 },
  { channel_group: 'Affiliate', audience: 'consumer', visits: 20, signups: 2, activations: 0, paids: 0 },
  { channel_group: 'Referral', audience: 'consumer', visits: 5, signups: 0, activations: 0, paids: 0 },
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  rpcMock.mockReset();
  storeShape = { signedIn: { user: { app_metadata: { role: 'admin' } } } };
  // Ensure document is "visible" by default for visibility-pause logic.
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TrafficRealtimeTab', () => {
  it('T1: mounts + fires initial fetch; renders total visits + top 5 channels', async () => {
    rpcMock.mockResolvedValue({ data: sampleRows, error: null });

    const { TrafficRealtimeTab } = await import('./TrafficRealtimeTab');
    render(<TrafficRealtimeTab />);

    // Flush microtasks so the initial useEffect fetch + setState resolves.
    // Multiple flushes because: render → effect → rpc promise → setState.
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(rpcMock).toHaveBeenCalledWith('get_realtime_traffic_summary', {
      p_minutes: 60,
      p_org_id: null,
    });

    // Sum of visits across all 6 rows = 325.
    expect(screen.getByTestId('realtime-total-visits')).toHaveTextContent('325');

    // Top 5 channels rendered (Direct, Email, Affiliate, Organic Search, Paid Search).
    expect(screen.getByText('Top 5 Channels')).toBeInTheDocument();
    expect(screen.getByText('Paid Search')).toBeInTheDocument();
    expect(screen.getByText('Organic Search')).toBeInTheDocument();
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Affiliate')).toBeInTheDocument();
    // 6th row (Referral, 5 visits) must NOT appear — top 5 only.
    expect(screen.queryByText('Referral')).not.toBeInTheDocument();
  });

  it('T2: setInterval poll triggers a second fetch after 5 minutes', async () => {
    rpcMock.mockResolvedValue({ data: sampleRows, error: null });

    const { TrafficRealtimeTab } = await import('./TrafficRealtimeTab');
    render(<TrafficRealtimeTab />);

    // Initial fetch from mount.
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Advance 5 minutes — interval tick fires fetch #2.
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('T3: stale pip transitions to red once lastSuccessAt is >10 min old', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const { TrafficRealtimeTab } = await import('./TrafficRealtimeTab');
    render(<TrafficRealtimeTab />);

    // Initial fetch resolves → lastSuccessAt is set.
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // Hide the document so the 5-min visibility-aware tick skips fetching
    // and lastSuccessAt stays anchored to the mount moment.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    // Initially fresh (just fetched).
    expect(screen.getByTestId('realtime-pip')).toHaveAttribute(
      'data-freshness',
      'fresh',
    );

    // Advance 10m30s, draining the 30s freshness tick + any polling that
    // would have fired (but document is hidden so it doesn't).
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000 + 30 * 1000);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(screen.getByTestId('realtime-pip')).toHaveAttribute(
      'data-freshness',
      'stale',
    );

    // Sanity: Refresh now button is wired (no error thrown).
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
  });
});
