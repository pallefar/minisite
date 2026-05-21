/**
 * Phase 37 Plan 37-07 Task 3 — Deno test suite for `helpdesk-agent-reply-send`.
 *
 * Coverage:
 *   T1.  Missing Authorization Bearer → 401
 *   T2.  Service-role Bearer is accepted (no org check) → success
 *   T3.  JWT path: agent in org_members → success
 *   T4.  JWT path: agent NOT in org_members → 403
 *   T5.  phi=true ticket → sendEmail called with phi: true
 *   T6.  phi=false ticket → sendEmail called with phi: false
 *   T7.  Reply-To header in vars is `reply+<token>@app.leanshot.app`
 *   T8.  ticket_messages row not found → 404; sendEmail NOT called
 *   T9.  message belongs to a different ticket → 404; sendEmail NOT called
 *   T10. No recipient email in profiles → 200 skipped; sendEmail NOT called
 *
 * Strategy mirrors helpdesk-csat-send/index.test.ts — chainable supabase admin
 * mock + sendEmail stub via __internal seam.
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';

// 1. Env vars BEFORE module import (singletons read at first call).
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test_service_key');
Deno.env.set('HELPDESK_REPLY_DOMAIN', 'app.leanshot.app');

const mod = await import('./index.ts');

// 2. Chainable supabase admin mock.
type Row = Record<string, unknown>;
interface MockState {
  ticketsById: Map<string, Row>;
  messagesById: Map<string, Row>;
  profilesById: Map<string, Row>;
  orgMembers: Set<string>; // `${userId}:${orgId}`
  authUsersByJwt: Map<string, { id: string }>;
  ticket_updates: Array<{ id: string; updates: Row }>;
  rpcCalls: Array<{ fn: string; args: Row }>;
  rpcReturns: Map<string, unknown>;
}
function freshState(): MockState {
  return {
    ticketsById: new Map(),
    messagesById: new Map(),
    profilesById: new Map(),
    orgMembers: new Set(),
    authUsersByJwt: new Map(),
    ticket_updates: [],
    rpcCalls: [],
    rpcReturns: new Map(),
  };
}

interface ChainOpts {
  table: string;
  state: MockState;
  filters: Record<string, unknown>;
}

function resolveRead(o: ChainOpts) {
  const { table, state, filters } = o;
  if (table === 'tickets' && filters.id) {
    return { data: state.ticketsById.get(filters.id as string) ?? null, error: null };
  }
  if (table === 'ticket_messages' && filters.id) {
    return { data: state.messagesById.get(filters.id as string) ?? null, error: null };
  }
  if (table === 'profiles' && filters.id) {
    return { data: state.profilesById.get(filters.id as string) ?? null, error: null };
  }
  if (table === 'org_members' && filters.user_id && filters.org_id) {
    const key = `${String(filters.user_id)}:${String(filters.org_id)}`;
    if (state.orgMembers.has(key)) {
      return { data: { user_id: filters.user_id }, error: null };
    }
    return { data: null, error: null };
  }
  return { data: null, error: null };
}

function buildReadChain(opts: ChainOpts) {
  const ch: Record<string, unknown> = {};
  ch.select = (_cols?: string) => ch;
  ch.eq = (col: string, val: unknown) => {
    opts.filters[col] = val;
    return ch;
  };
  ch.maybeSingle = () => Promise.resolve(resolveRead(opts));
  ch.single = () => Promise.resolve(resolveRead(opts));
  ch.then = (resolveCb: (v: unknown) => void) => {
    resolveCb(resolveRead(opts));
    return ch;
  };
  return ch;
}

function buildUpdateChain(table: string, updates: Row, state: MockState) {
  const ch: Record<string, unknown> = {};
  let pendingId: string | null = null;
  ch.eq = (col: string, val: unknown) => {
    if (col === 'id') pendingId = val as string;
    return ch;
  };
  ch.then = (resolveCb: (v: unknown) => void) => {
    if (table === 'tickets' && pendingId) {
      state.ticket_updates.push({ id: pendingId, updates });
      const cur = state.ticketsById.get(pendingId);
      if (cur) state.ticketsById.set(pendingId, { ...cur, ...updates });
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
        select: (_cols?: string) => buildReadChain({ table, state, filters: {} }),
        update: (updates: Row) => buildUpdateChain(table, updates, state),
      };
    },
    rpc(fn: string, args: Row) {
      state.rpcCalls.push({ fn, args });
      const ret = state.rpcReturns.get(fn);
      if (ret instanceof Error) {
        return Promise.resolve({ data: null, error: { code: ret.message } });
      }
      return Promise.resolve({ data: ret ?? 'tok-default', error: null });
    },
    auth: {
      getUser(jwt: string) {
        const u = state.authUsersByJwt.get(jwt);
        if (!u) {
          return Promise.resolve({
            data: { user: null },
            error: { message: 'invalid jwt' },
          });
        }
        return Promise.resolve({ data: { user: u }, error: null });
      },
    },
  };
  return admin;
}

// 3. sendEmail stub.
interface SendEmailCall {
  template: string;
  to: string;
  vars: Record<string, unknown>;
  phi: boolean;
}
function makeSendEmailStub() {
  const calls: SendEmailCall[] = [];
  const fn = (
    _supabase: unknown,
    args: { template: string; to: string; vars: Record<string, unknown>; phi: boolean },
  ) => {
    calls.push({
      template: args.template,
      to: args.to,
      vars: args.vars,
      phi: args.phi,
    });
    const provider: 'ses' | 'resend' = args.phi ? 'ses' : 'resend';
    return Promise.resolve({ provider, id: 'msg-test' });
  };
  return { calls, fn };
}

// 4. Helpers.
const SERVICE_BEARER = 'Bearer test_service_key';

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/functions/v1/helpdesk-agent-reply-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function seedTicket(
  state: MockState,
  opts: { ticketId?: string; phi?: boolean; orgId?: string; userId?: string } = {},
) {
  const ticketId = opts.ticketId ?? 'tk-1';
  const orgId = opts.orgId ?? 'org-1';
  const userId = opts.userId ?? 'user-1';
  state.ticketsById.set(ticketId, {
    id: ticketId,
    org_id: orgId,
    user_id: userId,
    phi: opts.phi ?? false,
    subject: 'Help with billing',
  });
  state.profilesById.set(userId, { id: userId, email: 'patient@example.com' });
  return ticketId;
}

function seedMessage(
  state: MockState,
  opts: { messageId?: string; ticketId?: string; body?: string } = {},
) {
  const messageId = opts.messageId ?? 'msg-1';
  state.messagesById.set(messageId, {
    id: messageId,
    ticket_id: opts.ticketId ?? 'tk-1',
    author_kind: 'agent',
    body: opts.body ?? 'Thanks for reaching out.',
  });
  return messageId;
}

function withMocks(state: MockState) {
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const stub = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(stub.fn);
  return stub;
}

function cleanup() {
  mod.__internal.resetAdminForTest();
  mod.__internal.resetSendEmailForTest();
}

// ─── T1 ───────────────────────────────────────────────────────────────────────

Deno.test('T1: missing Authorization Bearer → 401', async () => {
  const state = freshState();
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: ...' }),
    );
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0);
  } finally {
    cleanup();
  }
});

// ─── T2 ───────────────────────────────────────────────────────────────────────

Deno.test('T2: service-role Bearer is accepted (no org check)', async () => {
  const state = freshState();
  seedTicket(state, { phi: false });
  seedMessage(state);
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: hi' },
        { Authorization: SERVICE_BEARER },
      ),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].template, 'helpdesk_agent_reply');
  } finally {
    cleanup();
  }
});

// ─── T3 ───────────────────────────────────────────────────────────────────────

Deno.test('T3: JWT path with org membership → success', async () => {
  const state = freshState();
  seedTicket(state, { orgId: 'org-1' });
  seedMessage(state);
  state.authUsersByJwt.set('agent-jwt', { id: 'agent-1' });
  state.orgMembers.add('agent-1:org-1');
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: hi' },
        { Authorization: 'Bearer agent-jwt' },
      ),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
  } finally {
    cleanup();
  }
});

// ─── T4 ───────────────────────────────────────────────────────────────────────

Deno.test('T4: JWT path WITHOUT org membership → 403; no send', async () => {
  const state = freshState();
  seedTicket(state, { orgId: 'org-1' });
  seedMessage(state);
  state.authUsersByJwt.set('rogue-jwt', { id: 'rogue-1' });
  // Note: rogue-1 is NOT added to orgMembers.
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: hi' },
        { Authorization: 'Bearer rogue-jwt' },
      ),
    );
    assertEquals(res.status, 403);
    assertEquals(calls.length, 0, 'sendEmail must NOT be called on org boundary violation');
  } finally {
    cleanup();
  }
});

// ─── T5 ───────────────────────────────────────────────────────────────────────

Deno.test('T5: phi=true → sendEmail called with phi:true', async () => {
  const state = freshState();
  seedTicket(state, { phi: true });
  seedMessage(state);
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: PHI ticket' },
        { Authorization: SERVICE_BEARER },
      ),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].phi, true);
  } finally {
    cleanup();
  }
});

// ─── T6 ───────────────────────────────────────────────────────────────────────

Deno.test('T6: phi=false → sendEmail called with phi:false', async () => {
  const state = freshState();
  seedTicket(state, { phi: false });
  seedMessage(state);
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: hi' },
        { Authorization: SERVICE_BEARER },
      ),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].phi, false);
  } finally {
    cleanup();
  }
});

// ─── T7 ───────────────────────────────────────────────────────────────────────

Deno.test('T7: Reply-To is reply+<token>@app.leanshot.app', async () => {
  const state = freshState();
  seedTicket(state);
  seedMessage(state);
  state.rpcReturns.set('generate_helpdesk_reply_token', 'tok-xyz-789');
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: hi' },
        { Authorization: SERVICE_BEARER },
      ),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    const replyTo = calls[0].vars.reply_to as string;
    assertEquals(replyTo, 'reply+tok-xyz-789@app.leanshot.app');
    // Sanity: the RPC was called with the right args.
    const rpcCall = state.rpcCalls.find((c) => c.fn === 'generate_helpdesk_reply_token');
    assert(rpcCall);
    assertEquals(rpcCall!.args.p_ticket_id, 'tk-1');
    assertEquals(rpcCall!.args.p_user_id, 'user-1');
  } finally {
    cleanup();
  }
});

// ─── T8 ───────────────────────────────────────────────────────────────────────

Deno.test('T8: message not found → 404; no send', async () => {
  const state = freshState();
  seedTicket(state);
  // Note: NO message seeded.
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'missing-msg', subject: 'Re: hi' },
        { Authorization: SERVICE_BEARER },
      ),
    );
    assertEquals(res.status, 404);
    assertEquals(calls.length, 0);
  } finally {
    cleanup();
  }
});

// ─── T9 ───────────────────────────────────────────────────────────────────────

Deno.test('T9: message belongs to a different ticket → 404; no send', async () => {
  const state = freshState();
  seedTicket(state, { ticketId: 'tk-1' });
  // Message says ticket_id='tk-OTHER'.
  state.messagesById.set('msg-x', {
    id: 'msg-x',
    ticket_id: 'tk-OTHER',
    author_kind: 'agent',
    body: 'cross-ticket spoof attempt',
  });
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-x', subject: 'Re: hi' },
        { Authorization: SERVICE_BEARER },
      ),
    );
    assertEquals(res.status, 404);
    assertEquals(calls.length, 0);
  } finally {
    cleanup();
  }
});

// ─── T10 ──────────────────────────────────────────────────────────────────────

Deno.test('T10: no recipient email → 200 skipped; no send', async () => {
  const state = freshState();
  seedTicket(state);
  seedMessage(state);
  // Replace profile to have null email.
  state.profilesById.set('user-1', { id: 'user-1', email: null });
  const { calls } = withMocks(state);
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1', subject: 'Re: hi' },
        { Authorization: SERVICE_BEARER },
      ),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { skipped?: string };
    assertEquals(body.skipped, 'no_recipient');
    assertEquals(calls.length, 0);
  } finally {
    cleanup();
  }
});
