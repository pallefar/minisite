/**
 * Phase 34 Plan 34-02 (ONBOARD-01) — `create-anon-session` Edge Function.
 *
 * POST /functions/v1/create-anon-session
 *
 * Body (all fields optional):
 *   { cookie_id?: string }   // UUID v4 shape; ignored if malformed
 *
 * Response (200):
 *   { cookie_id: string }    // either the warm-touch cookie or a fresh UUID
 *
 * Behavior:
 *   - POST without cookie_id (or with a non-UUID-shape value):
 *       creates a fresh row in `public.anonymous_sessions` with a server-
 *       generated UUID and returns it.
 *   - POST with a valid UUID-shape cookie_id matching an existing un-merged row:
 *       updates `last_activity_at` to now() and returns the same cookie_id
 *       (idempotent warm-touch — resets the TTL clock).
 *   - POST with a valid UUID-shape cookie_id that does NOT match any row
 *     (orphan / already merged): falls through to fresh-row creation.
 *
 * The Fn is pre-auth and intended to be called BEFORE the user has a session.
 * It does NOT enforce a Bearer token; the AnonymousPreviewLayer (Plan 34-06)
 * is the only caller and it does not have a user JWT at that point. Service-
 * role writes are gated by the UUID-shape regex (T-34-02-01).
 *
 * Architecture invariants:
 *   - Service-role INSERT/UPDATE only on `public.anonymous_sessions`.
 *   - Does NOT import `_shared/posthog-server.ts` — activation_completed is
 *     captured by Plan 34-03's `record-activation` Fn, not here.
 *   - Does NOT import Sentry — failures degrade silently (caller falls back
 *     to local-only flow).
 *   - Skeleton mirrors `supabase/functions/plan-personalize/index.ts` (CORS
 *     helpers + lazy admin singleton + test injection seam + Deno.serve guard
 *     + __internal export).
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CORS
// ============================================================================

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

// ============================================================================
// Lazy admin singleton (per project pattern, see plan-personalize/index.ts)
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

// ============================================================================
// Validation
// ============================================================================

// UUID v4 shape (RFC 4122) — also accepts other UUID versions in v[1-5] slot
// to remain permissive of older crypto.randomUUID() outputs in test fixtures.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCookieId(input: unknown): string | null {
  return typeof input === 'string' && UUID_RE.test(input) ? input : null;
}

// ============================================================================
// Handler
// ============================================================================

async function handleCreateAnonSession(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  let body: { cookie_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Empty / malformed body is OK — we just create a fresh row.
    body = {};
  }

  const incoming = normalizeCookieId(body.cookie_id);

  // Warm-touch path: try to update an existing un-merged row.
  if (incoming !== null) {
    const { data, error } = await admin
      .from('anonymous_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('cookie_id', incoming)
      .is('merged_user_id', null)
      .select('cookie_id')
      .maybeSingle();

    if (error) {
      return jsonError(500, 'db_error');
    }
    if (data && typeof (data as { cookie_id?: unknown }).cookie_id === 'string') {
      return jsonResponse(200, { cookie_id: (data as { cookie_id: string }).cookie_id });
    }
    // Cookie present but row missing OR already merged — fall through to
    // create a fresh row so the browser is never left without a session.
  }

  // Cold-start path: create a fresh row with a server-generated UUID.
  const newCookie = crypto.randomUUID();
  const { error: insErr } = await admin
    .from('anonymous_sessions')
    .insert({ cookie_id: newCookie });
  if (insErr) {
    return jsonError(500, 'db_error');
  }
  return jsonResponse(200, { cookie_id: newCookie });
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleCreateAnonSession);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleCreateAnonSession,
  setAdminForTest,
  resetAdminForTest,
  normalizeCookieId,
  UUID_RE,
};
