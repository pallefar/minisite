/**
 * Phase 28 Plan 03 Task 3 — WorkspaceSwitcher clinic JWT propagation UX tests.
 *
 * Tests:
 *   T1 (hook): Resolves propagated=true within budget when claim arrives at 200ms (mocked).
 *   T2 (hook): Resolves needsRetry=false + propagated=true when fallback probe
 *              confirms membership (claim lags past 600ms but probe succeeds).
 *   T3 (hook): Resolves needsRetry=true when 600ms elapses AND probe returns empty
 *              (membership revoked mid-flight).
 *   T4 (render): ClinicWorkspaceSwitcherJwtOverlay shows spinner during propagation.
 *   T5 (render): ClinicWorkspaceSwitcherJwtOverlay shows Retry when needsRetry is true.
 *   T6 (render): ClinicWorkspaceSwitcherJwtOverlay renders nothing when targetOrgId is null.
 *   T7 (render): ClinicWorkspaceSwitcherJwtOverlay renders nothing once propagated=true.
 */

import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceJwtPropagation, ClinicWorkspaceSwitcherJwtOverlay } from './WorkspaceSwitcher';

// ---------------------------------------------------------------------------
// Supabase mock — use vi.hoisted to avoid hoisting-before-initialization error
// ---------------------------------------------------------------------------

const { mockGetSession, mockRefreshSession, mockFromOrgMembersSelect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRefreshSession: vi.fn(),
  mockFromOrgMembersSelect: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      refreshSession: mockRefreshSession,
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          limit: (_n: number) => mockFromOrgMembersSelect(),
        }),
      }),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(orgIds: string[]) {
  return {
    data: {
      session: {
        user: {
          id: 'user-1',
          app_metadata: { org_ids: orgIds },
        },
      },
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetSession.mockReset();
  mockRefreshSession.mockResolvedValue({ data: { session: null }, error: null });
  mockFromOrgMembersSelect.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// T1: Hook resolves propagated=true within budget (claim arrives quickly)
// ---------------------------------------------------------------------------
describe('T1 — hook: propagated=true when claim arrives within 600ms', () => {
  it('resolves propagated=true when claim is present on first poll', async () => {
    const TARGET_ORG = 'org-target-aaa';

    // Claim present from first getSession call.
    mockGetSession.mockResolvedValue(makeSession([TARGET_ORG]));

    const { result } = renderHook(() => useWorkspaceJwtPropagation(TARGET_ORG));

    // Initially not propagated.
    expect(result.current.propagated).toBe(false);
    expect(result.current.needsRetry).toBe(false);

    // Wait for the async tick to resolve.
    await waitFor(
      () => {
        expect(result.current.propagated).toBe(true);
      },
      { timeout: 3000 },
    );

    expect(result.current.needsRetry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T2: Hook resolves propagated=true via fallback probe (claim never arrives)
// ---------------------------------------------------------------------------
describe('T2 — hook: propagated=true via freshness probe after 600ms', () => {
  it('resolves propagated=true when claim never arrives but probe confirms membership', async () => {
    const TARGET_ORG = 'org-target-bbb';

    // Claim never includes targetOrgId — triggers ceiling + probe.
    mockGetSession.mockResolvedValue(makeSession([]));
    // Probe returns a row (member exists).
    mockFromOrgMembersSelect.mockResolvedValue({ data: [{ org_id: TARGET_ORG }], error: null });

    const { result } = renderHook(() => useWorkspaceJwtPropagation(TARGET_ORG));
    expect(result.current.propagated).toBe(false);

    // Wait up to 2s for the ceiling + probe path to complete.
    await waitFor(
      () => {
        expect(result.current.propagated).toBe(true);
      },
      { timeout: 2000 },
    );

    expect(result.current.needsRetry).toBe(false);
  }, 10000);
});

// ---------------------------------------------------------------------------
// T3: Hook resolves needsRetry=true when claim and probe both fail
// ---------------------------------------------------------------------------
describe('T3 — hook: needsRetry=true when claim AND probe fail after 600ms', () => {
  it('sets needsRetry=true when claim absent and probe returns empty', async () => {
    const TARGET_ORG = 'org-target-ccc';

    // Claim never updates.
    mockGetSession.mockResolvedValue(makeSession([]));
    // Probe returns empty (membership revoked).
    mockFromOrgMembersSelect.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useWorkspaceJwtPropagation(TARGET_ORG));
    expect(result.current.propagated).toBe(false);

    await waitFor(
      () => {
        expect(result.current.needsRetry).toBe(true);
      },
      { timeout: 2000 },
    );

    expect(result.current.propagated).toBe(false);
  }, 10000);
});

// ---------------------------------------------------------------------------
// T4: Overlay renders spinner while propagating
// ---------------------------------------------------------------------------
describe('T4 — overlay: spinner visible while propagating', () => {
  it('renders spinner (data-testid="ws-jwt-spinner") during propagation', async () => {
    const TARGET_ORG = 'org-target-ddd';
    // Claim never arrives — keeps spinner up indefinitely (probe takes long).
    // Use a never-resolving promise so the hook stays in-flight.
    mockGetSession.mockImplementation(() => new Promise(() => {}));
    mockFromOrgMembersSelect.mockImplementation(() => new Promise(() => {}));

    render(<ClinicWorkspaceSwitcherJwtOverlay targetOrgId={TARGET_ORG} />);

    // Spinner should appear immediately (propagated=false, needsRetry=false).
    expect(screen.getByTestId('ws-jwt-spinner')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T5: Overlay renders Retry button when needsRetry=true
// ---------------------------------------------------------------------------
describe('T5 — overlay: Retry button visible on needsRetry', () => {
  it('renders Retry button (data-testid="ws-retry") after probe fails', async () => {
    const TARGET_ORG = 'org-target-eee';
    mockGetSession.mockResolvedValue(makeSession([]));
    mockFromOrgMembersSelect.mockResolvedValue({ data: [], error: null });

    render(<ClinicWorkspaceSwitcherJwtOverlay targetOrgId={TARGET_ORG} />);

    await waitFor(
      () => {
        expect(screen.getByTestId('ws-retry')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // Spinner should be gone.
    expect(screen.queryByTestId('ws-jwt-spinner')).toBeNull();
  }, 10000);

  it('Retry button click resets state and shows spinner again', async () => {
    const TARGET_ORG = 'org-target-fff';
    mockGetSession.mockResolvedValue(makeSession([]));
    mockFromOrgMembersSelect.mockResolvedValue({ data: [], error: null });

    render(<ClinicWorkspaceSwitcherJwtOverlay targetOrgId={TARGET_ORG} />);

    await waitFor(
      () => {
        expect(screen.getByTestId('ws-retry')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // Switch mock so that after retry, claim still absent (shows spinner, not retry).
    // New retryKey resets the effect; getSession still returns empty → spinner shows.
    mockGetSession.mockImplementation(() => new Promise(() => {}));

    await userEvent.click(screen.getByTestId('ws-retry'));

    // After retry, spinner should reappear.
    await waitFor(() => {
      expect(screen.getByTestId('ws-jwt-spinner')).toBeInTheDocument();
    });
  }, 10000);
});

// ---------------------------------------------------------------------------
// T6: Overlay renders nothing when targetOrgId is null
// ---------------------------------------------------------------------------
describe('T6 — overlay: renders nothing for null targetOrgId', () => {
  it('renders nothing when targetOrgId is null', () => {
    // No supabase calls needed — null short-circuits.
    render(<ClinicWorkspaceSwitcherJwtOverlay targetOrgId={null} />);
    expect(screen.queryByTestId('ws-jwt-spinner')).toBeNull();
    expect(screen.queryByTestId('ws-retry')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T7: Overlay renders nothing once propagated=true
// ---------------------------------------------------------------------------
describe('T7 — overlay: renders nothing once propagated', () => {
  it('hides spinner once claim appears in org_ids', async () => {
    const TARGET_ORG = 'org-target-ggg';
    // Claim present from first poll.
    mockGetSession.mockResolvedValue(makeSession([TARGET_ORG]));

    render(<ClinicWorkspaceSwitcherJwtOverlay targetOrgId={TARGET_ORG} />);

    // Initially spinner may appear (before first async poll).
    // Wait for it to disappear once propagated.
    await waitFor(
      () => {
        expect(screen.queryByTestId('ws-jwt-spinner')).toBeNull();
      },
      { timeout: 3000 },
    );

    expect(screen.queryByTestId('ws-retry')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Additional: hook no-ops when targetOrgId is null
// ---------------------------------------------------------------------------
describe('hook: null targetOrgId immediately returns propagated=true', () => {
  it('returns propagated=true and needsRetry=false immediately for null', () => {
    const { result } = renderHook(() => useWorkspaceJwtPropagation(null));
    expect(result.current.propagated).toBe(true);
    expect(result.current.needsRetry).toBe(false);
  });
});
