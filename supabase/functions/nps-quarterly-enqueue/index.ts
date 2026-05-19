/**
 * Phase 42 Plan 42-07 (POLISH-12) — Quarterly NPS enqueue Edge Function.
 *
 * Triggered by `pg_cron` at first-of-quarter UTC midnight (D-22).
 * Authentication: service-role Bearer from `vault.decrypted_secrets`.
 *
 * Flow per D-21 / D-23:
 *   1. Compute current quarter ('YYYY-QN' UTC).
 *   2. Identify eligible users — active in last 90 days (auth.users.last_sign_in_at)
 *      AND NOT EXISTS a quarterly_nps_responses row for current quarter.
 *   3. For each batch of up to 500: INSERT a nonce per user; sign 11 score-link
 *      URLs (0..10); send email via _shared/email-router.ts (non-PHI → Resend).
 *
 * Idempotency: re-running on the same quarter is safe — users that already have
 * a response row are filtered out, and the nonce ledger is per-user-per-quarter
 * (a re-run creates a fresh nonce; old nonces remain valid until used).
 *
 * Service-role bearer is required (cron sets it from vault). Other callers
 * get 401.
 */

// eslint-disable-next-line import-x/no-unresolved
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail } from '../_shared/email-router.ts';
import { currentQuarter } from '../_shared/nps-quarter.ts';
import { signQuarterlyNpsToken } from '../_shared/nps-token.ts';

const BATCH_SIZE = 500;
const DEFAULT_RESPOND_BASE =
  'https://ytnsipxxmzgaebkqmokp.functions.supabase.co/nps-quarterly-respond';

// Re-export for backward-compat / test consumers.
export { currentQuarter };

interface EnqueueResult {
  quarter: string;
  eligible_user_count: number;
  enqueued: number;
  skipped_already_responded: number;
  errors: number;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function isServiceRoleBearer(req: Request, serviceRoleKey: string): boolean {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const tok = auth.slice(7).trim();
  return tok === serviceRoleKey;
}

// ─── Eligibility query ────────────────────────────────────────────────────────

/**
 * Returns up to BATCH_SIZE user IDs (with email) that are eligible for the
 * quarterly NPS in `quarter`:
 *   - last_sign_in_at within the past 90 days (D-23)
 *   - no existing quarterly_nps_responses row for this quarter
 */
async function fetchEligibleBatch(
  admin: SupabaseClient,
  quarter: string,
  offset: number,
): Promise<Array<{ id: string; email: string }>> {
  // We query auth.users via the admin API. There's no PostgREST table for
  // auth.users; admin.listUsers paginates 1000 at a time and we filter
  // client-side (small daily volume — fine for v1.3).
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  const page = Math.floor(offset / 1000) + 1;
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const candidates = (data.users ?? [])
    .filter((u) => u.email && u.last_sign_in_at && u.last_sign_in_at >= ninetyDaysAgo)
    .slice(offset % 1000, (offset % 1000) + BATCH_SIZE)
    .map((u) => ({ id: u.id, email: u.email! }));

  if (candidates.length === 0) return [];

  // Exclude users who already have a response row for this quarter.
  const ids = candidates.map((c) => c.id);
  const { data: responded, error: respErr } = await admin
    .from('quarterly_nps_responses')
    .select('user_id')
    .eq('quarter', quarter)
    .in('user_id', ids);
  if (respErr) throw new Error(`quarterly_nps_responses select: ${respErr.message}`);
  const respondedSet = new Set((responded ?? []).map((r) => r.user_id as string));
  return candidates.filter((c) => !respondedSet.has(c.id));
}

// ─── Per-user enqueue ─────────────────────────────────────────────────────────

async function enqueueOne(
  admin: SupabaseClient,
  user: { id: string; email: string },
  quarter: string,
  respondBase: string,
): Promise<void> {
  // Each user gets a single nonce; the 11 score links share that nonce.
  // First-response-wins is enforced by the atomic UPDATE … SET used_at=now()
  // in the respond Fn (the score is part of the signed payload, so the
  // attacker can't replay with a different score either).
  const nonce = crypto.randomUUID();
  const { error: nonceErr } = await admin.from('quarterly_nps_nonces').insert({
    nonce,
    user_id: user.id,
    quarter,
  });
  if (nonceErr) throw new Error(`nonce insert: ${nonceErr.message}`);

  const links = Array.from({ length: 11 }, (_, score) => {
    const token = signQuarterlyNpsToken({ user_id: user.id, quarter, score, nonce });
    const url = `${respondBase}?score=${score}&token=${encodeURIComponent(token)}`;
    return { score, url };
  });

  const r = await sendEmail(admin, {
    template: 'nps_quarterly',
    to: user.email,
    vars: { quarter, score_links: links },
    phi: false,
  });
  if (r.skipped) {
    console.warn('[nps-quarterly-enqueue] send skipped:', r.id);
  }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      },
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: 'service_misconfigured' });
  }
  if (!isServiceRoleBearer(req, SERVICE_ROLE_KEY)) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const respondBase = Deno.env.get('NPS_RESPOND_BASE') ?? DEFAULT_RESPOND_BASE;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const quarter = currentQuarter();
  const result: EnqueueResult = {
    quarter,
    eligible_user_count: 0,
    enqueued: 0,
    skipped_already_responded: 0,
    errors: 0,
  };

  let offset = 0;
  // Hard cap on pages — 10 × 1000 users = 10k recipients per cron tick. That's
  // generous for v1.3; later we'll partition per-day.
  for (let i = 0; i < 10; i++) {
    let batch: Array<{ id: string; email: string }>;
    try {
      batch = await fetchEligibleBatch(admin, quarter, offset);
    } catch (e) {
      console.warn('[nps-quarterly-enqueue] fetchEligibleBatch failed:', (e as Error).message);
      result.errors += 1;
      break;
    }
    if (batch.length === 0) break;
    result.eligible_user_count += batch.length;

    for (const user of batch) {
      try {
        await enqueueOne(admin, user, quarter, respondBase);
        result.enqueued += 1;
      } catch (e) {
        result.errors += 1;
        console.warn(
          '[nps-quarterly-enqueue] enqueueOne failed for user',
          user.id.slice(0, 8),
          ':',
          (e as Error).message,
        );
      }
    }
    offset += 1000;
  }

  return jsonResponse(200, result);
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
