/**
 * Phase 66 Plan 66-02 — Consumer AAL2 gate unit tests.
 *
 * Covers the 5 plan-required behaviours of `requireAal2ForConsumerAction`:
 *
 *   T1 — No MFA factor enrolled → { ok: false, reason: 'mfa_not_enabled' }
 *         (caller is allowed to proceed; the gate doesn't apply)
 *   T2 — Already-fresh AAL2 → { ok: true } WITHOUT calling onChallenge
 *   T3 — Stale AAL2 + valid code → { ok: true } AND persists freshness ts
 *   T4 — Stale AAL2 + user cancels → { ok: false, reason: 'cancelled' }
 *   T5 — Stale AAL2 + invalid code → { ok: false, reason: 'invalid_code' }
 *
 * Plus defensive coverage:
 *   T6 — No session → { ok: false, reason: 'session_stale' }
 *   T7 — Missing onChallenge callback → { ok: false, reason: 'cancelled' }
 *
 * The gate is wired against the Phase 25 step-up primitives. Tests mock
 * `@/lib/admin/palette/aal2-step-up` to control the freshness signal
 * without touching JWT decoding or localStorage timing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Aal2StepUp from '@/lib/admin/palette/aal2-step-up';
import { isAal2Fresh, AAL2_LS_KEY } from '@/lib/admin/palette/aal2-step-up';
import { requireAal2ForConsumerAction } from '@/lib/auth/aal2-consumer';

// ---------------------------------------------------------------------------
// localStorage polyfill — `src-lib-unit` runs in node env without jsdom, so
// globalThis.localStorage is undefined. The Phase 25 step-up helper tolerates
// this via try/catch, but the gate's persistFreshnessTs path needs a real
// store to assert against. Install a minimal in-memory polyfill for the
// duration of this test file.
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (!globalThis.localStorage) {
    const store = new Map<string, string>();
    (globalThis as { localStorage: Storage }).localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => {
        store.set(k, String(v));
      },
      removeItem: (k) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

// ---------------------------------------------------------------------------
// Mock the Phase 25 step-up module — we control `isAal2Fresh` per test.
// Constants `AAL2_LS_KEY` + `AAL2_FRESHNESS_MS` keep their real values.
// ---------------------------------------------------------------------------

vi.mock('@/lib/admin/palette/aal2-step-up', async (importOriginal) => {
  const actual = await importOriginal<typeof Aal2StepUp>();
  return {
    ...actual,
    isAal2Fresh: vi.fn(),
  };
});


// ---------------------------------------------------------------------------
// Build a controllable SupabaseClient stub.
// ---------------------------------------------------------------------------

interface ClientStubOpts {
  hasSession?: boolean;
  factors?: Array<{ id: string; status: string; factor_type: string }>;
  verifySucceeds?: boolean;
  currentAal?: 'aal1' | 'aal2';
}

function buildClient(opts: ClientStubOpts = {}) {
  const {
    hasSession = true,
    factors = [
      { id: 'factor-1', factor_type: 'totp', status: 'verified' },
    ],
    verifySucceeds = true,
    currentAal = 'aal2',
  } = opts;

  const challenge = vi.fn().mockResolvedValue({
    data: { id: 'challenge-1' },
    error: null,
  });
  const verify = vi.fn().mockResolvedValue(
    verifySucceeds
      ? { data: { session: {} }, error: null }
      : { data: null, error: { message: 'invalid_code', status: 400 } },
  );
  const listFactors = vi.fn().mockResolvedValue({
    data: { totp: factors, all: factors },
    error: null,
  });
  const getAal = vi
    .fn()
    .mockResolvedValue({ data: { currentLevel: currentAal }, error: null });
  const getSession = vi.fn().mockResolvedValue({
    data: hasSession
      ? { session: { access_token: 'fake.jwt.token' } }
      : { session: null },
    error: null,
  });

  const client = {
    auth: {
      getSession,
      mfa: {
        challenge,
        verify,
        listFactors,
        getAuthenticatorAssuranceLevel: getAal,
      },
    },
  } as unknown as SupabaseClient;

  return { client, challenge, verify, listFactors, getAal, getSession };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  try {
    globalThis.localStorage?.removeItem(AAL2_LS_KEY);
  } catch {
    /* noop */
  }
});

// ---------------------------------------------------------------------------
// T1 — No MFA factor enrolled
// ---------------------------------------------------------------------------

describe('requireAal2ForConsumerAction', () => {
  it('T1: returns { ok: false, reason: "mfa_not_enabled" } when no verified factor', async () => {
    const { client } = buildClient({ factors: [] });

    const result = await requireAal2ForConsumerAction(client, 'delete-account');

    expect(result).toEqual({ ok: false, reason: 'mfa_not_enabled' });
  });

  it('T1b: also returns mfa_not_enabled when only UNVERIFIED factors exist', async () => {
    const { client } = buildClient({
      factors: [{ id: 'f1', factor_type: 'totp', status: 'unverified' }],
    });

    const result = await requireAal2ForConsumerAction(client, 'export-all-data');

    expect(result).toEqual({ ok: false, reason: 'mfa_not_enabled' });
  });

  // -------------------------------------------------------------------------
  // T2 — Already-fresh AAL2
  // -------------------------------------------------------------------------

  it('T2: returns { ok: true } without invoking onChallenge when AAL2 is fresh', async () => {
    const { client } = buildClient();
    vi.mocked(isAal2Fresh).mockResolvedValueOnce(true);

    const onChallenge = vi.fn();
    const result = await requireAal2ForConsumerAction(client, 'delete-account', {
      onChallenge,
    });

    expect(result).toEqual({ ok: true });
    expect(onChallenge).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T3 — Stale AAL2 + valid code
  // -------------------------------------------------------------------------

  it('T3: stale AAL2 + valid code → ok:true + persists freshness ts', async () => {
    const { client, verify } = buildClient({ verifySucceeds: true });
    vi.mocked(isAal2Fresh).mockResolvedValueOnce(false);

    const onChallenge = vi.fn().mockResolvedValue({ code: '123456' });
    const before = Date.now();

    const result = await requireAal2ForConsumerAction(client, 'change-email', {
      onChallenge,
    });

    expect(result).toEqual({ ok: true });
    expect(onChallenge).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith({
      factorId: 'factor-1',
      challengeId: 'challenge-1',
      code: '123456',
    });
    // Freshness ts persisted within the last few ms
    const persisted = Number(globalThis.localStorage?.getItem(AAL2_LS_KEY));
    expect(persisted).toBeGreaterThanOrEqual(before);
    expect(persisted).toBeLessThanOrEqual(Date.now() + 10);
  });

  // -------------------------------------------------------------------------
  // T4 — Stale AAL2 + user cancels modal
  // -------------------------------------------------------------------------

  it('T4: stale AAL2 + user cancels → { ok: false, reason: "cancelled" }', async () => {
    const { client, verify } = buildClient();
    vi.mocked(isAal2Fresh).mockResolvedValueOnce(false);

    const onChallenge = vi.fn().mockResolvedValue({ cancelled: true });

    const result = await requireAal2ForConsumerAction(client, 'delete-account', {
      onChallenge,
    });

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(verify).not.toHaveBeenCalled();
    // No freshness ts persisted on cancel
    expect(globalThis.localStorage?.getItem(AAL2_LS_KEY)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T5 — Stale AAL2 + invalid code
  // -------------------------------------------------------------------------

  it('T5: stale AAL2 + invalid code → { ok: false, reason: "invalid_code" }', async () => {
    const { client } = buildClient({ verifySucceeds: false });
    vi.mocked(isAal2Fresh).mockResolvedValueOnce(false);

    const onChallenge = vi.fn().mockResolvedValue({ code: '000000' });

    const result = await requireAal2ForConsumerAction(client, 'export-all-data', {
      onChallenge,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_code' });
    // No freshness ts persisted on verify-failure
    expect(globalThis.localStorage?.getItem(AAL2_LS_KEY)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T6 — No session at all
  // -------------------------------------------------------------------------

  it('T6: no session → { ok: false, reason: "session_stale" }', async () => {
    const { client } = buildClient({ hasSession: false });

    const result = await requireAal2ForConsumerAction(client, 'delete-account');

    expect(result).toEqual({ ok: false, reason: 'session_stale' });
  });

  // -------------------------------------------------------------------------
  // T7 — Stale + no onChallenge supplied
  // -------------------------------------------------------------------------

  it('T7: stale AAL2 + no onChallenge → { ok: false, reason: "cancelled" } (defensive)', async () => {
    const { client } = buildClient();
    vi.mocked(isAal2Fresh).mockResolvedValueOnce(false);

    const result = await requireAal2ForConsumerAction(client, 'change-email');

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });

  // -------------------------------------------------------------------------
  // freshWindowMs override path
  // -------------------------------------------------------------------------

  it('honours opts.freshWindowMs override: 5-min window + 6-min-old ts → stale', async () => {
    const { client } = buildClient({ currentAal: 'aal2' });
    // Don't let the default helper short-circuit — caller supplies window.
    vi.mocked(isAal2Fresh).mockResolvedValueOnce(true); // would say fresh on 15-min window

    // Seed a 6-min-old timestamp
    const sixMinAgo = Date.now() - 6 * 60 * 1000;
    globalThis.localStorage?.setItem(AAL2_LS_KEY, String(sixMinAgo));

    const onChallenge = vi.fn().mockResolvedValue({ cancelled: true });
    const result = await requireAal2ForConsumerAction(client, 'delete-account', {
      freshWindowMs: 5 * 60 * 1000,
      onChallenge,
    });

    // 6-min-old ts vs 5-min window → STALE → onChallenge invoked → cancelled
    expect(onChallenge).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });
});
