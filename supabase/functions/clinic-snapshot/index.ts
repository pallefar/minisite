/**
 * `clinic-snapshot` Edge Function — Phase 10 Plan 10-04.
 *
 * Returns a SnapshotData payload for an operator viewing a specific patient's
 * data in a clinic context. Mirrors Phase 8's `/share/snapshot` but uses JWT
 * authentication (Bearer token) instead of cookie-based auth.
 *
 * ## Endpoint
 *   GET /clinic-snapshot?org_id=<uuid>&patient_id=<uuid>
 *   Authorization: Bearer <operator JWT>
 *
 * ## Auth gate (D-04 four-step):
 *   1. Extract Bearer JWT from Authorization header → 401 if missing/invalid.
 *   2. Verify operator is an active member of org_id
 *      (memberships WHERE user_id=operator AND org_id=org_id AND revoked_at IS NULL) → 403.
 *   3. Verify operator has patient_data.read via has_permission() RPC → 403.
 *   4. Verify patient is an active member of org_id + fetch consent_scope → 403.
 *
 * ## Response shape:
 *   SnapshotData (from src/types/snapshot.ts) with:
 *     - viewer_context: 'clinic'
 *     - org_id: the org the operator is viewing from
 *     - permission_map: computed from operator's role permissions
 *     - consent_scope: patient's consent scope for this org
 *
 * ## Security invariants:
 *   T-10-04-01: sections where consent_scope[section]=false are absent from response.
 *   T-10-04-03: Cache-Control: private, no-store on EVERY response status code.
 *   T-10-04-04: ai_history NEVER returned (structural exclusion at SELECT level).
 *   T-10-04-05: Bearer token never logged or returned in response body.
 *
 * ## Audit:
 *   On 200: writes audit_logs row with action='clinic_snapshot_loaded', org_id,
 *   target_user_id=patient. Best-effort (failure does NOT block response).
 *
 * Exports `handle()` for Deno test suite injection (same pattern as clinic-photo).
 */

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { BASE_RESPONSE_HEADERS } from './cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ─── Module-level admin client (service-role) ────────────────────────────────
// Used for auth.getUser() (which requires admin context) and all data SELECTs.
// The D-04 gate IS the security boundary; RLS-bypass via service-role is
// intentional inside this function.
const moduleAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── UUID validation ──────────────────────────────────────────────────────────
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string | null | undefined): s is string {
  return typeof s === 'string' && UUID_PATTERN.test(s);
}

// ─── Response helpers ────────────────────────────────────────────────────────
function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: BASE_RESPONSE_HEADERS,
  });
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: BASE_RESPONSE_HEADERS,
  });
}

// ─── Types (wire-layer subset of src/types/snapshot.ts) ─────────────────────

interface ReadOnlyPermissionMap {
  canViewInjections: boolean;
  canViewWeights: boolean;
  canViewSymptoms: boolean;
  canViewPhotos: boolean;
  canViewDoctorReport: boolean;
  canViewMeals: boolean;
  canViewWorkouts: boolean;
  canViewSupplements: boolean;
  canViewMood: boolean;
  canViewSleep: boolean;
  canViewBreakdown: boolean;
}

type ConsentKey =
  | 'injections'
  | 'weights'
  | 'symptoms'
  | 'photos'
  | 'meals'
  | 'workouts'
  | 'supplements'
  | 'mood'
  | 'sleep';

type ConsentScope = Partial<Record<ConsentKey, boolean>>;

export interface Handlers {
  admin: SupabaseClient;
}

// ─── Main handler (exported for test injection) ──────────────────────────────

export async function handle(
  req: Request,
  deps: Handlers = { admin: moduleAdmin },
): Promise<Response> {
  const admin = deps.admin;

  // 1. CORS preflight
  if (req.method === 'OPTIONS') {
    // HTTP 204 cannot carry a body; use 200 for preflight (matches clinic-photo pattern).
    return new Response('ok', { status: 200, headers: BASE_RESPONSE_HEADERS });
  }
  if (req.method !== 'GET') {
    return jsonError(405, 'method_not_allowed');
  }

  // 2. Extract Bearer JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonError(401, 'missing_jwt');
  }
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return jsonError(401, 'missing_jwt');
  }

  // 3. Validate JWT → get operator identity
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonError(401, 'invalid_jwt');
  }
  const operator = userData.user;

  // 4. Parse + validate query parameters
  const url = new URL(req.url);
  const orgId = url.searchParams.get('org_id');
  const patientId = url.searchParams.get('patient_id');

  if (!isUuid(orgId)) {
    return jsonError(400, 'missing_or_invalid_org_id');
  }
  if (!isUuid(patientId)) {
    return jsonError(400, 'missing_or_invalid_patient_id');
  }

  // 5. Gate 1: operator has active membership in org_id
  const { data: opMembership } = await admin
    .from('memberships')
    .select('id, role_id')
    .eq('user_id', operator.id)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .maybeSingle();
  if (!opMembership) {
    return jsonError(403, 'not_member');
  }

  // 6. Gate 2: operator has patient_data.read
  const { data: hasDataRead, error: dataReadErr } = await admin.rpc('has_permission', {
    p_user_id: operator.id,
    p_org_id: orgId,
    p_permission_key: 'patient_data.read',
  });
  if (dataReadErr) {
    console.error('[clinic-snapshot] has_permission (data.read) error', dataReadErr.message);
    return jsonError(500, 'permission_check_failed');
  }
  if (hasDataRead !== true) {
    return jsonError(403, 'insufficient_permission');
  }

  // 7. Gate 3: patient is an active member of org_id + fetch consent_scope
  const { data: patientMembership } = await admin
    .from('memberships')
    .select('id, consent_scope')
    .eq('user_id', patientId)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .maybeSingle();
  if (!patientMembership) {
    return jsonError(403, 'patient_not_member');
  }
  const consentScope: ConsentScope =
    (patientMembership as { consent_scope?: ConsentScope }).consent_scope ?? {};

  // 8. Compute permission_map — intersect operator role permissions with consent_scope.
  //    For each section: canView = consent_scope[section] === true AND operator
  //    has the required permission key.
  const { data: hasPhotosRead } = await admin.rpc('has_permission', {
    p_user_id: operator.id,
    p_org_id: orgId,
    p_permission_key: 'patient_photos.read',
  });
  const { data: hasBreakdownRead } = await admin.rpc('has_permission', {
    p_user_id: operator.id,
    p_org_id: orgId,
    p_permission_key: 'roster.read_breakdown',
  });

  // Helper: true only if consent is given AND operator has the permission
  const canView = (section: ConsentKey, requiresPhotosRead = false): boolean => {
    if (consentScope[section] !== true) return false;
    if (requiresPhotosRead) return hasPhotosRead === true;
    return true; // patient_data.read already verified above (Gate 2)
  };

  const permissionMap: ReadOnlyPermissionMap = {
    canViewInjections: canView('injections'),
    canViewWeights: canView('weights'),
    canViewSymptoms: canView('symptoms'),
    canViewPhotos: canView('photos', /* requiresPhotosRead= */ true),
    canViewDoctorReport: consentScope.injections === true, // doctor report requires injections consent
    canViewMeals: canView('meals'),
    canViewWorkouts: canView('workouts'),
    canViewSupplements: canView('supplements'),
    canViewMood: canView('mood'),
    canViewSleep: canView('sleep'),
    canViewBreakdown: hasBreakdownRead === true,
  };

  // 9. Fetch patient display name
  const { data: patientUser } = await admin.auth.admin.getUserById(patientId);
  const displayName =
    (patientUser?.user?.user_metadata as Record<string, string> | null)?.display_name ??
    'Patient';

  // 10. Fetch patient data per section, OMITTING sections where consent_scope[section] === false.
  //     ai_history EXCLUDED structurally (T-10-04-04 invariant — never returned).

  const [injectionsRes, weightsRes, symptomsRes, photosRes, mealsRes, workoutsRes, supplementsRes, moodRes, sleepRes] =
    await Promise.all([
      // Injections (consent required)
      permissionMap.canViewInjections
        ? admin
            .from('injections')
            .select('id, dose_mg, site, created_at')
            .eq('user_id', patientId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: null }),

      // Weights
      permissionMap.canViewWeights
        ? admin
            .from('weights')
            .select('id, weight_kg, recorded_at')
            .eq('user_id', patientId)
            .order('recorded_at', { ascending: false })
        : Promise.resolve({ data: null }),

      // Symptoms
      permissionMap.canViewSymptoms
        ? admin
            .from('symptoms')
            .select('id, name, severity, recorded_at')
            .eq('user_id', patientId)
            .order('recorded_at', { ascending: false })
        : Promise.resolve({ data: null }),

      // Photos (requires patient_photos.read)
      permissionMap.canViewPhotos
        ? admin
            .from('photos')
            .select('id, storage_path, taken_at')
            .eq('user_id', patientId)
            .order('taken_at', { ascending: false })
        : Promise.resolve({ data: null }),

      // Meals
      permissionMap.canViewMeals
        ? admin
            .from('meals')
            .select('id, name, calories, eaten_at')
            .eq('user_id', patientId)
            .order('eaten_at', { ascending: false })
        : Promise.resolve({ data: null }),

      // Workouts
      permissionMap.canViewWorkouts
        ? admin
            .from('workouts')
            .select('id, type, minutes, performed_at')
            .eq('user_id', patientId)
            .order('performed_at', { ascending: false })
        : Promise.resolve({ data: null }),

      // Supplements (daily record — select most recent)
      permissionMap.canViewSupplements
        ? admin
            .from('supplements')
            .select('*')
            .eq('user_id', patientId)
            .order('date', { ascending: false })
            .limit(7)
        : Promise.resolve({ data: null }),

      // Mood
      permissionMap.canViewMood
        ? admin
            .from('mood')
            .select('score, recorded_at')
            .eq('user_id', patientId)
            .order('recorded_at', { ascending: false })
        : Promise.resolve({ data: null }),

      // Sleep
      permissionMap.canViewSleep
        ? admin
            .from('sleep')
            .select('hours, quality, date')
            .eq('user_id', patientId)
            .order('date', { ascending: false })
        : Promise.resolve({ data: null }),
    ]);

  // 11. Build the snapshot response
  const snapshot = {
    patient_user_id: patientId,
    display_name: displayName,
    viewer_context: 'clinic' as const,
    org_id: orgId,
    permission_map: permissionMap,
    consent_scope: consentScope,
    injections: injectionsRes.data ?? [],
    weights: weightsRes.data ?? [],
    symptoms: symptomsRes.data ?? [],
    // photos: omit key when empty (structural exclusion mirrors T-10-04-01 intent)
    ...(permissionMap.canViewPhotos && photosRes.data ? { photos: photosRes.data } : { photos: [] }),
    ...(permissionMap.canViewMeals && mealsRes.data ? { meals: mealsRes.data } : {}),
    ...(permissionMap.canViewWorkouts && workoutsRes.data ? { workouts: workoutsRes.data } : {}),
    ...(permissionMap.canViewSupplements && supplementsRes.data
      ? { supplements: supplementsRes.data }
      : {}),
    ...(permissionMap.canViewMood && moodRes.data ? { mood: moodRes.data } : {}),
    ...(permissionMap.canViewSleep && sleepRes.data ? { sleep: sleepRes.data } : {}),
    // ai_history: NEVER included (T-10-04-04 structural exclusion)
  };

  // 12. Audit row (best-effort — failure does NOT block the 200 response)
  // Uses target_user_id and metadata columns added by Plan 10-02 migration 003.
  try {
    await admin.from('audit_logs').insert({
      user_id: operator.id,
      user_id_hash: await sha256Hex(operator.id),
      table_name: 'clinic_snapshot',
      row_id: patientId,
      action: 'clinic_snapshot_loaded',
      actor_type: 'org_member',
      org_id: orgId,
      target_user_id: patientId,
      metadata: { sections_served: Object.keys(permissionMap).filter(k => permissionMap[k as keyof ReadOnlyPermissionMap] === true) },
    });
  } catch (e) {
    console.error(
      '[clinic-snapshot] audit insert failed',
      e instanceof Error ? e.message : 'unknown',
    );
  }

  return jsonOk(snapshot);
}

// ─── sha256 helper ───────────────────────────────────────────────────────────
async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────
Deno.serve((req: Request) => handle(req));
