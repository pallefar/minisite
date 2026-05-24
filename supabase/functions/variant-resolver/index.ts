/**
 * Phase 39 Plan 39-03 — `variant-resolver` Edge Function.
 *
 * POST /functions/v1/variant-resolver
 *
 * Server-side variant assignment for the 3 A/B surfaces (paywall | page | pharma).
 *
 * Auth:
 *   Authorization: Bearer <user-jwt>  (validated against GoTrue via admin.auth.getUser)
 *
 * Body:
 *   {
 *     surface: 'paywall' | 'page' | 'pharma',
 *     page_id?: string,
 *     block_id?: string
 *   }
 *
 * Response (200): { variant_id: string, config: Record<string, unknown> }
 * Error responses:
 *   401 { error: 'unauthenticated' }
 *   400 { error: 'invalid_body' }
 *   503 { error: 'vendor_unconfigured', service: 'posthog' }
 *
 * Resolution order (D-10: cohort wins over UTM):
 *   1. Existing user_experiments row for (uid, surface) → return its variant_id
 *   2. surface='pharma' AND (region∈{WA,CT} OR lt_pharma_blocked cookie
 *      OR profile.state_of_residence ∈ {WA,CT}) → return {variant_id:'control', config:{}}
 *   3. Call adminClient.rpc('resolve_cohort_for_user', { uid }) → cohort_id (or null)
 *   4. If cohort_id: SELECT variant_config WHERE cohort_id=$1 AND surface=$2 AND archived_at IS NULL
 *   5. Else: SELECT utm_variant_map WHERE utm_source = cookie lt_utm_source (or 'default')
 *   6. UPSERT user_experiments (user_id, surface, variant_id, cohort_id, utm_variant_id)
 *   7. captureServer({ userId: uid, event: '$feature_flag_called',
 *                      properties: { surface, variant_id, $feature_flag: `phase39_${surface}` } })
 *   8. Return variant_config.config
 *
 * RPC pattern (per memory [[feedback_rpc_auth_uid_vs_service_role_mismatch]]):
 *   resolve_cohort_for_user takes EXPLICIT uid parameter (no auth.uid()).
 *
 * Threat model (T-39-03-01, T-39-03-02, T-39-03-03):
 *   - Server-side captureServer fires regardless of adblocker (T-01)
 *   - admin.auth.getUser(jwt) gate prevents JWT forgery (T-02)
 *   - WA/CT 3-signal check (Vercel header + cookie + profile) prevents
 *     pharma variant serving to regulated states (T-03)
 *
 * Per [[reference_supabase_edge_function_deploy]]: deploy without --linked.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  captureServer as importedCaptureServer,
  shutdownPostHog,
} from '../_shared/posthog-server.ts';

// ============================================================================
// CORS + helpers
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
// Lazy admin singleton + test override (Pattern C)
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
// captureServer test seam (lightweight indirection — Pattern C analog for PostHog)
// ============================================================================

type CaptureFn = (args: {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
}) => void;

let _captureOverride: CaptureFn | null = null;
function setCaptureForTest(fn: CaptureFn | null): void {
  _captureOverride = fn;
}

function captureServer(args: Parameters<CaptureFn>[0]): void {
  if (_captureOverride) {
    _captureOverride(args);
    return;
  }
  importedCaptureServer(args);
}

// ============================================================================
// Vendor health check
// ============================================================================

function vendorHealthCheck(): Response | null {
  const key = Deno.env.get('POSTHOG_PROJECT_KEY');
  if (!key) {
    console.warn(
      '[variant-resolver] vendor_unconfigured: POSTHOG_PROJECT_KEY missing.',
    );
    return jsonResponse(503, { error: 'vendor_unconfigured', service: 'posthog' });
  }
  return null;
}

// ============================================================================
// Body validation
// ============================================================================

type Surface = 'paywall' | 'page' | 'pharma';
interface ResolveBody {
  surface: Surface;
  page_id?: string;
  block_id?: string;
}

function parseBody(raw: unknown): { ok: true; body: ResolveBody } | { ok: false; code: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'invalid_body' };
  const r = raw as Record<string, unknown>;
  if (r.surface !== 'paywall' && r.surface !== 'page' && r.surface !== 'pharma') {
    return { ok: false, code: 'invalid_body' };
  }
  const out: ResolveBody = { surface: r.surface };
  if (typeof r.page_id === 'string') out.page_id = r.page_id;
  if (typeof r.block_id === 'string') out.block_id = r.block_id;
  return { ok: true, body: out };
}

// ============================================================================
// Cookie + region helpers (D-07 pharma WA/CT short-circuit)
// ============================================================================

const PHARMA_BLOCKED_STATES = new Set(['WA', 'CT']);

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.get('Cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of raw.split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k.length > 0) out[k] = decodeURIComponent(v);
  }
  return out;
}

function regionFromHeader(req: Request): string | null {
  // Vercel injects x-vercel-ip-country-region; Supabase Fn behind Vercel edge
  // would receive this. Direct calls (curl, tests) omit it.
  const r = req.headers.get('x-vercel-ip-country-region')
    ?? req.headers.get('x-region-code')
    ?? null;
  return r ? r.toUpperCase() : null;
}

async function isPharmaBlocked(req: Request, uid: string): Promise<boolean> {
  // Signal 1: cookie `lt_pharma_blocked` set to any truthy value.
  const cookies = parseCookies(req);
  if (cookies.lt_pharma_blocked && cookies.lt_pharma_blocked !== '0') return true;

  // Signal 2: Vercel region header for WA / CT.
  const region = regionFromHeader(req);
  if (region && PHARMA_BLOCKED_STATES.has(region)) return true;

  // Signal 3: profile.state_of_residence ∈ {WA, CT}. Column may not exist on
  // main yet — wrap in try and treat any error / missing column as "not blocked".
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = (await ((admin as any)
      .from('profiles')
      .select('state_of_residence')
      .eq('id', uid)
      .maybeSingle())) as {
        data: { state_of_residence?: string | null } | null;
        error: { message?: string } | null;
      };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!error && data?.state_of_residence
        && PHARMA_BLOCKED_STATES.has(data.state_of_residence.toUpperCase())) {
      return true;
    }
  } catch (_e) {
    // Column missing or other DB error — fall through (not blocked).
  }

  return false;
}

// ============================================================================
// Core handler — wraps body in try/finally with shutdownPostHog (Pattern D)
// ============================================================================

async function handleVariantResolve(req: Request): Promise<Response> {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  try {
    // 0. Vendor health check (short-circuit BEFORE any DB/PostHog traffic).
    const health = vendorHealthCheck();
    if (health) return health;

    // 1. JWT auth — gate against GoTrue.
    const bearer = jwtFromReq(req);
    if (!bearer) return jsonError(401, 'unauthenticated');
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(bearer))) as {
      data: { user?: { id?: string } | null };
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
    const uid = userData.user.id;

    // 2. Body validation.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }
    const parsed = parseBody(raw);
    if (!parsed.ok) return jsonError(400, parsed.code);
    const { surface } = parsed.body;

    // === Step 1 of <interfaces>: existing user_experiments row wins ===
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: existing } = (await ((admin as any)
      .from('user_experiments')
      .select('variant_id')
      .eq('user_id', uid)
      .eq('surface', surface)
      .maybeSingle())) as {
        data: { variant_id?: string | null } | null;
        error: unknown;
      };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (existing?.variant_id) {
      const config = await fetchVariantConfig(existing.variant_id);
      captureServer({
        userId: uid,
        event: '$feature_flag_called',
        properties: {
          surface,
          variant_id: existing.variant_id,
          $feature_flag: `phase39_${surface}`,
        },
      });
      return jsonResponse(200, { variant_id: existing.variant_id, config });
    }

    // === Step 2 of <interfaces>: pharma WA/CT short-circuit (D-07) ===
    if (surface === 'pharma' && (await isPharmaBlocked(req, uid))) {
      captureServer({
        userId: uid,
        event: '$feature_flag_called',
        properties: {
          surface,
          variant_id: 'control',
          $feature_flag: `phase39_${surface}`,
        },
      });
      return jsonResponse(200, { variant_id: 'control', config: {} });
    }

    // === Step 3 of <interfaces>: cohort RPC with explicit uid (Pattern B) ===
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: cohortRpcData } = (await ((admin as any)
      .rpc('resolve_cohort_for_user', { uid }))) as { data: string | null; error: unknown };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const cohortId: string | null = typeof cohortRpcData === 'string' ? cohortRpcData : null;

    // === Step 4 of <interfaces>: cohort-driven variant lookup ===
    let variantId: string | null = null;
    let utmVariantId: string | null = null;

    if (cohortId) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data: cohortVariant } = (await ((admin as any)
        .from('variant_config')
        .select('id')
        .eq('cohort_id', cohortId)
        .eq('surface', surface)
        .is('archived_at', null)
        .limit(1)
        .maybeSingle())) as { data: { id?: string } | null; error: unknown };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (cohortVariant?.id) variantId = cohortVariant.id;
    }

    // === Step 5 of <interfaces>: UTM fallback (only if no cohort variant) ===
    if (!variantId) {
      const cookies = parseCookies(req);
      const utmSource = cookies.lt_utm_source || 'default';
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data: utmRow } = (await ((admin as any)
        .from('utm_variant_map')
        .select('id, variant_id')
        .eq('utm_source', utmSource)
        .maybeSingle())) as {
          data: { id?: string; variant_id?: string | null } | null;
          error: unknown;
        };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (utmRow?.id) {
        utmVariantId = utmRow.id;
        if (utmRow.variant_id) variantId = utmRow.variant_id;
      }
      // Last-resort fallback to 'default' utm_source if specific source had no row.
      if (!variantId && utmSource !== 'default') {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { data: defRow } = (await ((admin as any)
          .from('utm_variant_map')
          .select('id, variant_id')
          .eq('utm_source', 'default')
          .maybeSingle())) as {
            data: { id?: string; variant_id?: string | null } | null;
            error: unknown;
          };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (defRow?.id) {
          utmVariantId = defRow.id;
          if (defRow.variant_id) variantId = defRow.variant_id;
        }
      }
    }

    if (!variantId) {
      // No cohort, no UTM, no default — return control with empty config.
      captureServer({
        userId: uid,
        event: '$feature_flag_called',
        properties: {
          surface,
          variant_id: 'control',
          $feature_flag: `phase39_${surface}`,
        },
      });
      return jsonResponse(200, { variant_id: 'control', config: {} });
    }

    // === Step 6 of <interfaces>: UPSERT user_experiments ===
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (admin as any)
      .from('user_experiments')
      .upsert(
        {
          user_id: uid,
          surface,
          variant_id: variantId,
          cohort_id: cohortId,
          utm_variant_id: utmVariantId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,surface' },
      );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // === Step 7 of <interfaces>: captureServer ===
    captureServer({
      userId: uid,
      event: '$feature_flag_called',
      properties: {
        surface,
        variant_id: variantId,
        $feature_flag: `phase39_${surface}`,
      },
    });

    // === Step 8 of <interfaces>: return variant config ===
    const config = await fetchVariantConfig(variantId);
    return jsonResponse(200, { variant_id: variantId, config });
  } finally {
    // Pattern D: flush PostHog batch before isolate teardown.
    await shutdownPostHog();
  }
}

async function fetchVariantConfig(variantId: string): Promise<Record<string, unknown>> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await ((admin as any)
    .from('variant_config')
    .select('config')
    .eq('id', variantId)
    .maybeSingle())) as { data: { config?: Record<string, unknown> } | null; error: unknown };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return data?.config ?? {};
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve && import.meta.main) {
  denoGlobal.serve(handleVariantResolve);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleVariantResolve,
  setAdminForTest,
  resetAdminForTest,
  setCaptureForTest,
  parseBody,
  vendorHealthCheck,
  parseCookies,
};
