/**
 * Phase 42 Plan 42-05 (POLISH-05/06) — notification-dismiss Edge Function.
 *
 * POST /functions/v1/notification-dismiss
 *
 * Auth: Authorization: Bearer <user-jwt>.
 * Body: { notification_id: string (uuid) }.
 *
 * Behavior:
 *   1. Verify the JWT via admin.auth.getUser(jwt) → resolves auth.uid().
 *   2. RLS-scoped UPDATE user_notifications SET dismissed_at = now()
 *      WHERE id = $1 AND user_id = auth.uid() — returns the row's category.
 *   3. UPSERT notification_dismissal_state with consecutive_dismissals +1:
 *
 *      INSERT INTO notification_dismissal_state
 *        (user_id, category, consecutive_dismissals, last_event_at, throttle_until)
 *      VALUES (auth.uid(), <cat>, 1, now(), NULL)
 *      ON CONFLICT (user_id, category) DO UPDATE SET
 *        consecutive_dismissals = notification_dismissal_state.consecutive_dismissals + 1,
 *        last_event_at = now(),
 *        throttle_until = CASE
 *          WHEN notification_dismissal_state.consecutive_dismissals + 1 >= 3
 *            THEN now() + interval '7 days'
 *          ELSE notification_dismissal_state.throttle_until
 *        END;
 *
 *      CRITICAL — UPSERT not bare UPDATE: a fresh user has no row → bare UPDATE
 *      no-ops silently → consecutive_dismissals never reaches 3 → D-05 dies.
 *      The fresh-user invariant is covered by
 *      leanshot/tests/integration/notification-dismissal-fresh-user.test.ts.
 *
 * Internals (`__internal`) exported for Deno test suite (not present in this
 * plan — covered by the integration test via service-role admin client).
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DismissBody {
  notification_id: string;
}

function validateBody(raw: unknown): { ok: true; body: DismissBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body_not_object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.notification_id !== 'string' || !UUID_RE.test(obj.notification_id)) {
    return { ok: false, reason: 'notification_id_required_uuid' };
  }
  return { ok: true, body: { notification_id: obj.notification_id } };
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleDismiss(req: Request): Promise<Response> {
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

  const { notification_id } = valid.body;
  const nowIso = new Date().toISOString();

  // 1. Mark notification dismissed; RLS would deny if not owner; we use service
  // role here but scope by user_id to enforce ownership.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const updRes = (await ((admin.from('user_notifications') as any)
    .update({ dismissed_at: nowIso })
    .eq('id', notification_id)
    .eq('user_id', userId)
    .select('id, category')
    .maybeSingle())) as {
    data: { id: string; category: string } | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (updRes.error) {
    console.error('[notification-dismiss] update failed', updRes.error.message);
    return jsonError(500, 'internal');
  }
  if (!updRes.data) {
    return jsonError(404, 'notification_not_found');
  }
  const category = updRes.data.category;

  // 2. UPSERT dismissal-state. RPC-style raw SQL for the conditional throttle_until.
  // Supabase-js doesn't natively support ON CONFLICT DO UPDATE with column-ref
  // expressions, so we read-then-upsert.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const existingRes = (await ((admin.from('notification_dismissal_state') as any)
    .select('consecutive_dismissals, throttle_until')
    .eq('user_id', userId)
    .eq('category', category)
    .maybeSingle())) as {
    data: { consecutive_dismissals: number; throttle_until: string | null } | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (existingRes.error) {
    console.error('[notification-dismiss] dismissal_state read failed', existingRes.error.message);
    return jsonError(500, 'internal');
  }

  const prevCount = existingRes.data?.consecutive_dismissals ?? 0;
  const newCount = prevCount + 1;
  const prevThrottle = existingRes.data?.throttle_until ?? null;
  const newThrottle =
    newCount >= 3
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : prevThrottle;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const upsertRes = (await ((admin.from('notification_dismissal_state') as any).upsert(
    {
      user_id: userId,
      category,
      consecutive_dismissals: newCount,
      last_event_at: nowIso,
      throttle_until: newThrottle,
    },
    { onConflict: 'user_id,category' },
  ))) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (upsertRes.error) {
    console.error('[notification-dismiss] dismissal_state upsert failed', upsertRes.error.message);
    return jsonError(500, 'internal');
  }

  return jsonResponse(200, {
    dismissed_at: nowIso,
    consecutive_dismissals: newCount,
    throttle_until: newThrottle,
  });
}

// ─── Deno.serve entrypoint ────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleDismiss);
}

export const __internal = {
  handleDismiss,
  setAdminForTest,
  resetAdminForTest,
  validateBody,
};
