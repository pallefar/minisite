/**
 * Phase 34 Plan 34-09 ONBOARD-08 — `ship-winner-flag` Edge Function.
 *
 * POST /functions/v1/ship-winner-flag
 *
 * Promotes a PostHog feature-flag variant to 100% rollout AND writes an
 * `audit_logs` row. Server-side superadmin gate enforced (defense-in-depth
 * beyond the client's surfaceCheck UI hint per CONTEXT D-18).
 *
 * Auth:
 *   Authorization: Bearer <user-jwt>
 *
 * Body:
 *   {
 *     flag_id: string,   // PostHog feature_flag.id (integer-as-string)
 *     variant: string    // variant key to ship to 100%
 *   }
 *
 * Response (200):
 *   { ok: true, flag_id, variant }
 *
 * Error responses:
 *   401 unauthenticated     — bearer missing or invalid
 *   400 invalid_body        — flag_id/variant validation failed
 *   403 forbidden_not_superadmin — caller's profiles.admin_role != 'superadmin'
 *   403 posthog_patch_failed     — PostHog returned 403 (token scope)
 *   502 posthog_patch_failed     — PostHog 5xx
 *   503 vendor_unconfigured      — POSTHOG_PERSONAL_API_KEY|PROJECT_ID missing
 *
 * Vendor-gated pattern (memory [[vendor-gated-send-via-health-check]]):
 *   Startup health check returns 503 BEFORE any outbound traffic when secrets
 *   are missing. Plan 34-10's human checkpoint sets the secrets via:
 *     supabase secrets set POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=...
 *
 * Threat model (T-34-09-01, T-34-09-02, T-34-09-05, T-34-09-06):
 *   - Superadmin role re-verified server-side from profiles via service-role
 *     read; client-side surfaceCheck is UI hint only.
 *   - POSTHOG_PERSONAL_API_KEY never leaves Edge Fn env; no VITE_ prefix.
 *   - audit_logs row records actor + before/after; best-effort insert (does
 *     not block the 200 response on insert failure).
 *   - Bearer JWT validated via admin.auth.getUser() against GoTrue.
 *
 * Per memory [[reference_supabase_edge_function_deploy]]: deploy without
 * `--linked`; orchestrator runs `supabase functions deploy ship-winner-flag`.
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

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Lazy admin singleton + test override
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
// Vendor health check (memory [[vendor-gated-send-via-health-check]])
// ============================================================================

function vendorHealthCheck(): Response | null {
  const apiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY');
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID');
  if (!apiKey || !projectId) {
    console.warn(
      '[ship-winner-flag] vendor_unconfigured: POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID missing — Plan 34-10 checkpoint not yet run.',
    );
    return jsonResponse(503, { error: 'vendor_unconfigured', service: 'posthog' });
  }
  return null;
}

// ============================================================================
// Body validation
// ============================================================================

interface ShipWinnerBody {
  flag_id: string;
  variant: string;
}

function parseBody(raw: unknown): { ok: true; body: ShipWinnerBody } | { ok: false; code: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'invalid_body' };
  const r = raw as Record<string, unknown>;
  // PostHog feature-flag IDs are integers — accept integer-as-string only.
  if (typeof r.flag_id !== 'string' || !/^\d+$/.test(r.flag_id)) {
    return { ok: false, code: 'invalid_body' };
  }
  if (typeof r.variant !== 'string' || r.variant.length === 0 || r.variant.length > 64) {
    return { ok: false, code: 'invalid_body' };
  }
  return { ok: true, body: { flag_id: r.flag_id, variant: r.variant } };
}

// ============================================================================
// Core handler
// ============================================================================

async function handleShipWinner(req: Request): Promise<Response> {
  // CORS preflight (204 = no content, no body).
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // Vendor health check — short-circuit BEFORE any outbound traffic.
  const health = vendorHealthCheck();
  if (health) return health;

  // Bearer JWT.
  const bearer = jwtFromReq(req);
  if (!bearer) return jsonError(401, 'unauthenticated');

  // Validate bearer against GoTrue.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(bearer))) as {
    data: { user?: { id?: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
  const callerUid = userData.user.id;

  // Server-side superadmin gate (T-34-09-01).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: prof } = (await ((admin as any)
    .from('profiles')
    .select('admin_role')
    .eq('id', callerUid)
    .maybeSingle())) as { data: { admin_role?: string } | null; error: unknown };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (prof?.admin_role !== 'superadmin') {
    return jsonError(403, 'forbidden_not_superadmin');
  }

  // Body validation.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) return jsonError(400, parsed.code);
  const { flag_id, variant } = parsed.body;

  // PATCH PostHog feature flag → 100% rollout on the winning variant.
  const apiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY') ?? '';
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID') ?? '';
  const url = `https://us.i.posthog.com/api/projects/${projectId}/feature_flags/${flag_id}/`;
  const phRes = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: {
        groups: [{ properties: [], rollout_percentage: 100, variant }],
        multivariate: null,
      },
    }),
  });
  if (!phRes.ok) {
    const text = await phRes.text().catch(() => '');
    console.error('[ship-winner-flag] PostHog PATCH failed:', phRes.status, text);
    // 403 → 403 (token scope problem). Anything else (404, 5xx) → 502.
    const mapped = phRes.status === 403 ? 403 : 502;
    return jsonError(mapped, 'posthog_patch_failed');
  }

  // Audit log row — best-effort (T-34-09-05). NEVER blocks the 200 response.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error: auditErr } = (await ((admin as any)
      .from('audit_logs')
      .insert({
        actor: callerUid,
        action: 'onboarding.ship_winner',
        target_kind: 'posthog_feature_flag',
        target_id: flag_id,
        after: { variant, rollout_percentage: 100 },
      }))) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (auditErr) {
      console.warn('[ship-winner-flag] audit log insert failed (non-blocking):', auditErr.message);
    }
  } catch (err) {
    console.warn('[ship-winner-flag] audit log insert threw (non-blocking):', (err as Error).message);
  }

  return jsonResponse(200, { ok: true, flag_id, variant });
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleShipWinner);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleShipWinner,
  setAdminForTest,
  resetAdminForTest,
  parseBody,
  vendorHealthCheck,
};
