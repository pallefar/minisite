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
import { corsHeaders } from './cors.ts';
import { checkAndIncrement } from './rate-limit.ts';
import { buildSystemPrompt } from './system-prompt.ts';

const MOONSHOT_BASE_URL = Deno.env.get('MOONSHOT_BASE_URL') ?? 'https://api.moonshot.ai/v1';
const MOONSHOT_MODEL = Deno.env.get('MOONSHOT_MODEL') ?? 'kimi-k2.6';
const MOONSHOT_KEY = Deno.env.get('MOONSHOT_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

