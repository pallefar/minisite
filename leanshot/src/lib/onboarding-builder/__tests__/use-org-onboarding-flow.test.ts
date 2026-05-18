/**
 * Phase 31 Plan 06 — useOrgOnboardingFlow unit tests.
 *
 * Tests 7 behavior scenarios per the plan spec:
 *   1. anonymous (no auth user) → 'consumer'
 *   2. signed-in but no primary_org_id → 'consumer'
 *   3. signed-in with active org flow → 'org'
 *   4. signed-in with completed_onboarding_at set → 'completed'
 *   5. signed-in, org resolved but no active flow → 'consumer'
 *   6. initial render → 'loading'
 *   7. network error → 'consumer' (fail-open per T-31-06-04)
 *
 * Mocking strategy: vi.mock('@/lib/supabase') returns a chainable builder stub
 * so the hook's two-phase query model (thin profiles SELECT, then conditional
 * org JOIN) is testable without live DB.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase client mock
// ---------------------------------------------------------------------------

// We need to mock BEFORE the module is imported. vitest hoists vi.mock() calls.
vi.mock('@/lib/supabase', () => {
  const mockGetUser = vi.fn();
  const mockFrom = vi.fn();

  const supabaseMock = {
    auth: { getUser: mockGetUser },
    from: mockFrom,
  };

  return { supabase: supabaseMock };
});

// Import AFTER mock is established
import { useOrgOnboardingFlow } from '../use-org-onboarding-flow';
import { supabase } from '@/lib/supabase';

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
const mockGetUser = supabase.auth.getUser as ReturnType<typeof vi.fn>;
const mockFrom = supabase.from as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useOrgOnboardingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: anonymous → 'consumer' ─────────────────────────────────────
  it('returns consumer when supabase.auth.getUser returns no user (anonymous / pre-signin)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const { result } = renderHook(() => useOrgOnboardingFlow());

    // Initial state is loading
    expect(result.current.status).toBe('loading');

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
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-001' } },
      error: null,
    });

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
      { id: 'w1', type: 'welcome', custom: { title: 'Welcome to Acme Health', body: 'Start here.' } },
      { id: 'm1', type: 'medication' },
      { id: 'c1', type: 'consent' },
    ];

    mockGetUser.mockResolvedValue({
      data: { user: { id: testUserId } },
      error: null,
    });

    // Mock from() to return different builders depending on call order
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: thin profiles SELECT
        return makeBuilder({
          data: { primary_org_id: testOrgId, completed_onboarding_at: null },
          error: null,
        });
      }
      // Second call: org name query
      return makeBuilder({
        data: { name: testOrgName },
        error: null,
      });
    });

    // Third mock call for org_onboarding_flows
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
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-003' } },
      error: null,
    });

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

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-004' } },
      error: null,
    });

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

  // ── Test 6: initial render → 'loading' ──────────────────────────────────
  it('returns loading status on initial render before any query resolves', () => {
    // Never resolves (pending promise)
    mockGetUser.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOrgOnboardingFlow());

    expect(result.current.status).toBe('loading');
    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.steps).toBeNull();
  });

  // ── Test 7: network error → 'consumer' (fail-open per T-31-06-04) ──────
  it('fails open to consumer when supabase query throws (network error)', async () => {
    mockGetUser.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useOrgOnboardingFlow());

    await waitFor(() => {
      expect(result.current.status).toBe('consumer');
    });

    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.steps).toBeNull();
  });
});
