/**
 * Phase 51 Plan 51-05 (TRAFFIC-12) — TrafficDashboardPage shell unit tests.
 *
 * Covers behavior bullets from 51-05-PLAN Task 3:
 *   T1: renders page header with H1 "Traffic & Conversion" + Activity icon-pill
 *   T2: renders 5 PillGroup tabs in order: Channels, Funnels, Landing Pages,
 *       Real-time, Taxonomy (segmented role=tablist).
 *   T3: clicking Funnels updates window.history.pushState to
 *       /admin/growth/traffic/funnels AND swaps aria-pressed state.
 *   T4: initial render reads window.location.pathname — if
 *       /admin/growth/traffic/realtime, the Real-time tab starts active.
 *   T5: clinic_owner role with app_metadata.org_name renders subtitle
 *       "Traffic & Conversion — Acme Clinic".
 *
 * Mock pattern mirrors ExperimentDashboardPage.test.tsx — `vi.mock` the
 * store selector so we control role/orgName per test without touching
 * the real Zustand instance.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock useStore ────────────────────────────────────────────────────────────
//
// The shell reads `s.signedIn?.user?.app_metadata?.role` and
// `s.signedIn?.user?.app_metadata?.org_name`. Default = admin (no org).
// Per-test overrides reassign storeShape before each render.

let storeShape: { signedIn: null | { user: { app_metadata?: Record<string, unknown> } } } = {
  signedIn: null,
};

vi.mock('@/lib/store', () => ({
  useStore: <T,>(selector: (s: typeof storeShape) => T): T => selector(storeShape),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const originalPushState = window.history.pushState;

function setPathname(path: string) {
  // jsdom: pushState updates location.pathname without navigating.
  window.history.pushState({}, '', path);
}

beforeEach(() => {
  // Reset role/org to admin default.
  storeShape = { signedIn: null };
  setPathname('/admin/growth/traffic/channels');
});

afterEach(() => {
  // Restore history.pushState in case a test spied on it.
  window.history.pushState = originalPushState;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TrafficDashboardPage shell', () => {
  it('T1: renders page header with H1 "Traffic & Conversion" + Activity icon-pill', async () => {
    const { TrafficDashboardPage } = await import('./TrafficDashboardPage');
    render(<TrafficDashboardPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: /Traffic & Conversion/i }),
    ).toBeInTheDocument();
    // Default-admin subtitle copy
    expect(
      screen.getByText('Multi-channel acquisition + funnel intelligence'),
    ).toBeInTheDocument();
  });

  it('T2: renders 5 PillGroup tabs in correct order with role=tablist', async () => {
    const { TrafficDashboardPage } = await import('./TrafficDashboardPage');
    render(<TrafficDashboardPage />);

    const tablist = screen.getByRole('tablist', { name: 'Traffic dashboard tabs' });
    expect(tablist).toBeInTheDocument();

    // 5 pills (rendered as <button>); we accept either button-role or pill
    // matching the aria-label set on each Pill.
    const expectedLabels = [
      'Channel rollup tab',
      'Conversion funnels tab',
      'Landing pages tab',
      'Real-time activity tab',
      'Channel taxonomy tab',
    ];
    for (const label of expectedLabels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('T3: clicking Funnels updates pushState + aria-pressed swap', async () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const { TrafficDashboardPage } = await import('./TrafficDashboardPage');
    render(<TrafficDashboardPage />);

    const channelsPill = screen.getByRole('button', { name: 'Channel rollup tab' });
    const funnelsPill = screen.getByRole('button', { name: 'Conversion funnels tab' });

    // Initial: channels active
    expect(channelsPill).toHaveAttribute('aria-pressed', 'true');
    expect(funnelsPill).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(funnelsPill);

    await waitFor(() => {
      expect(funnelsPill).toHaveAttribute('aria-pressed', 'true');
    });
    expect(channelsPill).toHaveAttribute('aria-pressed', 'false');
    expect(pushSpy).toHaveBeenCalledWith(
      null,
      '',
      '/admin/growth/traffic/funnels',
    );
  });

  it('T4: initial render reads window.location.pathname — realtime path → Real-time tab active', async () => {
    setPathname('/admin/growth/traffic/realtime');
    const { TrafficDashboardPage } = await import('./TrafficDashboardPage');
    render(<TrafficDashboardPage />);

    expect(screen.getByRole('button', { name: 'Real-time activity tab' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Channel rollup tab' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('T5: clinic_owner + app_metadata.org_name renders org-scoped subtitle', async () => {
    storeShape = {
      signedIn: {
        user: {
          app_metadata: { role: 'clinic_owner', org_name: 'Acme Clinic' },
        },
      },
    };
    const { TrafficDashboardPage } = await import('./TrafficDashboardPage');
    render(<TrafficDashboardPage />);

    expect(
      screen.getByText('Traffic & Conversion — Acme Clinic'),
    ).toBeInTheDocument();
    // Default-admin subtitle should NOT be present.
    expect(
      screen.queryByText('Multi-channel acquisition + funnel intelligence'),
    ).not.toBeInTheDocument();
  });
});
