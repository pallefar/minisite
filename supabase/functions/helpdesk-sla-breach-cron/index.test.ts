/**
 * Phase 37 Plan 37-05 Task 3 — Deno test suite for `helpdesk-sla-breach-cron`.
 *
 * Coverage maps to plan <behavior> list (11 cases):
 *
 *   T1.  Missing Authorization Bearer → 401
 *   T2.  No open tickets → 200, breaches=0, no emails
 *   T3.  Open ticket with no agent reply past first_response window → first_response breach
 *   T4.  Open ticket past resolution window → resolution breach
 *   T5.  Both breach types on the same ticket → 2 separate UPSERT calls
 *   T6.  try_record_sla_breach returns false (within dedupe) → email NOT sent
 *   T7.  try_record_sla_breach returns true → email sent + breach counted
 *   T8.  Recipients = assigned_to + sla_targets.alert_recipients + env fallback (deduped)
 *   T9.  phi flag on sla_breach_alert is always false (hardcoded — internal alert)
 *   T10. PostHog helpdesk.sla.breach event fires once per breach
 *   T11. Per-recipient sendEmail failure does NOT block the others (try/catch loop)
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';

// ─── 1. Env vars BEFORE module import ────────────────────────────────────────
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test_service_key');
Deno.env.set('SLA_BREACH_DEFAULT_ONCALL_EMAILS', 'oncall@leanshot.app,oncall-2@leanshot.app');

const mod = await import('./index.ts');

// ─── 2. Hand-rolled chainable supabase admin mock ─────────────────────────────
type Row = Record<string, unknown>;
interface MockState {
  openTickets: Row[];
  slaTargets: Map<string, Row>;       // key = `${org_id}|${tier}`
  profiles: Map<string, Row>;          // by id
  rpcLog: Array<{ name: string; args: Row }>;
  rpcResponder: (name: string, args: Row) => unknown;
}
function freshState(): MockState {
  return {
    openTickets: [],
    slaTargets: new Map(),
    profiles: new Map(),
    rpcLog: [],
    rpcResponder: () => true,
  };
}

interface ChainOpts {
  table: string;
  state: MockState;
  filters: Record<string, unknown>;
  inFilters: Record<string, unknown[]>;
}

function buildChain(opts: ChainOpts) {
  const ch: Record<string, unknown> = {};
  ch.select = (_cols?: string) => ch;
  ch.eq = (col: string, val: unknown) => {
    opts.filters[col] = val;
    return ch;
  };
  ch.in = (col: string, arr: unknown[]) => {
    opts.inFilters[col] = arr;
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
  const { table, state, filters, inFilters } = o;
  if (table === 'tickets') {
    // Cron path is: .select(...).in('status', [...]) — return all openTickets.
    if (inFilters.status) {
      return { data: state.openTickets, error: null };
    }
  }
  if (table === 'sla_targets') {
    const key = `${filters.org_id}|${filters.tier}`;
    return { data: state.slaTargets.get(key) ?? null, error: null };
  }
  if (table === 'profiles') {
    if (filters.id) {
      return { data: state.profiles.get(filters.id as string) ?? null, error: null };
    }
  }
  if (single) return { data: null, error: { code: 'not_found' } };
  return { data: [], error: null };
}

function buildAdminMock(state: MockState) {
  // deno-lint-ignore no-explicit-any
  const admin: any = {
    from(table: string) {
      return {
        select: (_cols?: string) => buildChain({ table, state, filters: {}, inFilters: {} }),
      };
    },
    rpc(name: string, args: Row) {
      state.rpcLog.push({ name, args });
      const out = state.rpcResponder(name, args);
      return Promise.resolve({ data: out, error: null });
    },
  };
  return admin;
}

// ─── 3. sendEmail + captureServer stubs ──────────────────────────────────────
interface SendEmailCall {
  template: string;
  to: string;
  vars: Record<string, unknown>;
  phi: boolean;
}
function makeSendEmailStub(opts: { throwForTo?: string } = {}) {
  const calls: SendEmailCall[] = [];
  return {
    calls,
    fn: (
      _supabase: unknown,
      args: { template: string; to: string; vars: Record<string, unknown>; phi: boolean },
    ): Promise<{ provider: 'resend' | 'ses'; id: string }> => {
      if (opts.throwForTo && args.to === opts.throwForTo) {
        return Promise.reject(new Error('throw_for_test'));
      }
      calls.push({ template: args.template, to: args.to, vars: args.vars, phi: args.phi });
      return Promise.resolve({ provider: args.phi ? 'ses' : 'resend', id: 'msg' });
    },
  };
}

interface CaptureEvent {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
}

function captureStub(): { events: CaptureEvent[]; fn: (args: CaptureEvent) => void } {
  const events: CaptureEvent[] = [];
  return {
    events,
    fn: (args) => {
      events.push(args);
    },
  };
}

// ─── 4. Helpers ──────────────────────────────────────────────────────────────
const SERVICE_BEARER = 'Bearer test_service_key';

function makeReq(headers: Record<string, string> = {}, body: unknown = {}): Request {
  return new Request('http://localhost/functions/v1/helpdesk-sla-breach-cron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function nowMinusMinutes(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

// ─── T1: missing bearer → 401 ────────────────────────────────────────────────

Deno.test('T1: missing Authorization Bearer → 401', async () => {
  const state = freshState();
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({}));
    assertEquals(res.status, 401);
    assertEquals(se.calls.length, 0);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T2: no open tickets → 200, breaches=0 ───────────────────────────────────

Deno.test('T2: no open tickets → 200 with breaches_emitted=0; no emails', async () => {
  const state = freshState();
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { breaches_emitted?: number };
    assertEquals(body.breaches_emitted, 0);
    assertEquals(se.calls.length, 0);
    assertEquals(state.rpcLog.length, 0, 'no try_record_sla_breach calls when no candidates');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T3: first_response breach ───────────────────────────────────────────────

Deno.test('T3: open ticket without agent reply, age > first_response_minutes → first_response breach', async () => {
  const state = freshState();
  // 60 min old, no agent reply; sla.first_response_minutes = 30 → BREACH.
  state.openTickets.push({
    id: 'tk-1',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: 'agent-1',
    created_at: nowMinusMinutes(60),
    last_agent_message_at: null,
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: [],
  });
  state.profiles.set('agent-1', { id: 'agent-1', email: 'agent1@leanshot.app' });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { breaches_emitted?: number };
    assertEquals(body.breaches_emitted, 1);
    const rpcs = state.rpcLog.filter((r) => r.name === 'try_record_sla_breach');
    assertEquals(rpcs.length, 1);
    assertEquals(rpcs[0]!.args.p_breach_type, 'first_response');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T4: resolution breach ───────────────────────────────────────────────────

Deno.test('T4: open ticket past resolution window → resolution breach', async () => {
  const state = freshState();
  // 600 min old, agent replied at minute 5; resolution_minutes = 480 → BREACH.
  // first_response satisfied (agent replied at minute 5).
  state.openTickets.push({
    id: 'tk-2',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: null,
    created_at: nowMinusMinutes(600),
    last_agent_message_at: nowMinusMinutes(595),
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: ['extra@leanshot.app'],
  });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { breaches_emitted?: number };
    assertEquals(body.breaches_emitted, 1);
    const rpcs = state.rpcLog.filter((r) => r.name === 'try_record_sla_breach');
    assertEquals(rpcs.length, 1);
    assertEquals(rpcs[0]!.args.p_breach_type, 'resolution');
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T5: both breach types on same ticket → 2 separate UPSERTs ──────────────

Deno.test('T5: both first_response + resolution exceed → 2 separate UPSERT calls', async () => {
  const state = freshState();
  // 600 min old, no agent reply; sla 30/480 → BOTH breach.
  state.openTickets.push({
    id: 'tk-3',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: null,
    created_at: nowMinusMinutes(600),
    last_agent_message_at: null,
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: [],
  });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    const rpcs = state.rpcLog.filter((r) => r.name === 'try_record_sla_breach');
    assertEquals(rpcs.length, 2);
    const types = rpcs.map((r) => r.args.p_breach_type as string).sort();
    assertEquals(types, ['first_response', 'resolution']);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T6: UPSERT returns false → email NOT sent ───────────────────────────────

Deno.test('T6: try_record_sla_breach returns false → email NOT sent for that breach', async () => {
  const state = freshState();
  state.openTickets.push({
    id: 'tk-4',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: null,
    created_at: nowMinusMinutes(60),
    last_agent_message_at: null,
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: ['someone@leanshot.app'],
  });
  // Force RPC to say "within dedupe window".
  state.rpcResponder = () => false;
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { breaches_emitted?: number };
    assertEquals(body.breaches_emitted, 0, 'dedupe window: count must NOT increment');
    assertEquals(se.calls.length, 0, 'no email sent within dedupe');
    assertEquals(cap.events.filter((e) => e.event === 'helpdesk.sla.breach').length, 0);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T7: UPSERT returns true → email sent + counted ─────────────────────────

Deno.test('T7: try_record_sla_breach returns true → email sent + breach counted', async () => {
  const state = freshState();
  state.openTickets.push({
    id: 'tk-5',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: null,
    created_at: nowMinusMinutes(60),
    last_agent_message_at: null,
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: ['oncall-specific@leanshot.app'],
  });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { breaches_emitted?: number };
    assertEquals(body.breaches_emitted, 1);
    assert(se.calls.length >= 1, 'at least one email sent');
    assertEquals(cap.events.filter((e) => e.event === 'helpdesk.sla.breach').length, 1);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T8: recipient list = assigned + alert_recipients + env (deduped) ───────

Deno.test('T8: recipients = assigned_to + sla_targets.alert_recipients + env fallback (deduped)', async () => {
  const state = freshState();
  state.openTickets.push({
    id: 'tk-6',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: 'agent-1',
    created_at: nowMinusMinutes(60),
    last_agent_message_at: null,
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    // Overlap one with env fallback ('oncall@leanshot.app') to force dedupe.
    alert_recipients: ['team@leanshot.app', 'oncall@leanshot.app'],
  });
  state.profiles.set('agent-1', { id: 'agent-1', email: 'agent1@leanshot.app' });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    const recipients = se.calls.map((c) => c.to).sort();
    // Expect: agent1 + team + oncall (deduped) + oncall-2 — total 4 unique.
    assertEquals(recipients.length, 4);
    assertEquals(recipients, [
      'agent1@leanshot.app',
      'oncall-2@leanshot.app',
      'oncall@leanshot.app',
      'team@leanshot.app',
    ]);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T9: phi: false ALWAYS on sla_breach_alert (hardcoded) ─────────────────

Deno.test('T9: phi flag on sla_breach_alert is ALWAYS false (hardcoded for internal alert)', async () => {
  const state = freshState();
  state.openTickets.push({
    id: 'tk-phi',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: null,
    // 60 min, no agent reply → first_response breach.
    created_at: nowMinusMinutes(60),
    last_agent_message_at: null,
    status: 'open',
    // Note: ticket COULD be phi, but the alert email is internal so phi MUST be false.
    phi: true,
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: [],
  });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assert(se.calls.length > 0);
    for (const c of se.calls) {
      assertEquals(c.phi, false, 'sla_breach_alert template MUST always be phi=false');
      assertEquals(c.template, 'sla_breach_alert');
    }
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T10: helpdesk.sla.breach event fires once per breach ───────────────────

Deno.test('T10: PostHog helpdesk.sla.breach event fires once per breach', async () => {
  const state = freshState();
  // Both breach types fire → 2 events.
  state.openTickets.push({
    id: 'tk-double',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: 'agent-1',
    created_at: nowMinusMinutes(600),
    last_agent_message_at: null,
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: [],
  });
  state.profiles.set('agent-1', { id: 'agent-1', email: 'agent1@leanshot.app' });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  const se = makeSendEmailStub();
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    const breaches = cap.events.filter((e) => e.event === 'helpdesk.sla.breach');
    assertEquals(breaches.length, 2, 'one event per breach type');
    for (const b of breaches) {
      assert(b.properties?.ticket_id);
      assert(b.properties?.breach_type);
      assert(b.properties?.tier);
    }
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});

// ─── T11: one failed recipient does NOT block the others ────────────────────

Deno.test('T11: per-recipient sendEmail failure does NOT block other recipients', async () => {
  const state = freshState();
  state.openTickets.push({
    id: 'tk-fail',
    org_id: 'org-1',
    priority: 'p2',
    assigned_to: null,
    created_at: nowMinusMinutes(60),
    last_agent_message_at: null,
    status: 'open',
  });
  state.slaTargets.set('org-1|p2', {
    first_response_minutes: 30,
    resolution_minutes: 480,
    alert_recipients: ['fails@leanshot.app', 'good@leanshot.app'],
  });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  // Force the throw only for fails@leanshot.app.
  const se = makeSendEmailStub({ throwForTo: 'fails@leanshot.app' });
  mod.__internal.setSendEmailForTest(se.fn);
  const cap = captureStub();
  mod.__internal.setCaptureForTest(cap.fn);
  try {
    const res = await mod.handler(makeReq({ Authorization: SERVICE_BEARER }));
    assertEquals(res.status, 200);
    // 'good@leanshot.app' + env oncall + env oncall-2 = 3 successful sends.
    // 'fails@leanshot.app' is captured by the throw branch (not in calls list).
    assertEquals(se.calls.length, 3);
    const tos = se.calls.map((c) => c.to).sort();
    assertEquals(tos, ['good@leanshot.app', 'oncall-2@leanshot.app', 'oncall@leanshot.app']);
  } finally {
    mod.__internal.resetAdminForTest();
    mod.__internal.resetSendEmailForTest();
    mod.__internal.resetCaptureForTest();
  }
});
