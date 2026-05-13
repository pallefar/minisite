/**
 * `bulk-csv-export` Edge Function — Phase 10 Plan 10-10.
 *
 * Returns a CSV file with symptom data for a set of selected patients over
 * the last 30 days. Only patients with consent_scope.symptoms=true are included.
 * Per-included-patient calls log_bulk_export_inclusion RPC for audit.
 *
 * ## Endpoint
 *   POST /bulk-csv-export
 *   Authorization: Bearer <operator JWT>
 *   Body: { org_id: string, patient_ids: string[] }
 *
 * ## Auth gate:
 *   1. Extract Bearer JWT → 401 if missing/invalid.
 *   2. Verify operator is active member of org_id
 *      (memberships WHERE user_id=operator AND org_id=org_id AND revoked_at IS NULL) → 403.
 *   3. Verify operator has patient_data.read via has_permission() RPC → 403.
 *   4. For each patient_id: verify active membership + consent_scope.symptoms=true.
 *      Silently skip patients that fail (consent withdrawn or not a member).
 *
 * ## Response:
 *   Content-Type: text/csv
 *   Content-Disposition: attachment; filename="symptoms-{org_slug}-{date}.csv"
 *   Cache-Control: private, no-store
 *   CSV columns: patient_display_name, date, symptom_name, severity
 *   One row per symptom log in the last 30 days for each included patient.
 *
 * ## Security invariants:
 *   T-10-10-02: Operator must have patient_data.read; consent_scope.symptoms filter per patient.
 *   T-10-10-04: No PHI in audit/logs other than the audit rows themselves.
 *   Cache-Control: private, no-store on EVERY response status code.
 *
 * Exports `handle()` for Deno test suite injection (same pattern as clinic-snapshot).
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { BASE_JSON_HEADERS, corsHeaders } from './cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Module-level admin client (service-role). The D-04-style auth gate IS the
// security boundary; RLS-bypass via service-role is intentional here.
const moduleAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// UUID validation
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string | null | undefined): s is string {
  return typeof s === 'string' && UUID_PATTERN.test(s);
}

// Response helpers
function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: BASE_JSON_HEADERS,
  });
}

// ─── Symptom row from DB ─────────────────────────────────────────────────────
interface SymptomRow {
  logged_at: string;
  name: string;
  severity: number;
}

// ─── Membership with consent_scope ──────────────────────────────────────────
interface MembershipWithConsent {
  user_id: string;
  consent_scope: Record<string, boolean> | null;
  role_id: string | null;
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function handle(
  req: Request,
  deps: { admin: SupabaseClient } = { admin: moduleAdmin },
): Promise<Response> {
  const { admin } = deps;

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // ── Step 1: Extract and validate Bearer JWT ──────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return jsonError(401, 'missing_jwt');
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonError(401, 'invalid_jwt');
  }
  const operatorId = authData.user.id;

  // ── Step 2: Parse and validate request body ──────────────────────────────
  let orgId: string;
  let patientIds: string[];
  try {
    const body = await req.json();
    orgId = body?.org_id ?? '';
    patientIds = Array.isArray(body?.patient_ids) ? body.patient_ids : [];
  } catch {
    return jsonError(400, 'invalid_body');
  }

  if (!isUuid(orgId)) {
    return jsonError(400, 'invalid_org_id');
  }
  if (patientIds.length === 0) {
    return jsonError(400, 'empty_patient_ids');
  }
  if (!patientIds.every(isUuid)) {
    return jsonError(400, 'invalid_patient_ids');
  }

  // ── Step 3: Verify operator is active member of org ──────────────────────
  const { data: opMembership, error: opMemberError } = await admin
    .from('memberships')
    .select('id, role_id')
    .eq('user_id', operatorId)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .limit(1)
    .single();

  if (opMemberError || !opMembership) {
    return jsonError(403, 'not_member');
  }

  // ── Step 4: Verify operator has patient_data.read ────────────────────────
  const { data: hasPerm, error: permError } = await admin.rpc('has_permission', {
    p_user_id: operatorId,
    p_org_id: orgId,
    p_permission_key: 'patient_data.read',
  });

  if (permError || !hasPerm) {
    return jsonError(403, 'insufficient_permission');
  }

  // ── Step 5: Fetch org slug for filename ──────────────────────────────────
  const { data: orgData } = await admin
    .from('orgs')
    .select('slug')
    .eq('id', orgId)
    .limit(1)
    .single();
  const orgSlug = orgData?.slug ?? 'export';

  // ── Step 6: For each patient — validate membership + consent_scope ───────
  const { data: memberships, error: membershipsError } = await admin
    .from('memberships')
    .select('user_id, consent_scope, role_id')
    .eq('org_id', orgId)
    .in('user_id', patientIds)
    .is('revoked_at', null);

  if (membershipsError) {
    return jsonError(500, 'db_error');
  }

  // Build a map of patient_id → consent_scope for quick lookup
  const consentMap = new Map<string, Record<string, boolean>>();
  for (const m of (memberships as MembershipWithConsent[]) ?? []) {
    consentMap.set(m.user_id, m.consent_scope ?? {});
  }

  // Included patients: those with active membership AND consent_scope.symptoms=true
  const includedPatientIds = patientIds.filter((id) => {
    const scope = consentMap.get(id);
    return scope !== undefined && scope.symptoms === true;
  });

  // ── Step 7: Fetch display names for included patients ────────────────────
  const displayNameMap = new Map<string, string>();
  if (includedPatientIds.length > 0) {
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users?.users) {
      for (const u of users.users) {
        if (includedPatientIds.includes(u.id)) {
          displayNameMap.set(
            u.id,
            (u.user_metadata?.display_name as string | undefined) ??
              (u.email ?? 'Unknown'),
          );
        }
      }
    }
  }

  // ── Step 8: Fetch symptom data for included patients (last 30 days) ──────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const csvRows: string[] = [];
  csvRows.push('patient_display_name,date,symptom_name,severity');

  const auditPromises: Promise<unknown>[] = [];

  for (const patientId of includedPatientIds) {
    const displayName = displayNameMap.get(patientId) ?? 'Unknown';

    // Fetch symptom logs from the last 30d
    const { data: symptoms, error: sympError } = await admin
      .from('symptoms')
      .select('logged_at, name, severity')
      .eq('user_id', patientId)
      .gte('logged_at', thirtyDaysAgo)
      .order('logged_at', { ascending: false });

    if (!sympError && symptoms) {
      for (const row of symptoms as SymptomRow[]) {
        const date = row.logged_at.split('T')[0];
        // Escape CSV values that contain commas or quotes
        const escapedName = escapeCsv(displayName);
        const escapedSymptomName = escapeCsv(row.name);
        csvRows.push(`${escapedName},${date},${escapedSymptomName},${row.severity}`);
      }
    }

    // Per-included-patient: call log_bulk_export_inclusion RPC (fire-and-forget, best-effort)
    const auditPromise = Promise.resolve(
      admin.rpc('log_bulk_export_inclusion', {
        p_org_id: orgId,
        p_target_user_id: patientId,
        p_export_type: 'csv',
      }),
    ).then((result: { data: unknown; error: { message: string } | null }) => {
      if (result.error) {
        console.warn(`audit log failed for patient ${patientId}:`, result.error.message);
      }
    }).catch(() => {
      // Best-effort — audit failure must not block the CSV response
    });
    auditPromises.push(auditPromise);
  }

  // Wait for audit rows (best-effort; errors are logged but don't block response)
  await Promise.allSettled(auditPromises);

  // ── Step 9: Build and return CSV response ────────────────────────────────
  const csvBody = csvRows.join('\n');
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `symptoms-${orgSlug}-${dateStr}.csv`;

  return new Response(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      ...corsHeaders,
    },
  });
}

// ─── CSV escaping helper ──────────────────────────────────────────────────────
function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
Deno.serve((req: Request) => handle(req));
