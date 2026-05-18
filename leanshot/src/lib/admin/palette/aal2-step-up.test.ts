/**
 * Phase 27 Plan 27-03 Task 2 — aal2-step-up unit tests (TDD RED then GREEN).
 *
 * Tests the dual-path aal2 freshness mechanism per RESEARCH correction #4:
 *   - Primary: JWT `auth_time` claim (server-issued, tamper-evident).
 *   - Fallback: localStorage timestamp set by requireAal2Fresh() on a
 *     successful mfa.challengeAndVerify resolution (when JWT lacks auth_time).
 *
 * Covered behaviors (≥5 tests per plan verify):
 *   T1: AAL='aal1' → isAal2Fresh()=false (fail-closed; freshness irrelevant if not aal2)
 *   T2: AAL='aal2' + JWT auth_time within window → true
 *   T3: AAL='aal2' + JWT auth_time outside window → false
 *   T4: AAL='aal2' + JWT lacks auth_time + localStorage fresh → true
 *   T5: AAL='aal2' + JWT lacks auth_time + localStorage stale → false
 *   T6: AAL='aal2' + both signals absent → false (fail-closed)
 *   T7: requireAal2Fresh short-circuits onChallenge when fresh
 *   T8: requireAal2Fresh invokes onChallenge + mfa.challengeAndVerify when stale;
 *       stores localStorage timestamp on success
 *   T9: requireAal2Fresh throws 'aal2_challenge_failed' on verify failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isAal2Fresh,
  requireAal2Fresh,
  AAL2_FRESHNESS_MS,
} from '@/lib/admin/palette/aal2-step-up';
import { supabase } from '@/lib/supabase';

const AAL2_LS_KEY = 'leanshot_aal2_last_verified';

// ---------------------------------------------------------------------------
// Mock @/lib/supabase — we control auth.mfa + auth.getSession per test
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(),
        challengeAndVerify: vi.fn(),
      },
      getSession: vi.fn(),
    },
  },
}));

// Tiny base64url helper — encodes the payload portion of a fake JWT.
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const body = btoa(JSON.stringify(payload))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.signature`;
}

function setAal(level: 'aal1' | 'aal2') {
  vi.mocked(supabase.auth.mfa.getAuthenticatorAssuranceLevel).mockResolvedValue({
    data: { currentLevel: level, nextLevel: level, currentAuthenticationMethods: [] },
    error: null,
  } as never);
}

function setJwt(jwt: string | null) {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: jwt ? ({ access_token: jwt } as never) : null },
    error: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom-backed localStorage is available in vitest by default
  globalThis.localStorage?.clear();
});

describe('isAal2Fresh', () => {
  it('T1: returns false when current AAL is not aal2 (fail-closed)', async () => {
    setAal('aal1');
    setJwt(fakeJwt({ auth_time: Math.floor(Date.now() / 1000) - 60 }));
    await expect(isAal2Fresh()).resolves.toBe(false);
  });

  it('T2: returns true when AAL=aal2 and JWT auth_time is within freshness window', async () => {
    setAal('aal2');
    const fiveMinAgoSec = Math.floor(Date.now() / 1000) - 5 * 60;
    setJwt(fakeJwt({ auth_time: fiveMinAgoSec, aal: 'aal2' }));
    await expect(isAal2Fresh()).resolves.toBe(true);
  });

  it('T3: returns false when AAL=aal2 but JWT auth_time is older than freshness window', async () => {
    setAal('aal2');
    const sixteenMinAgoSec = Math.floor(Date.now() / 1000) - 16 * 60;
    setJwt(fakeJwt({ auth_time: sixteenMinAgoSec, aal: 'aal2' }));
    await expect(isAal2Fresh()).resolves.toBe(false);
  });

  it('T4: returns true when JWT lacks auth_time but localStorage timestamp is fresh', async () => {
    setAal('aal2');
    setJwt(fakeJwt({ aal: 'aal2' /* no auth_time */ }));
    localStorage.setItem(AAL2_LS_KEY, String(Date.now() - 3 * 60 * 1000));
    await expect(isAal2Fresh()).resolves.toBe(true);
  });

  it('T5: returns false when JWT lacks auth_time and localStorage timestamp is stale', async () => {
    setAal('aal2');
    setJwt(fakeJwt({ aal: 'aal2' }));
    localStorage.setItem(AAL2_LS_KEY, String(Date.now() - 30 * 60 * 1000));
    await expect(isAal2Fresh()).resolves.toBe(false);
  });

  it('T6: returns false when both auth_time and localStorage are absent (fail-closed)', async () => {
    setAal('aal2');
    setJwt(fakeJwt({ aal: 'aal2' }));
    // no localStorage entry
    await expect(isAal2Fresh()).resolves.toBe(false);
  });

  it('AAL2_FRESHNESS_MS is the 15-min window per D-12', () => {
    expect(AAL2_FRESHNESS_MS).toBe(15 * 60 * 1000);
  });
});

describe('requireAal2Fresh', () => {
  it('T7: skips onChallenge + verify when isAal2Fresh() returns true', async () => {
    setAal('aal2');
    setJwt(fakeJwt({ auth_time: Math.floor(Date.now() / 1000) - 60, aal: 'aal2' }));
    const onChallenge = vi.fn();
    await requireAal2Fresh(onChallenge);
    expect(onChallenge).not.toHaveBeenCalled();
    expect(vi.mocked(supabase.auth.mfa.challengeAndVerify)).not.toHaveBeenCalled();
  });

  it('T8: invokes onChallenge + challengeAndVerify when stale; persists ls timestamp on success', async () => {
    setAal('aal2');
    setJwt(fakeJwt({ auth_time: Math.floor(Date.now() / 1000) - 60 * 60, aal: 'aal2' })); // stale
    const onChallenge = vi.fn().mockResolvedValue({ factorId: 'factor-1', code: '123456' });
    vi.mocked(supabase.auth.mfa.challengeAndVerify).mockResolvedValueOnce({
      data: { id: 'ch-1' } as never,
      error: null,
    });
    await requireAal2Fresh(onChallenge);
    expect(onChallenge).toHaveBeenCalledOnce();
    expect(vi.mocked(supabase.auth.mfa.challengeAndVerify)).toHaveBeenCalledWith({
      factorId: 'factor-1',
      code: '123456',
    });
    const ts = Number(localStorage.getItem(AAL2_LS_KEY));
    expect(ts).toBeGreaterThan(Date.now() - 5_000);
  });

  it('T9: throws aal2_challenge_failed when challengeAndVerify returns error', async () => {
    setAal('aal2');
    setJwt(fakeJwt({ auth_time: Math.floor(Date.now() / 1000) - 60 * 60, aal: 'aal2' }));
    const onChallenge = vi.fn().mockResolvedValue({ factorId: 'factor-1', code: 'bad' });
    vi.mocked(supabase.auth.mfa.challengeAndVerify).mockResolvedValueOnce({
      data: null,
      error: { name: 'AuthError', message: 'Invalid TOTP code' } as never,
    });
    await expect(requireAal2Fresh(onChallenge)).rejects.toThrow('aal2_challenge_failed');
    // Should NOT have persisted ls timestamp on failure
    expect(localStorage.getItem(AAL2_LS_KEY)).toBeNull();
  });
});
