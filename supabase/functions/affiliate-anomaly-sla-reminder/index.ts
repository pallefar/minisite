/**
 * `affiliate-anomaly-sla-reminder` Edge Function — Phase 26 Plan 26-02.
 *
 * AFFTIER-05 / D-09 — 7-day admin-review SLA enforcement. Operationalizes
 * "anomaly flagged → admin must decide within 7 days". Fires a reminder
 * email at the 5-day mark so admins have a 2-day window to act before the
 * SLA breaches.
 *
 * Invoked by pg_cron at `0 9 * * *` (daily 09:00 UTC — see
 * migration 20270701000009_affiliate_anomaly_sla_cron.sql). NOT a
 * public endpoint; bearer-gated on the service_role_key (constant-time
 * compare).
 *
 * PII / PHI safety (Phase 25 D-09):
 *   - Email body summary lines ONLY contain {affiliate_id, z_score, created_at}.
 *   - NEVER includes user_id, conversion_id, or any PHI-class keywords
 *     (the forbidden-keyword list lives in the sibling index.test.ts case
 *     "email body is PHI-clean" — adding any here would break the grep gate).
 *   - Conversation context: this is a B2B operator email, not a marketing
 *     send. ADMIN_REVIEW_EMAIL_TO env var is the only recipient.
 *
 * Project rules:
 *   - reference_supabase_edge_function_deploy.md — esm.sh + jsr URLs only;
 *     verify_jwt=true (cron-only via bearer; no public surface).
 *   - reference_deno_test_discovery.md — sibling test is index.test.ts.
 *   - Pattern 5 (Edge-Fn scaffold): lazy env getters + DI seam for tests.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ─── Lazy env getters (Pattern 5) ────────────────────────────────────────────
// Avoid reading env at module-load so test files can `Deno.env.set(...)`
// AFTER the import resolves.
const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const getAdminEmail = () => Deno.env.get('ADMIN_REVIEW_EMAIL_TO') ?? '';
const getResendKey = () => Deno.env.get('RESEND_API_KEY') ?? '';

// SLA window — flag rows older than this trigger a reminder. Plan picks 5d
// so admins have 2d head-room before the 7d SLA breaches.
const SLA_REMINDER_AGE_DAYS = 5;
const SLA_REMINDER_AGE_MS = SLA_REMINDER_AGE_DAYS * 86400_000;

// ─── DI seam — module-level admin singleton (lazy) ───────────────────────────
let _adminInstance: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

/**
 * Test seam — allow swapping the admin client (or clearing with `null`)
 * without re-evaluating the module. Mirrors affiliate-attribute's
 * `__setAdminForTest` / `__resetAdminForTest` convention.
 */
export const __internal = {
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient | null;
  },
};

// ─── Constant-time bearer compare (T-26-10 mitigation) ───────────────────────
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function handleRun(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!constantTimeEqual(bearer, getServiceRoleKey())) {
    return new Response('unauthorized', { status: 401 });
  }

  const admin = getAdmin();

  // Query unreviewed flagged conversions older than 5d.
  // Filters: anomaly_flagged=true, anomaly_review_decision IS NULL,
  // created_at < now() - 5d. Ordered ASC (oldest first) so the summary
  // tells admins which one is closest to breaching the 7d SLA.
  const cutoffIso = new Date(Date.now() - SLA_REMINDER_AGE_MS).toISOString();

  const { data: rows, error } = await admin
    .from('affiliate_conversions')
    .select('id, affiliate_id, anomaly_z_score, created_at')
    .eq('anomaly_flagged', true)
    .is('anomaly_review_decision', null)
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!rows || rows.length === 0) {
    return new Response(
      JSON.stringify({ sent: false, reason: 'no_pending_items' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Build PHI-safe summary lines. ONLY affiliate_id + z_score + created_at.
  // (No conversion_id — that can correlate to user via affiliate_conversions
  // FK chain; affiliate_id alone is operationally sufficient for triage.)
  type SummaryRow = {
    affiliate_id: string;
    anomaly_z_score: number | null;
    created_at: string;
  };
  const summaryLines = (rows as SummaryRow[])
    .map((r) => {
      const z = r.anomaly_z_score === null ? 'n/a' : r.anomaly_z_score.toFixed(2);
      return `- affiliate ${r.affiliate_id}: z=${z} flagged ${r.created_at}`;
    })
    .join('\n');

  const subject = `LeanShot — ${rows.length} affiliate anomaly review item(s) past 5d SLA`;
  const text =
    `The following affiliate anomaly review items have been flagged for more than ${SLA_REMINDER_AGE_DAYS} days without a decision (7-day SLA per D-09):\n\n` +
    `${summaryLines}\n\n` +
    `Review at /admin/affiliates → Anomaly Review tab.`;

  // POST to Resend. Failure is logged + reported but does not throw —
  // pg_cron will retry tomorrow regardless.
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getResendKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'LeanShot <noreply@app.leanshot.app>',
      to: [getAdminEmail()],
      subject,
      text,
    }),
  });

  return new Response(
    JSON.stringify({ sent: true, count: rows.length, resend_status: resp.status }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────
if (import.meta.main) {
  Deno.serve(handleRun);
}
