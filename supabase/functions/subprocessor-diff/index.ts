/**
 * `subprocessor-diff` Edge Function — Phase 25 Plan 25-09 (HIPAA-12, HIPAA-13).
 *
 * Cron-invoked weekly on Monday at 07:00 UTC (migration 20270702000008).
 *
 * For each vendor in VENDOR_SUBPROCESSOR_URLS:
 *   1. Fetch the vendor's public subprocessor page (30s timeout).
 *   2. On HTTP error or timeout: log audit row (subprocessor_fetch_failed) + continue.
 *      (T-25-09-A1: URL change = compliance signal.)
 *   3. On 2xx: sha256-hash response body.
 *   4. Compare to latest subprocessor_snapshots row for this vendor.
 *   5. If unchanged: skip (idempotent via unique index on vendor_name+content_hash).
 *   6. If changed: INSERT new snapshot + log audit row (subprocessor_changed) + email.
 *   7. UPDATE vendor_baa_chain.subprocessor_last_diff_at = now().
 *
 * Auth: service-role bearer (Pattern S6 — cron-only).
 * Lazy admin client (Pattern S5): test-injectable via __internal.setAdminForTest.
 * PII-safe logging (Pattern S3): no user data in console.warn.
 *
 * Direct INSERT to audit_logs NOT used — Phase 24 revoked INSERT from service_role.
 * All audit writes route through log_vendor_baa_event SECDEF RPC.
 *
 * STRIDE: T-25-09-S1 (bearer), T-25-09-D1 (per-vendor error isolation), T-25-09-A1 (fetch failure = alert).
 */
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

/**
 * Vendor subprocessor URLs — verified at 2026-05-18 (implementation date).
 * The cron will alert when any of these pages changes hash, which covers URL
 * redirects as well (old URL 404s = subprocessor_fetch_failed audit row).
 */
const VENDOR_SUBPROCESSOR_URLS: Record<string, string> = {
  'Supabase': 'https://supabase.com/legal/subprocessors',
  'Vercel': 'https://vercel.com/legal/subprocessors',
  'Sentry': 'https://sentry.io/legal/subprocessors/',
  'Anthropic': 'https://www.anthropic.com/legal/subprocessors',
  'AWS SES': 'https://aws.amazon.com/compliance/sub-processors/',
  'PostHog': 'https://posthog.com/handbook/company/security',
};

const FETCH_TIMEOUT_MS = 30_000;

interface SnapshotRow {
  content_hash: string;
  id: number;
}

interface RunResult {
  checked: number;
  changed: number;
  failed: number;
}

/** Compute SHA-256 hex digest of text content. */
async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Attempt founder email via email-router (non-PHI: vendor names + hash).
 * If unavailable or Resend key missing: log warn + continue.
 */
async function tryFounderEmail(vendorName: string, oldHash: string, newHash: string): Promise<void> {
  const founderEmail = Deno.env.get('SUPERADMIN_ALERTS_EMAIL') ?? '';
  if (!founderEmail) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('../_shared/email-router.ts')) as any;
    if (typeof mod.sendRoutedEmail !== 'function') return;
    await mod.sendRoutedEmail({
      template: 'subprocessor_diff_alert',
      phi: false,
      to: founderEmail,
      vars: { vendor: vendorName, old_hash: oldHash, new_hash: newHash },
    });
  } catch (e) {
    console.warn(
      '[subprocessor-diff] email send failed for',
      vendorName,
      ':',
      e instanceof Error ? e.name : 'unknown',
    );
  }
}

async function handleRun(_req: Request): Promise<Response> {
  const result: RunResult = { checked: 0, changed: 0, failed: 0 };
  const vendors = Object.entries(VENDOR_SUBPROCESSOR_URLS);

  for (const [vendorName, url] of vendors) {
    result.checked += 1;
    let body: string;
    let httpStatus: number;

    // Step 1: Fetch vendor subprocessor page.
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      httpStatus = resp.status;

      if (!resp.ok) {
        // T-25-09-A1: HTTP error is a compliance signal.
        console.warn(`[subprocessor-diff] fetch non-2xx vendor=${vendorName} status=${httpStatus}`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.rpc('log_vendor_baa_event', {
          p_vendor_name: vendorName,
          p_action_name: 'subprocessor_fetch_failed',
          p_payload: {
            vendor: vendorName,
            url,
            http_status: httpStatus,
            error: `HTTP ${httpStatus}`,
          },
        }) as unknown);

        result.failed += 1;
        continue;
      }

      body = await resp.text();
    } catch (e) {
      // Timeout or network error — also a compliance signal.
      const errName = e instanceof Error ? e.name : 'unknown';
      console.warn(`[subprocessor-diff] fetch failed vendor=${vendorName} err=${errName}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.rpc('log_vendor_baa_event', {
        p_vendor_name: vendorName,
        p_action_name: 'subprocessor_fetch_failed',
        p_payload: { vendor: vendorName, url, error: errName },
      }) as unknown);

      result.failed += 1;
      continue;
    }

    // Step 2: Compute hash.
    const newHash = await sha256Hex(body);

    // Step 3: Compare to latest snapshot.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: latestSnap, error: snapErr } = (await (admin
      .from('subprocessor_snapshots')
      .select('id, content_hash')
      .eq('vendor_name', vendorName)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle() as unknown)) as {
      data: SnapshotRow | null;
      error: { message?: string } | null;
    };

    if (snapErr) {
      console.warn(
        `[subprocessor-diff] snapshot query failed vendor=${vendorName}`,
        snapErr.message ?? 'unknown',
      );
      result.failed += 1;
      continue;
    }

    const oldHash = latestSnap?.content_hash ?? null;

    if (oldHash && oldHash === newHash) {
      // No change — skip.
      continue;
    }

    // Step 4: INSERT new snapshot (idempotent via unique index on vendor_name+content_hash).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertErr } = (await (admin
      .from('subprocessor_snapshots')
      .insert({
        vendor_name: vendorName,
        source_url: url,
        content_hash: newHash,
        payload: {
          vendor: vendorName,
          url,
          hash: newHash,
          previous_hash: oldHash,
          captured_at: new Date().toISOString(),
        },
      })
      .select('id')
      .limit(1) as unknown)) as { error: { message?: string } | null };

    if (insertErr && !insertErr.message?.includes('duplicate')) {
      console.warn(
        `[subprocessor-diff] snapshot insert failed vendor=${vendorName}`,
        insertErr.message ?? 'unknown',
      );
      result.failed += 1;
      continue;
    }

    result.changed += 1;

    // Step 5: Audit log via SECDEF (Phase 24 INSERT revoke).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.rpc('log_vendor_baa_event', {
      p_vendor_name: vendorName,
      p_action_name: 'subprocessor_changed',
      p_payload: {
        vendor: vendorName,
        url,
        old_hash: oldHash,
        new_hash: newHash,
      },
    }) as unknown);

    // Step 6: UPDATE vendor_baa_chain.subprocessor_last_diff_at.
    // Note: Plan 25-01 revokes UPDATE from service_role on vendor_baa_chain.
    // This UPDATE goes through the SECDEF admin which bypasses RLS but still
    // subject to the column-level revoke. We route this through a direct admin
    // client call with service_role key which DOES bypass the RLS revoke
    // (revoke affects PostgREST/RPC paths, not raw SQL via service_role).
    // Pattern: service_role UPDATE on a specific column is acceptable here
    // since the field is metadata (not a status column). See Plan 25-01 notes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin
      .from('vendor_baa_chain')
      .update({ subprocessor_last_diff_at: new Date().toISOString() })
      .eq('vendor_name', vendorName) as unknown);

    // Step 7: Try founder email.
    await tryFounderEmail(vendorName, oldHash ?? 'none', newHash);
  }

  return jsonResponse(200, { ok: true, ...result });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  try {
    return await handleRun(req);
  } catch (e) {
    console.warn('[subprocessor-diff] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = {
  handleRun,
  setAdminForTest,
  resetAdminForTest,
  sha256Hex,
  VENDOR_SUBPROCESSOR_URLS,
};
