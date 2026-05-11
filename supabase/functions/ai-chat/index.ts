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
 * Three TODO(04-03) stubs are deliberately left for the next plan:
 *   1. Refusal pre-check: `shared/refusal.ts` is not extracted yet.
 *   2. Rate-limit RPC: `rate_limit_counters` migration owned by 04-03.
 *   3. `ai_messages` persistence: schema + RLS owned by 04-03.
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
import { buildSystemPrompt } from './system-prompt.ts';
import { corsHeaders } from './cors.ts';

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

// Drainer for the captureAndPersist tee branch. In 04-02 this is a
// no-op that simply reads to end so the upstream stream is not
// backpressure-stalled (RESEARCH Pitfall 8). 04-03 replaces this body
// with the real `ai_messages` persister (RESEARCH §14 F4 pseudocode).
async function captureAndPersist(
  stream: ReadableStream<Uint8Array>,
  _userId: string,
): Promise<void> {
  // TODO(04-03): persist assistant message to ai_messages.
  // For 04-02, drain so the tee branch does not stall the browser stream.
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
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

  // 4. Refusal pre-check.
  // TODO(04-03): import { isDoseChangeAdvice } from 'shared/refusal';
  //   if (isDoseChangeAdvice(latestUser.content)) {
  //     return refusalSSE("I can't suggest a specific dose change. Please bring this to your prescriber.");
  //   }

  // 5. Rate-limit.
  // TODO(04-03): const allowed = await checkAndIncrement(user.id);
  //   if (!allowed) return jsonError(429, 'rate-limited');

  // 6. ai_messages persistence (user side).
  // TODO(04-03): await admin.from('ai_messages').insert({
  //     user_id: user.id, role: 'user', content: latestUser.content, mode,
  //   });
  //   user_id MUST come from `user.id` (verified JWT) — never from body (T-04-04).

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
  EdgeRuntime.waitUntil(captureAndPersist(toCapture, user.id));

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

// `refusalSSE` is intentionally referenced from a commented hook above
// (TODO 04-03) — keep the import in the surface area so 04-03 only flips
// the call site, not the helper. Force-reference here for lint cleanliness.
void refusalSSE;
