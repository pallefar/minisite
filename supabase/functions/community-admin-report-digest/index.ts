/**
 * Phase 45 Plan 45-05 — community-admin-report-digest Edge Function.
 *
 * POST /functions/v1/community-admin-report-digest
 *
 * Daily cron-triggered (0 9 * * * UTC, registered by
 * supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql).
 *
 * Auth — SERVICE-ROLE ONLY (no user JWT path):
 *   Bearer ${SUPABASE_SERVICE_ROLE_KEY} required.
 *
 *   Why service-role-only: per RESEARCH Pattern 3 + Pitfall 7
 *   (feedback_rpc_auth_uid_vs_service_role_mismatch), this Fn READS
 *   community_reports + profiles directly via admin client and NEVER calls
 *   an RPC that depends on the request user context. Cron has no user
 *   context to forward.
 *
 * Pipeline:
 *   1. checkServiceRoleBearer(req) — 401 on miss.
 *   2. SELECT target_type FROM community_reports WHERE status='open' LIMIT 1000.
 *   3. JS-side reduce → open_count + by_type Array<{target_type, count}>.
 *   4. SELECT id FROM profiles WHERE is_staff=true AND admin_digest_opt_in=true.
 *   5. For each admin id → auth.admin.getUserById(id) → resolve email
 *      (per memory profiles_email_vs_auth_users_email: profiles has NO
 *      email column; the canonical email lives in auth.users only).
 *   6. sendEmail({ template: 'community_admin_report_digest', to: email,
 *                 vars: { open_count, by_type, digest_date, admin_url },
 *                 phi: false }).
 *      Per-recipient try/catch — one failed send must NOT block others
 *      (mirrors helpdesk-sla-breach-cron pattern).
 *   7. Return 200 { sent_count, open_count, by_type }.
 *
 * Threat model mitigations (45-05 + 45-02):
 *   T-45-07 — DoS (replay): cron is service-role-bearer-gated; daily cap = 1.
 *   T-45-05 — XSS (by_type vars): escapeHtml() applied inside the
 *             community-admin-report-digest.ts template (per 45-02 design).
 *
 * References:
 *   - reference_deno_test_top_level_serve_trap — Deno.serve guarded by import.meta.main.
 *   - reference_profiles_email_vs_auth_users_email — JOIN auth.users for email.
 *   - notify-community/index.ts — corsHeaders, jsonResponse, jsonError, hashForLog.
 *   - helpdesk-sla-breach-cron/index.ts — sendEmail seam + per-recipient try/catch.
 *   - 45-PATTERNS.md §"community-admin-report-digest/index.ts".
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail as defaultSendEmail } from '../_shared/email-router.ts';
import type { SendEmailArgs, SendEmailResult } from '../_shared/email-router.ts';
import { checkServiceRoleBearer } from '../_shared/lifecycle-utils.ts';

// ============================================================================
// CORS + response helpers
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

// ============================================================================
// Lazy admin singleton + Proxy (test-injectable)
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
// sendEmail test seam (mirrors helpdesk-sla-breach-cron pattern)
// ============================================================================

type SendEmailFn = (supabase: SupabaseClient, args: SendEmailArgs) => Promise<SendEmailResult>;
let _sendEmailImpl: SendEmailFn = defaultSendEmail;
function setSendEmailForTest(fn: SendEmailFn): void {
  _sendEmailImpl = fn;
}
function resetSendEmailForTest(): void {
  _sendEmailImpl = defaultSendEmail;
}

// ============================================================================
// PII guard: sha256-hash a string before logging
// (Mirrors notify-community lines 107–116; protects admin user_id in logs.)
// ============================================================================

async function hashForLog(value: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(value);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  } catch {
    return '[hash-err]';
  }
}

// ============================================================================
// Core handler
// ============================================================================

async function handleDigest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  // 1. Auth — service-role only.
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  // 2. Fetch open reports (cap 1000 rows for v1 — Phase 48 moderation queue
  // will paginate). READ-only — never writes (per RESEARCH Pattern 3).
  // deno-lint-ignore no-explicit-any
  const adminAny = admin as any;
  const { data: reportData, error: reportError } = await adminAny
    .from('community_reports')
    .select('target_type')
    .eq('status', 'open')
    .limit(1000);

  if (reportError) {
    console.error('[community-admin-report-digest] reports lookup error', reportError.message);
    return jsonError(500, 'internal');
  }

  const reports = (reportData ?? []) as Array<{ target_type: string }>;
  const open_count = reports.length;

  // 3. JS-side reduce: group by target_type.
  const byTypeCount: Record<string, number> = {};
  for (const row of reports) {
    const t = row.target_type;
    byTypeCount[t] = (byTypeCount[t] ?? 0) + 1;
  }
  const by_type: Array<{ target_type: string; count: number }> = Object.entries(byTypeCount)
    .map(([target_type, count]) => ({ target_type, count }))
    .sort((a, b) => b.count - a.count);

  // 4. Fetch admin recipients — is_staff=true AND admin_digest_opt_in=true.
  // Per D-11 (45-01 schema): admin_digest_opt_in defaults to false, so admins
  // MUST opt-in via admin_toggle_report_digest_opt_in() RPC before receiving.
  const { data: adminData, error: adminError } = await adminAny
    .from('profiles')
    .select('id')
    .eq('is_staff', true)
    .eq('admin_digest_opt_in', true);

  if (adminError) {
    console.error('[community-admin-report-digest] profiles lookup error', adminError.message);
    return jsonError(500, 'internal');
  }
  const adminRows = (adminData ?? []) as Array<{ id: string }>;

  // 5/6. Early-return when no open reports — still 200 OK, sent_count=0.
  // (Don't waste Resend sends on empty digests.)
  if (open_count === 0) {
    return jsonResponse(200, { sent_count: 0, open_count: 0, by_type: [] });
  }

  const digest_date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const admin_url = 'https://app.leanshot.app/admin/community/reports';

  let sent_count = 0;
  for (const row of adminRows) {
    // Resolve email via auth.admin.getUserById — profiles has NO email column
    // (memory reference_profiles_email_vs_auth_users_email).
    let email: string | null = null;
    try {
      // deno-lint-ignore no-explicit-any
      const { data: userData, error: userErr } = await (admin.auth as any).admin.getUserById(row.id);
      if (userErr || !userData?.user?.email) {
        const hashId = await hashForLog(row.id);
        console.warn(
          `[community-admin-report-digest] admin sha256:${hashId} has no auth.users email — skipping`,
        );
        continue;
      }
      email = String(userData.user.email);
    } catch (e) {
      const hashId = await hashForLog(row.id);
      const errName = e instanceof Error ? e.name : 'unknown';
      console.warn(
        `[community-admin-report-digest] getUserById failed for admin sha256:${hashId}: ${errName}`,
      );
      continue;
    }

    const hashId = await hashForLog(row.id);
    console.log(`[community-admin-report-digest] digest send to admin sha256:${hashId}`);

    try {
      await _sendEmailImpl(admin, {
        template: 'community_admin_report_digest',
        to: email,
        vars: {
          open_count,
          by_type,
          digest_date,
          admin_url,
        },
        // Hardcoded false — digest contains only aggregate counts + admin URL.
        // No patient data ever flows through this template.
        phi: false,
      });
      sent_count += 1;
    } catch (err) {
      // Per-recipient isolation (mirrors helpdesk-sla-breach-cron) — one
      // failed send does NOT block others; cron re-fires tomorrow.
      const errName = err instanceof Error ? err.name : 'unknown';
      console.warn(`[community-admin-report-digest] recipient-send-failed: ${errName}`);
    }
  }

  return jsonResponse(200, { sent_count, open_count, by_type });
}

// ============================================================================
// Deno.serve entrypoint — guarded per reference_deno_test_top_level_serve_trap
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handleDigest);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleDigest,
  setAdminForTest,
  resetAdminForTest,
  setSendEmailForTest,
  resetSendEmailForTest,
};
