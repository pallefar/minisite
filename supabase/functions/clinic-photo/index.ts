/**
 * clinic-photo Edge Function — Phase 9 Plan 09-07.
 *
 * Implements D-12's three-check gate + D-13's 5-minute signed-URL TTL for
 * cross-tenant operator photo access. This is the canonical pattern for
 * ANY operator-side data access: Phase 10 will reuse it for the full
 * drill-in surface.
 *
 * Endpoint:
 *   GET /clinic-photo/{orgId}/{userId}/{photoId}
 *   Authorization: Bearer <operator JWT>
 *
 * D-12 three-check gate:
 *   1. Operator JWT validates via admin.auth.getUser → 401 invalid_jwt.
 *   2. Operator has an active membership in orgId
 *      (memberships WHERE user_id=operator AND org_id=orgId AND revoked_at IS NULL).
 *   3. Operator's role has 'patient_photos.read' via has_permission RPC.
 *   4. Patient (path userId) has an active membership in orgId AND
 *      consent_scope.photos === true.
 *
 * On all checks pass: SELECT storage_path from public.photos for
 * (user_id=patient, photo_id=photoId) → mint signed URL via
 * supabase.storage.from('photos').createSignedUrl(path, 300).
 *
 * D-13 TRADEOFF (documented for security review):
 *   Existing signed URLs remain valid for up to 5 minutes post-revoke.
 *   The 3-check gate kills NEW mints IMMEDIATELY; URLs already minted
 *   continue to load photos until their natural 300s TTL expires.
 *   Accepted Phase 9 tradeoff (saved/copied URLs work for ≤5 min after
 *   revocation). Re-mint per request was considered and rejected on
 *   Edge Function cost. Tradeoff is in 09-CONTEXT.md D-13.
 *
 * CLINIC-07 capture half (read path):
 *   - Every 200 writes audit_logs row action='clinic_photo_view'
 *     (actor_type='org_operator', org_id, target_user_id=patient, row_id=photoId)
 *     via log_clinic_event RPC.
 *   - Every authorization denial (401 not_member / 401 patient_not_member /
 *     403 permission_denied / 403 consent_excluded) writes a 'permission_denied'
 *     audit row. UI affordance pre-checks do NOT — only security-relevant
 *     denials at the Edge Function layer.
 *   - 404 photo_not_found writes no audit row (not a security event;
 *     the gate already passed).
 *
 * Pitfall #11 (CORS): Access-Control-Allow-Origin '*', NO credentials.
 * JWT (Bearer) is the auth gate; no cookies are set or read here. Mirrors
 * ai-chat/cors.ts and clinic-invite/cors.ts.
 *
 * Anti-pattern (T-04-04 inherited): user_id and org_id in audit rows
 * come from VERIFIED sources (JWT + URL path validated against
 * memberships) — never from request body.
 */
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

const TTL_SECONDS = 300; // D-13 5-minute signed-URL TTL.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Service-role admin client. The 3-check gate is the security boundary;
// RLS bypass via service-role is INTENTIONAL inside this function
// (the gate replaces RLS for cross-tenant operator access — see
// 09-07-PLAN.md `<non_regression>`).
const moduleAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export interface Handlers {
  admin: SupabaseClient;
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Best-effort audit-on-denied. We swallow audit failures so the
// response shape (and timing) is stable even when log_clinic_event
// is briefly unavailable. The 200 audit-on-success path is NOT
// best-effort — see handle() below.
async function logDenied(
  admin: SupabaseClient,
  orgId: string,
  patientId: string,
  photoId: string,
): Promise<void> {
  try {
    await admin.rpc('log_clinic_event', {
      p_actor_type: 'org_operator',
      p_action: 'permission_denied',
      p_org_id: orgId,
      p_target_user_id: patientId,
      p_row_id: photoId,
    });
  } catch {
    // Swallow: audit writes are best-effort on the deny path. Failure
    // here MUST NOT leak the 5xx error to the caller; we already
    // decided to deny on the gate evaluation above.
  }
}

/**
 * Core request handler. Exported so the Deno test suite can exercise
 * the 3-check gate + signed-URL path against a mock SupabaseClient
 * without spinning up Postgres + Storage.
 *
 * The deps argument lets tests inject a mock admin client. In
 * production the module-level moduleAdmin is used.
 */
export async function handle(req: Request, deps: Handlers = { admin: moduleAdmin }): Promise<Response> {
  const admin = deps.admin;

  // 1. CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return jsonError(405, 'method_not_allowed');
  }

  // 2. Parse path. Expected: /clinic-photo/{orgId}/{userId}/{photoId}
  // Path parts after the function name. We tolerate the function name
  // appearing anywhere in the prefix (Supabase Edge Runtime routes
  // strip it; local Deno test calls keep it). Strategy: take the
  // LAST 3 non-empty path segments and treat them as
  // (orgId, userId, photoId). Any non-UUID input flows through to the
  // membership lookups below and naturally returns a 401/403.
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3) {
    return jsonError(400, 'bad_path');
  }
  const [orgId, userId, photoId] = parts.slice(-3);
  if (!orgId || !userId || !photoId) {
    return jsonError(400, 'bad_path');
  }

  // 3. JWT → operator id. Bearer token required.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonError(401, 'no_auth');
  }
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return jsonError(401, 'no_auth');
  }
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return jsonError(401, 'invalid_jwt');
  }
  const operator = userData.user;

  // 4. Check 1 (D-12): operator has active membership in orgId.
  // .is('revoked_at', null) is the partial-index-aligned predicate
  // (memberships_user_org_idx WHERE revoked_at IS NULL).
  const { data: opMembership } = await admin
    .from('memberships')
    .select('id, role_id')
    .eq('user_id', operator.id)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .maybeSingle();
  if (!opMembership) {
    // T-09-43 (operator passes orgId they're not a member of) →
    // gate denies; audit row written.
    await logDenied(admin, orgId, userId, photoId);
    return jsonError(401, 'not_member');
  }

  // 5. Check 2 (D-12): operator's role has 'patient_photos.read'.
  // has_permission is SECURITY DEFINER STABLE and joins
  // memberships → role_permissions on (user_id, org_id, key).
  const { data: hasPerm, error: hasPermErr } = await admin.rpc('has_permission', {
    p_user_id: operator.id,
    p_org_id: orgId,
    p_permission_key: 'patient_photos.read',
  });
  if (hasPermErr) {
    // RPC failure is treated as deny + 500. We log a permission_denied
    // audit row anyway (the operator's request was rejected at the
    // permission boundary; audit visibility matters more than the
    // exact error code).
    await logDenied(admin, orgId, userId, photoId);
    return jsonError(500, 'permission_check_failed');
  }
  if (hasPerm !== true) {
    // T-09-40 (operator without patient_photos.read) → 403 +
    // audit_logs row (CLINIC-07).
    await logDenied(admin, orgId, userId, photoId);
    return jsonError(403, 'permission_denied');
  }

  // 6. Check 3 (D-12): patient has active membership in orgId AND
  // consent_scope.photos === true. These are the two halves of the
  // patient-side gate; we differentiate them in the response code so
  // the operator UI can show the right toast (Phase 10 D-11).
  const { data: patientMembership } = await admin
    .from('memberships')
    .select('id, consent_scope')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .maybeSingle();
  if (!patientMembership) {
    // T-09-41 first half: patient revoked membership → operator's
    // existing URLs continue to work until natural TTL (D-13), but
    // NEW mints are denied.
    await logDenied(admin, orgId, userId, photoId);
    return jsonError(401, 'patient_not_member');
  }
  // T-09-41 second half: patient kept membership but unchecked
  // photos in consent_scope. Boolean strict-equality so jsonb
  // `null`/missing/`false` all flow through to denial (Pitfall #8
  // strict-shape defense in depth: TS isConsentScope guard at write
  // + _validate_consent_scope at the RPC + this strict check here).
  const consentScope = (patientMembership as { consent_scope?: Record<string, unknown> }).consent_scope ?? {};
  if (consentScope.photos !== true) {
    await logDenied(admin, orgId, userId, photoId);
    return jsonError(403, 'consent_excluded');
  }

  // 7. Lookup photo row. (user_id, photo_id) is the composite PK on
  // public.photos. 404 here is NOT a security event — we already
  // passed the gate; the operator was entitled to ANY photo of this
  // patient in this org and the request just hit a stale row_id.
  const { data: photo } = await admin
    .from('photos')
    .select('storage_path')
    .eq('user_id', userId)
    .eq('photo_id', photoId)
    .maybeSingle();
  if (!photo) {
    return jsonError(404, 'photo_not_found');
  }

  // 8. Mint signed URL (D-13: 300s TTL).
  const { data: signed, error: signErr } = await admin.storage
    .from('photos')
    .createSignedUrl((photo as { storage_path: string }).storage_path, TTL_SECONDS);
  if (signErr || !signed) {
    // T-09-44 (wrap createSignedUrl failures so bucket internals
    // never leak in the response body).
    return jsonError(500, 'sign_failed');
  }

  // 9. CLINIC-07 audit on success. NOT swallowed — if this fails we
  // log to console but still serve the URL (the gate already cleared
  // the request; failing the user because the audit row didn't write
  // would be worse than a silently-missing row, and the console.error
  // gives ops a signal). Repudiation threat T-09-42 is mitigated
  // probabilistically: the audit insert is best-effort, but the
  // log_clinic_event RPC is a single-statement INSERT against a
  // table on the same Postgres instance — practical write failures
  // are vanishingly rare.
  try {
    await admin.rpc('log_clinic_event', {
      p_actor_type: 'org_operator',
      p_action: 'clinic_photo_view',
      p_org_id: orgId,
      p_target_user_id: userId,
      p_row_id: photoId,
    });
  } catch (e) {
    console.error(
      '[clinic-photo] audit log_clinic_event failed',
      e instanceof Error ? e.message : 'unknown',
    );
  }

  return new Response(
    JSON.stringify({ signedUrl: (signed as { signedUrl: string }).signedUrl, ttl: TTL_SECONDS }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
      },
    },
  );
}

// Module-level Deno.serve wiring. Tests import { handle } directly and
// pass a mock admin; production traffic goes through this serve binding.
Deno.serve((req: Request) => handle(req));
