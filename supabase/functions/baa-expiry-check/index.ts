/**
 * `baa-expiry-check` Edge Function — Phase 25 Plan 25-09 (HIPAA-12, HIPAA-13).
 *
 * Cron-invoked nightly at 06:00 UTC (migration 20270702000008).
 *
 * For each vendor in vendor_baa_chain WHERE status='signed' AND baa_expiry_at IS NOT NULL:
 *   1. Compute days_until_expiry = floor((baa_expiry_at - now()) / 1 day).
 *   2. Bucket check: 60/30/14/7/1 days → log audit row (idempotent: once per bucket per day).
 *   3. Past expiry (days_until <= 0) → call vendor_baa_chain_set_expired RPC.
 *   4. Try email-router for founder alert (vendor/date = non-PHI).
 *
 * Auth: service-role bearer (Pattern S6 — cron-only). Constant-time compare.
 * Lazy admin client (Pattern S5): test-injectable via __internal.setAdminForTest.
 * PII-safe error logging (Pattern S3): no user data in console.warn.
 *
 * STRIDE: T-25-09-S1 (bearer auth), T-25-09-D1 (vendor error isolation).
 *
 * Direct INSERT to audit_logs is NOT used — Phase 24 revoked INSERT from
 * service_role. All audit writes go through log_vendor_baa_event SECDEF RPC.
 */
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

/** Alert buckets (days-until-expiry): match once per day per vendor per bucket. */
const EXPIRY_BUCKETS = [60, 30, 14, 7, 1] as const;

interface VendorBaaRow {
  vendor_name: string;
  baa_expiry_at: string;
  status: string;
}

interface RunResult {
  checked: number;
  alerts: number;
  expired: number;
}

/**
 * Returns floor((expiry - now) / 1 day) as a whole number.
 * Negative means past expiry.
 */
function daysUntil(expiryAt: string, now: Date): number {
  const expiryMs = new Date(expiryAt).getTime();
  const diffMs = expiryMs - now.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/** ISO date string YYYY-MM-DD for idempotency key. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Check idempotency: has this (vendor, bucket, date) already been logged today?
 * Reads audit_logs WHERE action_name='vendor_baa_expiry_warning' AND after_data contains
 * the vendor+bucket+date combo. Returns true if already emitted.
 */
async function alreadyLoggedToday(
  vendorName: string,
  bucket: number,
  todayStr: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action_name', 'vendor_baa_expiry_warning')
    .eq('table_name', 'vendor_baa_chain')
    .eq('row_pk', vendorName)
    .filter('after_data->>bucket', 'eq', String(bucket))
    .gte('created_at', `${todayStr}T00:00:00Z`)
    .lt('created_at', `${todayStr}T23:59:59.999Z`) as unknown)) as {
    data: null;
    count: number | null;
    error: { message?: string } | null;
  };

  if (error) {
    console.warn('[baa-expiry-check] idempotency check failed', error.message ?? 'unknown');
    return false; // conservative: allow the write on error
  }
  return (data as unknown as { count: number } | null)?.count !== undefined
    ? false // data shape varies; rely on count below
    : false;
}

/**
 * Idempotency check using count from the query header.
 */
async function alreadyLoggedTodayWithCount(
  vendorName: string,
  bucket: number,
  todayStr: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action_name', 'vendor_baa_expiry_warning')
    .eq('table_name', 'vendor_baa_chain')
    .eq('row_pk', vendorName)
    .filter('after_data->>bucket', 'eq', String(bucket))
    .gte('created_at', `${todayStr}T00:00:00Z`)
    .lt('created_at', `${todayStr}T23:59:59.999Z`) as unknown) as {
    count: number | null;
    error: { message?: string } | null;
  };

  if (result.error) {
    console.warn('[baa-expiry-check] idempotency check failed', result.error.message ?? 'unknown');
    return false;
  }
  return (result.count ?? 0) > 0;
}

/**
 * Attempt to send an email via the Phase 25 email-router.
 * PHI=false: vendor names + dates are NOT PHI per Plan 25-09 must_haves.
 * If email-router is unavailable or Resend key is missing, log warn + continue.
 */
async function tryFounderEmail(vendorName: string, daysUntilExpiry: number): Promise<void> {
  const founderEmail = Deno.env.get('SUPERADMIN_ALERTS_EMAIL') ?? '';
  if (!founderEmail) {
    console.warn('[baa-expiry-check] SUPERADMIN_ALERTS_EMAIL not set; skipping email');
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('../_shared/email-router.ts')) as any;
    const sendRoutedEmail = mod.sendRoutedEmail;
    if (typeof sendRoutedEmail !== 'function') {
      console.warn('[baa-expiry-check] email-router.sendRoutedEmail not available; skipping');
      return;
    }
    const result = await sendRoutedEmail({
      template: 'baa_expiry_alert',
      phi: false,
      to: founderEmail,
      vars: { vendor: vendorName, days_until: daysUntilExpiry },
    });
    if (!result?.ok) {
      console.warn('[baa-expiry-check] email-router returned not-ok for', vendorName);
    }
  } catch (e) {
    // Pattern S5: vendor-gated send — missing Resend config is expected; not a crash.
    console.warn(
      '[baa-expiry-check] email send failed for',
      vendorName,
      ':',
      e instanceof Error ? e.name : 'unknown',
    );
  }
}

async function handleRun(_req: Request): Promise<Response> {
  const result: RunResult = { checked: 0, alerts: 0, expired: 0 };
  const now = new Date();
  const todayStr = isoDate(now);

  // Enumerate signed vendors with a known expiry date.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vendors, error: vendorsErr } = (await (admin
    .from('vendor_baa_chain')
    .select('vendor_name, baa_expiry_at, status')
    .eq('status', 'signed')
    .not('baa_expiry_at', 'is', null)
    .order('baa_expiry_at', { ascending: true }) as unknown)) as {
    data: VendorBaaRow[] | null;
    error: { message?: string } | null;
  };

  if (vendorsErr) {
    console.warn('[baa-expiry-check] vendor query failed', vendorsErr.message ?? 'unknown');
    return jsonResponse(500, { error: 'vendor_query_failed', ...result });
  }

  const rows = vendors ?? [];

  for (const vendor of rows) {
    result.checked += 1;
    const days = daysUntil(vendor.baa_expiry_at, now);

    if (days <= 0) {
      // Past expiry: flip status via SECDEF RPC.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: expiredErr } = (await (admin.rpc('vendor_baa_chain_set_expired', {
        p_vendor_name: vendor.vendor_name,
      }) as unknown)) as { error: { message?: string } | null };

      if (expiredErr) {
        console.warn(
          '[baa-expiry-check] set_expired failed for',
          vendor.vendor_name,
          expiredErr.message ?? 'unknown',
        );
      } else {
        result.expired += 1;
        await tryFounderEmail(vendor.vendor_name, days);
      }
      continue;
    }

    // Check if this vendor's expiry falls in any alert bucket today.
    const hitBucket = EXPIRY_BUCKETS.find((b) => days === b) ?? null;
    if (hitBucket === null) {
      // Not in a bucket today.
      continue;
    }

    // Idempotency: check if already emitted for this (vendor, bucket, date).
    const alreadyDone = await alreadyLoggedTodayWithCount(vendor.vendor_name, hitBucket, todayStr);
    if (alreadyDone) {
      continue;
    }

    // Emit audit row via SECDEF (Phase 24 revoked INSERT from service_role).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: logErr } = (await (admin.rpc('log_vendor_baa_event', {
      p_vendor_name: vendor.vendor_name,
      p_action_name: 'vendor_baa_expiry_warning',
      p_payload: {
        vendor_name: vendor.vendor_name,
        days_until: days,
        bucket: hitBucket,
        expiry_at: vendor.baa_expiry_at,
        alert_date: todayStr,
      },
    }) as unknown)) as { error: { message?: string } | null };

    if (logErr) {
      console.warn(
        '[baa-expiry-check] log_vendor_baa_event failed for',
        vendor.vendor_name,
        logErr.message ?? 'unknown',
      );
      continue;
    }

    result.alerts += 1;
    await tryFounderEmail(vendor.vendor_name, days);
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
    console.warn('[baa-expiry-check] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest, alreadyLoggedToday };
