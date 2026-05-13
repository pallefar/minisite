/**
 * `patient-activity` Edge Function — Phase 10 Plan 10-09.
 *
 * Returns per-org audit rows scoped to the authenticated patient.
 * Fills the Phase 9 D-15 stub for the "View activity" modal on Active
 * Organizations rows in the patient's Settings.
 *
 * ## Endpoint
 *   GET /patient-activity?org_id=<uuid>&tab=<operator_views|ranking_events>&offset=<N>&limit=<N>
 *   Authorization: Bearer <patient JWT>
 *
 * ## Auth gate:
 *   1. Extract Bearer JWT from Authorization header → 401 if missing/invalid.
 *   2. Validate JWT via admin.auth.getUser(jwt) → obtain patient identity.
 *   3. Require org_id query param → 400 if missing/invalid UUID.
 *   4. Query audit_logs via admin (service role — bypasses user_id RLS)
 *      WHERE target_user_id = patient.id AND org_id = requested_org_id.
 *      Cross-tenant isolation: patient B cannot see patient A's rows because
 *      they cannot obtain a JWT for patient A. The WHERE clause enforces it.
 *
 * ## Security invariants:
 *   T-10-09-01: target_user_id = patient JWT uid — cross-tenant isolation.
 *   T-10-09-02: NO PostHog events fired from this function (D-19 decision).
 *   T-10-09-03: metadata column does NOT include IP/UA (D-20 invariant).
 *   Cache-Control: private, no-store on EVERY response status code.
 *
 * ## Tab filter:
 *   - tab=operator_views → action IN ('section_view', 'patient_data.read', 'patient_photos.read')
 *   - tab=ranking_events → action = 'rank_threshold_crossed'
 *   - (omitted) → all rows for both tabs (no filter)
 *
 * ## Actor display fallback (D-20):
 *   Each row is enriched with actor_display_name:
 *   auth.users.user_metadata.display_name, falls back to 'a clinic member'.
 *
 * ## Pagination:
 *   ?offset=N&limit=25 (max 25). Response: { rows, total, has_more }.
 *
 * Exports `handle()` for Deno test suite injection.
 */

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { BASE_RESPONSE_HEADERS } from './cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ─── Module-level admin client (service-role) ────────────────────────────────
// The patient's JWT validates who they are; the service-role client is used
// to query audit_logs by target_user_id (not user_id = actor) which the
// patient-facing RLS policy does not cover. Service role bypasses RLS
// intentionally — the WHERE target_user_id = patient.id clause IS the gate.
const moduleAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── UUID validation ──────────────────────────────────────────────────────────
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string | null | undefined): s is string {
  return typeof s === 'string' && UUID_PATTERN.test(s);
}

// ─── Tab filter sets ──────────────────────────────────────────────────────────
const OPERATOR_VIEW_ACTIONS = ['section_view', 'patient_data.read', 'patient_photos.read', 'clinic_snapshot_loaded'] as const;
const RANKING_EVENT_ACTIONS = ['rank_threshold_crossed'] as const;

type TabFilter = 'operator_views' | 'ranking_events' | 'all';

// ─── Response helpers ─────────────────────────────────────────────────────────
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

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: number;
  timestamp: string;
  action: string;
  actor_type: string | null;
  org_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
  actor_display_name: string;
  actor_role: string | null;
}

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

  // 3. Validate JWT → get patient identity
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonError(401, 'invalid_jwt');
  }
  const patient = userData.user;

  // 4. Parse + validate query parameters
  const url = new URL(req.url);
  const orgId = url.searchParams.get('org_id');
  const tabParam = url.searchParams.get('tab') ?? 'all';
  const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limitParam = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10), 25);

  if (!isUuid(orgId)) {
    return jsonError(400, 'missing_or_invalid_org_id');
  }

  const offset = isNaN(offsetParam) || offsetParam < 0 ? 0 : offsetParam;
  const limit = isNaN(limitParam) || limitParam < 1 ? 25 : limitParam;

  // Validate tab param
  const tab: TabFilter =
    tabParam === 'operator_views' ? 'operator_views'
    : tabParam === 'ranking_events' ? 'ranking_events'
    : 'all';

  // 5. Build query — WHERE target_user_id = patient.id AND org_id = orgId
  //    This is the cross-tenant isolation gate (T-10-09-01).
  let query = admin
    .from('audit_logs')
    .select(
      'id, timestamp, action, actor_type, org_id, target_user_id, metadata, user_id',
      { count: 'exact' },
    )
    .eq('target_user_id', patient.id)
    .eq('org_id', orgId)
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  // Apply tab filter
  if (tab === 'operator_views') {
    query = query.in('action', OPERATOR_VIEW_ACTIONS as unknown as string[]);
  } else if (tab === 'ranking_events') {
    query = query.in('action', RANKING_EVENT_ACTIONS as unknown as string[]);
  }

  const { data: rawRows, error: queryErr, count } = await query;

  if (queryErr) {
    console.error('[patient-activity] audit_logs query failed', queryErr.message);
    return jsonError(500, 'query_failed');
  }

  const rows = rawRows ?? [];
  const total = count ?? rows.length;
  const hasMore = offset + rows.length < total;

  // 6. Enrich each row with actor_display_name (D-20 fallback).
  //    Collect unique actor user_ids; batch-fetch display names.
  const actorIds = [...new Set(rows.map((r: Record<string, unknown>) => r.user_id as string | null).filter(Boolean))] as string[];

  const actorNames: Record<string, string> = {};
  const actorRoles: Record<string, string | null> = {};

  if (actorIds.length > 0) {
    // Fetch actor display names from auth.users via admin API.
    // We do individual lookups to avoid needing a list-users endpoint.
    // In production with high volume, this would be batched via a RPC;
    // for the 25-row window this is acceptable.
    await Promise.all(
      actorIds.map(async (actorId) => {
        try {
          const { data: actorData } = await admin.auth.admin.getUserById(actorId);
          const displayName =
            (actorData?.user?.user_metadata as Record<string, string> | null | undefined)
              ?.display_name;
          actorNames[actorId] = displayName || 'a clinic member';
        } catch {
          actorNames[actorId] = 'a clinic member';
        }
      }),
    );

    // Fetch actor role names via memberships JOIN roles (best-effort).
    try {
      const { data: memberships } = await admin
        .from('memberships')
        .select('user_id, roles(name)')
        .eq('org_id', orgId)
        .in('user_id', actorIds)
        .is('revoked_at', null);

      if (memberships) {
        for (const m of memberships as Array<{
          user_id: string;
          roles: { name: string } | Array<{ name: string }> | null;
        }>) {
          const rolesField = m.roles;
          const role = Array.isArray(rolesField) ? rolesField[0] : rolesField;
          actorRoles[m.user_id] = role?.name ?? null;
        }
      }
    } catch {
      // Non-fatal — role data is best-effort
    }
  }

  // 7. Shape the enriched rows
  const enrichedRows: AuditRow[] = rows.map((r: Record<string, unknown>) => {
    const actorId = r.user_id as string | null;
    return {
      id: r.id as number,
      timestamp: r.timestamp as string,
      action: r.action as string,
      actor_type: r.actor_type as string | null,
      org_id: r.org_id as string | null,
      target_user_id: r.target_user_id as string | null,
      metadata: r.metadata as Record<string, unknown> | null,
      user_id: actorId,
      actor_display_name: actorId ? (actorNames[actorId] ?? 'a clinic member') : 'a clinic member',
      actor_role: actorId ? (actorRoles[actorId] ?? null) : null,
    };
  });

  return jsonOk({
    rows: enrichedRows,
    total,
    has_more: hasMore,
    offset,
    limit,
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────
Deno.serve((req: Request) => handle(req));
