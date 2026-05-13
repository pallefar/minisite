/**
 * Phase 10 Plan 10-09 — Vitest tests for PatientActivityModal.
 *
 * 9 behaviors from 10-09-PLAN.md task 2:
 *   1. Click View activity IconButton on Active Orgs row → modal renders with org name in title.
 *   2. Tab nav has "Operator views" + "Ranking events"; defaults to Operator views.
 *   3. Each tab triggers separate fetch with ?tab=...; rows render with actor display + role badge.
 *   4. Ranking-event Why? expander: click → breakdown block renders; click again → collapses.
 *   5. Empty states: when API returns 0 rows for the active tab.
 *   6. Pagination: Previous/Next render; click Next → fetches with offset=25.
 *   7. Focus return: close modal → focus returns to View activity IconButton.
 *   8. NO PostHog: posthog.capture is NEVER called during modal mount + interaction (D-19).
 *   9. HBNR footer: footer text visible regardless of active tab.
 *
 * Security note: Test 8 is a positive assertion that posthog.capture is never called.
 * This prevents D-19 regressions (meta-auditing patient transparency views).
 */

import { type RefObject } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock supabase (network) ──────────────────────────────────────────────────

const mockGetSession = vi.fn().mockResolvedValue({
  data: { session: { access_token: 'patient-test-jwt' } },
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

// ─── Mock the usePatientActivity hook ─────────────────────────────────────────
// The hook fetches via Edge Function; we mock it for unit testing.

type ActivityTab = 'operator_views' | 'ranking_events';

const mockUsePatientActivity = vi.fn();

vi.mock('./use-patient-activity', () => ({
  usePatientActivity: (opts: { orgId: string; tab: ActivityTab; offset: number; limit?: number }) =>
    mockUsePatientActivity(opts),
}));

// ─── PostHog mock ─────────────────────────────────────────────────────────────

const posthogCaptureSpy = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    capture: posthogCaptureSpy,
    init: vi.fn(),
    identify: vi.fn(),
  },
}));

// ─── Imports under test (after mocks are wired) ───────────────────────────────

import { PatientActivityModal } from './PatientActivityModal';
import { ActiveOrganizationsSection } from './sections/ActiveOrganizationsSection';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const ORG_NAME = 'Test Clinic';

const OPERATOR_ROW = {
  id: 1,
  timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
  action: 'section_view',
  actor_type: 'org_operator',
  org_id: ORG_ID,
  target_user_id: 'patient-uuid',
  metadata: { section: 'injections' },
  user_id: 'actor-uuid',
  actor_display_name: 'Dr. Smith',
  actor_role: 'Coach',
};

const RANKING_ROW = {
  id: 2,
  timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
  action: 'rank_threshold_crossed',
  actor_type: 'org_system',
  org_id: ORG_ID,
  target_user_id: 'patient-uuid',
  metadata: {
    score: 75,
    breakdown_snapshot: { missed_dose: 30, symptom_severity: 25, weight_trend: 20 },
    threshold_crossed: 70,
    direction: 'up',
  },
  user_id: null,
  actor_display_name: 'a clinic member',
  actor_role: null,
};

function defaultHookResult(rows: typeof OPERATOR_ROW[] = [OPERATOR_ROW]) {
  return {
    rows,
    loading: false,
    error: null,
    hasMore: false,
    total: rows.length,
    refresh: vi.fn(),
  };
}

// ─── Test 1: Modal opens with org name in title ───────────────────────────────

describe('PatientActivityModal', () => {
  beforeEach(() => {
    mockUsePatientActivity.mockReturnValue(defaultHookResult());
    posthogCaptureSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: renders modal with org name in title', () => {
    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(`Activity from ${ORG_NAME}`)).toBeTruthy();
  });

  // ─── Test 2: Two tabs; defaults to Operator views ─────────────────────────

  it('Test 2: tab nav has Operator views + Ranking events; defaults to Operator views', () => {
    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeTruthy();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent('Operator views');
    expect(tabs[1]).toHaveTextContent('Ranking events');

    // Default active tab
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  // ─── Test 3: Each tab fetches with ?tab=...; rows render ─────────────────

  it('Test 3: each tab triggers hook with correct tab param; rows render with actor + badge', async () => {
    const user = userEvent.setup();

    // First call (operator_views) returns operator row
    mockUsePatientActivity.mockImplementation((opts: { tab: ActivityTab }) => {
      if (opts.tab === 'operator_views') {
        return defaultHookResult([OPERATOR_ROW]);
      }
      return defaultHookResult([]);
    });

    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    // Operator views tab should show actor row
    await waitFor(() => {
      expect(screen.getByText('Dr. Smith')).toBeTruthy();
    });
    expect(screen.getByText('Coach')).toBeTruthy();

    // Switch to Ranking events tab
    mockUsePatientActivity.mockImplementation((opts: { tab: ActivityTab }) => {
      if (opts.tab === 'ranking_events') {
        return defaultHookResult([RANKING_ROW] as unknown as typeof OPERATOR_ROW[]);
      }
      return defaultHookResult([]);
    });

    await user.click(screen.getByRole('tab', { name: 'Ranking events' }));

    // Hook must have been called with ranking_events tab
    expect(mockUsePatientActivity).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'ranking_events' }),
    );
  });

  // ─── Test 4: Ranking-event Why? expander ─────────────────────────────────

  it('Test 4: click Why? → breakdown renders; click again → collapses', async () => {
    const user = userEvent.setup();

    mockUsePatientActivity.mockImplementation((opts: { tab: ActivityTab }) => {
      if (opts.tab === 'ranking_events') {
        return defaultHookResult([RANKING_ROW] as unknown as typeof OPERATOR_ROW[]);
      }
      return defaultHookResult([]);
    });

    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    // Switch to ranking events tab
    await user.click(screen.getByRole('tab', { name: 'Ranking events' }));

    // Why? button should appear
    const whyButton = await screen.findByRole('button', { name: 'Show what triggered this flag' });
    expect(whyButton).toBeTruthy();
    expect(whyButton).toHaveAttribute('aria-expanded', 'false');

    // Click to expand
    await user.click(whyButton);
    expect(whyButton).toHaveAttribute('aria-expanded', 'true');

    // Breakdown content should appear
    expect(screen.getByText(/What triggered this flag/)).toBeTruthy();
    expect(screen.getByText(/Score: 75\/100/)).toBeTruthy();
    expect(screen.getByText(/missed dose/)).toBeTruthy();

    // Click again to collapse
    await user.click(whyButton);
    expect(whyButton).toHaveAttribute('aria-expanded', 'false');
  });

  // ─── Test 5: Empty state ──────────────────────────────────────────────────

  it('Test 5: shows empty state when API returns 0 rows', () => {
    mockUsePatientActivity.mockReturnValue(defaultHookResult([]));

    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('No views from this workspace yet.')).toBeTruthy();
  });

  // ─── Test 6: Pagination ───────────────────────────────────────────────────

  it('Test 6: Previous/Next render; clicking Next fetches with offset=25', async () => {
    const user = userEvent.setup();

    // Return 25 rows + has_more=true to trigger pagination controls
    const manyRows = Array.from({ length: 25 }, (_, i) => ({
      ...OPERATOR_ROW,
      id: i + 1,
    }));

    mockUsePatientActivity.mockReturnValue({
      rows: manyRows,
      loading: false,
      error: null,
      hasMore: true,
      total: 50,
      refresh: vi.fn(),
    });

    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    // Pagination footer should appear with total > 25
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy();
    });

    // Previous should be disabled on first page
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    // Click Next
    await user.click(screen.getByRole('button', { name: 'Next page' }));

    // Hook should be called with offset=25
    await waitFor(() => {
      expect(mockUsePatientActivity).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 25 }),
      );
    });
  });

  // ─── Test 7: Focus return ─────────────────────────────────────────────────

  it('Test 7: close modal returns focus to triggerRef element', async () => {
    const triggerRef = { current: document.createElement('button') };
    document.body.appendChild(triggerRef.current);
    const focusSpy = vi.spyOn(triggerRef.current, 'focus');

    const onClose = vi.fn();
    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={onClose}
        triggerRef={triggerRef as RefObject<HTMLElement | null>}
      />,
    );

    // Close via the X button
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    closeBtn.click();

    // The setTimeout in handleClose schedules focus after 50ms.
    // Wait for it to fire naturally.
    await new Promise((resolve) => window.setTimeout(resolve, 100));

    expect(focusSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(triggerRef.current);
  });

  // ─── Test 8: NO PostHog ───────────────────────────────────────────────────

  it('Test 8: posthog.capture is NEVER called during modal mount + tab switch (D-19)', async () => {
    const user = userEvent.setup();

    mockUsePatientActivity.mockImplementation((opts: { tab: ActivityTab }) => {
      if (opts.tab === 'ranking_events') {
        return defaultHookResult([RANKING_ROW] as unknown as typeof OPERATOR_ROW[]);
      }
      return defaultHookResult([OPERATOR_ROW]);
    });

    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    // Switch tabs to trigger any possible telemetry
    await user.click(screen.getByRole('tab', { name: 'Ranking events' }));
    await user.click(screen.getByRole('tab', { name: 'Operator views' }));

    // posthog.capture MUST NOT have been called (D-19 explicit decision)
    expect(posthogCaptureSpy).not.toHaveBeenCalled();
  });

  // ─── Test 9: HBNR footer always visible ──────────────────────────────────

  it('Test 9: HBNR/WMHMDA footer visible on both tabs regardless of active tab', async () => {
    const user = userEvent.setup();

    mockUsePatientActivity.mockImplementation((opts: { tab: ActivityTab }) => {
      if (opts.tab === 'ranking_events') {
        return defaultHookResult([RANKING_ROW] as unknown as typeof OPERATOR_ROW[]);
      }
      return defaultHookResult([OPERATOR_ROW]);
    });

    render(
      <PatientActivityModal
        orgId={ORG_ID}
        orgName={ORG_NAME}
        onClose={vi.fn()}
      />,
    );

    // Footer visible on Operator views tab (default)
    const footer = screen.getByTestId('hbnr-footer');
    expect(footer).toBeTruthy();
    expect(footer).toHaveTextContent('LeanShot keeps a complete record of every access');
    expect(footer).toHaveTextContent(ORG_NAME);

    // Switch to Ranking events tab — footer must still be visible
    await user.click(screen.getByRole('tab', { name: 'Ranking events' }));
    expect(screen.getByTestId('hbnr-footer')).toBeTruthy();
    expect(screen.getByTestId('hbnr-footer')).toHaveTextContent(
      'LeanShot keeps a complete record of every access',
    );
  });
});

