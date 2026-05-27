/**
 * sign-in-with-lockout.test.ts
 *
 * Phase 66 Plan 66-05 (AUTH-14 + AUTH-15).
 *
 * Coverage:
 *   T1: check returns allowed=false → wrapper returns { ok:false, reason:'locked' }
 *       AND does NOT call supabase.auth.signInWithPassword
 *   T2: check returns allowed=true + supabase succeeds → { ok:true, user }
 *       AND log_success POST fires
 *   T3: check returns allowed=true + supabase rejects → { ok:false, reason:'invalid_credentials' }
 *       AND log_failure POST fires
 *   T4: rate-limit Fn unreachable (fetch throws) → falls through to supabase
 *   T5: email is lowercased before being sent to both rate-limit Fn and Supabase
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { signInWithLockout } from './sign-in-with-lockout';

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function buildMockFetch(
  responses: Array<{ status: number; body: unknown } | Error>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const parsed = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : {};
    calls.push({ url, body: parsed });
    const next = responses[i++];
    if (next instanceof Error) throw next;
    if (!next) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function buildMockSupabase(opts: {
  signInResult:
    | { data: { user: User }; error: null }
    | { data: { user: null }; error: { message: string } };
}): { client: SupabaseClient; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockResolvedValue(opts.signInResult);
  const client = {
    auth: {
      signInWithPassword: spy,
    },
  } as unknown as SupabaseClient;
  return { client, spy };
}

const FAKE_USER = {
  id: 'user-1',
  email: 'alice@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
} as unknown as User;

const FN_URL = 'https://test.supabase.co/functions/v1/auth-rate-limit-check';

describe('signInWithLockout', () => {
  it('T1: locked → returns locked result and does NOT call supabase', async () => {
    const lockedUntilIso = '2026-05-27T12:30:00.000Z';
    const { fetchImpl, calls } = buildMockFetch([
      { status: 200, body: { allowed: false, reason: 'email', locked_until: lockedUntilIso } },
    ]);
    const { client, spy } = buildMockSupabase({
      signInResult: { data: { user: FAKE_USER }, error: null },
    });

    const result = await signInWithLockout(client, 'alice@example.com', 'pw', {
      rateLimitUrl: FN_URL,
      fetchImpl,
      anonKey: 'test-anon',
      awaitLogging: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected locked');
    expect(result.reason).toBe('locked');
    expect(result.lockoutReason).toBe('email');
    expect(result.lockedUntil.toISOString()).toBe(lockedUntilIso);
    expect(spy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.action).toBe('check');
  });

  it('T2: allowed + supabase success → ok=true and log_success POST fires', async () => {
    const { fetchImpl, calls } = buildMockFetch([
      { status: 200, body: { allowed: true } },
      { status: 200, body: { ok: true } }, // log_success response
    ]);
    const { client, spy } = buildMockSupabase({
      signInResult: { data: { user: FAKE_USER }, error: null },
    });

    const result = await signInWithLockout(client, 'Alice@Example.com', 'pw', {
      rateLimitUrl: FN_URL,
      fetchImpl,
      anonKey: 'test-anon',
      awaitLogging: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.user.id).toBe('user-1');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'pw' });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.action).toBe('check');
    expect(calls[1]!.body.action).toBe('log_success');
    expect(calls[1]!.body.email).toBe('alice@example.com');
  });

  it('T3: allowed + supabase rejects → ok=false invalid_credentials + log_failure fires', async () => {
    const { fetchImpl, calls } = buildMockFetch([
      { status: 200, body: { allowed: true } },
      { status: 200, body: { ok: true } }, // log_failure response
    ]);
    const { client, spy } = buildMockSupabase({
      signInResult: {
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      },
    });

    const result = await signInWithLockout(client, 'alice@example.com', 'wrong', {
      rateLimitUrl: FN_URL,
      fetchImpl,
      anonKey: 'test-anon',
      awaitLogging: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid');
    expect(result.reason).toBe('invalid_credentials');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.action).toBe('log_failure');
    expect(calls[1]!.body.failure_reason).toBe('Invalid login credentials');
  });

  it('T4: rate-limit Fn unreachable → falls through to supabase', async () => {
    const { fetchImpl, calls } = buildMockFetch([
      new Error('Network error'),
      { status: 200, body: { ok: true } }, // log_success
    ]);
    const { client, spy } = buildMockSupabase({
      signInResult: { data: { user: FAKE_USER }, error: null },
    });

    const result = await signInWithLockout(client, 'alice@example.com', 'pw', {
      rateLimitUrl: FN_URL,
      fetchImpl,
      anonKey: 'test-anon',
      awaitLogging: true,
    });

    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    // First call was the check (which threw); second was log_success.
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('T5: email is lowercased before being sent to rate-limit Fn and Supabase', async () => {
    const { fetchImpl, calls } = buildMockFetch([
      { status: 200, body: { allowed: true } },
      { status: 200, body: { ok: true } },
    ]);
    const { client, spy } = buildMockSupabase({
      signInResult: { data: { user: FAKE_USER }, error: null },
    });

    await signInWithLockout(client, '  ALICE@Example.COM  ', 'pw', {
      rateLimitUrl: FN_URL,
      fetchImpl,
      anonKey: 'test-anon',
      awaitLogging: true,
    });

    expect(calls[0]!.body.email).toBe('alice@example.com');
    expect(spy).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'pw' });
  });
});
