/**
 * `affiliate-attribute` Edge Function — Phase 19 Plan 19-02 (real handler).
 *
 * Public, verify_jwt=false endpoint at `GET /functions/v1/affiliate-attribute?code=...`.
 * Fronted by the Vercel rewrite `/r/:code` → this function so the response
 * `Set-Cookie: Domain=.leanshot.app` is honored by the visitor's browser
 * (verified by leanshot/scripts/wave-0-vercel-rewrite-smoke.sh — D-37 #1).
 *
 * Request flow:
 *   1. Validate `code` against /^[a-z0-9-]{4,80}$/ (V5 input validation).
 *      Invalid → 404, NO Set-Cookie, no DB hit.
 *   2. SELECT affiliate by referral_code. If !found OR status != 'approved'
 *      → 404, NO Set-Cookie (D-25 silently no-ops non-approved codes).
 *   3. User-Agent check: `LeanShot/` UA → exempt from Referer fraud filter (D-28).
 *   4. Referer fraud check: if !mobileApp AND allowed_referer_hosts non-empty
 *      AND Referer doesn't match → flagged=true, flag_reason='referer_mismatch'.
 *   5. Cold-start cap (D-27): if affiliate < 7d old AND clicks in last 24h ≥ 500
 *      → flagged=true, flag_reason='cold_start_cap'.
 *   6. INSERT affiliate_clicks row (always; flagged clicks are still recorded
 *      per D-27 — the policy is to suppress attribution, not the audit trail).
 *   7. If !flagged → setAffiliateCookie(headers, code) — single `_aff` HttpOnly
 *      cookie (W-6 — single-cookie invariant; no JS-readable mirror).
 *   8. Return 302 → `/r/{code}/landing` (Plan 19-08 seeds the landing page).
 *
 * Mitigations enforced here (see <threat_model> in 19-02-PLAN.md):
 *   T-19-02-T  Tampering (SQLi via code param) — regex BEFORE DB query.
 *   T-19-02-T  Tampering (click fraud) — Referer + cold-start cap.
 *   T-19-02-R  Repudiation (fake-Referer injection) — allowlist on aff row.
 *   T-19-02-I  Info disclosure (cookie via XSS) — HttpOnly; no JS-readable mirror.
 *   T-19-02-I  Info disclosure (CDN cache) — Cache-Control: private, no-store.
 *   T-19-02-E  EoP (trojan code attribution) — status='approved' filter.
 *
 * Project rules (LeanShot memory):
 *   - reference_supabase_edge_function_deploy.md — esm.sh + jsr URLs only;
 *     verify_jwt=false explicit in supabase/config.toml.
 *   - reference_deno_test_discovery.md — sibling test is index.test.ts.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { BASE_RESPONSE_HEADERS, buildCorsHeaders } from './cors.ts';
import { setAffiliateCookie } from './cookie.ts';
import { isRefererAllowed } from './referer.ts';

// ─── Module-level admin client (lazy + test-injectable) ──────────────────────
// Mirrors stripe-checkout's lazy-init + DI seam so the test suite can swap
// the admin client without re-evaluating module scope.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// deno-lint-ignore no-explicit-any
let _adminInstance: any | null = null;

// deno-lint-ignore no-explicit-any
function getAdmin(): any {
  if (_adminInstance === null) {
    _adminInstance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

/** Test seam — replace the admin client. Use `__resetAdminForTest()` to clear. */
export function __setAdminForTest(fake: unknown): void {
  _adminInstance = fake;
}

/** Test seam — clear the cached admin client so next call rebuilds it. */
export function __resetAdminForTest(): void {
  _adminInstance = null;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const REFERRAL_CODE_PATTERN = /^[a-z0-9-]{4,80}$/;
const COLD_START_DAYS = 7;
const COLD_START_CAP_CLICKS_PER_DAY = 500; // D-27
const MOBILE_APP_UA_PREFIX = 'LeanShot/'; // D-28 exemption
// Phase 19 Plan 19-07 — Z-score click-fraud (D-26).
// Affiliates with `days_observed < 7` skip the Z-score check (cold-start cap above handles them).
const ZSCORE_BASELINE_MIN_DAYS = 7;
const ZSCORE_THRESHOLD = 3; // 3σ above the affiliate's own daily-mean
// Phase 26 Plan 26-02 — Ratio Z-score (D-09 / D-10). MUST stay in sync with
// leanshot/src/lib/affiliate/anomaly-detection.ts (Deno runtime cannot import
// from the leanshot src tree; this is the documented duplication seam).
const RATIO_ANOMALY_Z_THRESHOLD = 3;
// Fingerprint validation (Plan 19-07): 8-128 chars of [A-Za-z0-9_-] only.
// Source: client header `X-LeanShot-Fingerprint` OR query param `?fp=...`.
const FINGERPRINT_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

type FlagReason = 'referer_mismatch' | 'cold_start_cap' | 'z_score_3sigma' | null;

interface AffiliateRow {
  id: string;
  status: string;
  allowed_referer_hosts: string[] | null;
  created_at: string;
}

// ─── Response helpers ────────────────────────────────────────────────────────
function notFound(headers: Headers): Response {
  return new Response('Not found', { status: 404, headers });
}

function internalError(headers: Headers): Response {
  return new Response('error', { status: 500, headers });
}

// ─── Request signal extraction ──────────────────────────────────────────────
function firstForwardedFor(xff: string | null): string | null {
  if (!xff) return null;
  const first = xff.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

// ─── Core attribution handler ────────────────────────────────────────────────
//
// Exported for the unit-test suite (`handle(req)`); Deno.serve below wraps it.
export async function handle(req: Request): Promise<Response> {
  const cors = buildCorsHeaders(req.headers.get('Origin'));
  const baseHeaders = new Headers(BASE_RESPONSE_HEADERS);
  cors.forEach((value, key) => baseHeaders.set(key, value));

  // CORS preflight — keep it cheap.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: baseHeaders });
  }

  // 1. Parse + validate code.
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  if (!REFERRAL_CODE_PATTERN.test(code)) {
    return notFound(baseHeaders);
  }

  try {
    const admin: SupabaseClient = getAdmin() as SupabaseClient;

    // 2. SELECT affiliate row + approval gate.
    const { data: affiliateData, error: affErr } = await admin
      .from('affiliates')
      .select('id, status, allowed_referer_hosts, created_at')
      .eq('referral_code', code)
      .maybeSingle();

    if (affErr) {
      console.error('[affiliate-attribute] affiliates lookup error', affErr.message);
      return internalError(baseHeaders);
    }
    const affiliate = affiliateData as AffiliateRow | null;
    if (!affiliate || affiliate.status !== 'approved') {
      // D-25 — silently no-op on non-approved codes (no Set-Cookie, 404).
      return notFound(baseHeaders);
    }

    // 3. Mobile-app exemption (D-28).
    const ua = req.headers.get('User-Agent') ?? '';
    const isMobileApp = ua.includes(MOBILE_APP_UA_PREFIX);

    // 4. Referer fraud check.
    const refererHeader = req.headers.get('Referer');
    const refererOk = isMobileApp
      || isRefererAllowed(refererHeader, affiliate.allowed_referer_hosts ?? []);

    // 5. Cold-start cap (D-27).
    let overCap = false;
    const ageMs = Date.now() - Date.parse(affiliate.created_at);
    const isColdStart = ageMs < COLD_START_DAYS * 24 * 60 * 60 * 1000;
    if (isColdStart) {
      const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count, error: capErr } = await admin
        .from('affiliate_clicks')
        .select('id', { count: 'exact', head: true })
        .eq('affiliate_id', affiliate.id)
        .gt('created_at', dayAgoIso);
      if (capErr) {
        console.error('[affiliate-attribute] cold-start cap query error', capErr.message);
        return internalError(baseHeaders);
      }
      overCap = (count ?? 0) >= COLD_START_CAP_CLICKS_PER_DAY;
    }

    // 5b. Z-score check (Plan 19-07; D-26). Skip during the cold-start window —
    // the matview will have `days_observed < 7` and the cold-start cap above
    // is the only gate active. After 7 days, today's click count is compared
    // against the affiliate's own 7-day rolling daily mean+stddev_samp.
    let zScoreFlagged = false;
    if (!isColdStart) {
      const { data: baselineData, error: baselineErr } = await admin
        .from('affiliate_click_baseline')
        .select('mean_clicks, stddev_clicks, days_observed')
        .eq('affiliate_id', affiliate.id)
        .maybeSingle();
      if (baselineErr) {
        console.error('[affiliate-attribute] baseline lookup error', baselineErr.message);
        return internalError(baseHeaders);
      }
      const baseline = baselineData as {
        mean_clicks: number | null;
        stddev_clicks: number | null;
        days_observed: number | null;
      } | null;
      if (
        baseline
        && (baseline.days_observed ?? 0) >= ZSCORE_BASELINE_MIN_DAYS
        && baseline.mean_clicks !== null
        && baseline.stddev_clicks !== null
        && baseline.stddev_clicks > 0
      ) {
        // Today's clicks so far for this affiliate.
        const todayStartIso = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();
        const { count: todayCount, error: todayErr } = await admin
          .from('affiliate_clicks')
          .select('id', { count: 'exact', head: true })
          .eq('affiliate_id', affiliate.id)
          .gt('created_at', todayStartIso);
        if (todayErr) {
          console.error('[affiliate-attribute] today-count query error', todayErr.message);
          return internalError(baseHeaders);
        }
        const today = todayCount ?? 0;
        const z = (today - baseline.mean_clicks) / baseline.stddev_clicks;
        if (z >= ZSCORE_THRESHOLD) {
          zScoreFlagged = true;
        }
      }
    }

    // 5c. Best-effort fingerprint capture (Plan 19-07). Source-of-truth order:
    //   header `X-LeanShot-Fingerprint` first, query param `?fp=...` fallback.
    //   Invalid / missing fingerprint stays null — server-side fraud trigger
    //   no-ops on null per fraud_trigger_conversion.sql.
    const fpHeader = req.headers.get('X-LeanShot-Fingerprint');
    const fpQuery = url.searchParams.get('fp');
    const fpCandidate = fpHeader ?? fpQuery ?? null;
    const fingerprint =
      fpCandidate !== null && FINGERPRINT_PATTERN.test(fpCandidate) ? fpCandidate : null;

    // 6. Flagged decision. Priority order (first match wins):
    //   referer_mismatch → cold_start_cap → z_score_3sigma.
    const flagged = !refererOk || overCap || zScoreFlagged;
    const flagReason: FlagReason = !refererOk
      ? 'referer_mismatch'
      : overCap
        ? 'cold_start_cap'
        : zScoreFlagged
          ? 'z_score_3sigma'
          : null;

    // 7. INSERT click row (always — even flagged clicks are recorded per D-27).
    const clickIp = firstForwardedFor(req.headers.get('x-forwarded-for'));
    const { error: clickErr } = await admin
      .from('affiliate_clicks')
      .insert({
        affiliate_id: affiliate.id,
        referral_code: code,
        ip: clickIp,
        user_agent: ua === '' ? null : ua,
        referer: refererHeader,
        fingerprint,
        flagged,
        flag_reason: flagReason,
      });
    if (clickErr) {
      // Don't echo Postgres detail (Pattern S3 — PII-safe logs).
      console.error('[affiliate-attribute] affiliate_clicks insert error', clickErr.message);
      return internalError(baseHeaders);
    }

    // 7b. Phase 26 Plan 26-02 — Ratio Z-score detector (AFFTIER-05, D-09/D-10).
    //
    // EXTENDS the v1.2 AFF-08 raw-count detector above (does NOT replace).
    // Both detectors run; either flag is sufficient. Per D-09 default-trust:
    //   - request still 302s with cookie set / suppressed via the raw-count
    //     decision above (`flagged` already determined).
    //   - this block ONLY writes a fraud_signal row when the ratio observation
    //     breaches 3σ; the actual conversion flag is applied in invoice-paid.ts
    //     when the conversion lands (next event in the funnel).
    //
    // No-op on errors / cold-start (RPC returns null). PII-safe payload:
    // affiliate_id + z_score + observation only (no user_id, no Referer body).
    try {
      const todayStartIso = new Date(
        new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
      ).toISOString();

      const { count: ratioClicksToday } = await admin
        .from('affiliate_clicks')
        .select('id', { count: 'exact', head: true })
        .eq('affiliate_id', affiliate.id)
        .gte('created_at', todayStartIso);

      const { count: ratioImpressionsToday } = await admin
        .from('affiliate_impressions')
        .select('id', { count: 'exact', head: true })
        .eq('affiliate_id', affiliate.id)
        .gte('created_at', todayStartIso);

      // Pitfall 4 — divide-by-zero guard. Use Math.max(...,1) so a click-only
      // day still produces a finite ratio (the matview-side `nullif` already
      // excludes such days from the baseline; here we just avoid NaN).
      const obs = (ratioClicksToday ?? 0) / Math.max(ratioImpressionsToday ?? 0, 1);

      const { data: zData } = await admin.rpc('compute_affiliate_ratio_z_score', {
        p_affiliate_id: affiliate.id,
        p_observation: obs,
      });
      const z = zData as number | null;

      // Inline duplicate of leanshot/src/lib/affiliate/anomaly-detection.ts —
      // Deno cannot import from the leanshot bundle tree. Keep these two
      // predicates in lockstep.
      const ratioFlagged =
        z !== null && Number.isFinite(z) && Math.abs(z) > RATIO_ANOMALY_Z_THRESHOLD;

      if (ratioFlagged) {
        await admin.from('affiliate_fraud_signals').insert({
          affiliate_id: affiliate.id,
          signal_type: 'anomaly_z_score',
          payload: {
            kind: 'anomaly_z_score',
            z_score: z,
            baseline_mean: null,
            baseline_stddev: null,
            observation: obs,
          },
        });
      }
    } catch (ratioErr) {
      // Default-trust: never block attribution on detector failure (D-09).
      // Log + continue.
      console.error(
        '[affiliate-attribute] ratio detector error',
        ratioErr instanceof Error ? ratioErr.message : 'unknown',
      );
    }

    // 8. Cookie + 302. Flagged clicks skip Set-Cookie (attribution suppressed).
    if (!flagged) {
      setAffiliateCookie(baseHeaders, code);
    }
    baseHeaders.set('Location', `/r/${code}/landing`);
    return new Response(null, { status: 302, headers: baseHeaders });
  } catch (err) {
    // Pattern S3 — never echo upstream errors.
    console.error(
      '[affiliate-attribute] handler error',
      err instanceof Error ? err.message : 'unknown',
    );
    return internalError(baseHeaders);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────
// Mirrors share/index.ts — Deno.serve evaluates at module load. In the test
// process, that means a one-shot listener on :8000 (harmless; the test runner
// exits before any external connection arrives). Test-time conditional
// guarding via Deno.env or globalThis flags was considered but rejected
// because share/index.ts is the established LeanShot convention.
Deno.serve(handle);
