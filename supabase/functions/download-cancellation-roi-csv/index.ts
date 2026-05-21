/**
 * `download-cancellation-roi-csv` Edge Function — Phase 40 Plan 40-06 POLISH-02.
 *
 * Streams the v_cancellation_offers_roi VIEW as a CSV download.
 * Gate: JWT bearer auth + server-side admin role check (T-40-06-02 mitigation).
 *
 * ## Endpoint
 *   GET /functions/v1/download-cancellation-roi-csv
 *   Authorization: Bearer <admin JWT>
 *
 *   Query params:
 *     range_from  YYYY-MM-DD  (optional; defaults to 30 days ago)
 *     range_to    YYYY-MM-DD  (optional; defaults to today)
 *     cohorts     comma-separated cohort_id list (optional; omit = all)
 *     offers      comma-separated offer_type list (optional; omit = all)
 *
 * ## Auth gate:
 *   1. Extract Bearer JWT → 401 if missing/invalid.
 *   2. Verify via getUser() → extract auth.uid().
 *   3. SELECT admin_role FROM profiles WHERE id=uid → 403 if not admin.
 *
 * ## Response:
 *   Content-Type: text/csv; charset=utf-8
 *   Content-Disposition: attachment; filename="cancellation-roi-YYYYMMDD.csv"
 *   Cache-Control: private, no-store
 *   Rows: one per v_cancellation_offers_roi result row.
 *   Header row: offered_day,offer_type,cohort_id,tenure_bucket,posthog_variant_id,
 *                shown_count,accepted_count,declined_count,deferred_mrr_usd
 *
 * ## Security invariants:
 *   T-40-06-02: JWT bearer + server-side admin role check; 403 on sub-admin.
 *   T-40-06-03: reason_other_text excluded from this export (PII in admin context only).
 *   Cache-Control: private, no-store on EVERY response status code.
 *
 * Pattern mirrors supabase/functions/bulk-csv-export/index.ts (Phase 10).
 * Exports `handle()` for Deno test suite injection.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  bearerFromReq,
  corsHeaders,
  jsonError,
} from '../_shared/lifecycle-utils.ts';
import { shutdownPostHog } from '../_shared/posthog-server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** Admin roles that are allowed to export ROI CSV (mirrors admin-grant-freeze-token pattern). */
const ADMIN_ROLES = new Set([
  'support_admin',
  'support_lead',
  'finance_admin',
  'superadmin',
]);

// Module-level admin client (service-role). Used ONLY for profile + view reads.
let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_admin === null) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

/** Test hook: inject a mock admin client. */
export function setAdminForTest(client: SupabaseClient | null): void {
  _admin = client;
}

/** Row shape from v_cancellation_offers_roi. */
interface RoiViewRow {
  offered_day: string;
  offer_type: string;
  cohort_id: string | null;
  tenure_bucket: string;
  posthog_variant_id: string | null;
  shown_count: number;
  accepted_count: number;
  declined_count: number;
  deferred_mrr_cents_est: number;
}

function escapeCsv(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const NOOP_CORS = {
  ...corsHeaders,
  'Cache-Control': 'private, no-store',
};

function csvErrorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json', ...NOOP_CORS },
  });
}

export async function handle(
  req: Request,
  deps: { admin: SupabaseClient } = { admin: getAdmin() },
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') return csvErrorResponse(405, 'method_not_allowed');

  try {
    // ── 1. Extract + verify JWT ────────────────────────────────────────────
    const jwt = bearerFromReq(req);
    if (!jwt) return csvErrorResponse(401, 'missing_jwt');

    // Verify JWT via getUser (real supabase Auth validation).
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return csvErrorResponse(401, 'invalid_jwt');
    const callerId = userData.user.id;

    // ── 2. Server-side admin role check ───────────────────────────────────
    const { data: profile, error: profileErr } = await deps.admin
      .from('profiles')
      .select('admin_role')
      .eq('id', callerId)
      .maybeSingle();
    if (profileErr) {
      console.error('[download-cancellation-roi-csv] profile lookup failed', profileErr.message);
      return csvErrorResponse(500, 'db_error');
    }
    if (!profile?.admin_role || !ADMIN_ROLES.has(profile.admin_role)) {
      return csvErrorResponse(403, 'forbidden_not_admin');
    }

    // ── 3. Parse query params ──────────────────────────────────────────────
    const url = new URL(req.url);
    const rangeFrom = url.searchParams.get('range_from') ?? daysAgoIso(30);
    const rangeTo = url.searchParams.get('range_to') ?? todayIso();
    const cohortParam = url.searchParams.get('cohorts');
    const offerParam = url.searchParams.get('offers');

    const cohorts = cohortParam ? cohortParam.split(',').filter(Boolean) : [];
    const offerTypes = offerParam ? offerParam.split(',').filter(Boolean) : [];

    // ── 4. Query the view ─────────────────────────────────────────────────
    let q = deps.admin
      .from('v_cancellation_offers_roi')
      .select('*')
      .gte('offered_day', rangeFrom)
      .lte('offered_day', rangeTo)
      .order('offered_day', { ascending: true });

    if (cohorts.length > 0) q = q.in('cohort_id', cohorts);
    if (offerTypes.length > 0) q = q.in('offer_type', offerTypes);

    const { data, error: qErr } = await q;
    if (qErr) {
      console.error('[download-cancellation-roi-csv] view query failed', qErr.message);
      return csvErrorResponse(500, 'query_error');
    }

    // ── 5. Build CSV ────────────────────────────────────────────────────────
    const rows = (data ?? []) as RoiViewRow[];
    const csvLines: string[] = [
      // Header row
      'offered_day,offer_type,cohort_id,tenure_bucket,posthog_variant_id,shown_count,accepted_count,declined_count,deferred_mrr_usd',
    ];

    for (const row of rows) {
      // Convert deferred_mrr_cents_est (cents) to USD (2 decimal places)
      const mrrUsd = ((row.deferred_mrr_cents_est ?? 0) / 100).toFixed(2);
      csvLines.push(
        [
          escapeCsv(row.offered_day?.slice(0, 10)),
          escapeCsv(row.offer_type),
          escapeCsv(row.cohort_id),
          escapeCsv(row.tenure_bucket),
          escapeCsv(row.posthog_variant_id),
          escapeCsv(row.shown_count ?? 0),
          escapeCsv(row.accepted_count ?? 0),
          escapeCsv(row.declined_count ?? 0),
          escapeCsv(mrrUsd),
        ].join(','),
      );
    }

    const csvBody = csvLines.join('\n');
    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    return new Response(csvBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cancellation-roi-${yyyymmdd}.csv"`,
        'Cache-Control': 'private, no-store',
        ...corsHeaders,
      },
    });
  } finally {
    await shutdownPostHog();
  }
}

// Guard: only start the HTTP server when this file is the main module,
// not when it is imported by the Deno test suite (prevents Deno.serve permission
// errors in tests — same pattern as bulk-csv-export).
if (import.meta.main) {
  Deno.serve((req: Request) => handle(req));
}
