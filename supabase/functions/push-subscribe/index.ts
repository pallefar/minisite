/**
 * Phase 42 Plan 42-05 (POLISH-05/06) — push-subscribe Edge Function.
 *
 * POST /functions/v1/push-subscribe
 *
 * Auth: Authorization: Bearer <user-jwt>.
 * Body: { endpoint: string, p256dh: string, auth: string, user_agent?: string }.
 *
 * Behavior:
 *   1. Verify JWT → auth.uid().
 *   2. Validate body (non-empty strings; endpoint must be https URL).
 *   3. UPSERT push_subscriptions:
 *      INSERT (user_id, endpoint, p256dh, auth, user_agent)
 *      ON CONFLICT (user_id, endpoint) DO UPDATE SET
 *        p256dh = EXCLUDED.p256dh,
 *        auth = EXCLUDED.auth,
 *        user_agent = EXCLUDED.user_agent;
 *   4. Respond 200 { subscribed: true }.
 *
 * T-42-05-02 mitigation: the body's user_id is NOT trusted — only the verified
 * JWT subject is used.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ─── CORS ──────────────────────────────────────────────────────────────────────

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ─── Lazy admin singleton ──────────────────────────────────────────────────────

let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

let _adminOverride: unknown | null = null;
function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
function resetAdminForTest(): void {
  _adminOverride = null;
  _adminInstance = null;
}

const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: unknown, prop: string | symbol): unknown {
    // deno-lint-ignore no-explicit-any
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ─── Body validation ──────────────────────────────────────────────────────────

interface SubscribeBody {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}

function validateBody(raw: unknown): { ok: true; body: SubscribeBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body_not_object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.endpoint !== 'string' || !/^https:\/\//.test(obj.endpoint)) {
    return { ok: false, reason: 'endpoint_must_be_https_url' };
  }
  if (typeof obj.p256dh !== 'string' || obj.p256dh.length === 0) {
    return { ok: false, reason: 'p256dh_required' };
  }
  if (typeof obj.auth !== 'string' || obj.auth.length === 0) {
    return { ok: false, reason: 'auth_required' };
  }
  if (obj.user_agent !== undefined && typeof obj.user_agent !== 'string') {
    return { ok: false, reason: 'user_agent_must_be_string' };
  }
  return {
    ok: true,
    body: {
      endpoint: obj.endpoint,
      p256dh: obj.p256dh,
      auth: obj.auth,
      user_agent: typeof obj.user_agent === 'string' ? obj.user_agent : undefined,
    },
  };
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleSubscribe(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(jwt))) as {
    data: { user?: { id?: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
  const userId = userData.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'body_not_json');
  }
  const valid = validateBody(raw);
  if (!valid.ok) return jsonError(400, valid.reason);
  const { endpoint, p256dh, auth, user_agent } = valid.body;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const upsertRes = (await ((admin.from('push_subscriptions') as any).upsert(
    {
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: user_agent ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint' },
  ))) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (upsertRes.error) {
    console.error('[push-subscribe] upsert failed', upsertRes.error.message);
    return jsonError(500, 'internal');
  }

  return jsonResponse(200, { subscribed: true });
}

// ─── Deno.serve entrypoint ────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleSubscribe);
}

export const __internal = {
  handleSubscribe,
  setAdminForTest,
  resetAdminForTest,
  validateBody,
};
