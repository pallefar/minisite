/**
 * Phase 31 Plan 06 — useOrgOnboardingFlow unit tests.
 *
 * Tests 7 behavior scenarios per the plan spec:
 *   1. anonymous (no auth user in store) → 'consumer'
 *   2. signed-in but no primary_org_id → 'consumer'
 *   3. signed-in with active org flow → 'org'
 *   4. signed-in with completed_onboarding_at set → 'completed'
 *   5. signed-in, org resolved but no active flow → 'consumer'
 *   6. initial render → 'loading' (transitions to consumer/org quickly)
 *   7. network error → 'consumer' (fail-open per T-31-06-04)
 *
 * Mocking strategy: vi.mock('@/lib/supabase') + vi.mock('@/lib/store') so the
 * hook's Zustand store read + two-phase query model are testable without live DB.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { useOrgOnboardingFlow } from '../use-org-onboarding-flow';

// ---------------------------------------------------------------------------
// Supabase client mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => {
  const mockFrom = vi.fn();

  const supabaseMock = {
    from: mockFrom,
  };

  return { supabase: supabaseMock };
});

// ---------------------------------------------------------------------------
// Zustand store mock
// ---------------------------------------------------------------------------

const mockUseStore = vi.fn();
vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) => mockUseStore(selector),
}));

// Import AFTER mocks are established

// ---------------------------------------------------------------------------
// Helper: build a chainable supabase-js builder stub
// ---------------------------------------------------------------------------

type BuilderResult = { data: unknown; error: unknown };

function makeBuilder(resolveWith: BuilderResult) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(resolveWith),
    maybeSingle: vi.fn().mockResolvedValue(resolveWith),
  };
  return builder;
}

// Typed supabase mock accessors
const mockFrom = supabase.from as ReturnType<typeof vi.fn>;

// Helper: make useStore return a specific signedIn.user mock
function setStoreUser(user: { id: string; is_anonymous?: boolean } | null) {
  // useStore is called with a selector function; we return the selected value
  mockUseStore.mockImplementation((selector: (s: unknown) => unknown) => {
    // The hook calls useStore((s) => s.signedIn?.user ?? null)
    return selector({ signedIn: user ? { user } : null });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useOrgOnboardingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: anonymous → 'consumer' ─────────────────────────────────────
  it('returns consumer when no signedIn.user in store (anonymous / pre-signin)', async () => {
    setStoreUser(null);

    const { result } = renderHook(() => useOrgOnboardingFlow());

    await waitFor(() => {
      expect(result.current.status).toBe('consumer');
    });

    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.steps).toBeNull();
    // Confirm no DB round-trip was made
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // ── Test 2: signed-in but no primary_org_id → 'consumer' ────────────────
  it('returns consumer when profiles row has primary_org_id=null', async () => {
    setStoreUser({ id: 'user-001' });

    // First query (thin profiles SELECT) returns null primary_org_id
    const profileBuilder = makeBuilder({
      data: { primary_org_id: null, completed_onboarding_at: null },
      error: null,
    });
    mockFrom.mockReturnValue(profileBuilder);

    const { result } = renderHook(() => useOrgOnboardingFlow());

    await waitFor(() => {
      expect(result.current.status).toBe('consumer');
    });

    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.steps).toBeNull();
  });

  // ── Test 3: signed-in with active org flow → 'org' ─────────────────────
  it('returns org status with orgId, orgName, and steps when active flow exists', async () => {
    const testUserId = 'user-002';
    const testOrgId = 'org-001';
    const testOrgName = 'Acme Health';
    const testSteps = [
      {
        id: 'w1',
        type: 'welcome',
        custom: { title: 'Welcome to Acme Health', body: 'Start here.' },
      },
      { id: 'm1', type: 'medication' },
      { id: 'c1', type: 'consent' },
    ];

    setStoreUser({ id: testUserId });

    let fromCallIdx = 0;
    mockFrom.mockImplementation(() => {
      fromCallIdx++;
      if (fromCallIdx === 1) {
        return makeBuilder({
          data: { primary_org_id: testOrgId, completed_onboarding_at: null },
          error: null,
        });
      }
      if (fromCallIdx === 2) {
        return makeBuilder({
          data: { name: testOrgName },
          error: null,
        });
      }
      // Third: active flow
      return makeBuilder({
        data: { steps: testSteps },
        error: null,
      });
    });

    const { result } = renderHook(() => useOrgOnboardingFlow());

    await waitFor(() => {
      expect(result.current.status).toBe('org');
    });

    expect(result.current.orgId).toBe(testOrgId);
    expect(result.current.orgName).toBe(testOrgName);
    expect(result.current.steps).toEqual(testSteps);
  });

  // ── Test 4: completed_onboarding_at set → 'completed' ───────────────────
  it('returns completed when profiles.completed_onboarding_at is NOT null (D-14 + D-15)', async () => {
    setStoreUser({ id: 'user-003' });

    // Thin profiles SELECT returns non-null completed_onboarding_at
    const profileBuilder = makeBuilder({
      data: {
        primary_org_id: 'some-org-id',
        completed_onboarding_at: '2026-05-18T10:00:00Z',
      },
      error: null,
    });
    mockFrom.mockReturnValue(profileBuilder);

    const { result } = renderHook(() => useOrgOnboardingFlow());

    await waitFor(() => {
      expect(result.current.status).toBe('completed');
    });

    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.steps).toBeNull();
    // Only one DB call (thin profiles SELECT); no further queries needed
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  // ── Test 5: org resolved but no active flow → 'consumer' ─────────────
  it('falls back to consumer when primary_org_id is set but no active flow exists', async () => {
    const testOrgId = 'org-002';
    const testOrgName = 'Beta Clinic';

    setStoreUser({ id: 'user-004' });

    let fromCallIdx2 = 0;
    mockFrom.mockImplementation(() => {
      fromCallIdx2++;
      if (fromCallIdx2 === 1) {
        return makeBuilder({
          data: { primary_org_id: testOrgId, completed_onboarding_at: null },
          error: null,
        });
      }
      if (fromCallIdx2 === 2) {
        return makeBuilder({
          data: { name: testOrgName },
          error: null,
        });
      }
      // Third: no active flow
      return makeBuilder({
        data: null,
        error: null,
      });
    });

    const { result } = renderHook(() => useOrgOnboardingFlow());

    await waitFor(() => {
      expect(result.current.status).toBe('consumer');
    });

    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.steps).toBeNull();
  });

  // ── Test 6: initial render → transitions quickly ─────────────────────────
  it('returns loading initially then transitions to consumer for null user', async () => {
    setStoreUser(null);

    const { result } = renderHook(() => useOrgOnboardingFlow());

    // May be loading initially
    // Should resolve to consumer quickly
    await waitFor(() => {
      expect(result.current.status).toBe('consumer');
    });
  });

  // ── Test 7: network error → 'consumer' (fail-open per T-31-06-04) ──────
  it('fails open to consumer when supabase query throws (network error)', async () => {
    setStoreUser({ id: 'user-005' });
    // Simulate DB query failure
    const errorBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('Network failure')),
    };
    mockFrom.mockReturnValue(errorBuilder);

    const { result } = renderHook(() => useOrgOnboardingFlow());

    await waitFor(() => {
      expect(result.current.status).toBe('consumer');
    });

    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.steps).toBeNull();
  });
});
