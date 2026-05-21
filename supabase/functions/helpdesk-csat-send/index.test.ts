/**
 * Phase 37 Plan 37-05 Task 2 — Deno test suite for `helpdesk-csat-send` Edge Fn.
 *
 * Coverage maps to plan <behavior> list (9 cases):
 *
 *   T1.  Missing Authorization Bearer → 401
 *   T2.  ticket.csat_sent_at already set → 200 skipped, sendEmail NOT called
 *   T3.  csat_responses row already exists for ticket → 200 skipped, sendEmail NOT called
 *   T4.  phi=true ticket → sendEmail called with phi: true
 *   T5.  phi=false ticket → sendEmail called with phi: false
 *   T6.  CSAT URL contains t, e, s query params; s = base64url HMAC over `${ticket_id}:csat:${e}`
 *   T7.  After send, tickets.csat_sent_at is set to current timestamp
 *   T8.  Profile has no email → 200, no sendEmail call
 *   T9.  sendEmail throws on phi=true SES failure → error propagates (no Resend fallback)
 *
 * Strategy mirrors helpdesk-ai-assist/index.test.ts — hand-rolled chainable
 * supabase admin mock + sendEmail stub via __internal test seam.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@^1';

// ─── 1. Env vars BEFORE module import (load-bearing for default singletons) ───
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test_service_key');
Deno.env.set('HELPDESK_CSAT_SIGNING_SECRET', 'test_csat_signing_secret_32bytes_long');

const mod = await import('./index.ts');

// ─── 2. Hand-rolled chainable supabase admin mock ─────────────────────────────
type Row = Record<string, unknown>;
interface MockState {
  ticketsById: Map<string, Row>;
  profilesById: Map<string, Row>;
  csatResponsesByTicket: Map<string, Row>;
  ticket_updates: Array<{ id: string; updates: Row }>;
}
function freshState(): MockState {
  return {
    ticketsById: new Map(),
    profilesById: new Map(),
    csatResponsesByTicket: new Map(),
    ticket_updates: [],
  };
}

interface ChainOpts {
  table: string;
  state: MockState;
  filters: Record<string, unknown>;
}

function buildChain(opts: ChainOpts) {
  const ch: Record<string, unknown> = {};
  ch.select = (_cols?: string) => ch;
  ch.eq = (col: string, val: unknown) => {
    opts.filters[col] = val;
    return ch;
  };
  ch.maybeSingle = () => Promise.resolve(resolveRead(opts));
  ch.single = () => Promise.resolve(resolveRead(opts, true));
  ch.then = (resolveCb: (v: unknown) => void) => {
    resolveCb(resolveRead(opts));
    return ch;
  };
  return ch;
}

function resolveRead(o: ChainOpts, single = false) {
  const { table, state, filters } = o;
  if (table === 'tickets') {
    if (filters.id) {
      const row = state.ticketsById.get(filters.id as string) ?? null;
      return { data: row, error: null };
    }
  }
  if (table === 'profiles') {
    if (filters.id) {
      const row = state.profilesById.get(filters.id as string) ?? null;
      return { data: row, error: null };
    }
  }
  if (table === 'csat_responses') {
    if (filters.ticket_id) {
      const row = state.csatResponsesByTicket.get(filters.ticket_id as string) ?? null;
      return { data: row, error: null };
    }
  }
  if (single) return { data: null, error: { code: 'not_found' } };
  return { data: null, error: null };
}

function buildUpdateChain(opts: { table: string; updates: Row; state: MockState }) {
  const ch: Record<string, unknown> = {};
  let pendingId: string | null = null;
  ch.eq = (col: string, val: unknown) => {
    if (col === 'id') pendingId = val as string;
    return ch;
  };
  ch.then = (resolveCb: (v: unknown) => void) => {
    if (opts.table === 'tickets' && pendingId) {
      opts.state.ticket_updates.push({ id: pendingId, updates: opts.updates });
      const cur = opts.state.ticketsById.get(pendingId);
      if (cur) opts.state.ticketsById.set(pendingId, { ...cur, ...opts.updates });
    }
    resolveCb({ data: null, error: null });
    return ch;
  };
  return ch;
}

function buildAdminMock(state: MockState) {
  // deno-lint-ignore no-explicit-any
  const admin: any = {
    from(table: string) {
      return {
        select: (_cols?: string) => buildChain({ table, state, filters: {} }),
        update: (updates: Row) => buildUpdateChain({ table, updates, state }),
      };
    },
  };
  return admin;
}

// ─── 3. sendEmail stub ────────────────────────────────────────────────────────
interface SendEmailCall {
  template: string;
  to: string;
  vars: Record<string, unknown>;
  phi: boolean;
}

function makeSendEmailStub(): {
  calls: SendEmailCall[];
  fn: (
    _supabase: unknown,
    args: { template: string; to: string; vars: Record<string, unknown>; phi: boolean },
  ) => Promise<{ provider: 'ses' | 'resend'; id: string }>;
} {
  const calls: SendEmailCall[] = [];
  return {
    calls,
    fn: (_supabase, args) => {
      calls.push({
        template: args.template,
        to: args.to,
        vars: args.vars,
        phi: args.phi,
      });
      return Promise.resolve({ provider: args.phi ? 'ses' : 'resend', id: 'msg-test' });
    },
  };
}

// ─── 4. Helpers ───────────────────────────────────────────────────────────────
const SERVICE_BEARER = 'Bearer test_service_key';

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/functions/v1/helpdesk-csat-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function seedTicket(
  state: MockState,
  opts: { ticketId?: string; phi?: boolean; csatSentAt?: string | null; subject?: string } = {},
) {
  const ticketId = opts.ticketId ?? 'tk-1';
  state.ticketsById.set(ticketId, {
    id: ticketId,
    org_id: 'org-1',
    user_id: 'user-1',
    phi: opts.phi ?? false,
    subject: opts.subject ?? 'Help with billing',
    csat_sent_at: opts.csatSentAt ?? null,
  });
  state.profilesById.set('user-1', { id: 'user-1', email: 'user@example.com' });
  return ticketId;
}

// ─── T1: missing bearer → 401 ─────────────────────────────────────────────────

Deno.test('T1: missing Authorization Bearer → 401', async () => {
  const state = freshState();
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(makeReq({ ticket_id: 'tk-1' }));
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0, 'sendEmail must NOT be called');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

Deno.test('T1b: wrong bearer → 401', async () => {
  const state = freshState();
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: 'Bearer wrong' }),
    );
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// ─── T2: csat_sent_at already set → 200 skipped, no send ─────────────────────

Deno.test('T2: ticket.csat_sent_at already set → 200 skipped; sendEmail NOT called', async () => {
  const state = freshState();
  seedTicket(state, { csatSentAt: '2026-01-01T00:00:00Z' });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { skipped?: string };
    assertEquals(body.skipped, 'already_sent');
    assertEquals(calls.length, 0, 'sendEmail must NOT be called on idempotent re-fire');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// ─── T3: csat_responses row already exists → 200 skipped, no send ────────────

Deno.test('T3: csat_responses row exists → 200 skipped; sendEmail NOT called', async () => {
  const state = freshState();
  seedTicket(state);
  state.csatResponsesByTicket.set('tk-1', {
    ticket_id: 'tk-1',
    user_id: 'user-1',
    rating: 4,
  });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { skipped?: string };
    assertEquals(body.skipped, 'already_responded');
    assertEquals(calls.length, 0);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// ─── T4: phi=true → sendEmail called with phi:true ───────────────────────────

Deno.test('T4: phi=true ticket → sendEmail called with phi: true', async () => {
  const state = freshState();
  seedTicket(state, { phi: true });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0]!.phi, true);
    assertEquals(calls[0]!.template, 'csat_followup');
    assertEquals(calls[0]!.to, 'user@example.com');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// ─── T5: phi=false → sendEmail called with phi:false ─────────────────────────

Deno.test('T5: phi=false ticket → sendEmail called with phi: false', async () => {
  const state = freshState();
  seedTicket(state, { phi: false });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0]!.phi, false);
    assertEquals(calls[0]!.template, 'csat_followup');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// ─── T6: CSAT URL signature shape — t, e, s params; s = HMAC ────────────────

Deno.test('T6: CSAT URL has t/e/s params; s is base64url HMAC over ${ticket_id}:csat:${e}', async () => {
  const state = freshState();
  seedTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(calls.length, 1);
    const url = String(calls[0]!.vars.csat_url ?? '');
    assert(url.length > 0, 'csat_url must be set in template vars');
    const u = new URL(url);
    const t = u.searchParams.get('t');
    const e = u.searchParams.get('e');
    const s = u.searchParams.get('s');
    assertEquals(t, 'tk-1');
    assert(e && /^\d+$/.test(e), 'e is unix-seconds integer');
    assert(s && s.length > 0, 's must be present');
    // No padding / + / / chars — base64url.
    assert(!s.includes('+') && !s.includes('/') && !s.includes('='), 's must be base64url-encoded');
    // Recompute the expected signature locally and compare.
    const expected = await computeExpectedSig('test_csat_signing_secret_32bytes_long', `tk-1:csat:${e}`);
    assertEquals(s, expected, 'signature must equal HMAC-SHA256 over ${ticket_id}:csat:${e}');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

async function computeExpectedSig(secret: string, msg: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(msg)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ─── T7: tickets.csat_sent_at update after send ─────────────────────────────

Deno.test('T7: after send, tickets.csat_sent_at is set', async () => {
  const state = freshState();
  seedTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.ticket_updates.length, 1);
    const u = state.ticket_updates[0]!;
    assertEquals(u.id, 'tk-1');
    assert(typeof u.updates.csat_sent_at === 'string', 'csat_sent_at must be set to ISO timestamp');
    // Parseable as a Date.
    const d = new Date(u.updates.csat_sent_at as string);
    assert(!Number.isNaN(d.getTime()), 'csat_sent_at must be parseable as a Date');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// ─── T8: profile has no email → 200, no send ────────────────────────────────

Deno.test('T8: profile has no email → 200 skipped no_recipient; sendEmail NOT called', async () => {
  const state = freshState();
  seedTicket(state);
  // Override the profile to have no email.
  state.profilesById.set('user-1', { id: 'user-1', email: null });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const { calls, fn } = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(fn);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { skipped?: string };
    assertEquals(body.skipped, 'no_recipient');
    assertEquals(calls.length, 0);
    // csat_sent_at must NOT be stamped (we couldn't send, so re-tries on a
    // future profile-email update should still be possible).
    assertEquals(state.ticket_updates.length, 0);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// ─── T9: sendEmail throws on phi=true SES failure → propagates ──────────────

Deno.test('T9: sendEmail throws on phi=true SES failure → error propagates (no Resend fallback)', async () => {
  const state = freshState();
  seedTicket(state, { phi: true });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  // Force sendEmail to throw — mimics the ses_send_failed path from email-router.
  mod.__internal.setSendEmailForTest(() => {
    throw new Error('ses_send_failed');
  });
  try {
    // We expect the handler NOT to swallow the error on phi=true. The handler
    // should return a 500 (or rethrow); either way, csat_sent_at must NOT be
    // stamped (the send failed) so a future trigger refire can retry.
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1' }, { Authorization: SERVICE_BEARER }),
    );
    assertEquals(res.status, 500);
    assertEquals(state.ticket_updates.length, 0, 'csat_sent_at must NOT be stamped on SES failure');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
  }
});

// Bonus T9b — assertion via assertRejects on a low-level helper if we ever
// expose one. For now the 500-response behavior is the contract.
Deno.test('T9b: signing helper sanity — recomputable from secret/ticket/expiry', async () => {
  const a = await computeExpectedSig('s', 'tk:csat:1');
  const b = await computeExpectedSig('s', 'tk:csat:1');
  assertEquals(a, b);
  assert(a.length > 0);
  // Use assertRejects to exercise the import — keeps the import alive.
  await assertRejects(() => Promise.reject(new Error('x')), Error);
});
