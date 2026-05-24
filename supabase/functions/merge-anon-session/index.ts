/**
 * Phase 34 Plan 34-05 (ONBOARD-01/11) — `merge-anon-session` Edge Function.
 *
 * POST /functions/v1/merge-anon-session
 *
 * Auth:
 *   Authorization: Bearer <user-jwt>   (post-signup browser session)
 *
 * Body:
 *   {
 *     cookie_ids: string[],         // 1..8 _ls_anon UUIDs the browser has seen
 *     anon_distinct_id?: string,    // posthog-js distinct_id captured pre-auth
 *   }
 *
 * Responses:
 *   - 200 { merged: true, draft_entries: unknown[] }   — winner row consumed; browser carries
 *                                                        the returned draft_entries into the
 *                                                        dashboard's draft-replay flow.
 *   - 200 { merged: false }                            — no eligible row (already-merged, orphan,
 *                                                        or never-existed); idempotent re-run path.
 *   - 400 { error: 'invalid_body' }                    — missing/malformed cookie_ids
 *   - 401 { error: 'unauthenticated' }                 — no Bearer / invalid JWT
 *   - 500 { error: 'rpc_error' | 'db_error' }          — Postgres / network unrecoverable
 *
 * Architecture invariants:
 *   1. SECDEF RPC `merge_anon_session(uuid, text[])` does the race-safe pick
 *      under pg_advisory_xact_lock; this Fn is a thin propagation layer for
 *      D-08's four buckets (preferences / drafts / PostHog alias / affiliate).
 *   2. profiles UPDATE + affiliate_clicks UPDATE are best-effort (non-fatal
 *      warn-log) — failing them must not roll back the merge: the row is
 *      already tagged merged_user_id in the same txn as the RPC pick. If we
 *      threw on profile-update failure, the next browser retry would observe
 *      `winner_id: null` from the now-merged row and the user would never
 *      get their preferences propagated.
 *   3. PostHog alias is server-side via _shared/posthog-server.ts ::
 *      aliasServerSide; ONLY runs when the browser includes `anon_distinct_id`
 *      in the body — we never alias to the cookie_id surrogate (D-08c
 *      Pattern A — see RESEARCH Pattern 4).
 *   4. try/finally + shutdownPostHog per PITFALL 1; the isolate is torn down
 *      after Response is returned, dropping in-flight PostHog batch sends
 *      unless we await shutdown.
 *   5. zod-free body validation — keep cold-start lean.
 *
 * Threat model (34-05-PLAN.md):
 *   - T-34-05-01 spoofing: SECDEF excludes already-merged rows
 *   - T-34-05-02 tampering: cookie_ids capped at 8 (T-34-05-06 DoS too)
 *   - T-34-05-03 disclosure: auth.getUser validates JWT before RPC call
 *   - T-34-05-04 EoP replay: second call returns winner_id:null
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { aliasServerSide, shutdownPostHog } from '../_shared/posthog-server.ts';

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
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

/**
 * Phase 51 Plan 51-02 — parse a single cookie value from the request's
 * `Cookie` header. Returns null when the header is absent or the named
 * cookie is missing. Decodes percent-encoded values.
 */
function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

// ============================================================================
// Lazy admin singleton + test seams
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

// deno-lint-ignore no-explicit-any
function admin(): any {
  return _adminOverride ?? getAdmin();
}

// ============================================================================
// Alias / shutdown test seams
// ============================================================================

type AliasFn = (supabaseUid: string, anonDistinctId: string) => void;
type ShutdownFn = () => void | Promise<void>;

let _aliasOverride: AliasFn | null = null;
let _shutdownOverride: ShutdownFn | null = null;

function setAliasSpyForTest(fn: AliasFn): void {
  _aliasOverride = fn;
}
function setShutdownSpyForTest(fn: ShutdownFn): void {
  _shutdownOverride = fn;
}
function resetSpiesForTest(): void {
  _aliasOverride = null;
  _shutdownOverride = null;
}

function doAlias(supabaseUid: string, anonDistinctId: string): void {
  if (_aliasOverride) {
    _aliasOverride(supabaseUid, anonDistinctId);
    return;
  }
  aliasServerSide(supabaseUid, anonDistinctId);
}

async function doShutdown(): Promise<void> {
  if (_shutdownOverride) {
    await _shutdownOverride();
    return;
  }
  await shutdownPostHog();
}

// ============================================================================
// Body validation
// ============================================================================

const COOKIE_MIN_LEN = 8;
const COOKIE_MAX_LEN = 64;
const COOKIE_IDS_MAX = 8;
const ANON_DISTINCT_MIN = 8;
const ANON_DISTINCT_MAX = 128;

interface ParsedBody {
  cookie_ids: string[];
  anon_distinct_id?: string;
}

function parseBody(raw: unknown): { ok: true; body: ParsedBody } | { ok: false } {
  if (typeof raw !== 'object' || raw === null) return { ok: false };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.cookie_ids)) return { ok: false };
  if (r.cookie_ids.length < 1 || r.cookie_ids.length > COOKIE_IDS_MAX) return { ok: false };
  const cookieIds: string[] = [];
  for (const v of r.cookie_ids) {
    if (typeof v !== 'string') return { ok: false };
    if (v.length < COOKIE_MIN_LEN || v.length > COOKIE_MAX_LEN) return { ok: false };
    cookieIds.push(v);
  }
  let anonDistinctId: string | undefined;
  if (r.anon_distinct_id !== undefined) {
    if (typeof r.anon_distinct_id !== 'string') return { ok: false };
    if (
      r.anon_distinct_id.length < ANON_DISTINCT_MIN ||
      r.anon_distinct_id.length > ANON_DISTINCT_MAX
    ) {
      return { ok: false };
    }
    anonDistinctId = r.anon_distinct_id;
  }
  return { ok: true, body: { cookie_ids: cookieIds, anon_distinct_id: anonDistinctId } };
}

// ============================================================================
// Core handler
// ============================================================================

interface MergeRpcResult {
  winner_id: string | null;
  cookie_id?: string;
  preferences?: Record<string, unknown>;
  draft_entries?: unknown[];
  aff_code?: string | null;
}

async function handleMergeAnonSession(req: Request): Promise<Response> {
  // CORS preflight — never wraps shutdown because no capture happens.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return jsonError(405, 'method_not_allowed');
    }

    // 1. Auth — verify Bearer JWT.
    const bearer = jwtFromReq(req);
    if (!bearer) return jsonError(401, 'unauthenticated');

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: userRes, error: authErr } = (await (admin().auth as any).getUser(bearer)) as {
      data: { user?: { id?: string } | null } | null;
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (authErr || !userRes?.user?.id) return jsonError(401, 'unauthenticated');
    const userId = userRes.user.id;

    // 2. Validate body.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }
    const parsed = parseBody(raw);
    if (!parsed.ok) return jsonError(400, 'invalid_body');
    const { cookie_ids, anon_distinct_id } = parsed.body;

    // 3. SECDEF RPC — pick winner under advisory lock (race-safe).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: rpcData, error: rpcErr } = (await (admin() as any).rpc('merge_anon_session', {
      p_user_id: userId,
      p_cookie_ids: cookie_ids,
    })) as {
      data: MergeRpcResult | null;
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (rpcErr) return jsonError(500, 'rpc_error');

    const result = rpcData ?? { winner_id: null };
    if (!result.winner_id) {
      return jsonResponse(200, { merged: false });
    }

    // 4. D-08a — propagate preferences into profiles. Best-effort: failure logs
    //    but does NOT roll back the merge (the row is already tagged merged).
    const prefs = (result.preferences ?? {}) as Record<string, unknown>;
    const profileUpdates: Record<string, unknown> = {};
    if (typeof prefs.locale === 'string') profileUpdates.locale = prefs.locale;
    if (typeof prefs.units === 'string') profileUpdates.units = prefs.units;
    if (typeof prefs.timezone === 'string') profileUpdates.timezone = prefs.timezone;
    if (typeof prefs.primary_goal === 'string') profileUpdates.primary_goal = prefs.primary_goal;
    if (Object.keys(profileUpdates).length > 0) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { error: profErr } = (await admin()
        .from('profiles')
        .update(profileUpdates)
        .eq('id', userId)) as { error: { message?: string } | null };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (profErr) {
        console.warn(
          '[merge-anon-session] profile update failed (non-fatal):',
          profErr.message ?? 'unknown',
        );
      }
    }

    // 5. D-08d — affiliate propagation. Anonymous_sessions.aff_code maps to
    //    affiliate_clicks.referral_code (Phase 19 schema — see migration
    //    20270101000002_affiliate_clicks_conversions_payouts.sql). Update only
    //    rows where user_id IS NULL so we never overwrite an existing
    //    attribution (idempotent).
    if (result.aff_code) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { error: affErr } = (await admin()
        .from('affiliate_clicks')
        .update({ user_id: userId })
        .eq('referral_code', result.aff_code)
        .is('user_id', null)) as { error: { message?: string } | null };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (affErr) {
        console.warn(
          '[merge-anon-session] affiliate propagation failed (non-fatal):',
          affErr.message ?? 'unknown',
        );
      }
    }

    // 6. D-08c — PostHog server-side alias. Only fires when the browser
    //    supplied its posthog distinct_id (Pattern A). Idempotent server-side.
    if (anon_distinct_id) {
      doAlias(userId, anon_distinct_id);
    }

    // 7. Phase 51 Plan 51-02 (TRAFFIC-03) — Stitch the pre-signup traffic
    //    attribution row keyed by `lt_anon_id` cookie to this user.
    //
    //    Cookie-only (NOT body): preserves backwards compatibility for
    //    existing browser callers that don't know about lt_anon_id, per
    //    Plan 51-02 PATTERNS invariant. Cookie was minted server-side by
    //    leanshot/middleware.ts before the SPA bundle loaded, so the value
    //    arrives in the inbound `Cookie` header on this authenticated request.
    //
    //    Best-effort: failures log + continue (the merge has already
    //    succeeded; an unstitched traffic row is a degraded analytics
    //    signal, not a user-data integrity issue). Idempotent at the
    //    RPC layer — claim_traffic_attribution only sets user_id when
    //    previously null, so re-calls on already-stitched rows are no-ops.
    const ltAnonId = parseCookie(req.headers.get('cookie'), 'lt_anon_id');
    if (ltAnonId) {
      // REVIEW WR-11: claim FIRST, alias only on success. Previously the
      // PostHog alias fired BEFORE the SQL claim, so a browser could pre-set
      // an arbitrary lt_anon_id cookie value and force a PostHog person
      // alias to a distinct_id of its choosing. claim_traffic_attribution
      // only sets user_id when previously null, so the SQL side is naturally
      // idempotent + the row's existence is server-controlled. Gating the
      // alias on claim success prevents the alias-pollution attack.
      let claimSucceeded = false;
      try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { error: claimErr } = (await (admin() as any).rpc('claim_traffic_attribution', {
          p_anon_id: ltAnonId,
          p_user_id: userId,
        })) as { error: { message?: string } | null };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (claimErr) {
          console.warn(
            '[merge-anon-session] claim_traffic_attribution failed (non-fatal):',
            claimErr.message ?? 'unknown',
          );
        } else {
          claimSucceeded = true;
        }
      } catch (err) {
        console.warn(
          '[merge-anon-session] claim_traffic_attribution threw (non-fatal):',
          err instanceof Error ? err.message : String(err),
        );
      }

      // PostHog alias only after the SQL claim has successfully bound
      // lt_anon_id → userId. The two identity systems (anon_distinct_id +
      // lt_anon_id) remain independent at the PostHog layer; both alias to
      // the same user_id when present.
      if (claimSucceeded) {
        try {
          doAlias(userId, ltAnonId);
        } catch (err) {
          console.warn(
            '[merge-anon-session] lt_anon_id alias failed (non-fatal):',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    return jsonResponse(200, {
      merged: true,
      draft_entries: Array.isArray(result.draft_entries) ? result.draft_entries : [],
    });
  } finally {
    // PITFALL 1: always flush PostHog batch before isolate teardown, even on
    // auth/validation/RPC error paths.
    try {
      await doShutdown();
    } catch (e) {
      console.error('[merge-anon-session] shutdown failed', e);
    }
  }
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleMergeAnonSession);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleMergeAnonSession,
  setAdminForTest,
  resetAdminForTest,
  setAliasSpyForTest,
  setShutdownSpyForTest,
  resetSpiesForTest,
  parseBody,
};
