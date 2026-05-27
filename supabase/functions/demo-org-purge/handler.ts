/**
 * demo-org-purge — handler.ts
 *
 * Phase 68 Plan 68-02 (LAND-06).
 *
 * Cron-driven Edge Fn (daily at 03:00 UTC) that purges demo organizations
 * whose 7-day demo window has expired. Operator can extend a demo up to
 * 30 days by setting `organizations.demo_extended_until > now()` via the
 * admin UI (Plan 68-04).
 *
 * === Endpoints ===
 *   GET  /healthz → 200 { ok: true, fn: "demo-org-purge" }
 *   POST /        → service-role bearer required → purge expired demo orgs
 *
 * Request body (optional JSON):
 *   { "dry_run": true } → returns the candidate list WITHOUT deleting
 *
 * Response:
 *   200 { purged_count, purged_org_ids, dry_run }
 *
 * === Auth ===
 *   `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — constant-time compare.
 *   GET /healthz exempt.
 *
 * === Schema reality (Phase 28 Plan 28-01) — Rule 1 deviation from PLAN ===
 *   The PLAN.md narrative claims "relies on existing FK ON DELETE CASCADE for
 *   patients, dose_logs, weight_logs, etc.", but every Phase-28 child table
 *   FK on `public.organizations(id)` is declared `ON DELETE RESTRICT` (org_members,
 *   org_invites, org_settings, org_branding, org_subscriptions, org_patient_links,
 *   org_consent_grants). A bare `DELETE FROM organizations WHERE id = ?` will
 *   fail with 23503 foreign_key_violation. To honour the plan's intent
 *   (purging demo orgs cleanly), the handler manually deletes dependent rows
 *   first in dependency-safe order before deleting the organization itself.
 *
 *   User-owned PHI rows (injections, weights, mood, symptoms, etc.) are keyed
 *   on `auth.users.id`, not `organizations.id` — they ride along with their
 *   patient's auth.users row, not the org. Demo patients seeded via
 *   `scripts/seed-demo-org.ts` are NOT auth.users-deleted here; that is a
 *   separate operator step (Plan 68-04 admin UI) since auth.users.delete
 *   requires its own audit-log entry path.
 *
 * === Slack alert ===
 *   Sends a P2 `cost`-channel alert when `purged_count > 10` in a single run
 *   (defensive — a large bulk purge suggests demo-creation runaway).
 *
 * === Deno.serve trap ===
 *   Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve lives in
 *   `index.ts` under `if (import.meta.main)`. Tests import `handler.ts` only.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { constantTimeEqual } from '../_shared/newsletter-token.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemoOrgPurgeDeps {
  /** Supabase service-role client. */
  supabaseServiceClient: ReturnType<typeof createClient>;
  /** Service-role key for bearer auth check. */
  serviceRoleKey: string;
  /** Slack alerter — defaults to the shared helper but injectable for tests. */
  slackAlert?: (
    channel: 'cost' | 'regulatory' | 'pharma02' | 'rag' | 'research',
    payload: {
      severity: 'P1' | 'P2' | 'P3';
      title: string;
      text: string;
      fields?: Array<{ title: string; value: string; short?: boolean }>;
    },
  ) => Promise<void>;
  /** Override now() for deterministic tests. */
  nowProvider?: () => Date;
}

interface ExpiredDemoOrg {
  id: string;
}

// Tables that hold per-org rows and use `ON DELETE RESTRICT` FKs on
// organizations(id). Order is dependency-safe: rows that reference other
// child rows (e.g. org_patient_links → org_consent_grants) get cleaned first.
const ORG_CHILD_TABLES = [
  'org_patient_links',
  'org_consent_grants',
  'org_invites',
  'org_branding',
  'org_settings',
  'org_subscriptions',
  'org_members',
  'memberships',
  'roles',
] as const;

// ─── Main handler ────────────────────────────────────────────────────────────

/**
 * Handle one purge invocation. Exported as a named function so tests call it
 * directly without binding a Deno.serve socket.
 */
export async function handle(
  req: Request,
  deps?: Partial<DemoOrgPurgeDeps>,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return json({ ok: true, fn: 'demo-org-purge' }, 200);
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ── Auth: service-role bearer (constant-time compare) ─────────────────────
  const serviceRoleKey =
    deps?.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';

  if (!serviceRoleKey || !constantTimeEqual(bearer, serviceRoleKey)) {
    return json({ error: 'unauthorized' }, 401);
  }

  // ── Parse dry_run flag from request body ───────────────────────────────────
  let dryRun = false;
  try {
    const text = await req.text();
    if (text) {
      const body = JSON.parse(text) as { dry_run?: boolean };
      dryRun = body?.dry_run === true;
    }
  } catch {
    // Tolerate empty / unparseable bodies — treat as dry_run=false.
  }

  // ── Build supabase client ──────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://placeholder.supabase.co';
  const supabase =
    deps?.supabaseServiceClient ??
    createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

  const nowFn = deps?.nowProvider ?? (() => new Date());
  const sevenDaysAgoIso = new Date(nowFn().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = nowFn().toISOString();

  // ── Query expired demo orgs ────────────────────────────────────────────────
  // is_demo = true
  // AND created_at < now() - interval '7 days'
  // AND (demo_extended_until IS NULL OR demo_extended_until < now())
  const { data: candidates, error: queryError } = await (
    supabase
      .from('organizations')
      .select('id')
      .eq('is_demo', true)
      .lt('created_at', sevenDaysAgoIso)
      .or(`demo_extended_until.is.null,demo_extended_until.lt.${nowIso}`) as unknown as Promise<{
      data: ExpiredDemoOrg[] | null;
      error: { message: string } | null;
    }>
  );

  if (queryError) {
    console.error('[demo-org-purge] candidate query error:', queryError);
    return json({ error: 'db_error', message: queryError.message }, 500);
  }

  const expiredOrgIds = (candidates ?? []).map((r) => r.id);

  if (expiredOrgIds.length === 0) {
    return json({ purged_count: 0, purged_org_ids: [], dry_run: dryRun }, 200);
  }

  // ── dry_run: bail before any writes ────────────────────────────────────────
  if (dryRun) {
    return json(
      { purged_count: expiredOrgIds.length, purged_org_ids: expiredOrgIds, dry_run: true },
      200,
    );
  }

  // ── Purge: delete child rows first, then the org itself ────────────────────
  // Phase 28 child tables use ON DELETE RESTRICT — bare DELETE on organizations
  // would 23503 without these explicit clears (see file header notes).
  const purged: string[] = [];
  for (const orgId of expiredOrgIds) {
    try {
      for (const table of ORG_CHILD_TABLES) {
        const res = await supabase.from(table).delete().eq('org_id', orgId);
        // 42P01 = relation does not exist. Tolerate — some tables may have
        // been renamed in later phases; skip and continue.
        if (res.error && !/42P01|does not exist/i.test(res.error.message)) {
          throw new Error(`failed to clear ${table} for org ${orgId}: ${res.error.message}`);
        }
      }

      const delRes = await supabase
        .from('organizations')
        .delete()
        .eq('id', orgId)
        .eq('is_demo', true); // belt-and-braces: NEVER delete a non-demo org.
      if (delRes.error) {
        throw new Error(`failed to delete organization ${orgId}: ${delRes.error.message}`);
      }
      purged.push(orgId);
    } catch (err) {
      console.error('[demo-org-purge] error purging org', orgId, err);
      // Continue with the next org rather than abort the whole batch.
    }
  }

  // ── Defensive alert: bulk-purge of >10 orgs in a single run ────────────────
  if (purged.length > 10) {
    const alerter = deps?.slackAlert ?? sendSlackGuardrailAlert;
    void alerter('cost', {
      severity: 'P2',
      title: `demo-org-purge: ${purged.length} orgs purged in a single run`,
      text:
        'A bulk purge of >10 demo orgs is unusual. Investigate: was there a demo-creation runaway? ' +
        'A misconfigured cron schedule? An accidental backfill of is_demo=true?',
      fields: [
        { title: 'purged_count', value: String(purged.length), short: true },
        { title: 'first_org_id', value: purged[0] ?? 'n/a', short: true },
      ],
    }).catch(() => {
      // Slack delivery is best-effort; the purge has already completed.
    });
  }

  return json(
    { purged_count: purged.length, purged_org_ids: purged, dry_run: false },
    200,
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
