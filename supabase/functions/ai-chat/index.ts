/**
 * `ai-chat` Edge Function — Moonshot Kimi K2 streaming proxy.
 *
 * Phase 4 D-01 + D-05 (Moonshot pivot): replaces the in-browser Anthropic
 * call. Browser POSTs here with a JWT (anonymous or real account), this
 * function validates the JWT, applies the AI-04 `<user_data>` structural
 * separation fence, opens an OpenAI-canonical Chat Completions stream
 * against Moonshot, tees the SSE body into (a) the browser response and
 * (b) a `captureAndPersist` drainer running inside `EdgeRuntime.waitUntil`
 * so the stream stays alive past response close (RESEARCH §"Common
 * Pitfalls" Pitfall 8).
 *
 * Phase 4 D-04 (04-03) wiring complete:
 *   1. Refusal pre-check: `isDoseChangeAdvice` from `shared/refusal.ts`.
 *   2. Rate-limit RPC: `checkAndIncrement` → `increment_rate_limit` (atomic).
 *   3. `ai_messages` persistence: user-side insert + assistant-side capture
 *      in `captureAndPersist` (Moonshot/OpenAI delta-shape extractor).
 *
 * Security:
 * - T-04-06 (key leak): Moonshot non-2xx is wrapped as
 *   `{error: 'moonshot-<status>'}` — NEVER `r.text()` echoed.
 * - T-04-07 (CORS): `Access-Control-Allow-Origin: '*'` acceptable because
 *   JWT is the auth gate (RESEARCH §2 line 1067).
 * - T-04-04 (cross-tenant): commented stubs explicitly carry the
 *   `user_id: user.id` (verified JWT) — NEVER from body.
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isDoseChangeAdvice } from 'shared/refusal';
import { assertBaaCoveredModel } from '../_shared/anthropic-baa-allowlist.ts';
import { resolveOrgId } from '../_shared/resolve-org-id.ts';
import { corsHeaders } from './cors.ts';
import { checkAndIncrement } from './rate-limit.ts';
import { buildSystemPrompt } from './system-prompt.ts';

const MOONSHOT_BASE_URL = Deno.env.get('MOONSHOT_BASE_URL') ?? 'https://api.moonshot.ai/v1';
const MOONSHOT_MODEL = Deno.env.get('MOONSHOT_MODEL') ?? 'kimi-k2.6';
const MOONSHOT_KEY = Deno.env.get('MOONSHOT_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Phase 25 D-13 — Anthropic clinical credential constants.
// Set in Supabase Function Secrets after BAA + ZDR addendum signed.
// NEVER fall through to consumer credentials if clinical path is selected.
const ANTHROPIC_CLINICAL_KEY = Deno.env.get('ANTHROPIC_CLINICAL_API_KEY');
const ANTHROPIC_CLINICAL_BAA_ACTIVE = Deno.env.get('ANTHROPIC_CLINICAL_BAA_ACTIVE') === '1';
const ANTHROPIC_DEFAULT_CLINICAL_MODEL = 'claude-sonnet-4-5';

// Service-role admin client. Phase 4 D-04: writes to ai_messages bypass
// RLS, but the `user_id` column MUST come from the verified JWT — never
// from the request body (T-04-04 anti-pattern explicit in RESEARCH §
// "Anti-Patterns" line 457). Persistence is stubbed in 04-02; the
// 04-03 implementation honors this invariant via `user_id: user.id`.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface ProxyMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ProxyRequest {
  messages: ProxyMessage[];
  mode?: 'coach' | 'macro-estimator';
  userContext?: string;
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Per RESEARCH §2 cont. lines 1083-1111 — refusal helper authored now so
// 04-03 only needs to flip the call site (not the helper). Emits a single
// SSE frame in the OpenAI delta shape so the browser parser handles it
// identically to a real upstream stream.
function refusalSSE(refusalText: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const frame =
        'data: ' +
        JSON.stringify({
          choices: [{ index: 0, delta: { content: refusalText }, finish_reason: 'stop' }],
        }) +
        '\n\n';
      controller.enqueue(encoder.encode(frame));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}

// Phase 4 D-04: persist the streamed assistant turn to `public.ai_messages`
// after the response has flushed to the browser. Runs inside
// `EdgeRuntime.waitUntil(...)` so the function stays alive past response
// close (RESEARCH Pitfall 8) without blocking the SSE stream.
//
// SSE delta extractor — Moonshot / OpenAI Chat Completions shape:
//   `data: {"choices":[{"delta":{"content":"..."}}]}\n\n` … `data: [DONE]\n\n`
// per `04-ADDENDUM-MOONSHOT.md`. We accumulate `choices[0].delta.content`
// across frames; bad/empty frames are swallowed (the front-end already saw
// the text — we just won't get to persist that piece). Buffered across reads
// so a `data:` frame that arrives split across chunks is parsed whole.
async function captureAndPersist(
  stream: ReadableStream<Uint8Array>,
  userId: string,
  mode: 'coach' | 'macro-estimator',
): Promise<void> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let assistantText = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    // SSE frames are separated by a blank line (\n\n). Keep the last
    // (possibly partial) chunk in the buffer for the next read.
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const frame of parts) {
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const payload = dataLine.slice(6).trim();
      if (payload === '' || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: unknown } }>;
        };
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') {
          assistantText += delta;
        }
      } catch {
        // Swallow malformed frames — front-end already received the text;
        // persistence is best-effort. T-04-06: never log the raw payload.
      }
    }
  }
  // Handle any trailing partial buffer (rare — most streams end with `\n\n`).
  if (buffer.startsWith('data: ')) {
    const payload = buffer.slice(6).trim();
    if (payload && payload !== '[DONE]') {
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: unknown } }>;
        };
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') {
          assistantText += delta;
        }
      } catch {
        // best-effort
      }
    }
  }

  if (!assistantText) {
    // Nothing to persist (refusalSSE path bypasses this drainer anyway).
    return;
  }
  try {
    // T-04-04 mitigation invariant: `user_id` is the verified JWT id passed
    // from the request handler — NEVER from request body or upstream payload.
    await admin.from('ai_messages').insert({
      user_id: userId,
      role: 'assistant',
      content: assistantText,
      mode,
      model: MOONSHOT_MODEL,
    });
  } catch (e) {
    console.error(
      '[ai-chat] failed to persist assistant message',
      e instanceof Error ? e.message : 'unknown',
    );
  }
}

// Phase 25 D-13 — Anthropic Messages API streaming for clinical org users.
//
// Called ONLY when:
//   (a) resolveOrgId returns non-null (user is org-bound)
//   (b) ANTHROPIC_CLINICAL_BAA_ACTIVE === '1' (BAA + ZDR addendum signed)
//   (c) assertBaaCoveredModel(modelId) passes without throwing
//
// NEVER called for consumer path (org_id === null → consumer path unchanged).
// T-25-04-E1 mitigation: NO silent credential fallthrough from clinical path.
//
// SSE format: Anthropic Messages API `event: content_block_delta` shape.
// Delta text: `data.delta.text` (NOT `choices[0].delta.content`).
// Reference: https://docs.anthropic.com/en/api/messages-streaming
async function streamFromAnthropicClinical(opts: {
  admin: ReturnType<typeof createClient>;
  user: { id: string };
  messages: ProxyMessage[];
  modelId: string;
}): Promise<Response> {
  const { admin, user, messages, modelId } = opts;

  if (!ANTHROPIC_CLINICAL_KEY) {
    // Vendor-gated: BAA active flag set but key not provisioned yet.
    // Log warning (NOT error — this is an ops gap, not a code bug).
    console.warn('[ai-chat] ANTHROPIC_CLINICAL_BAA_ACTIVE=1 but ANTHROPIC_CLINICAL_API_KEY not set');
    return jsonError(503, 'clinical-key-pending');
  }

  // Build Anthropic Messages API request body.
  // System prompt: first message with role 'system', or separate `system` param.
  const anthropicMessages = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
  const systemMsg = messages.find((m) => m.role === 'system');

  let upstreamResp: Response;
  try {
    upstreamResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ANTHROPIC_CLINICAL_KEY}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        // ZDR requirement (verify header name on Anthropic Enterprise console before activating).
        // 'anthropic-zdr-required': 'true',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1024,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: anthropicMessages,
        stream: true,
      }),
    });
  } catch (e) {
    console.error('[ai-chat] anthropic clinical upstream fetch failed', e instanceof Error ? e.message : 'unknown');
    return jsonError(502, 'anthropic-clinical-network');
  }

  if (!upstreamResp.ok) {
    // T-25-04-I1: NEVER echo Anthropic's error body. Stable short-code only.
    console.error(`[ai-chat] anthropic clinical non-2xx: ${upstreamResp.status}`);
    return jsonError(502, `anthropic-clinical-${upstreamResp.status}`);
  }
  if (!upstreamResp.body) {
    return jsonError(502, 'anthropic-clinical-empty-body');
  }

  // Tee for client + persist drainer (Anthropic `event: content_block_delta` shape).
  // Delta path: `data.type === 'content_block_delta' && data.delta.type === 'text_delta'`
  //             → `data.delta.text`.
  const [toClient, toCapture] = upstreamResp.body.tee();
  // @ts-expect-error — EdgeRuntime is injected by Supabase Edge Runtime; not in @types/deno.
  EdgeRuntime.waitUntil(captureAndPersistAnthropicClinical(toCapture, user.id, admin));

  return new Response(toClient, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}

// Anthropic SSE drainer — adapts `event: content_block_delta` shape to persistence.
// Mirrors `captureAndPersist` for Moonshot but reads `delta.text` instead of
// `choices[0].delta.content` (Anthropic Messages API streaming format).
async function captureAndPersistAnthropicClinical(
  stream: ReadableStream<Uint8Array>,
  userId: string,
  admin: ReturnType<typeof createClient>,
): Promise<void> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let assistantText = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const frame of parts) {
      // Anthropic SSE: `event: content_block_delta\ndata: {...}`
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const payload = dataLine.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: unknown };
        };
        if (
          parsed?.type === 'content_block_delta' &&
          parsed?.delta?.type === 'text_delta' &&
          typeof parsed?.delta?.text === 'string'
        ) {
          assistantText += parsed.delta.text;
        }
      } catch {
        // Swallow malformed frames — best-effort persistence.
      }
    }
  }

  if (!assistantText) return;
  try {
    // T-04-04 invariant: user_id from verified JWT, NEVER from request body.
    await admin.from('ai_messages').insert({
      user_id: userId,
      role: 'assistant',
      content: assistantText,
      mode: 'coach',
      model: 'anthropic-clinical',
    });
  } catch (e) {
    console.error(
      '[ai-chat] failed to persist anthropic clinical assistant message',
      e instanceof Error ? e.message : 'unknown',
    );
  }
}

// Phase 25 D-13 — test seam for dependency injection in unit tests.
// This object is ONLY exported for test use; production code NEVER imports it.
// deno-lint-ignore no-explicit-any
export const __internal: { _resolveOrgId?: (...args: any[]) => Promise<string | null> } = {};

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method-not-allowed');
  }

  // 2. JWT → user. The Edge Runtime's default JWT verification already
  // gated the request; we re-derive `user.id` here for downstream use.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) {
    return jsonError(401, 'missing-jwt');
  }
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonError(401, 'invalid-jwt');
  }
  const user = userData.user;

  // 3. Body parse + validate.
  let body: ProxyRequest;
  try {
    body = (await req.json()) as ProxyRequest;
  } catch {
    return jsonError(400, 'bad-json');
  }
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, 'empty-messages');
  }
  const mode = body.mode ?? 'coach';

  const latestUser = [...body.messages].reverse().find((m) => m.role === 'user');
  if (!latestUser) {
    return jsonError(400, 'no-user-message');
  }

  // 4. Rate-limit (T-04-02 mitigation). Atomic security-definer RPC across
  // minute/hour/day windows; fail-OPEN on RPC error. Runs BEFORE refusal +
  // persist so a flooder can't burn DB writes — the cheapest gate first.
  const allowed = await checkAndIncrement(admin, user.id);
  if (!allowed) {
    return jsonError(429, 'rate-limited');
  }

  // 5. ai_messages persistence (user side). T-04-04 integrity invariant:
  // `user_id` is sourced from `user.id` (verified JWT in step 2), NEVER from
  // request body. Service role bypasses RLS at write time; the RLS policy
  // `with check (auth.uid() = user_id)` guards any future non-service-role
  // write path.
  //
  // Order rationale (Rule 2 audit-trail fix): the user-side insert runs
  // BEFORE the refusal pre-check so refused inputs are still captured —
  // dose-change attempts, prompt-injection, and emotional-manipulation rows
  // are valuable threat-model evidence and the SUMMARY's T-04-01 / T-04-03
  // proof depends on this row being present after a refusal-smoke POST.
  try {
    await admin.from('ai_messages').insert({
      user_id: user.id,
      role: 'user',
      content: latestUser.content,
      mode,
      model: MOONSHOT_MODEL,
    });
  } catch (e) {
    console.error(
      '[ai-chat] failed to persist user message',
      e instanceof Error ? e.message : 'unknown',
    );
    // Continue — persistence failure is logged but does not fail the chat.
  }

  // 6. Refusal pre-check (T-04-01 mitigation). Deterministic short-circuit
  // BEFORE any Moonshot round-trip — see `shared/refusal.ts`. The refusalSSE
  // helper emits a single OpenAI-shaped delta frame so the browser parser
  // handles it identically to a real upstream stream. The matching user row
  // landed in step 5 above so the refusal attempt is still audit-traceable.
  if (isDoseChangeAdvice(latestUser.content)) {
    // Also persist the refusal as the assistant turn (audit trail). Use the
    // canonical refusal copy so this exact string appears in ai_messages
    // alongside the user attempt — useful for post-mortem T-04-01 review.
    const refusalText =
      "I can't recommend specific dose changes. Please bring this to your prescriber.";
    try {
      await admin.from('ai_messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: refusalText,
        mode,
        model: 'refusal-precheck',
      });
    } catch (e) {
      console.error(
        '[ai-chat] failed to persist refusal assistant message',
        e instanceof Error ? e.message : 'unknown',
      );
    }
    return refusalSSE(refusalText);
  }

  // 6b. Phase 25 D-13 — 3-way branch on org_id (clinical vs consumer).
  //
  // T-25-04-S1 mitigation: org_id is ALWAYS resolved server-side from the DB
  // keyed on the verified JWT user.id — NEVER from request body.
  //
  // Branch logic:
  //   (A) org_id === null  → consumer Moonshot path (continue below — UNCHANGED)
  //   (B) org_id non-null + BAA inactive → 503 'clinical-baa-pending' + audit row
  //   (C) org_id non-null + BAA active + model on allowlist → Anthropic clinical stream
  //
  // T-25-04-E1 mitigation: EXPLICITLY no silent credential fallthrough (clinical → consumer).
  // If BAA inactive or model not allowed, REFUSE — do NOT fall through to consumer path.
  const resolveOrgIdFn = __internal._resolveOrgId ?? resolveOrgId;
  const orgId = await resolveOrgIdFn(admin, user.id);

  if (orgId !== null) {
    // Clinical branch — must NOT silent-fallthrough to consumer credentials (T-25-04-E1).
    if (!ANTHROPIC_CLINICAL_BAA_ACTIVE) {
      // Audit the gated refusal via SECDEF RPC.
      // Phase 24 revoked direct INSERT on audit_logs from service_role;
      // public.log_baa_guard_refusal (Task 0 migration) is the ONLY write path.
      await admin.rpc('log_baa_guard_refusal', {
        p_user_id: user.id,
        p_payload: { reason: 'clinical_baa_inactive', orgId },
      }).then(
        () => {},
        (e: unknown) => console.warn('[ai-chat] audit rpc failed', e instanceof Error ? e.name : 'unknown'),
      );
      return jsonError(503, 'clinical-baa-pending');
    }

    const modelId = Deno.env.get('ANTHROPIC_CLINICAL_MODEL') ?? ANTHROPIC_DEFAULT_CLINICAL_MODEL;
    try {
      assertBaaCoveredModel(modelId);
    } catch (rej) {
      if (rej instanceof Response) {
        await admin.rpc('log_baa_guard_refusal', {
          p_user_id: user.id,
          p_payload: { modelId, reason: 'allowlist-or-denylist-violation', orgId },
        }).then(
          () => {},
          (e: unknown) => console.warn('[ai-chat] audit rpc failed', e instanceof Error ? e.name : 'unknown'),
        );
        return rej;
      }
      throw rej;
    }

    // Clinical streaming path — Anthropic Messages API.
    // Consumer Moonshot path NOT reached from here (T-25-04-E1).
    return await streamFromAnthropicClinical({
      admin,
      user,
      messages: body.messages,
      modelId,
    });
  }

  // Consumer path — existing Moonshot path (UNCHANGED from Phase 4).
  // Only reached when orgId === null (non-clinical user, v1.3 always this).

  // 7. AI-04 structural separation. Apply the <user_data> fence to the
  // FIRST user message so the model treats client-supplied context as
  // untrusted data, never instructions. Subsequent user messages pass
  // through unchanged — context only attaches to the conversation root.
  const userContext = body.userContext ?? '';
  let firstUserSeen = false;
  const transformed: ProxyMessage[] = body.messages.map((m) => {
    if (m.role !== 'user' || firstUserSeen) return m;
    firstUserSeen = true;
    const fenced = `<user_data>\n${userContext}\n</user_data>\n\n${m.content}`;
    return { role: 'user', content: fenced };
  });

  // 8. Prepend system prompt (Moonshot/OpenAI convention: messages[0]
  // with role 'system' — NEVER concatenate userContext into the system
  // content; that defeats AI-04 structural separation).
  const systemMsg: ProxyMessage = {
    role: 'system',
    content: buildSystemPrompt(mode),
  };

  // 9. Open Moonshot stream.
  if (!MOONSHOT_KEY) {
    console.error('[ai-chat] MOONSHOT_API_KEY env secret is missing');
    return jsonError(500, 'moonshot-misconfigured');
  }
  const maxCompletionTokens = mode === 'macro-estimator' ? 250 : 1024;
  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(`${MOONSHOT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MOONSHOT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MOONSHOT_MODEL,
        messages: [systemMsg, ...transformed],
        stream: true,
        max_completion_tokens: maxCompletionTokens,
        stream_options: { include_usage: true },
      }),
    });
  } catch (e) {
    console.error('[ai-chat] upstream fetch failed', e instanceof Error ? e.message : 'unknown');
    return jsonError(502, 'moonshot-network');
  }

  if (!upstreamResp.ok) {
    // T-04-06: NEVER echo Moonshot's error body. Map status to a
    // stable code the browser can branch on. Specific 401/429 carry
    // distinct browser meanings (RESEARCH §14 F6).
    console.error(`[ai-chat] moonshot non-2xx: ${upstreamResp.status}`);
    if (upstreamResp.status === 429) {
      return jsonError(429, 'moonshot-429');
    }
    if (upstreamResp.status >= 500) {
      return jsonError(502, 'moonshot-5xx');
    }
    return jsonError(502, `moonshot-${upstreamResp.status}`);
  }
  if (!upstreamResp.body) {
    return jsonError(502, 'moonshot-empty-body');
  }

  // 10. Tee the stream: one branch to the browser, one to the persist
  // drainer running past response close (Pitfall 8).
  const [toClient, toCapture] = upstreamResp.body.tee();
  // @ts-expect-error — EdgeRuntime is injected by Supabase Edge Runtime; not in @types/deno.
  EdgeRuntime.waitUntil(captureAndPersist(toCapture, user.id, mode));

  return new Response(toClient, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
});

