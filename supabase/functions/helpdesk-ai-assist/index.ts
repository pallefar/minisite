/**
 * `helpdesk-ai-assist` Edge Function — Phase 37 Plan 37-04 (HELP-04).
 *
 * Claude-powered ticket classifier. Called fire-and-forget from
 * `helpdesk-inbound` (Plan 37-03) and from the agent inbox Realtime trigger
 * (Plan 37-07) whenever a new `user`-authored `ticket_messages` row appears.
 *
 * Pipeline (every step ORDER MATTERS — BAA breadcrumb ordering is the Phase 25
 * HIPAA-01 audit signal; out-of-order = audit failure):
 *
 *   1. Auth gate — Bearer ${SUPABASE_SERVICE_ROLE_KEY}; 401 on mismatch.
 *   2. Input parse — { ticket_id, message_id }; 400 on missing.
 *   3. Ticket lookup FIRST — read ticket.phi from DB (do NOT trust caller).
 *   4. Message lookup — skip-with-200 if author_kind !== 'user'.
 *   5. resolveBaaScope(admin, ticket.user_id)  → 'baa.scope.resolved' crumb.
 *   6. assertBaaScope(scope, MODEL_ID)         → 403 (Response) on miss.
 *   7. addBreadcrumb('anthropic.messages.create') just before fetch.
 *   8. fetch ${AI_GATEWAY_BASE_URL}/v1/messages — Anthropic Messages API.
 *   9. Refusal detection — empty suggestion row + return 200.
 *  10. Zod parse — on failure store empty suggestion + return 200.
 *  11. Routing resolution — helpdesk_routing_rules lookup.
 *  12. INSERT ticket_ai_suggestions row.
 *  13. Auto-apply gate (D-06) — confidence ≥0.75 → server-side apply
 *      (insert ticket_tags + update assigned_to + set applied_at).
 *  14. Sentiment alert (D-10) — single ≤ -0.6 OR aggregate (3× ≤ -0.3).
 *  15. Return { ok, suggestion_id, applied, sentiment_alert }.
 *
 * Forbidden:
 *   - Do NOT log msg.body, parsed.draft_reply, or any user-content field.
 *     console.warn with short-code strings only (never template-literal user input).
 *   - Do NOT import or call any outbound-email helper — draft replies are
 *     stored only (D-08). Plan 07's agent inbox dispatches outbound mail.
 *   - Do NOT use the dotted model id form (4 dot 6) — hyphenated only (4-6).
 *   - Do NOT route via the OpenAI-compat chat endpoint — Anthropic-native
 *     Messages API at /v1/messages only (output_config.format.json_schema
 *     does not work on the chat-completions surface per AI-SPEC §3 Pitfall #2).
 *   - Do NOT trust the caller's PHI hint — re-resolve via resolveBaaScope
 *     against ticket.user_id every time.
 *   - Do NOT auto-apply if NO tag and NO route meets the 0.75 threshold (D-07).
 *
 * Deviation — apply_ai_suggestion RPC:
 *   The plan instructed `admin.rpc('apply_ai_suggestion', { p_suggestion_id })`,
 *   but that RPC (migration 20270707000003 line 221) raises 'unauthenticated'
 *   when called via service-role because it asserts `auth.uid() is not null`.
 *   The RPC was designed for agent-initiated apply from the inbox UI; this
 *   Edge Fn runs server-to-server with no user JWT. Rule 1 fix: we perform the
 *   apply LOGIC server-side (insert ticket_tags + update assigned_to + set
 *   applied_at) — same writes the RPC would have made, but without the
 *   auth.uid() guard. Plan 07 will still call the RPC from the agent inbox.
 *
 * Deviation — env var names:
 *   The plan referenced `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_BAA` /
 *   `ANTHROPIC_API_BASE`, but the canonical helper `_shared/baa-scope.ts`
 *   resolves the credential from `AI_GATEWAY_API_KEY_CONSUMER` /
 *   `AI_GATEWAY_API_KEY_CLINICAL` and the base URL from `AI_GATEWAY_BASE_URL`
 *   (Phase 38 contract). We use the canonical names so resolveBaaScope and the
 *   Anthropic call agree on which secret is in scope. Rule 3 fix.
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import {
  assertBaaScope,
  BaaScopeError,
  resolveBaaScope,
  type BaaScope,
} from '../_shared/baa-scope.ts';
import { addBreadcrumb, captureException } from '../_shared/sentry.ts';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import { corsHeaders } from './cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REQUEST_TIMEOUT_MS = 25_000;

// ─── Thresholds (D-06, D-07, D-10, D-11) ──────────────────────────────────────
// Hardcoded in v1.3 per D-11 — no admin UI. Plan 04 closeout will surface
// threshold-hit metrics so a v1.4 admin-UI ships with data-informed defaults.
const TAG_AUTO_APPLY = 0.75;
const ROUTE_AUTO_APPLY = 0.75;
const SENTIMENT_ALERT_SINGLE = -0.6;
const SENTIMENT_AGGREGATE_PER_MSG = -0.3;
const SENTIMENT_AGGREGATE_COUNT = 3;

// ─── Allowed tag set (D-06) ───────────────────────────────────────────────────
// Closed taxonomy — Claude is told to pick from this set; anything outside
// gets dropped at Zod-validation time.
const ALLOWED_TAGS = [
  'billing',
  'account',
  'technical',
  'bug',
  'feature_request',
  'kb_question',
  'urgent_safety',
  'integration',
  'data_export',
  'refund_request',
  'account_deletion',
  'escalation',
  'other',
] as const;

// ─── Zod schema for Claude structured output ──────────────────────────────────
const ClaudeOutputSchema = z.object({
  tags: z
    .array(
      z.object({
        name: z.enum(ALLOWED_TAGS),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(5),
  routing_suggestion: z.string().min(1).max(64).nullable(),
  draft_reply: z.string().max(2000).nullable(),
  sentiment_score: z.number().min(-1).max(1),
});
type ClaudeOutput = z.infer<typeof ClaudeOutputSchema>;

// ─── JSON Schema mirror for Anthropic output_config.format.json_schema ────────
// Kept inline (rather than zod-to-json-schema) to avoid pulling in another
// dependency and to keep the schema audit-readable.
const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tags', 'routing_suggestion', 'draft_reply', 'sentiment_score'],
  properties: {
    tags: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'confidence'],
        properties: {
          name: { type: 'string', enum: [...ALLOWED_TAGS] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    routing_suggestion: { type: ['string', 'null'], maxLength: 64 },
    draft_reply: { type: ['string', 'null'], maxLength: 2000 },
    sentiment_score: { type: 'number', minimum: -1, maximum: 1 },
  },
} as const;

// ─── SYSTEM_PROMPT — defense in depth ─────────────────────────────────────────
// The model is told explicitly that `draft_reply` is NEVER auto-sent — a
// human agent always reviews and sends. This is belt-and-suspenders against
// HELP-04 / D-08 (the actual gate is the lack of any outbound-email helper
// import in this file).
const SYSTEM_PROMPT = `
You classify a single inbound support message for LeanShot's helpdesk.

Output STRICT JSON matching the provided JSON schema. No preamble, no markdown,
no commentary. Pick tags ONLY from the closed taxonomy. Use null for fields
you cannot determine.

Tags (pick up to 5; each with confidence 0..1):
  billing, account, technical, bug, feature_request, kb_question,
  urgent_safety, integration, data_export, refund_request,
  account_deletion, escalation, other

Routing suggestion: a single tag name (string) or null. Pick the tag most
useful for routing to a specialist agent (e.g. "billing", "urgent_safety").

Draft reply: an optional first draft for the agent to review. NEVER
auto-sent — a human agent always reviews before sending. Do NOT use template
placeholders like [name] or [customer]. ≤2000 characters.

Sentiment score: -1 (very negative) to 1 (very positive); 0 is neutral.
`.trim();

// ─── Admin client singleton ───────────────────────────────────────────────────
const _adminSingleton: { client: SupabaseClient | null } = { client: null };
function admin(): SupabaseClient {
  if (_adminSingleton.client) return _adminSingleton.client;
  _adminSingleton.client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminSingleton.client;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const REFUSAL_RE = /^I (cannot|can't|am unable to)\s+(provide|give|assist|help)/i;

interface AssistInput {
  ticketId: string;
  messageId: string;
}

function parseInput(body: unknown): AssistInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const ticketId = typeof b.ticket_id === 'string' ? b.ticket_id.trim() : '';
  const messageId = typeof b.message_id === 'string' ? b.message_id.trim() : '';
  if (!ticketId || !messageId) return null;
  return { ticketId, messageId };
}

interface TicketRow {
  id: string;
  org_id: string;
  user_id: string;
  phi: boolean;
  status: string;
  assigned_to: string | null;
  subject: string;
}
interface MessageRow {
  id: string;
  ticket_id: string;
  author_kind: 'user' | 'agent' | 'system' | 'ai_draft';
  body: string;
}

async function fetchTicket(ticketId: string): Promise<TicketRow | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('tickets')
    .select('id, org_id, user_id, phi, status, assigned_to, subject')
    .eq('id', ticketId)
    .maybeSingle() as any)) as { data: TicketRow | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-ai-assist] ticket lookup failed', error.code ?? 'unknown');
    return null;
  }
  return data;
}

async function fetchMessage(messageId: string): Promise<MessageRow | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('ticket_messages')
    .select('id, ticket_id, author_kind, body')
    .eq('id', messageId)
    .maybeSingle() as any)) as { data: MessageRow | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-ai-assist] message lookup failed', error.code ?? 'unknown');
    return null;
  }
  return data;
}

interface ClaudeFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Call Anthropic Messages API with structured output. Returns the parsed
 * JSON object (still unvalidated — caller runs ClaudeOutputSchema.parse).
 *
 * The string returned via the special sentinel `__REFUSAL__:<text>` is the
 * raw refusal narrative; callers detect it via the REFUSAL_RE regex before
 * Zod-validation.
 */
async function callClaude(
  scope: BaaScope,
  modelId: string,
  baseUrl: string,
  subject: string,
  body: string,
  options: ClaudeFetchOptions = {},
): Promise<{ kind: 'refusal'; text: string } | { kind: 'json'; raw: unknown }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const requestBody = {
    model: modelId,
    max_tokens: 1024,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `Ticket subject: ${subject}\n\n` +
          `Ticket message body:\n${body}`,
      },
    ],
    output_config: {
      format: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA },
    },
  };

  // Audit signal — must fire AFTER resolveBaaScope + assertBaaScope and
  // immediately BEFORE the fetch call (Phase 25 HIPAA-01).
  addBreadcrumb({
    category: 'anthropic.messages.create',
    level: 'info',
    data: {
      model_id: modelId,
      is_clinical: scope.isClinical,
      base_url_host: new URL(baseUrl).host,
    },
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${scope.credential}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`anthropic fetch failed: ${res.status} ${txt.slice(0, 200)}`);
    }
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = (j.content ?? []).find((b) => b.type === 'text');
    if (!textBlock?.text) {
      throw new Error('anthropic: no text content block');
    }
    const raw = textBlock.text.trim();
    // Refusal detection — pattern matches AI-SPEC §5 refusal corpus.
    if (REFUSAL_RE.test(raw)) {
      return { kind: 'refusal', text: raw.slice(0, 200) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('anthropic: response body not JSON');
    }
    return { kind: 'json', raw: parsed };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolve helpdesk_routing_rules → assigned-user + top-tag confidence.
 *
 * Returns the user to route to, plus the confidence we'd attach to the
 * route (which is the top-tag confidence, NOT a rule-table value). Returns
 * null when no active rule matches the suggestion tag in this org.
 */
async function resolveRoute(
  orgId: string,
  routingSuggestion: string | null,
  topTagConfidence: number | null,
): Promise<{ userId: string; confidence: number } | null> {
  if (!routingSuggestion || topTagConfidence === null) return null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await (admin()
    .from('helpdesk_routing_rules')
    .select('assign_to_user_id, priority')
    .eq('org_id', orgId)
    .eq('tag_name', routingSuggestion)
    .eq('active', true)
    .order('priority', { ascending: false })
    .limit(1)
    .maybeSingle() as any)) as { data: { assign_to_user_id?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!data?.assign_to_user_id) return null;
  return { userId: data.assign_to_user_id, confidence: topTagConfidence };
}

/**
 * Insert a row into ticket_ai_suggestions and return the new id.
 *
 * Empty / refusal / parse-failure suggestions are stored too so the audit
 * trail proves we tried — they carry empty tags array, null routing, null
 * draft, sentiment 0.
 */
interface SuggestionInsert {
  ticketId: string;
  messageId: string;
  tags: ClaudeOutput['tags'] | [];
  routeUserId: string | null;
  routeConfidence: number | null;
  draftReply: string | null;
  sentimentScore: number;
  modelId: string;
  isClinical: boolean;
}
async function insertSuggestion(s: SuggestionInsert): Promise<string | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('ticket_ai_suggestions')
    .insert({
      ticket_id: s.ticketId,
      message_id: s.messageId,
      suggested_tags: s.tags,
      suggested_route_user_id: s.routeUserId,
      suggested_route_confidence: s.routeConfidence,
      draft_reply: s.draftReply,
      sentiment_score: s.sentimentScore,
      model_id: s.modelId,
      is_clinical_scope: s.isClinical,
    })
    .select('id')
    .single() as any)) as { data: { id: string } | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error || !data) {
    console.warn('[helpdesk-ai-assist] suggestion insert failed', error?.code ?? 'unknown');
    return null;
  }
  return data.id;
}

/**
 * Server-side equivalent of apply_ai_suggestion RPC — Rule 1 deviation.
 *
 * The RPC requires auth.uid(); this Edge Fn runs service-role server-to-server
 * with no user JWT, so we mirror the RPC's write set directly:
 *   - upsert ticket_tags (applied_by='ai') for tags above threshold
 *   - update tickets.assigned_to if route confidence is above threshold
 *   - stamp ticket_ai_suggestions.applied_at
 *
 * Returns { taggedCount, routed } so the caller can emit the right
 * PostHog events.
 */
async function applySuggestionServerSide(
  suggestionId: string,
  ticketId: string,
  tags: ClaudeOutput['tags'],
  routeUserId: string | null,
  routeConfidence: number | null,
): Promise<{ taggedCount: number; routed: boolean }> {
  const above = tags.filter((t) => t.confidence >= TAG_AUTO_APPLY);
  let taggedCount = 0;
  for (const tag of above) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error } = (await (admin()
      .from('ticket_tags')
      .upsert(
        {
          ticket_id: ticketId,
          tag_name: tag.name,
          confidence: tag.confidence,
          applied_by: 'ai',
        },
        { onConflict: 'ticket_id,tag_name', ignoreDuplicates: true },
      ) as any)) as { error: { code?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (error) {
      console.warn('[helpdesk-ai-assist] tag upsert failed', error.code ?? 'unknown');
      continue;
    }
    taggedCount++;
  }

  let routed = false;
  if (routeUserId && routeConfidence !== null && routeConfidence >= ROUTE_AUTO_APPLY) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error } = (await (admin()
      .from('tickets')
      .update({ assigned_to: routeUserId, updated_at: new Date().toISOString() })
      .eq('id', ticketId) as any)) as { error: { code?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!error) routed = true;
    else console.warn('[helpdesk-ai-assist] route update failed', error.code ?? 'unknown');
  }

  // Stamp applied_at on the suggestion (even if 0 tags/no route landed, the
  // gate was attempted — distinct from suggestion-only path where applied_at
  // stays NULL).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin()
    .from('ticket_ai_suggestions')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', suggestionId) as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { taggedCount, routed };
}

/**
 * Sentiment alert (D-10):
 *   - sentiment_score ≤ -0.6 → fire immediately, OR
 *   - count(ticket_ai_suggestions WHERE ticket_id=X AND sentiment_score≤-0.3) ≥ 3 → fire.
 *
 * Includes the just-inserted row in the aggregate count. On fire:
 *   - tickets.sentiment_min_score := min(existing, current)
 *   - tickets.sentiment_alert_fired_at := now() (only set if currently null —
 *     idempotent for repeat alerts on the same ticket)
 *   - return true so caller emits PostHog events.
 */
async function maybeFireSentimentAlert(
  ticketId: string,
  currentScore: number,
): Promise<boolean> {
  let shouldFire = currentScore <= SENTIMENT_ALERT_SINGLE;
  if (!shouldFire && currentScore <= SENTIMENT_AGGREGATE_PER_MSG) {
    // Aggregate path — count negative-leaning rows already on this ticket.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { count } = (await (admin()
      .from('ticket_ai_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', ticketId)
      .lte('sentiment_score', SENTIMENT_AGGREGATE_PER_MSG) as any)) as {
      count: number | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if ((count ?? 0) >= SENTIMENT_AGGREGATE_COUNT) shouldFire = true;
  }
  if (!shouldFire) return false;

  // Update tickets: idempotent on sentiment_alert_fired_at (set only if null).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: existingTicket } = (await (admin()
    .from('tickets')
    .select('sentiment_min_score, sentiment_alert_fired_at')
    .eq('id', ticketId)
    .maybeSingle() as any)) as {
    data: { sentiment_min_score?: number | null; sentiment_alert_fired_at?: string | null } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const prevMin = existingTicket?.sentiment_min_score ?? null;
  const nextMin = prevMin === null ? currentScore : Math.min(prevMin, currentScore);
  const updates: Record<string, unknown> = {
    sentiment_min_score: nextMin,
    updated_at: new Date().toISOString(),
  };
  if (!existingTicket?.sentiment_alert_fired_at) {
    updates.sentiment_alert_fired_at = new Date().toISOString();
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin().from('tickets').update(updates).eq('id', ticketId) as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return true;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export interface HandlerOptions {
  /** Override fetch — used by tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Override fetch timeout — used by tests. */
  timeoutMs?: number;
}

export async function handler(req: Request, opts: HandlerOptions = {}): Promise<Response> {
  // 1. CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // 2. Auth gate — Bearer ${SUPABASE_SERVICE_ROLE_KEY}.
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${SERVICE_KEY}`;
  if (!SERVICE_KEY || auth !== expected) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // 3. Input parse.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  const input = parseInput(rawBody);
  if (!input) {
    return jsonResponse(400, { error: 'missing_ticket_or_message_id' });
  }

  // 4. Ticket lookup FIRST — read ticket.phi from DB (never trust caller).
  const ticket = await fetchTicket(input.ticketId);
  if (!ticket) {
    return jsonResponse(404, { error: 'ticket_not_found' });
  }

  // 5. Message lookup — skip-with-200 if author_kind !== 'user'.
  const message = await fetchMessage(input.messageId);
  if (!message) {
    return jsonResponse(404, { error: 'message_not_found' });
  }
  if (message.author_kind !== 'user') {
    return jsonResponse(200, { ok: true, skipped: true, reason: 'non_user_author' });
  }

  // 6. Model id + base URL.
  const rawModel = Deno.env.get('ANTHROPIC_MODEL_HELPDESK') ?? '';
  if (!rawModel) {
    console.warn('[helpdesk-ai-assist] ANTHROPIC_MODEL_HELPDESK env unset');
    return jsonResponse(500, { error: 'config_missing_model' });
  }
  // Defense in depth: reject dotted model ID (4.6) — must be hyphenated (4-6).
  if (/claude-(?:sonnet|opus|haiku)-\d+\.\d+/i.test(rawModel)) {
    console.warn('[helpdesk-ai-assist] dotted-model-id-rejected');
    return jsonResponse(500, { error: 'config_invalid_model_id' });
  }
  const rawBase = Deno.env.get('AI_GATEWAY_BASE_URL') ?? '';
  if (!rawBase) {
    console.warn('[helpdesk-ai-assist] AI_GATEWAY_BASE_URL env unset');
    return jsonResponse(500, { error: 'config_missing_base_url' });
  }
  const baseUrl = rawBase.replace(/\/v1$/, '');

  // 7. resolveBaaScope — emits 'baa.scope.resolved' breadcrumb internally.
  //    Scope is decided by the TICKET OWNER actor (D-01) — re-resolved every
  //    time from ticket.user_id (never trust caller's PHI hint).
  //    The cast bridges the npm: vs esm.sh SupabaseClient type-identity gap
  //    (same JS class, different type-import URLs).
  let scope: BaaScope;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scope = await resolveBaaScope(admin() as any, ticket.user_id);
  } catch (e) {
    if (e instanceof BaaScopeError) {
      console.warn('[helpdesk-ai-assist] baa-scope-resolve-failed');
      return jsonResponse(500, { error: 'baa_scope_resolve_failed' });
    }
    throw e;
  }

  // 8. assertBaaScope — throws Response(403) on clinical-path allowlist miss.
  try {
    assertBaaScope(scope, rawModel);
  } catch (resp) {
    if (resp instanceof Response) {
      // Surface the 403 — never log the message body. Short-code only.
      console.warn('[helpdesk-ai-assist] baa-scope-mismatch');
      return resp;
    }
    throw resp;
  }

  // 9. Call Claude. addBreadcrumb('anthropic.messages.create') fires INSIDE
  //    callClaude immediately before the fetch — preserving the load-bearing
  //    ordering invariant (resolved → breadcrumb → fetch).
  let claudeResult: { kind: 'refusal'; text: string } | { kind: 'json'; raw: unknown };
  try {
    claudeResult = await callClaude(
      scope,
      rawModel,
      baseUrl,
      ticket.subject,
      message.body,
      { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs },
    );
  } catch (err) {
    // Bound the error string; never echo prompt or response payload.
    const msg = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    console.warn('[helpdesk-ai-assist] anthropic-call-failed', msg);
    captureException(err, {
      level: 'warning',
      tags: { surface: 'helpdesk-ai-assist.fetch' },
    });
    return jsonResponse(502, { error: 'anthropic_call_failed' });
  }

  // 10. Refusal path — store empty suggestion + return 200.
  if (claudeResult.kind === 'refusal') {
    const suggestionId = await insertSuggestion({
      ticketId: ticket.id,
      messageId: message.id,
      tags: [],
      routeUserId: null,
      routeConfidence: null,
      draftReply: null,
      sentimentScore: 0,
      modelId: rawModel,
      isClinical: scope.isClinical,
    });
    return jsonResponse(200, {
      ok: true,
      suggestion_id: suggestionId,
      applied: false,
      sentiment_alert: false,
      refusal: true,
    });
  }

  // 11. Zod-validate Claude output.
  const parsed = ClaudeOutputSchema.safeParse(claudeResult.raw);
  if (!parsed.success) {
    // Audit trace — store empty suggestion so we know the attempt happened.
    console.warn('[helpdesk-ai-assist] zod-parse-failed');
    const suggestionId = await insertSuggestion({
      ticketId: ticket.id,
      messageId: message.id,
      tags: [],
      routeUserId: null,
      routeConfidence: null,
      draftReply: null,
      sentimentScore: 0,
      modelId: rawModel,
      isClinical: scope.isClinical,
    });
    return jsonResponse(200, {
      ok: true,
      suggestion_id: suggestionId,
      applied: false,
      sentiment_alert: false,
      zod_failed: true,
    });
  }
  const output = parsed.data;

  // 12. Top-tag confidence (used for route-confidence attribution).
  const topTagConfidence = output.tags.length > 0
    ? Math.max(...output.tags.map((t) => t.confidence))
    : null;

  // 13. Routing resolution — look up helpdesk_routing_rules.
  const route = await resolveRoute(ticket.org_id, output.routing_suggestion, topTagConfidence);

  // 14. INSERT ticket_ai_suggestions.
  const suggestionId = await insertSuggestion({
    ticketId: ticket.id,
    messageId: message.id,
    tags: output.tags,
    routeUserId: route?.userId ?? null,
    routeConfidence: route?.confidence ?? null,
    draftReply: output.draft_reply,
    sentimentScore: output.sentiment_score,
    modelId: rawModel,
    isClinical: scope.isClinical,
  });
  if (!suggestionId) {
    return jsonResponse(500, { error: 'suggestion_insert_failed' });
  }

  // 15. Auto-apply gate (D-06). Only when at least one tag OR route meets 0.75.
  const anyTagOverThreshold = output.tags.some((t) => t.confidence >= TAG_AUTO_APPLY);
  const routeOverThreshold =
    route !== null && route.confidence >= ROUTE_AUTO_APPLY;
  let applied = false;
  let taggedCount = 0;
  let routed = false;
  if (anyTagOverThreshold || routeOverThreshold) {
    const r = await applySuggestionServerSide(
      suggestionId,
      ticket.id,
      output.tags,
      route?.userId ?? null,
      route?.confidence ?? null,
    );
    taggedCount = r.taggedCount;
    routed = r.routed;
    applied = taggedCount > 0 || routed;
  }

  // 16. Sentiment alert (D-10).
  const sentimentAlert = await maybeFireSentimentAlert(ticket.id, output.sentiment_score);

  // 17. PostHog events. All payloads carry ticket_id + scores + model id ONLY;
  //     NEVER message body or draft text (T-37-04-07).
  try {
    if (applied && taggedCount > 0) {
      captureServer({
        userId: ticket.user_id,
        event: 'helpdesk.ai.tagged',
        properties: {
          ticket_id: ticket.id,
          tag_count: taggedCount,
          top_tag_confidence: topTagConfidence,
          model_id: rawModel,
          is_clinical: scope.isClinical,
        },
      });
    }
    if (routed) {
      captureServer({
        userId: ticket.user_id,
        event: 'helpdesk.ticket.assigned',
        properties: {
          ticket_id: ticket.id,
          assigned_to: route?.userId,
          via: 'ai',
        },
      });
      captureServer({
        userId: ticket.user_id,
        event: 'helpdesk.ai.routed',
        properties: {
          ticket_id: ticket.id,
          route_confidence: route?.confidence,
          tag: output.routing_suggestion,
        },
      });
    }
    if (sentimentAlert) {
      captureServer({
        userId: ticket.user_id,
        event: 'helpdesk.sentiment_alert.fired',
        properties: {
          ticket_id: ticket.id,
          sentiment_score: output.sentiment_score,
        },
      });
      captureServer({
        userId: ticket.user_id,
        event: 'helpdesk.ai.sentiment_flagged',
        properties: {
          ticket_id: ticket.id,
          sentiment_score: output.sentiment_score,
          model_id: rawModel,
        },
      });
    }
  } catch {
    /* never block on PostHog */
  }

  return jsonResponse(200, {
    ok: true,
    suggestion_id: suggestionId,
    applied,
    sentiment_alert: sentimentAlert,
  });
}

// ─── Deno.serve entrypoint (try/finally + shutdownPostHog) ────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handler(req);
  } catch (e) {
    console.error('[helpdesk-ai-assist] unhandled', e instanceof Error ? e.name : 'unknown');
    return jsonResponse(500, { error: 'internal_error' });
  } finally {
    await shutdownPostHog();
  }
});

// ─── Internal test seams ──────────────────────────────────────────────────────
export const __internal = {
  ALLOWED_TAGS,
  TAG_AUTO_APPLY,
  ROUTE_AUTO_APPLY,
  SENTIMENT_ALERT_SINGLE,
  SENTIMENT_AGGREGATE_PER_MSG,
  SENTIMENT_AGGREGATE_COUNT,
  ClaudeOutputSchema,
  REFUSAL_RE,
  setAdminForTest(client: SupabaseClient): void {
    _adminSingleton.client = client;
  },
  resetAdminForTest(): void {
    _adminSingleton.client = null;
  },
};
