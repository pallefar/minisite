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

/**
 * Phase 51 REVIEW CR-01 — redact PHI paths from same-origin referrers.
 *
 * user_traffic_attribution.first_touch_referrer / last_touch_referrer are
 * declared PHI-free by the table's RESEARCH §Security V6 contract; only
 * `landingPath` was redacted previously. A same-origin referrer like
 * `https://app.leanshot.app/patient/<phi>/notes` would otherwise persist
 * cleartext PHI in this non-PHI table AND get mirrored to PostHog as a
 * `last_touch_referrer` person property.
 *
 * Strategy:
 *   - Same-origin referrers (host in ALLOWED_ORIGINS): pathname is run
 *     through `redactPath`; the search string is dropped (query params can
 *     also leak PHI in our domain).
 *   - Cross-origin referrers: passed through untouched. We never edit a
 *     third-party URL — the only thing we strip is our own PHI.
 *   - Unparseable referrers (`new URL(...)` throws): passed through; the
 *     downstream byte clamp still caps length.
 */
export function redactReferrer(ref: string | null): string | null {
  if (ref == null) return null;
  try {
    const u = new URL(ref);
    if (ALLOWED_ORIGINS.has(u.origin)) {
      u.pathname = redactPath(u.pathname);
      u.search = '';
      return u.toString();
    }
    return ref;
  } catch {
    return ref;
  }
}

export function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}

/**
 * Phase 51 Plan 51-02 Task 4 follow-up: the `lt_anon_id` cookie minted by
 * `leanshot/middleware.ts` is HttpOnly, so the SPA fire-touch helper cannot
 * read it from `document.cookie`. In production the SPA omits `anonId` from
 * the POST body; the browser ALSO attaches the Cookie header automatically
 * via `credentials: 'include'`. This parser pulls lt_anon_id from that
 * server-side-readable header as the fallback.
 *
 * Without this fallback TRAFFIC-01 cannot work end-to-end on HttpOnly
 * cookies (Rule 2 auto-fix during 51-02 Task 4 — missing critical
 * functionality for the documented production behavior).
 */
export function readLtAnonIdFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)lt_anon_id=([^;]+)/);
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

/** Same fallback for the transient lt_clinic_slug_seen cookie (D-12). */
export function readClinicSlugFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)lt_clinic_slug_seen=([^;]+)/);
  return m ? decodeURIComponent(m[1] ?? '') : null;
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

    // Resolve anonId: prefer body.anonId (test/non-HttpOnly path); fall back
    // to the Cookie header (production HttpOnly path; browser auto-attaches
    // via the SPA's credentials:'include' fetch).
    const bodyAnon = typeof body.anonId === 'string' ? body.anonId : null;
    const cookieAnon = readLtAnonIdFromCookieHeader(req.headers.get('cookie'));
    const anonId = clamp(bodyAnon ?? cookieAnon, ANON_ID_MAX_BYTES);
    if (!anonId) return jsonError(400, 'anon_id_required');

    // Resolve orgId: prefer body.orgId; else read clinic-slug cookie. The
    // slug→org_id lookup itself happens in a future plan (51-10 wires
    // resolve_clinic_slug_rpc); for now we surface the slug-presence signal
    // by leaving orgId null when only the slug cookie is present (the
    // helper accepts null and the SQL UPSERT preserves coalesce semantics).
    const _slugFromCookie = readClinicSlugFromCookieHeader(req.headers.get('cookie'));
    void _slugFromCookie; // referenced for D-12 traceability; resolved in 51-10

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

    // CR-01: redact same-origin PHI paths from referrer BEFORE clamping. The
    // clamp still applies (defense in depth against giant URLs).
    const referrer = clamp(
      redactReferrer(typeof body.referrer === 'string' ? body.referrer : null),
      REFERRER_MAX_BYTES,
    );
    const landingPathRaw =
      clamp(typeof body.landingPath === 'string' ? body.landingPath : null, LANDING_PATH_MAX_BYTES) ?? '/';
    const landingPath = redactPath(landingPathRaw);

    // REVIEW WR-12: previously coerced unknown audience values to 'consumer'
    // silently — combined with WR-03's body.orgId path, an attacker could
    // probe controlled audience+org_id pairs with no feedback. Now we
    // explicitly reject malformed audience values (400) and only coerce when
    // the field is absent. Operators see the rejection in Fn logs.
    if (typeof body.audience === 'string' && !VALID_AUDIENCES.has(body.audience)) {
      console.warn('[traffic-recorder] rejected invalid audience:', body.audience);
      return jsonError(400, 'invalid_audience');
    }
    const audience: 'consumer' | 'clinic-org' | 'affiliate' =
      typeof body.audience === 'string'
        ? (body.audience as 'consumer' | 'clinic-org' | 'affiliate')
        : 'consumer';

    const pageVariantId = clamp(
      typeof body.pageVariantId === 'string' ? body.pageVariantId : null,
      PAGE_VARIANT_MAX_BYTES,
    );

    // REVIEW WR-03: body.orgId is UNTRUSTED INPUT. Previously it was accepted
    // verbatim and forwarded to upsert_traffic_attribution.p_org_id, letting
    // any browser stamp their attribution row with an arbitrary valid org UUID
    // (cross-org pollution in the "Traffic — {orgName}" matview slice; defeats
    // the planned signed-cookie flow's authority over org_id). The slug→
    // org_id resolution lands in a future plan (51-10 wires
    // resolve_clinic_slug_rpc); until then orgId is ALWAYS null on the
    // recorder write path. Server-resolved slug cookie is observed elsewhere.
    const orgId: string | null = null;

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
