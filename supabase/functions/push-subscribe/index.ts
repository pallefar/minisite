/**
 * Phase 42 Plan 42-05 (POLISH-05/06) — push-subscribe Edge Function.
 * Phase 54 Plan 54-03 — Extended to accept native { platform, device_token } body.
 *
 * POST /functions/v1/push-subscribe
 *
 * Auth: Authorization: Bearer <user-jwt>.
 *
 * Body shape A — web VAPID (existing):
 *   { endpoint: string, p256dh: string, auth: string, user_agent?: string }
 *   UPSERT onConflict (user_id, endpoint); platform='web'.
 *
 * Body shape B — native APNs/FCM (new in 54-03):
 *   { platform: 'ios'|'android', device_token: string }
 *   UPSERT onConflict (user_id, device_token) [partial unique index from 54-01].
 *
 * Behavior:
 *   1. Verify JWT → auth.uid().
 *   2. Validate body (discriminate A vs B; reject neither with 400).
 *   3. UPSERT push_subscriptions per shape.
 *   4. Respond 200 { subscribed: true }.
 *
 * T-42-05-02 / T-54-03-01 mitigation: the body's user_id is NOT trusted — only
 * the verified JWT subject is used.
 * T-54-03-02 mitigation: platform validated as 'ios'|'android' enum in validateBody.
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

// ─── Body types ───────────────────────────────────────────────────────────────

interface WebSubscribeBody {
  kind: 'web';
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}

interface NativeSubscribeBody {
  kind: 'native';
  platform: 'ios' | 'android';
  device_token: string;
}

type ValidatedBody = WebSubscribeBody | NativeSubscribeBody;

// ─── Body validation ──────────────────────────────────────────────────────────

function validateBody(raw: unknown): { ok: true; body: ValidatedBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body_not_object' };
  const obj = raw as Record<string, unknown>;

  // ── Native body: { platform: 'ios'|'android', device_token: string } ────────
  // Discriminated by presence of 'device_token' or 'platform' field.
  if ('device_token' in obj || ('platform' in obj && obj.platform !== undefined)) {
    if (obj.platform !== 'ios' && obj.platform !== 'android') {
      return { ok: false, reason: 'platform_must_be_ios_or_android' };
    }
    if (typeof obj.device_token !== 'string' || obj.device_token.length === 0) {
      return { ok: false, reason: 'device_token_required' };
    }
    return {
      ok: true,
      body: {
        kind: 'native',
        platform: obj.platform as 'ios' | 'android',
        device_token: obj.device_token,
      },
    };
  }

  // ── Web body: { endpoint, p256dh, auth, user_agent? } ───────────────────────
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
      kind: 'web',
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
  const body = valid.body;

  let upsertRes: { error: { message?: string } | null };

  if (body.kind === 'native') {
    // ── Native APNs/FCM token UPSERT ──────────────────────────────────────────
    // Conflict key: (user_id, device_token) — partial unique index from 54-01.
    // Updates platform + updated_at on re-registration (e.g. token refresh).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    upsertRes = (await ((admin.from('push_subscriptions') as any).upsert(
      {
        user_id: userId,
        platform: body.platform,
        device_token: body.device_token,
        failure_count: 0,          // reset on re-registration — actively registering device is healthy (WR-01)
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_token' },
    ))) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } else {
    // ── Web VAPID subscription UPSERT (existing path, unchanged) ─────────────
    /* eslint-disable @typescript-eslint/no-explicit-any */
    upsertRes = (await ((admin.from('push_subscriptions') as any).upsert(
      {
        user_id: userId,
        platform: 'web',
        endpoint: body.endpoint,
        p256dh: body.p256dh,
        auth: body.auth,
        user_agent: body.user_agent ?? null,
        failure_count: 0,          // reset on re-registration — actively registering device is healthy (WR-01)
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,endpoint' },
    ))) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  if (upsertRes.error) {
    console.error('[push-subscribe] upsert failed', upsertRes.error.message);
    return jsonError(500, 'internal');
  }

  return jsonResponse(200, { subscribed: true });
}

// ─── Deno.serve entrypoint ────────────────────────────────────────────────────
//
// Per reference_deno_test_top_level_serve_trap: `Deno.serve()` at module
// top-level fires during `deno test`, binding a real port and aborting all
// tests. Guard with `import.meta.main` (true only when this file is the
// direct entry point, NOT when imported by a test file).
// The legacy `denoGlobal?.serve` guard is insufficient — Deno.serve exists
// in test context. `import.meta.main` is the reliable discriminator.
// push-dispatch (54-02) uses the same pattern.
if (import.meta.main) {
  Deno.serve(handleSubscribe);
}

export const __internal = {
  handleSubscribe,
  setAdminForTest,
  resetAdminForTest,
  validateBody,
};
