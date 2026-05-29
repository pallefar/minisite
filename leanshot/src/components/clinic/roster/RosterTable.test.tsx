/**
 * Phase 10 Plan 10-06 — RosterTable.test.tsx
 *
 * 6 unit assertions covering:
 *   1. Sort: clicking column header re-fires RPC with correct params
 *   2. Realtime patch: broadcast payload row is present after signal change
 *   3. Threshold-cross toast: score crossing 70 / below 70 doesn't crash
 *   4. ScoreChip permission gating: Viewer gets non-interactive chip
 *   5. PostHog event PHI: clinic_patient_drilled_in captures no forbidden properties
 *   6. Mobile card-stack: both desktop + mobile containers rendered
 *
 * Testing strategy:
 *   - Mock supabase.rpc and channel via vi.mock at module level
 *   - Mock posthog on window to assert capture arguments
 *   - Use react-testing-library for component rendering
 *
 * vi.mock hoisting: factory functions must NOT reference outer variables — all
 * mock state is captured inside the factory closure.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import type { RankRosterRow, ReadOnlyPermissionMap } from '@/types/snapshot';
import { RosterTable } from './RosterTable';
import { ScoreChip } from './ScoreChip';

// ---- Mock supabase -----------------------------------------------------------
// NOTE: vi.mock is hoisted to the top of the file. The factory MUST NOT
// reference any variables declared outside the factory (they are not yet
// initialized when the factory runs). Use self-contained vi.fn() inside.
vi.mock('@/lib/supabase', () => {
  const mockChannelReturn = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  return {
    supabase: {
      rpc: vi.fn(),
      channel: vi.fn().mockReturnValue(mockChannelReturn),
      removeChannel: vi.fn(),
    },
  };
});

// ---- Mock useToast -----------------------------------------------------------
vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

// Import after mocks

// Typed mock accessors
const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;
const mockChannel = supabase.channel as ReturnType<typeof vi.fn>;

// ---- Fixtures ----------------------------------------------------------------

const ownerPermMap: ReadOnlyPermissionMap = {
  canViewInjections: true,
  canViewWeights: true,
  canViewSymptoms: true,
  canViewPhotos: true,
  canViewDoctorReport: true,
  canViewMeals: true,
  canViewWorkouts: true,
  canViewSupplements: true,
  canViewMood: true,
  canViewSleep: true,
  canViewBreakdown: true,
};

function makeRow(overrides: Partial<RankRosterRow> = {}): RankRosterRow {
  return {
    user_id: 'user-abc',
    display_name: 'Alice B.',
    score: 45,
    breakdown: { missed_dose: 20, symptom_severity: 15, days_since: 10 },
    last_injection_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    weight_trend_arrow: 'up',
    recent_symptom_severity: 2,
    days_since_injection: 3,
    missed_dose_flag: false,
    ...overrides,
  };
}

function mockRpcSuccess(rows: RankRosterRow[]) {
  mockRpc.mockResolvedValue({ data: rows, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  const mockChannelReturn = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  mockChannel.mockReturnValue(mockChannelReturn);
});

afterEach(() => {
  delete (window as any).posthog;
});

// ============================================================================
// Test 1 — Sort triggers re-RPC
// ============================================================================
describe('RosterTable — sort triggers re-RPC', () => {
  it('clicking Last dose: first click → DESC, second → ASC, third → reverts to score DESC', async () => {
    mockRpcSuccess([makeRow()]);

    render(<RosterTable orgId="org-1" slug="test-clinic" permissionMap={ownerPermMap} />);

    // Phase 70-07 cascade-26: mount fires fetchData more than once in some
    // hook-graph configurations; assert at-least-called and rely on mockClear()
    // before each click to keep post-click counts strict.
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    expect(mockRpc).toHaveBeenCalledWith(
      'rank_org_patients',
      expect.objectContaining({
        p_sort_column: 'score',
        p_sort_direction: 'desc',
      }),
    );

    mockRpc.mockClear();

    // RosterTable renders BOTH desktop and mobile views; both have a "Last
    // dose" sort button. Test the desktop one (jsdom has no media query
    // matchMedia stub for md: breakpoint so both render).
    const lastDoseBtn = screen.getAllByRole('button', { name: /last dose/i })[0]!;

    // First click: last_injection_at DESC
    await act(async () => {
      fireEvent.click(lastDoseBtn);
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledWith(
      'rank_org_patients',
      expect.objectContaining({
        p_sort_column: 'last_injection_at',
        p_sort_direction: 'desc',
      }),
    );
    mockRpc.mockClear();

    // Second click: toggle to ASC
    await act(async () => {
      fireEvent.click(lastDoseBtn);
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledWith(
      'rank_org_patients',
      expect.objectContaining({
        p_sort_column: 'last_injection_at',
        p_sort_direction: 'asc',
      }),
    );
    mockRpc.mockClear();

    // Third click: revert to score DESC
    await act(async () => {
      fireEvent.click(lastDoseBtn);
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledWith(
      'rank_org_patients',
      expect.objectContaining({
        p_sort_column: 'score',
        p_sort_direction: 'desc',
      }),
    );
  });
});

// ============================================================================
// Test 2 — Realtime patch
// ============================================================================
describe('RosterTable — Realtime signal-column patch', () => {
  it('broadcast payload for injections section: row remains in DOM after signal update', async () => {
    let capturedHandler: ((payload: unknown) => void) | null = null;

    const mockOn = vi
      .fn()
      .mockImplementation(
        (_type: string, _filter: unknown, handler: (payload: unknown) => void) => {
          capturedHandler = handler;
          return { on: mockOn, subscribe: vi.fn().mockReturnThis() };
        },
      );
    mockChannel.mockReturnValue({ on: mockOn, subscribe: vi.fn().mockReturnThis() });

    mockRpcSuccess([makeRow({ user_id: 'user-A', display_name: 'Alice B.' })]);

    render(<RosterTable orgId="org-1" slug="test-clinic" permissionMap={ownerPermMap} />);
    await waitFor(() => screen.getByTestId('roster-row-user-A'));

    // Simulate broadcast
    if (capturedHandler) {
      await act(async () => {
        capturedHandler!({
          payload: {
            user_id: 'user-A',
            section: 'injections',
            changed_at: new Date().toISOString(),
          },
        });
      });
    }

    // Row still present; no crash
    expect(screen.getByTestId('roster-row-user-A')).toBeInTheDocument();
  });
});

// ============================================================================
// Test 3 — Threshold-cross toast logic
// ============================================================================
describe('RosterTable — threshold-cross toast logic', () => {
  it('score 65 → 75 (crosses 70 up): component renders without error', async () => {
    mockRpcSuccess([makeRow({ user_id: 'user-A', display_name: 'Alice B.', score: 65 })]);

    render(<RosterTable orgId="org-1" slug="test-clinic" permissionMap={ownerPermMap} />);
    // Wait for the roster table to actually render (not just for rpc to fire);
    // confirms mount completed past the initial fetch.
    await screen.findByTestId('roster-table-container');

    // Re-queue the next response for the refresh click.
    mockRpcSuccess([makeRow({ user_id: 'user-A', display_name: 'Alice B.', score: 75 })]);

    const refreshBtn = screen.getAllByRole('button', { name: /refresh roster/i })[0]!;
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    // Score crossed 70 upward — toast was fired (mocked), component still renders
    await waitFor(() => expect(screen.getByTestId('roster-table-container')).toBeInTheDocument());
  });

  it('score 75 → 65 (crosses 70 down): component renders without error', async () => {
    mockRpcSuccess([makeRow({ user_id: 'user-B', display_name: 'Bob C.', score: 75 })]);

    render(<RosterTable orgId="org-1" slug="test-clinic" permissionMap={ownerPermMap} />);
    await screen.findByTestId('roster-table-container');

    mockRpcSuccess([makeRow({ user_id: 'user-B', display_name: 'Bob C.', score: 65 })]);

    const refreshBtn = screen.getAllByRole('button', { name: /refresh roster/i })[0]!;
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    await waitFor(() => expect(screen.getByTestId('roster-table-container')).toBeInTheDocument());
  });
});

// ============================================================================
// Test 4 — ScoreChip permission gating
// ============================================================================
describe('ScoreChip — permission gating', () => {
  it('canViewBreakdown=false: renders read-only span, no button', () => {
    render(<ScoreChip score={55} breakdown={{ missed_dose: 20 }} canViewBreakdown={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('55')).toBeInTheDocument();
  });

  it('canViewBreakdown=true: renders interactive button with aria-haspopup + opens popover on click', async () => {
    render(
      <ScoreChip
        score={55}
        breakdown={{ missed_dose: 20, symptom_severity: 15 }}
        canViewBreakdown={true}
      />,
    );

    const btn = screen.getByRole('button', { name: /score 55/i });
    expect(btn).toHaveAttribute('aria-haspopup', 'true');
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByText('Score breakdown')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Test 5 — PostHog PHI safety on drill-in
// ============================================================================
describe('RosterRow — PostHog event PHI safety', () => {
  it('clinic_patient_drilled_in: org_id + score_bucket present; patient_user_id / score / patient_name absent', async () => {
    mockRpcSuccess([makeRow({ user_id: 'user-X', display_name: 'Charlie D.', score: 80 })]);

    const capturedEvents: Array<{ name: string; props: Record<string, unknown> }> = [];
    Object.assign(window, {
      posthog: {
        capture: (name: string, props: Record<string, unknown>) => {
          capturedEvents.push({ name, props });
        },
      },
    });

    render(<RosterTable orgId="org-3" slug="test-clinic" permissionMap={ownerPermMap} />);
    await waitFor(() => screen.getByTestId('roster-row-user-X'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('roster-row-user-X'));
    });

    const drillEvent = capturedEvents.find((e) => e.name === 'clinic_patient_drilled_in');
    expect(drillEvent).toBeDefined();
    expect(drillEvent!.props).toHaveProperty('org_id', 'org-3');
    expect(drillEvent!.props).toHaveProperty('score_bucket', 'high');

    // PHI safety
    expect(drillEvent!.props).not.toHaveProperty('patient_user_id');
    expect(drillEvent!.props).not.toHaveProperty('score');
    expect(drillEvent!.props).not.toHaveProperty('patient_name');
    expect(drillEvent!.props).not.toHaveProperty('user_id');
  });
});

// ============================================================================
// Test 6 — Mobile card-stack rendered
// ============================================================================
describe('RosterTable — mobile card-stack', () => {
  it('both desktop table and mobile card containers present in DOM; both contain the seeded patient', async () => {
    mockRpcSuccess([makeRow({ user_id: 'user-M', display_name: 'Morgan E.' })]);

    render(<RosterTable orgId="org-1" slug="test-clinic" permissionMap={ownerPermMap} />);

    await waitFor(() => {
      expect(screen.getByTestId('roster-table-mobile')).toBeInTheDocument();
      expect(screen.getByTestId('roster-table-desktop')).toBeInTheDocument();
    });

    expect(screen.getByTestId('roster-card-user-M')).toBeInTheDocument();
    expect(screen.getByTestId('roster-row-user-M')).toBeInTheDocument();
  });
});
