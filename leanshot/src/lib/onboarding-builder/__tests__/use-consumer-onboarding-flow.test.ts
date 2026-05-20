/**
 * Phase 34 Plan 34-06 — useConsumerOnboardingFlow unit tests.
 *
 * Six behaviors per plan spec:
 *   1. Anonymous + active flow → status='preview', flow.config populated.
 *   2. Anonymous + PostHog payload { version_id } → query path `.eq('id', 'v2')`.
 *   3. Authed + completed_onboarding_at set → status='completed', flow=null.
 *   4. Authed + not completed → status='consumer', flow loaded.
 *   5. PostHog throws → fail-open, returns 'preview' for anonymous.
 *   6. waitForFeatureFlags resolves immediately (timeout never elapses) so
 *      we don't depend on real timers.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────
// supabase + store mocks (must come before importing the hook)
// ──────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => {
  const mockFrom = vi.fn();
  return { supabase: { from: mockFrom } };
});

const mockUseStore = vi.fn();
vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) => mockUseStore(selector),
}));

// PostHog mock — onFeatureFlags fires synchronously (flags-resolved) so the
// hook can advance without depending on real setTimeout.
vi.mock('posthog-js', () => {
  return {
    default: {
      onFeatureFlags: vi.fn((cb: () => void) => cb()),
      getFeatureFlagPayload: vi.fn(() => null),
    },
  };
});

import posthog from 'posthog-js';
import { supabase } from '@/lib/supabase';
import { useConsumerOnboardingFlow } from '../use-consumer-onboarding-flow';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

type BuilderResult = { data: unknown; error: unknown };

function makeBuilder(resolveWith: BuilderResult) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(resolveWith),
  };
}

const mockFrom = supabase.from as ReturnType<typeof vi.fn>;

function setStoreUser(
  user: { id: string; is_anonymous?: boolean } | null,
  localUser: { id?: string } | null = null,
): void {
  mockUseStore.mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ signedIn: user ? { user } : null, user: localUser }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset PostHog mock defaults
  (posthog.onFeatureFlags as ReturnType<typeof vi.fn>).mockImplementation((cb: () => void) => cb());
  (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe('useConsumerOnboardingFlow', () => {
  // T1 — anonymous + active flow row → 'preview' with config
  it('returns preview status with active-flow config for anonymous visitor', async () => {
    setStoreUser(null);
    const activeFlow = {
      id: 'flow-active',
      config: [
        { id: 's1', type: 'welcome' },
        { id: 's2', type: 'goals' },
      ],
      version: 3,
    };
    mockFrom.mockReturnValue(makeBuilder({ data: activeFlow, error: null }));

    const { result } = renderHook(() => useConsumerOnboardingFlow());

    await waitFor(() => expect(result.current.status).toBe('preview'));
    expect(result.current.flow?.id).toBe('flow-active');
    expect(result.current.flow?.config.length).toBe(2);
    expect(result.current.flow?.variant_id).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('onboarding_flows');
  });

  // T2 — PostHog A/B payload selects a specific version_id
  it('queries by id when PostHog flag payload supplies version_id', async () => {
    setStoreUser(null);
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue({
      version_id: 'v2',
    });
    const builder = makeBuilder({
      data: { id: 'v2', config: [], version: 7 },
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    const { result } = renderHook(() => useConsumerOnboardingFlow());

    await waitFor(() => expect(result.current.status).toBe('preview'));
    expect(builder.eq).toHaveBeenCalledWith('id', 'v2');
    expect(result.current.flow?.variant_id).toBe('v2');
  });

  // T3 — authed + completed_onboarding_at set → 'completed', no flow
  it('returns completed when profiles.completed_onboarding_at is set', async () => {
    setStoreUser({ id: 'user-001' });
    mockFrom.mockReturnValue(
      makeBuilder({
        data: { completed_onboarding_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    );

    const { result } = renderHook(() => useConsumerOnboardingFlow());

    await waitFor(() => expect(result.current.status).toBe('completed'));
    expect(result.current.flow).toBeNull();
    // Only the profiles query fires; we short-circuit before loading onboarding_flows.
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('profiles');
  });

  // T4 — authed + not completed → 'consumer' with flow loaded
  it('returns consumer status with flow loaded when authed and not completed', async () => {
    setStoreUser({ id: 'user-002' });
    let fromIdx = 0;
    mockFrom.mockImplementation(() => {
      fromIdx++;
      if (fromIdx === 1) {
        return makeBuilder({
          data: { completed_onboarding_at: null },
          error: null,
        });
      }
      return makeBuilder({
        data: {
          id: 'flow-active',
          config: [{ id: 'g1', type: 'goals' }],
          version: 1,
        },
        error: null,
      });
    });

    const { result } = renderHook(() => useConsumerOnboardingFlow());

    await waitFor(() => expect(result.current.status).toBe('consumer'));
    expect(result.current.flow?.id).toBe('flow-active');
    expect(result.current.flow?.config.length).toBe(1);
  });

  // T5 — PostHog throws → fail-open (no payload, falls back to is_active row)
  it('falls back to is_active row when PostHog flag-payload read throws', async () => {
    setStoreUser(null);
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('posthog blew up');
    });
    const builder = makeBuilder({
      data: { id: 'flow-fallback', config: [], version: 1 },
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    const { result } = renderHook(() => useConsumerOnboardingFlow());

    await waitFor(() => expect(result.current.status).toBe('preview'));
    // is_active path (no version_id), so the builder.eq receives ('is_active', true)
    expect(builder.eq).toHaveBeenCalledWith('is_active', true);
    expect(result.current.flow?.variant_id).toBeNull();
  });

  // T6 — no active flow row → status resolves, flow=null (fail-open)
  it('returns preview with flow=null when no active onboarding_flows row exists', async () => {
    setStoreUser(null);
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: null }));

    const { result } = renderHook(() => useConsumerOnboardingFlow());

    await waitFor(() => expect(result.current.status).toBe('preview'));
    expect(result.current.flow).toBeNull();
  });

  // T7 — supabase from() throws → fail-open
  it('fail-opens to preview/consumer when supabase.from throws', async () => {
    setStoreUser(null);
    mockFrom.mockImplementation(() => {
      throw new Error('network down');
    });

    const { result } = renderHook(() => useConsumerOnboardingFlow());

    await waitFor(() => expect(result.current.status).toBe('preview'));
    expect(result.current.flow).toBeNull();
  });
});
