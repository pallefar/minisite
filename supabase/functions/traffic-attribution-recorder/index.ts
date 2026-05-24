/**
 * `traffic-attribution-recorder` Edge Function — Phase 51 Plan 51-02.
 *
 * POST /functions/v1/traffic-attribution-recorder
 *
 * Auth: UNAUTHENTICATED + origin-allowlisted.
 *
 *   Per Plan 51-02 Task 1 security correction: since the SPA (browser bundle)
 *   would be the only HMAC-secret holder under the planned HMAC-bearer auth,
 *   keeping the secret would compromise it. Replaced with an origin allowlist
 *   (3 hosts) — same shape as PostHog's own /e/ endpoint. Writes are append-
 *   only and idempotent (ON CONFLICT preserves first-touch); worst-case spam
 *   inflates last_touch row counts and is defended at the matview / upsert
 *   layer.
 *
 *   `verify_jwt = false` MUST be set in supabase/config.toml or the gateway
 *   401s every browser-origin POST before the function runs (memory note
 *   `reference_supabase_config_toml_verify_jwt`).
 *
 * Body (JSON):
 *   {
 *     anonId: string,            // lt_anon_id cookie value (server-readable)
 *     utm?: { source?, medium?, campaign?, term?, content? },
 *     referrer?: string | null,
 *     landingPath?: string,
 *     pageVariantId?: string | null,
 *     audience?: 'consumer' | 'clinic-org' | 'affiliate',
 *     orgId?: string | null,
 *   }
 *
 * Defenses:
 *   - Origin allowlist (T-51-09): app.leanshot.app, leanshot.app, www.leanshot.app.
 *   - utm / referrer / landingPath length clamps (T-51-11).
 *   - PHI path redaction (T-51-10): /patient/*, /clinic/<x>/patient/*, /dose-log/*
 *     → '/[redacted]' before the helper sees the value.
 *
 * Responses:
 *   - 200 { ok: true, channel_group } on success.
 *   - 200 { ok: false, error } on downstream RPC failure (never throw — the
 *     SPA fires this fire-and-forget; failures must not abort first paint).
 *   - 400 { error: 'anon_id_required' } when body.anonId is missing.
 *   - 403 { error: 'origin_denied' } when Origin header is not in the allowlist.
 *   - 405 { error: 'method_not_allowed' } for non-POST.
 *
 * Threat refs: T-51-09, T-51-10, T-51-11, T-51-14 (Plan 51-02 register).
 *
 * Deploy: deferred to Plan 51-10 closeout (aggregated `supabase functions deploy`).
 */

import { corsHeaders, jsonError, jsonResponse } from '../_shared/lifecycle-utils.ts';
import { recordTouch as recordTouchImpl, type RecordTouchArgs, type RecordTouchResult } from '../_shared/traffic-attribution.ts';
import { shutdownPostHog } from '../_shared/posthog-server.ts';

// ============================================================================
// Origin allowlist + body shape constants
// ============================================================================

const ALLOWED_ORIGINS = new Set<string>([
  'https://app.leanshot.app',
  'https://leanshot.app',
  'https://www.leanshot.app',
]);

/** PHI path patterns (T-51-10). `^/clinic/<x>/patient/...` covers per-clinic patient subpaths. */
const PHI_PATH_REGEX = /^\/(patient|dose-log)(\/|$)|^\/clinic\/[^/]+\/patient\//i;

/** Length clamps per RecordTouchArgs invariants. */
const UTM_MAX_BYTES = 2048;
const REFERRER_MAX_BYTES = 4096;
const LANDING_PATH_MAX_BYTES = 2048;
const ANON_ID_MAX_BYTES = 64;
const PAGE_VARIANT_MAX_BYTES = 64;
const VALID_AUDIENCES = new Set(['consumer', 'clinic-org', 'affiliate']);

// ============================================================================
// Helpers (pure, exported for test consumption)
// ============================================================================

export function clamp(s: string | null | undefined, n: number): string | null {
  if (s == null) return null;
  return s.length > n ? s.slice(0, n) : s;
}

export function redactPath(p: string): string {
  return PHI_PATH_REGEX.test(p) ? '/[redacted]' : p;
}

export function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}

// ============================================================================
// Test seam — inject a mock recordTouch implementation
// ============================================================================

type RecordTouchFn = (args: RecordTouchArgs) => Promise<RecordTouchResult>;

let _recordTouchOverride: RecordTouchFn | null = null;

/** Test seam — override the recordTouch implementation for unit tests. */
export function setRecordTouchForTest(fn: RecordTouchFn | null): void {
  _recordTouchOverride = fn;
}

function recordTouch(args: RecordTouchArgs): Promise<RecordTouchResult> {
  return (_recordTouchOverride ?? recordTouchImpl)(args);
}

// ============================================================================
// Core handler (exported for tests)
// ============================================================================

export async function handleTrafficAttributionRecorder(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // Origin gate — same-origin (SPA fires from app.leanshot.app).
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return jsonError(403, 'origin_denied');
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonError(400, 'invalid_body');
    }

    const anonId = clamp(typeof body.anonId === 'string' ? body.anonId : null, ANON_ID_MAX_BYTES);
    if (!anonId) return jsonError(400, 'anon_id_required');

    const rawUtm = (body.utm ?? {}) as Record<string, unknown>;
    const utm = {
      source: clamp(typeof rawUtm.source === 'string' ? rawUtm.source : null, UTM_MAX_BYTES) ?? undefined,
      medium: clamp(typeof rawUtm.medium === 'string' ? rawUtm.medium : null, UTM_MAX_BYTES) ?? undefined,
      campaign:
        clamp(typeof rawUtm.campaign === 'string' ? rawUtm.campaign : null, UTM_MAX_BYTES) ?? undefined,
      term: clamp(typeof rawUtm.term === 'string' ? rawUtm.term : null, UTM_MAX_BYTES) ?? undefined,
      content:
        clamp(typeof rawUtm.content === 'string' ? rawUtm.content : null, UTM_MAX_BYTES) ?? undefined,
    };

    const referrer = clamp(typeof body.referrer === 'string' ? body.referrer : null, REFERRER_MAX_BYTES);
    const landingPathRaw =
      clamp(typeof body.landingPath === 'string' ? body.landingPath : null, LANDING_PATH_MAX_BYTES) ?? '/';
    const landingPath = redactPath(landingPathRaw);

    const audience =
      typeof body.audience === 'string' && VALID_AUDIENCES.has(body.audience)
        ? (body.audience as 'consumer' | 'clinic-org' | 'affiliate')
        : 'consumer';

    const pageVariantId = clamp(
      typeof body.pageVariantId === 'string' ? body.pageVariantId : null,
      PAGE_VARIANT_MAX_BYTES,
    );

    const orgId = typeof body.orgId === 'string' ? body.orgId : null;

    const result = await recordTouch({
      anonId,
      orgId,
      utm,
      referrer,
      landingPath,
      pageVariantId,
      audience,
      now: new Date(),
    });

    if (!result.ok) {
      console.warn('[traffic-recorder] recordTouch failed:', result.error);
      // 200 because the SPA fires this fire-and-forget; surfacing 5xx would
      // generate noise without helping (the middleware already returned).
      return jsonResponse(200, { ok: false, error: result.error });
    }

    return jsonResponse(200, { ok: true, channel_group: result.channelGroup });
  } catch (err) {
    console.warn(
      '[traffic-recorder] handler exception:',
      err instanceof Error ? err.message : String(err),
    );
    return jsonResponse(200, { ok: false, error: 'exception' });
  } finally {
    // PITFALL 1: flush PostHog batch before isolate teardown.
    try {
      await shutdownPostHog();
    } catch (e) {
      console.error('[traffic-recorder] shutdown failed', e);
    }
  }
}

// ============================================================================
// Deno.serve entrypoint
//
// Guarded per project memory `reference_deno_test_top_level_serve_trap`:
// `denoGlobal?.serve` only — `import.meta.main` is not reliable across the
// project's existing Edge Fns (see merge-anon-session/index.ts which uses
// the same `denoGlobal?.serve` guard without `import.meta.main`).
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleTrafficAttributionRecorder);
}
