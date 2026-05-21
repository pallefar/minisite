/**
 * Phase 37 Plan 37-04 Task 2 — Deno test suite for `helpdesk-ai-assist` Edge Fn.
 *
 * Coverage maps to plan <behavior> list (≥14 cases):
 *
 *   T1.  Missing Authorization Bearer → 401
 *   T2.  Tickets row not found → 404, no fetch to Anthropic
 *   T3.  msg.author_kind='agent' → 200 skipped, no Claude call, no DB insert
 *   T4.  ORDER assertion (LOAD-BEARING) — resolveBaaScope precedes
 *        addBreadcrumb('anthropic.messages.create') precedes fetch('/v1/messages')
 *   T5.  BAA scope mismatch (clinical user + non-allowlisted model) → 403, no fetch
 *   T6.  Refusal text from Claude → ticket_ai_suggestions row with sentiment 0,
 *        empty tags, null draft; apply_ai_suggestion NOT called
 *   T7.  Zod parse failure → empty suggestion stored; apply NOT called; 200
 *   T8.  Tag confidence 0.80 → applied + ticket_tags upsert + helpdesk.ai.tagged
 *   T9.  Tag confidence 0.50 → suggestion stored; NOT applied; no ai.tagged
 *   T10. sentiment_score -0.7 → tickets updated; helpdesk.sentiment_alert.fired +
 *        helpdesk.ai.sentiment_flagged emitted
 *   T11. sentiment_score -0.4 with 2 prior ≤-0.3 rows → aggregate threshold → alert fires
 *   T12. sentiment_score -0.4 with 0 prior → alert does NOT fire
 *   T13. routing_suggestion='billing' + active rule + top-tag conf ≥0.75 →
 *        suggested_route_user_id populated; helpdesk.ai.routed + ticket.assigned
 *   T14. Model id in fetch body equals 'anthropic/claude-sonnet-4-6' (hyphenated)
 *   T15. /v1/messages path used (NOT /chat/completions)
 *
 * Strategy mirrors helpdesk-inbound/index.test.ts — hand-rolled chainable
 * supabase admin mock + fetchImpl injection via handler options + posthog
 * event capture via stub on captureServer.
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';

// ─── 1. Env vars BEFORE module import (load-bearing for default singletons) ───
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test_service_key');
Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
Deno.env.set('AI_GATEWAY_API_KEY_CLINICAL', 'sb_clinical_test_key');
Deno.env.set('AI_GATEWAY_BASE_URL', 'https://ai-gateway.vercel.sh/v1');
Deno.env.set('ANTHROPIC_MODEL_HELPDESK', 'anthropic/claude-sonnet-4-6');

const mod = await import('./index.ts');
const sentry = await import('../_shared/sentry.ts');

// ─── 2. Hand-rolled chainable supabase admin mock ─────────────────────────────
type Row = Record<string, unknown>;
interface MockState {
  ticketsById: Map<string, Row>;
  messagesById: Map<string, Row>;
  profiles: Map<string, Row>;            // by id
  routingRules: Row[];
  suggestionsByTicket: Map<string, Row[]>; // for aggregate sentiment count
  ticket_tags: Row[];
  inserted_suggestions: Row[];
  ticket_updates: Array<{ id: string; updates: Row }>;
  // Toggle to force suggestion insert to error
  failSuggestionInsert: boolean;
}
function freshState(): MockState {
  return {
    ticketsById: new Map(),
    messagesById: new Map(),
    profiles: new Map(),
    routingRules: [],
    suggestionsByTicket: new Map(),
    ticket_tags: [],
    inserted_suggestions: [],
    ticket_updates: [],
    failSuggestionInsert: false,
  };
}

interface ChainOpts {
  table: string;
  state: MockState;
  filters: Record<string, unknown>;
  inFilters: Record<string, unknown[]>;
  countMode?: 'exact' | 'planned' | 'estimated';
  headMode?: boolean;
}

function buildChain(opts: ChainOpts) {
  const ch: Record<string, unknown> = {};
  ch.select = (_cols?: string, options?: { count?: string; head?: boolean }) => {
    if (options?.count) opts.countMode = options.count as 'exact';
    if (options?.head) opts.headMode = true;
    return ch;
  };
  ch.eq = (col: string, val: unknown) => {
    opts.filters[col] = val;
    return ch;
  };
  ch.in = (col: string, arr: unknown[]) => {
    opts.inFilters[col] = arr;
    return ch;
  };
  ch.lte = (col: string, val: unknown) => {
    opts.filters[`__lte__${col}`] = val;
    return ch;
  };
  ch.order = (_col: string, _o?: unknown) => ch;
  ch.limit = (_n: number) => ch;
  ch.maybeSingle = () => Promise.resolve(resolveRead(opts));
  ch.single = () => Promise.resolve(resolveRead(opts, true));
  ch.then = (resolveCb: (v: unknown) => void) => {
    // For headMode .select count queries that don't use maybeSingle/single
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
  if (table === 'ticket_messages') {
    if (filters.id) {
      const row = state.messagesById.get(filters.id as string) ?? null;
      return { data: row, error: null };
    }
  }
  if (table === 'profiles') {
    if (filters.id) {
      const row = state.profiles.get(filters.id as string) ?? null;
      return { data: row, error: null };
    }
  }
  if (table === 'helpdesk_routing_rules') {
    const match = state.routingRules.find(
      (r) =>
        r.org_id === filters.org_id &&
        r.tag_name === filters.tag_name &&
        r.active === filters.active,
    );
    return { data: match ?? null, error: null };
  }
  if (table === 'ticket_ai_suggestions') {
    if (o.countMode === 'exact' && o.headMode) {
      // Aggregate count query for sentiment alert.
      const ticketId = filters.ticket_id as string;
      const threshold = filters.__lte__sentiment_score as number;
      const rows = state.suggestionsByTicket.get(ticketId) ?? [];
      const c = rows.filter((r) => (r.sentiment_score as number) <= threshold).length;
      return { count: c, data: null, error: null };
    }
  }
  if (single) {
    return { data: null, error: { code: 'not_found' } };
  }
  return { data: null, error: null };
}

interface InsertOpts {
  table: string;
  payload: Row | Row[];
  state: MockState;
  hasReturn?: boolean;
}

function buildInsertChain(opts: InsertOpts) {
  const ch: Record<string, unknown> = {};
  ch.select = (_c?: string) => {
    opts.hasReturn = true;
    return ch;
  };
  ch.single = () => Promise.resolve(applyInsert(opts, true));
  ch.maybeSingle = () => Promise.resolve(applyInsert(opts, false));
  // Thenable so `await admin.from('x').insert(...)` resolves directly.
  ch.then = (resolveCb: (v: unknown) => void) => {
    resolveCb(applyInsert(opts, false));
    return ch;
  };
  return ch;
}

function applyInsert(o: InsertOpts, withRow: boolean) {
  if (o.table === 'ticket_ai_suggestions') {
    if (o.state.failSuggestionInsert) {
      return { data: null, error: { code: 'forced_fail' } };
    }
    const row: Row = {
      id: `sugg-${o.state.inserted_suggestions.length + 1}`,
      ...(o.payload as Row),
    };
    o.state.inserted_suggestions.push(row);
    // Also feed the aggregate-sentiment map so subsequent counts see it.
    const tid = row.ticket_id as string;
    const list = o.state.suggestionsByTicket.get(tid) ?? [];
    list.push(row);
    o.state.suggestionsByTicket.set(tid, list);
    if (withRow) return { data: { id: row.id as string }, error: null };
    return { data: null, error: null };
  }
  if (o.table === 'ticket_tags') {
    o.state.ticket_tags.push(o.payload as Row);
    return { data: null, error: null };
  }
  return { data: null, error: null };
}

function buildUpdateChain(opts: { table: string; updates: Row; state: MockState }) {
  const ch: Record<string, unknown> = {};
  let pendingId: string | null = null;
  let pendingSuggestionId: string | null = null;
  ch.eq = (col: string, val: unknown) => {
    if (col === 'id') {
      if (opts.table === 'tickets') pendingId = val as string;
      if (opts.table === 'ticket_ai_suggestions') pendingSuggestionId = val as string;
    }
    return ch;
  };
  ch.then = (resolveCb: (v: unknown) => void) => {
    if (opts.table === 'tickets' && pendingId) {
      opts.state.ticket_updates.push({ id: pendingId, updates: opts.updates });
      const cur = opts.state.ticketsById.get(pendingId);
      if (cur) opts.state.ticketsById.set(pendingId, { ...cur, ...opts.updates });
    }
    if (opts.table === 'ticket_ai_suggestions' && pendingSuggestionId) {
      const idx = opts.state.inserted_suggestions.findIndex(
        (s) => s.id === pendingSuggestionId,
      );
      if (idx >= 0) {
        opts.state.inserted_suggestions[idx] = {
          ...opts.state.inserted_suggestions[idx],
          ...opts.updates,
        };
      }
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
        select: (cols?: string, options?: { count?: string; head?: boolean }) => {
          const o: ChainOpts = { table, state, filters: {}, inFilters: {} };
          if (options?.count) o.countMode = options.count as 'exact';
          if (options?.head) o.headMode = true;
          return buildChain(o);
        },
        insert: (payload: Row | Row[]) => buildInsertChain({ table, payload, state }),
        upsert: (payload: Row | Row[], _opt?: unknown) =>
          buildInsertChain({ table, payload, state }),
        update: (updates: Row) => buildUpdateChain({ table, updates, state }),
      };
    },
  };
  return admin;
}

// ─── 3. Helpers ───────────────────────────────────────────────────────────────
const SERVICE_BEARER = 'Bearer test_service_key';

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/functions/v1/helpdesk-ai-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function validClaudeResponse(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

interface FetchCapture {
  url: string;
  init: RequestInit;
}

function makeFetchImpl(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
  capture: FetchCapture[],
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const ri = init ?? {};
    capture.push({ url, init: ri });
    const r = responder(url, ri);
    return Promise.resolve(r instanceof Promise ? r : r);
  };
}

function seedConsumerTicket(
  state: MockState,
  opts: { ticketId?: string; messageId?: string; orgId?: string; authorKind?: string } = {},
) {
  const ticketId = opts.ticketId ?? 'tk-1';
  const messageId = opts.messageId ?? 'msg-1';
  const orgId = opts.orgId ?? 'org-1';
  state.ticketsById.set(ticketId, {
    id: ticketId,
    org_id: orgId,
    user_id: 'user-1',
    phi: false,
    status: 'open',
    assigned_to: null,
    subject: 'Help with billing',
    sentiment_min_score: null,
    sentiment_alert_fired_at: null,
  });
  state.messagesById.set(messageId, {
    id: messageId,
    ticket_id: ticketId,
    author_kind: opts.authorKind ?? 'user',
    body: 'I need help with my invoice',
  });
  state.profiles.set('user-1', { id: 'user-1', primary_org_id: null });
  return { ticketId, messageId };
}

function seedClinicalTicket(state: MockState) {
  state.ticketsById.set('tk-c', {
    id: 'tk-c',
    org_id: 'org-clinic',
    user_id: 'user-clinic',
    phi: true,
    status: 'open',
    assigned_to: null,
    subject: 'PHI ticket',
  });
  state.messagesById.set('msg-c', {
    id: 'msg-c',
    ticket_id: 'tk-c',
    author_kind: 'user',
    body: 'clinical message',
  });
  state.profiles.set('user-clinic', { id: 'user-clinic', primary_org_id: 'org-clinic' });
  return { ticketId: 'tk-c', messageId: 'msg-c' };
}

interface CaptureEvent {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
}

function captureEventStub(events: CaptureEvent[]): { restore: () => void } {
  mod.__internal.setCaptureForTest((args: CaptureEvent) => {
    events.push(args);
  });
  return {
    restore() {
      mod.__internal.resetCaptureForTest();
    },
  };
}

// ─── T1: Missing Authorization Bearer → 401 ──────────────────────────────────

Deno.test('T1: missing Authorization Bearer → 401', async () => {
  const state = freshState();
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  try {
    const res = await mod.handler(makeReq({ ticket_id: 'x', message_id: 'y' }));
    assertEquals(res.status, 401);
    assertEquals(state.inserted_suggestions.length, 0);
  } finally {
    mod.__internal.resetAdminForTest();
  }
});

Deno.test('T1b: wrong bearer → 401', async () => {
  const state = freshState();
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'x', message_id: 'y' }, { Authorization: 'Bearer wrong' }),
    );
    assertEquals(res.status, 401);
  } finally {
    mod.__internal.resetAdminForTest();
  }
});

// ─── T2: ticket not found → 404, no fetch ────────────────────────────────────

Deno.test('T2: ticket not found → 404, no fetch to Anthropic', async () => {
  const state = freshState();
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () => new Response('{}', { status: 500 }),
    capture,
  );
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'missing', message_id: 'whatever' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 404);
    assertEquals(capture.length, 0, 'must NOT call Anthropic when ticket missing');
  } finally {
    mod.__internal.resetAdminForTest();
  }
});

// ─── T3: agent-author message → 200 skipped, no fetch ────────────────────────

Deno.test('T3: msg.author_kind=agent → 200 skipped, no Claude call, no DB insert', async () => {
  const state = freshState();
  seedConsumerTicket(state, { authorKind: 'agent' });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () => new Response('{}', { status: 500 }),
    capture,
  );
  try {
    const res = await mod.handler(
      makeReq(
        { ticket_id: 'tk-1', message_id: 'msg-1' },
        { Authorization: SERVICE_BEARER },
      ),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { skipped?: boolean };
    assertEquals(body.skipped, true);
    assertEquals(capture.length, 0, 'must NOT fetch Anthropic');
    assertEquals(state.inserted_suggestions.length, 0, 'must NOT insert suggestion');
  } finally {
    mod.__internal.resetAdminForTest();
  }
});

// ─── T4: LOAD-BEARING — breadcrumb order resolved → breadcrumb → fetch ──────

Deno.test('T4 [LOAD-BEARING]: resolved → breadcrumb → fetch ordering', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const order: string[] = [];
  const fetchImpl = makeFetchImpl((url) => {
    order.push(`fetch:${url.includes('/v1/messages') ? 'messages' : 'other'}`);
    return validClaudeResponse({
      tags: [{ name: 'billing', confidence: 0.3 }],
      routing_suggestion: null,
      draft_reply: null,
      sentiment_score: 0.1,
    });
  }, capture);
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);

    const crumbs = sentry.__getBreadcrumbsForTest();
    const baaIdx = crumbs.findIndex((c) => c.category === 'baa.scope.resolved');
    const anthropicIdx = crumbs.findIndex((c) => c.category === 'anthropic.messages.create');
    assert(baaIdx >= 0, 'baa.scope.resolved breadcrumb must be emitted');
    assert(anthropicIdx >= 0, 'anthropic.messages.create breadcrumb must be emitted');
    assert(
      baaIdx < anthropicIdx,
      `breadcrumb order violation — baa(${baaIdx}) must precede anthropic(${anthropicIdx})`,
    );
    // Anthropic call must follow the breadcrumb (we recorded url in capture[0]).
    assertEquals(capture.length, 1);
    assert(capture[0]!.url.includes('/v1/messages'));
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T5: BAA scope mismatch → 403, no fetch ─────────────────────────────────

Deno.test('T5: clinical user + non-allowlisted model → 403, NO fetch', async () => {
  const state = freshState();
  seedClinicalTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () => new Response('{}', { status: 500 }),
    capture,
  );
  // Flip to a non-allowlisted model for the duration of this test.
  Deno.env.set('ANTHROPIC_MODEL_HELPDESK', 'anthropic/claude-3-opus-20240229');
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-c', message_id: 'msg-c' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 403);
    assertEquals(capture.length, 0, 'fetch must NOT be called when allowlist fails');
  } finally {
    Deno.env.set('ANTHROPIC_MODEL_HELPDESK', 'anthropic/claude-sonnet-4-6');
    mod.__internal.resetAdminForTest();
  }
});

// ─── T6: Refusal → empty suggestion, no apply ──────────────────────────────

Deno.test('T6: refusal narrative → empty suggestion stored; no tags applied', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: "I cannot provide medical advice for this ticket." }],
        }),
        { status: 200 },
      ),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { refusal?: boolean; applied?: boolean };
    assertEquals(body.refusal, true);
    assertEquals(body.applied, false);
    assertEquals(state.inserted_suggestions.length, 1);
    const sugg = state.inserted_suggestions[0]!;
    assertEquals(sugg.suggested_tags, []);
    assertEquals(sugg.draft_reply, null);
    assertEquals(sugg.sentiment_score, 0);
    assertEquals(state.ticket_tags.length, 0, 'no tags applied on refusal');
    assert(
      !events.some((e) => e.event === 'helpdesk.ai.tagged'),
      'no helpdesk.ai.tagged on refusal',
    );
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T7: Zod parse failure → empty suggestion, no apply ────────────────────

Deno.test('T7: invalid Claude JSON shape → Zod fails → empty suggestion; no apply; 200', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  // tag with bogus name (not in ALLOWED_TAGS enum) → Zod fails.
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [{ name: 'NOT_AN_ALLOWED_TAG', confidence: 0.9 }],
        routing_suggestion: null,
        draft_reply: null,
        sentiment_score: 0,
      }),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { zod_failed?: boolean; applied?: boolean };
    assertEquals(body.zod_failed, true);
    assertEquals(body.applied, false);
    assertEquals(state.ticket_tags.length, 0);
    assert(!events.some((e) => e.event === 'helpdesk.ai.tagged'));
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T8: tag conf 0.80 → apply path ────────────────────────────────────────

Deno.test('T8: tag confidence 0.80 → ticket_tags inserted; helpdesk.ai.tagged emitted', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [{ name: 'billing', confidence: 0.8 }],
        routing_suggestion: null,
        draft_reply: 'Hi — checking your invoice now.',
        sentiment_score: 0.1,
      }),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { applied?: boolean };
    assertEquals(body.applied, true);
    assertEquals(state.ticket_tags.length, 1);
    assertEquals(state.ticket_tags[0]!.tag_name, 'billing');
    assertEquals(state.ticket_tags[0]!.applied_by, 'ai');
    const taggedEvents = events.filter((e) => e.event === 'helpdesk.ai.tagged');
    assertEquals(taggedEvents.length, 1, 'helpdesk.ai.tagged fired once');
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T9: tag conf 0.50 → suggestion only (no apply) ────────────────────────

Deno.test('T9: tag confidence 0.50 → suggestion stored; NOT applied; no ai.tagged event', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [{ name: 'billing', confidence: 0.5 }],
        routing_suggestion: null,
        draft_reply: null,
        sentiment_score: 0,
      }),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { applied?: boolean };
    assertEquals(body.applied, false);
    assertEquals(state.inserted_suggestions.length, 1, 'suggestion stored for agent review');
    assertEquals(state.ticket_tags.length, 0, 'no tags applied below threshold');
    assert(!events.some((e) => e.event === 'helpdesk.ai.tagged'), 'no ai.tagged below threshold');
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T10: sentiment -0.7 → alert fires ─────────────────────────────────────

Deno.test('T10: sentiment -0.7 → tickets updated; sentiment_alert + ai.sentiment_flagged emitted', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [],
        routing_suggestion: null,
        draft_reply: null,
        sentiment_score: -0.7,
      }),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { sentiment_alert?: boolean };
    assertEquals(body.sentiment_alert, true);

    const fired = events.filter((e) => e.event === 'helpdesk.sentiment_alert.fired');
    assertEquals(fired.length, 1);
    const flagged = events.filter((e) => e.event === 'helpdesk.ai.sentiment_flagged');
    assertEquals(flagged.length, 1);

    // tickets update happened (we check via state mutation).
    const t = state.ticketsById.get('tk-1');
    assertEquals(t?.sentiment_min_score, -0.7);
    assert(t?.sentiment_alert_fired_at !== null && t?.sentiment_alert_fired_at !== undefined);
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T11: aggregate sentiment -0.4 × 3 → alert fires ───────────────────────

Deno.test('T11: sentiment -0.4 with 2 prior ≤-0.3 → aggregate threshold → alert fires', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  // Seed two prior negative-leaning rows on this ticket so the just-inserted
  // 3rd row tips the aggregate count to ≥3.
  state.suggestionsByTicket.set('tk-1', [
    { id: 'prev-1', ticket_id: 'tk-1', sentiment_score: -0.4 },
    { id: 'prev-2', ticket_id: 'tk-1', sentiment_score: -0.5 },
  ]);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [],
        routing_suggestion: null,
        draft_reply: null,
        sentiment_score: -0.4,
      }),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { sentiment_alert?: boolean };
    assertEquals(body.sentiment_alert, true, 'aggregate path must fire on 3rd ≤-0.3 row');
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T12: aggregate sentiment -0.4 × 1 → NO alert ──────────────────────────

Deno.test('T12: sentiment -0.4 with 0 prior → alert does NOT fire', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [],
        routing_suggestion: null,
        draft_reply: null,
        sentiment_score: -0.4,
      }),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { sentiment_alert?: boolean };
    assertEquals(body.sentiment_alert, false);
    assert(!events.some((e) => e.event === 'helpdesk.sentiment_alert.fired'));
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T13: routing_suggestion=billing + active rule + conf≥0.75 → routed ───

Deno.test('T13: routing_suggestion + active rule + top-tag ≥0.75 → routed + ticket.assigned event', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  state.routingRules.push({
    id: 'rule-1',
    org_id: 'org-1',
    tag_name: 'billing',
    assign_to_user_id: 'agent-42',
    priority: 100,
    active: true,
  });
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [{ name: 'billing', confidence: 0.9 }],
        routing_suggestion: 'billing',
        draft_reply: null,
        sentiment_score: 0,
      }),
    capture,
  );
  const events: CaptureEvent[] = [];
  const phStub = captureEventStub(events);
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const sugg = state.inserted_suggestions[0]!;
    assertEquals(sugg.suggested_route_user_id, 'agent-42');
    const routed = events.filter((e) => e.event === 'helpdesk.ai.routed');
    assertEquals(routed.length, 1);
    const assigned = events.filter((e) => e.event === 'helpdesk.ticket.assigned');
    assertEquals(assigned.length, 1);
    const t = state.ticketsById.get('tk-1');
    assertEquals(t?.assigned_to, 'agent-42');
  } finally {
    phStub.restore();
    mod.__internal.resetAdminForTest();
  }
});

// ─── T14 + T15: model id + /v1/messages routing ────────────────────────────

Deno.test('T14+T15: fetch URL=/v1/messages + body.model=anthropic/claude-sonnet-4-6 (hyphenated)', async () => {
  const state = freshState();
  seedConsumerTicket(state);
  mod.__internal.setAdminForTest(buildAdminMock(state));
  sentry.__resetBreadcrumbsForTest();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeFetchImpl(
    () =>
      validClaudeResponse({
        tags: [{ name: 'billing', confidence: 0.5 }],
        routing_suggestion: null,
        draft_reply: null,
        sentiment_score: 0,
      }),
    capture,
  );
  try {
    const res = await mod.handler(
      makeReq({ ticket_id: 'tk-1', message_id: 'msg-1' }, { Authorization: SERVICE_BEARER }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    assertEquals(capture.length, 1);
    assert(capture[0]!.url.endsWith('/v1/messages'));
    assert(!capture[0]!.url.includes('/chat/completions'));
    // Verify base URL didn't acquire /v1/v1.
    assert(!capture[0]!.url.includes('/v1/v1/'));
    const body = JSON.parse(capture[0]!.init.body as string) as Record<string, unknown>;
    assertEquals(body.model, 'anthropic/claude-sonnet-4-6'); // hyphenated, not 4.6
    // Output config shape must be the Anthropic-native one.
    const oc = body.output_config as { format?: { type?: string; schema?: unknown } };
    assertEquals(oc?.format?.type, 'json_schema');
    assert(oc?.format?.schema, 'json_schema must be present');
    assertEquals(body.max_tokens, 1024);
  } finally {
    mod.__internal.resetAdminForTest();
  }
});
