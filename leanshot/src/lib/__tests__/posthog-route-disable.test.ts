/**
 * Tests for useSessionReplayPhiGuard + PHI_URL_REGEX.
 *
 * Phase 25 Plan 25-07 — HIPAA-06 + HIPAA-17.
 *
 * RESEARCH correction #1 context: posthog-js has NO `disable_session_recording_on_url`
 * config option. The actual mechanism is:
 *   1. `disable_session_recording: true` global default in posthog.init (analytics.ts).
 *   2. This hook calls startSessionRecording() / stopSessionRecording() on route change.
 *
 * These tests verify the PHI detection logic and posthog API call routing.
 * They use a mock of posthog-js so no real network calls occur.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PHI_URL_REGEX, __test } from '@/lib/posthog-route-disable';

// --- Mock posthog-js --------------------------------------------------------
const mockStop = vi.fn();
const mockStart = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    startSessionRecording: mockStart,
    stopSessionRecording: mockStop,
  },
}));

// --- Import AFTER mocking posthog-js ----------------------------------------
// Dynamic import of applyDecision is tested indirectly via the exported helpers.
// We also import PHI_URL_REGEX and __test seam for direct testing.

// Helper: call applyDecision via the module under test.
// We access it through dynamic import to match production code paths.
async function callApplyDecision(isPhi: boolean): Promise<void> {
  const mod = await import('@/lib/posthog-route-disable');
  // @ts-expect-error — applyDecision is not exported; we invoke via __test bridge
  return mod.__test.applyDecision(isPhi);
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockStop.mockClear();
  mockStart.mockClear();
  __test.reset();
});

// ---------------------------------------------------------------------------
// 1. PHI_URL_REGEX boundary tests
// ---------------------------------------------------------------------------
describe('PHI_URL_REGEX', () => {
  it('matches /clinic at boundary', () => {
    expect(PHI_URL_REGEX.test('/clinic')).toBe(true);
  });

  it('matches /clinic/patients', () => {
    expect(PHI_URL_REGEX.test('/clinic/patients')).toBe(true);
  });

  it('does NOT match /clinicians (suffix exclusion)', () => {
    expect(PHI_URL_REGEX.test('/clinicians')).toBe(false);
  });

  it('matches /patient/123/photo', () => {
    expect(PHI_URL_REGEX.test('/patient/123/photo')).toBe(true);
  });

  it('matches /admin/users', () => {
    expect(PHI_URL_REGEX.test('/admin/users')).toBe(true);
  });

  it('does NOT match /admin/billing (not in deny-list)', () => {
    expect(PHI_URL_REGEX.test('/admin/billing')).toBe(false);
  });

  it('matches /dose-log', () => {
    expect(PHI_URL_REGEX.test('/dose-log')).toBe(true);
  });

  it('matches /share/abc', () => {
    expect(PHI_URL_REGEX.test('/share/abc')).toBe(true);
  });

  it('matches /auth/callback', () => {
    expect(PHI_URL_REGEX.test('/auth/callback')).toBe(true);
  });

  it('matches /auth at exact boundary', () => {
    expect(PHI_URL_REGEX.test('/auth')).toBe(true);
  });

  it('does NOT match / (root path)', () => {
    expect(PHI_URL_REGEX.test('/')).toBe(false);
  });

  it('does NOT match /home', () => {
    expect(PHI_URL_REGEX.test('/home')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. applyDecision — posthog API routing
// ---------------------------------------------------------------------------
describe('applyDecision', () => {
  it('non-PHI route calls startSessionRecording', async () => {
    await callApplyDecision(false);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('PHI route calls stopSessionRecording', async () => {
    await callApplyDecision(true);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('dedupe: calling applyDecision(true) twice only calls stop once', async () => {
    await callApplyDecision(true);
    await callApplyDecision(true); // same value — should be deduped
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('dedupe resets between test cases (via __test.reset)', async () => {
    // This test relies on beforeEach calling __test.reset()
    await callApplyDecision(false);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('dynamic import rejection: applyDecision resolves without throwing', async () => {
    // Temporarily override the mock to throw
    vi.doMock('posthog-js', () => {
      throw new Error('ad-blocker blocked import');
    });

    // Reset memo so the next call hits the import path
    __test.reset();

    // The function should not throw / reject
    await expect(callApplyDecision(true)).resolves.toBeUndefined();

    // Restore working mock for subsequent tests
    vi.doMock('posthog-js', () => ({
      default: {
        startSessionRecording: mockStart,
        stopSessionRecording: mockStop,
      },
    }));
    __test.reset();
  });
});

// ---------------------------------------------------------------------------
// 3. Synthetic route mapping — medication tab → /dose-log → PHI
// ---------------------------------------------------------------------------
describe('Synthetic tab → route mapping', () => {
  it('medication tab maps to /dose-log (PHI)', async () => {
    // Verify via the exported __test.isPhiRoute seam
    const isPhi = __test.isPhiRoute('medication', '/');
    expect(isPhi).toBe(true);
  });

  it('home tab + root path → not PHI', () => {
    expect(__test.isPhiRoute('home', '/')).toBe(false);
  });

  it('home tab + /clinic/patients → PHI (URL side fires)', () => {
    expect(__test.isPhiRoute('home', '/clinic/patients')).toBe(true);
  });

  it('home tab + /auth/callback → PHI', () => {
    expect(__test.isPhiRoute('home', '/auth/callback')).toBe(true);
  });

  it('home tab + /patient/123 → PHI', () => {
    expect(__test.isPhiRoute('home', '/patient/123')).toBe(true);
  });

  it('home tab + /admin/users → PHI', () => {
    expect(__test.isPhiRoute('home', '/admin/users')).toBe(true);
  });

  it('home tab + /admin/billing → NOT PHI', () => {
    expect(__test.isPhiRoute('home', '/admin/billing')).toBe(false);
  });

  it('home tab + /share/abc → PHI', () => {
    expect(__test.isPhiRoute('home', '/share/abc')).toBe(true);
  });

  it('home tab + /clinicians → NOT PHI (boundary exclusion)', () => {
    expect(__test.isPhiRoute('home', '/clinicians')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. DEFERRED Phase 28+ modal-flag case (documented but not yet exercised)
// ---------------------------------------------------------------------------
describe('Phase 28+ deferred — currentSensitiveModal flag', () => {
  it.skip('[DEFERRED — see deferred-tests.md] When Zustand exposes currentSensitiveModal for share/doctor-report modals, calling applyDecision should transition to stop on non-null modal flag and back to start when modal closes', () => {
    // TODO Phase 28: wire Zustand currentSensitiveModal: "share" | "doctor-report" | null
    // into isPhiRoute(currentTab, pathname, currentSensitiveModal) and add a test case here.
  });
});
