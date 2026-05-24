/**
 * lesson-progress-beacon Edge Function — Phase 46 Plan 06
 *
 * POST /functions/v1/lesson-progress-beacon
 *
 * Handles tab-close progress saves dispatched from `navigator.sendBeacon`. The
 * Mux Player onTimeUpdate debounce window (Plan 46-08) is at most 15 s, so
 * tab-close inside that window would otherwise lose the user's last position.
 * sendBeacon is the catch.
 *
 * Critical correctness requirements (per CONTEXT.md correction 8 + RESEARCH
 * Pitfall 3):
 *
 *   - sendBeacon sends body as a string with
 *     `Content-Type: text/plain;charset=UTF-8` — `req.json()` THROWS.
 *     This fn MUST use `req.text()` + `JSON.parse()`.
 *   - sendBeacon cannot set the Authorization header — access_token MUST come
 *     from the body and be validated server-side.
 *   - sendBeacon cannot read the response — all error paths return 200 'ok'
 *     silently (logging only). Status codes are advisory at most.
 *   - The actual write goes through the SECDEF RPC `update_lesson_position`
 *     (Plan 46-01) which performs `GREATEST(...)` UPSERT — scrub-back never
 *     regresses the max watch position. A bare `UPDATE` from this fn would
 *     defeat that invariant (cf. memory feedback_state_counter_table_needs_upsert_on_event).
 *
 * Auth model:
 *   - The fn uses the admin (service-role) client only for `auth.getUser(token)`
 *     to validate the JWT.
 *   - The RPC call itself is dispatched through a per-request user-scoped client
 *     constructed with the access_token in the Authorization header so that
 *     `auth.uid()` inside the SECDEF function resolves to the JWT subject.
 *     (Plan 46-01's RPC raises 'unauthorized' when auth.uid() is null and is
 *     granted execute only to the `authenticated` role.)
 *
 * Threat refs:
 *   - T-46-02 (Tampering — spoofed max_position): mitigated soft. GREATEST() in
 *     the RPC means a spoofed-high beacon can only RAISE max — it cannot lower
 *     it. complete_lesson does its own server-side ≥95% threshold check
 *     against duration_seconds. A determined attacker can claim a fake
 *     completion but the resulting cert is empty / no learning occurred.
 *     CONTEXT D-12 documents this trade-off explicitly.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CORS + response helpers (verbatim from mux-create-upload/index.ts)
// ============================================================================

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

// ============================================================================
// Lazy admin singleton (verbatim from mux-create-upload/index.ts) — used only
// for `auth.getUser(token)` JWT validation; never for direct writes.
// ============================================================================

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
export function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
export function resetAdminForTest(): void {
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

// ============================================================================
// Per-request user-scoped client factory (testable override).
//
// Why: the SECDEF RPC update_lesson_position reads `auth.uid()` and is granted
// only to `authenticated`. We construct a fresh client carrying the user's JWT
// in the Authorization header so PostgREST forwards the auth context.
// ============================================================================

export type UserClientFactory = (token: string) => Pick<SupabaseClient, 'rpc'>;

const defaultUserClientFactory: UserClientFactory = (token: string) => {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
};

let _userClientFactoryOverride: UserClientFactory | null = null;
export function setUserClientFactoryForTest(factory: UserClientFactory): void {
  _userClientFactoryOverride = factory;
}
export function resetUserClientFactoryForTest(): void {
  _userClientFactoryOverride = null;
}

function getUserClient(token: string): Pick<SupabaseClient, 'rpc'> {
  return (_userClientFactoryOverride ?? defaultUserClientFactory)(token);
}

// ============================================================================
// Handler
// ============================================================================

export async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Method guard — sendBeacon always POSTs; reject everything else loudly.
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405, headers: corsHeaders });
  }

  // CRITICAL body parse (per RESEARCH Pitfall 3 / CONTEXT.md correction 8):
  // sendBeacon dispatches Content-Type: text/plain;charset=UTF-8 with a JSON
  // string body. `req.json()` would throw on the non-application/json
  // content-type in some runtimes; using `req.text()` + JSON.parse is safe
  // across both sendBeacon and an application/json caller (e.g. a curl smoke).
  const bodyText = await req.text();
  let body: {
    lesson_id?: string;
    last_position_seconds?: number;
    max_position_reached_seconds?: number;
    access_token?: string;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    // sendBeacon cannot read the response — log and 200 silently.
    console.warn('[lesson-progress-beacon] invalid JSON body, dropping');
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Auth from body (sendBeacon cannot set Authorization header).
  const token = typeof body?.access_token === 'string' ? body.access_token : '';
  if (!token) {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const { data: userData } = await (admin as SupabaseClient).auth.getUser(token);
  const user = userData?.user ?? null;
  if (!user) {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Input validation — strict types, fail closed.
  const lessonId = body?.lesson_id;
  const lastPos = body?.last_position_seconds;
  const maxPos = body?.max_position_reached_seconds;
  if (
    typeof lessonId !== 'string' ||
    lessonId.trim() === '' ||
    typeof lastPos !== 'number' ||
    !Number.isFinite(lastPos) ||
    typeof maxPos !== 'number' ||
    !Number.isFinite(maxPos)
  ) {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // RPC invocation through per-request user-scoped client. The SECDEF RPC
  // update_lesson_position (Plan 46-01) handles GREATEST() UPSERT — NEVER
  // bypass it with a bare table UPDATE from here.
  try {
    const userClient = getUserClient(token);
    await userClient.rpc('update_lesson_position', {
      p_lesson_id: lessonId,
      p_last_position_seconds: Math.max(0, Math.round(lastPos)),
      p_max_position_reached_seconds: Math.max(0, Math.round(maxPos)),
    });
  } catch (e) {
    // Best-effort — sendBeacon can't read the response. Log only.
    console.warn(
      '[lesson-progress-beacon] RPC update_lesson_position failed',
      e instanceof Error ? e.message : 'unknown',
    );
  }

  return new Response('ok', { status: 200, headers: corsHeaders });
}

// ============================================================================
// Deno.serve guard — prevents top-level serve trap in `deno test`
// (per reference_deno_test_top_level_serve_trap).
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
