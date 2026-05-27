/**
 * handler.test.ts — Deno tests for auth-rate-limit-check handler.
 *
 * Phase 66 Plan 66-05 (AUTH-14 + AUTH-15).
 *
 * Coverage:
 *   T1: check with no prior attempts → { allowed: true }
 *   T2: check with 5 failures from same email in 15min → { allowed: false, reason: 'email' }
 *   T3: check with 5 failures from same IP in 15min  → { allowed: false, reason: 'ip' }
 *   T4: log_failure inserts row + fires PostHog when IP threshold crossed
 *   T5: log_failure fires brute-force alert when email threshold crossed
 *   T6: log_success deletes prior failure rows for the email
 *   T7: GET /healthz → 200 { ok: true, fn: 'auth-rate-limit-check' }
 *   T8: invalid method / invalid JSON / invalid action → 4xx
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  BRUTE_FORCE_EMAIL_THRESHOLD,
  BRUTE_FORCE_IP_THRESHOLD,
  handle,
  LOCKOUT_THRESHOLD,
  type CheckResponse,
  type LogResponse,
  type RateLimitDeps,
} from '../handler.ts';

// ── Mock supabase client ────────────────────────────────────────────────────

interface FailureRow {
  email: string | null;
  ip_address: string | null;
  attempt_at: string;
  outcome: 'success' | 'failed' | 'locked' | 'captcha';
}

interface MockState {
  rows: FailureRow[];
  insertedRows: Array<Record<string, unknown>>;
  deleteCalls: Array<{ email: string; sinceIso: string }>;
}

/**
 * Build a chainable query builder that mirrors the subset of the
 * supabase-js v2 API used by handler.ts:
 *   client.from(table).select('id', {count:'exact', head:true})
 *                     .eq('outcome','failed')
 *                     .gte('attempt_at', iso)
 *                     .eq(<key>, <value>) → { count, error }
 *   client.from(table).insert(row)        → { error }
 *   client.from(table).delete()
 *                     .eq(...).eq(...).gte(...) → { error }
 */
function buildMockClient(state: MockState): RateLimitDeps['supabaseServiceClient'] {
  function buildSelectChain(initialOpts: { head: boolean; countMode: string }) {
    const filters: Array<(row: FailureRow) => boolean> = [];
    const chain = {
      eq(field: string, value: unknown) {
        filters.push((row) => (row as unknown as Record<string, unknown>)[field] === value);
        return chain;
      },
      gte(field: string, value: string) {
        filters.push((row) => {
          const cell = (row as unknown as Record<string, unknown>)[field];
          return typeof cell === 'string' && cell >= value;
        });
        return chain;
      },
      then(
        resolve: (
          v: { count: number | null; data: unknown; error: null },
        ) => unknown,
      ) {
        const matched = state.rows.filter((row) => filters.every((f) => f(row)));
        return Promise.resolve(resolve({
          count: initialOpts.head ? matched.length : null,
          data: initialOpts.head ? null : matched,
          error: null,
        }));
      },
    };
    return chain;
  }

  function buildDeleteChain() {
    const filters: Array<{ kind: 'eq' | 'gte'; field: string; value: unknown }> = [];
    let resolved = false;
    const chain = {
      eq(field: string, value: unknown) {
        filters.push({ kind: 'eq', field, value });
        return chain;
      },
      gte(field: string, value: string) {
        filters.push({ kind: 'gte', field, value });
        return chain;
      },
      then(
        resolve: (v: { error: null }) => unknown,
      ) {
        if (resolved) return Promise.resolve(resolve({ error: null }));
        resolved = true;
        const emailFilter = filters.find((f) => f.field === 'email');
        const sinceFilter = filters.find((f) => f.field === 'attempt_at' && f.kind === 'gte');
        if (emailFilter && sinceFilter) {
          state.deleteCalls.push({
            email: emailFilter.value as string,
            sinceIso: sinceFilter.value as string,
          });
          // Apply the same filters used by handler.ts to mutate state.
          state.rows = state.rows.filter((row) => {
            let drop = true;
            for (const f of filters) {
              const cell = (row as unknown as Record<string, unknown>)[f.field];
              if (f.kind === 'eq') {
                if (cell !== f.value) drop = false;
              } else if (f.kind === 'gte') {
                if (!(typeof cell === 'string' && cell >= (f.value as string))) drop = false;
              }
            }
            return !drop;
          });
        }
        return Promise.resolve(resolve({ error: null }));
      },
    };
    return chain;
  }

  const mockClient = {
    from(_table: string) {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          return buildSelectChain({
            head: opts?.head ?? false,
            countMode: opts?.count ?? '',
          });
        },
        insert(row: Record<string, unknown>) {
          state.insertedRows.push(row);
          return Promise.resolve({ error: null });
        },
        delete() {
          return buildDeleteChain();
        },
      };
    },
  };
  return mockClient as unknown as RateLimitDeps['supabaseServiceClient'];
}

// ── Mock PostHog + Slack ────────────────────────────────────────────────────

interface MockPostHog {
  captures: Array<{ distinctId: string; event: string; properties: Record<string, unknown> }>;
}

function buildMockPosthog(): { sink: NonNullable<RateLimitDeps['posthog']>; spy: MockPostHog } {
  const spy: MockPostHog = { captures: [] };
  return {
    sink: {
      capture: (args) => {
        spy.captures.push(args);
      },
    },
    spy,
  };
}

interface MockSlackSpy {
  calls: Array<{ channel: string; title: string }>;
}

function buildMockSlack(): { fn: NonNullable<RateLimitDeps['sendSlack']>; spy: MockSlackSpy } {
  const spy: MockSlackSpy = { calls: [] };
  return {
    fn: (async (channel, payload) => {
      spy.calls.push({ channel, title: payload.title });
    }) as NonNullable<RateLimitDeps['sendSlack']>,
    spy,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const FROZEN_NOW = new Date('2026-05-27T12:00:00.000Z');

function buildRequest(opts: {
  method: 'GET' | 'POST';
  path?: string;
  body?: unknown;
  ip?: string;
}): Request {
  const path = opts.path ?? '/';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.ip) headers.set('x-forwarded-for', opts.ip);
  return new Request(`https://test.supabase.co/functions/v1/auth-rate-limit-check${path}`, {
    method: opts.method,
    headers,
    body: opts.method === 'POST' && opts.body !== undefined
      ? JSON.stringify(opts.body)
      : undefined,
  });
}

function buildDeps(state: MockState): { deps: RateLimitDeps; posthog: MockPostHog; slack: MockSlackSpy } {
  const { sink, spy: posthog } = buildMockPosthog();
  const { fn, spy: slack } = buildMockSlack();
  return {
    deps: {
      supabaseServiceClient: buildMockClient(state),
      posthog: sink,
      sendSlack: fn,
      now: () => FROZEN_NOW,
    },
    posthog,
    slack,
  };
}

function seedFailures(count: number, opts: { email?: string | null; ip?: string | null }): FailureRow[] {
  const out: FailureRow[] = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(FROZEN_NOW.getTime() - (i + 1) * 60_000).toISOString(); // 1-min spacing
    out.push({
      email: opts.email ?? null,
      ip_address: opts.ip ?? null,
      attempt_at: ts,
      outcome: 'failed',
    });
  }
  return out;
}

// ─── T1 ──────────────────────────────────────────────────────────────────────

Deno.test('T1: check with no prior attempts → { allowed: true }', async () => {
  const state: MockState = { rows: [], insertedRows: [], deleteCalls: [] };
  const { deps } = buildDeps(state);

  const req = buildRequest({
    method: 'POST',
    body: { action: 'check', email: 'alice@example.com' },
    ip: '203.0.113.10',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as CheckResponse;
  assertEquals(body.allowed, true);
});

// ─── T2 ──────────────────────────────────────────────────────────────────────

Deno.test('T2: 5 failures from same email in 15min → { allowed: false, reason: "email" }', async () => {
  const state: MockState = {
    rows: seedFailures(LOCKOUT_THRESHOLD, { email: 'alice@example.com', ip: null }),
    insertedRows: [],
    deleteCalls: [],
  };
  const { deps } = buildDeps(state);

  const req = buildRequest({
    method: 'POST',
    body: { action: 'check', email: 'alice@example.com' },
    ip: '203.0.113.10',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as CheckResponse;
  if (body.allowed) throw new Error('expected lockout response');
  assertEquals(body.reason, 'email');
  // locked_until must be ~30 min in the future.
  const lockedUntil = new Date(body.locked_until).getTime();
  const expected = FROZEN_NOW.getTime() + 30 * 60_000;
  if (Math.abs(lockedUntil - expected) > 2000) {
    throw new Error(`locked_until off: got ${body.locked_until}`);
  }
});

// ─── T3 ──────────────────────────────────────────────────────────────────────

Deno.test('T3: 5 failures from same IP in 15min → { allowed: false, reason: "ip" }', async () => {
  // Seed with rows that have a DIFFERENT email so the email-lockout branch
  // does not trigger first — only the IP branch should fire.
  const state: MockState = {
    rows: seedFailures(LOCKOUT_THRESHOLD, { email: 'someone-else@example.com', ip: '203.0.113.10' }),
    insertedRows: [],
    deleteCalls: [],
  };
  const { deps } = buildDeps(state);

  const req = buildRequest({
    method: 'POST',
    body: { action: 'check', email: 'alice@example.com' },
    ip: '203.0.113.10',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as CheckResponse;
  if (body.allowed) throw new Error('expected lockout response');
  assertEquals(body.reason, 'ip');
});

// ─── T4 ──────────────────────────────────────────────────────────────────────

Deno.test('T4: log_failure inserts row + fires brute-force alert when IP threshold crossed', async () => {
  // Seed BRUTE_FORCE_IP_THRESHOLD-1 prior failures so the inserted row
  // pushes count to exactly the threshold.
  const state: MockState = {
    rows: seedFailures(BRUTE_FORCE_IP_THRESHOLD - 1, {
      email: 'attacker@example.com',
      ip: '203.0.113.99',
    }),
    insertedRows: [],
    deleteCalls: [],
  };
  // After handler inserts the failure row, we need the next count query
  // (which reads `state.rows`) to see threshold worth of failures. Seed
  // the threshold rows upfront — the insertedRows side-effect doesn't
  // need to mutate `state.rows` because count queries go through the
  // mock client which reads state.rows directly.
  state.rows = seedFailures(BRUTE_FORCE_IP_THRESHOLD, {
    email: 'attacker@example.com',
    ip: '203.0.113.99',
  });
  const { deps, posthog, slack } = buildDeps(state);

  const req = buildRequest({
    method: 'POST',
    body: {
      action: 'log_failure',
      email: 'attacker@example.com',
      failure_reason: 'invalid_credentials',
    },
    ip: '203.0.113.99',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as LogResponse;
  assertEquals(body.ok, true);
  assertEquals(body.brute_force?.kind, 'ip');

  // Insert side-effect verified.
  assertEquals(state.insertedRows.length, 1);
  const inserted = state.insertedRows[0]!;
  assertEquals(inserted.outcome, 'failed');
  assertEquals(inserted.email, 'attacker@example.com');
  assertEquals(inserted.ip_address, '203.0.113.99');
  assertEquals(inserted.failure_reason, 'invalid_credentials');

  // PostHog capture fired.
  assertEquals(posthog.captures.length >= 1, true);
  assertEquals(posthog.captures[0]!.event, 'auth_brute_force_detected');
  assertEquals(posthog.captures[0]!.properties.kind, 'ip');

  // Slack alert fired.
  assertEquals(slack.calls.length >= 1, true);
  assertEquals(slack.calls[0]!.channel, 'regulatory');
});

// ─── T5 ──────────────────────────────────────────────────────────────────────

Deno.test('T5: log_failure fires brute-force alert when email threshold crossed', async () => {
  const state: MockState = {
    rows: seedFailures(BRUTE_FORCE_EMAIL_THRESHOLD, {
      email: 'victim@example.com',
      ip: null,
    }),
    insertedRows: [],
    deleteCalls: [],
  };
  const { deps, posthog, slack } = buildDeps(state);

  const req = buildRequest({
    method: 'POST',
    body: {
      action: 'log_failure',
      email: 'victim@example.com',
      failure_reason: 'invalid_credentials',
    },
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = (await res.json()) as LogResponse;
  assertEquals(body.brute_force?.kind, 'email');

  const captures = posthog.captures.filter((c) => c.properties.kind === 'email');
  assertEquals(captures.length >= 1, true);
  assertEquals(slack.calls.length >= 1, true);
});

// ─── T6 ──────────────────────────────────────────────────────────────────────

Deno.test('T6: log_success deletes prior failure rows for the email', async () => {
  const state: MockState = {
    rows: seedFailures(3, { email: 'alice@example.com', ip: '203.0.113.10' }),
    insertedRows: [],
    deleteCalls: [],
  };
  const { deps } = buildDeps(state);

  const req = buildRequest({
    method: 'POST',
    body: { action: 'log_success', email: 'alice@example.com' },
    ip: '203.0.113.10',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);

  // Success row inserted.
  assertEquals(state.insertedRows.length, 1);
  assertEquals(state.insertedRows[0]!.outcome, 'success');
  assertEquals(state.insertedRows[0]!.email, 'alice@example.com');

  // Delete call recorded with the normalized email.
  assertEquals(state.deleteCalls.length, 1);
  assertEquals(state.deleteCalls[0]!.email, 'alice@example.com');
});

// ─── T7 ──────────────────────────────────────────────────────────────────────

Deno.test('T7: GET /healthz → 200 { ok: true, fn: "auth-rate-limit-check" }', async () => {
  const state: MockState = { rows: [], insertedRows: [], deleteCalls: [] };
  const { deps } = buildDeps(state);

  const req = buildRequest({ method: 'GET', path: '/healthz' });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; fn: string };
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'auth-rate-limit-check');
});

// ─── T8 ──────────────────────────────────────────────────────────────────────

Deno.test('T8: invalid method / JSON / action → 4xx', async () => {
  const state: MockState = { rows: [], insertedRows: [], deleteCalls: [] };
  const { deps } = buildDeps(state);

  // Unsupported method
  const putReq = new Request('https://test.supabase.co/functions/v1/auth-rate-limit-check', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
  });
  const putRes = await handle(putReq, deps);
  assertEquals(putRes.status, 405);

  // Invalid JSON
  const badJsonReq = new Request('https://test.supabase.co/functions/v1/auth-rate-limit-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  const badJsonRes = await handle(badJsonReq, deps);
  assertEquals(badJsonRes.status, 400);

  // Invalid action
  const invalidActionReq = buildRequest({
    method: 'POST',
    body: { action: 'not_a_real_action', email: 'x@example.com' },
  });
  const invalidActionRes = await handle(invalidActionReq, deps);
  assertEquals(invalidActionRes.status, 400);
});

// ─── T9: lowercases email at check time (idx_auth_attempts_email_ts) ────────

Deno.test('T9: email lookup normalizes to lowercase', async () => {
  const state: MockState = {
    rows: seedFailures(LOCKOUT_THRESHOLD, { email: 'alice@example.com', ip: null }),
    insertedRows: [],
    deleteCalls: [],
  };
  const { deps } = buildDeps(state);

  // Submit MIXED-CASE email — handler must normalize.
  const req = buildRequest({
    method: 'POST',
    body: { action: 'check', email: 'Alice@Example.COM' },
    ip: '203.0.113.10',
  });
  const res = await handle(req, deps);
  const body = (await res.json()) as CheckResponse;
  if (body.allowed) throw new Error('expected lockout via lowercased email');
  assertEquals(body.reason, 'email');
});
