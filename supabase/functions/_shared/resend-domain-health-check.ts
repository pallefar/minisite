/**
 * Resend domain gated-send health check — Phase 22 plan 22-02 (D-03).
 *
 * Source: `.planning/phases/22-…/22-RESEARCH.md` §Pattern 2 lines 412-443,
 * `reference_vendor_gated_send_health_check.md` (project memory).
 *
 * Contract per D-03:
 *   - Read `Deno.env.get('RESEND_API_KEY')`.
 *   - If unset → return `{ok:false, status:'no_api_key'}` (no fetch, no counter).
 *   - If equals 'test-stub' → return `{ok:true, status:'verified'}` (Pitfall 6 —
 *     Resend free-tier 2/hour rate-limit kills lifecycle tests).
 *   - Otherwise fetch GET `https://api.resend.com/domains` with bearer.
 *   - Look up domain `app.leanshot.app` in the response array.
 *   - If found AND status === 'verified' → return `{ok:true, status:'verified'}`.
 *   - Else → `supabase.rpc('increment_resend_domain_unverified_skips')` +
 *     `console.warn(...)` + return `{ok:false, status: domain?.status ?? 'not_found'}`.
 *
 * PII safety (T-22-13): NEVER echo `res.text()` or exception messages. The
 * Resend response body can contain dispatch metadata; the Authorization
 * header value MUST NOT reach logs. Mirrors `clinic-invite/resend.ts` lines
 * 70-89 pattern (T-09-34/37).
 *
 * Cutover when DNS verifies: zero code changes — next invocation returns
 * `{ok:true}` and the lifecycle Edge Function proceeds to send.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const RESEND_DOMAIN = 'app.leanshot.app';

export interface ResendDomainHealth {
  ok: boolean;
  status: string;
}

// Resend `GET /domains` response shape — narrow to what we need.
interface ResendDomainListResponse {
  data?: Array<{ name?: string; status?: string }>;
}

export async function resendDomainHealthCheck(
  supabase: SupabaseClient,
): Promise<ResendDomainHealth> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return { ok: false, status: 'no_api_key' };
  }
  // Pitfall 6 — CI / Deno test stub. Skip the HTTPS call entirely.
  if (apiKey === 'test-stub') {
    return { ok: true, status: 'verified' };
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
  } catch (e) {
    // T-22-13: NEVER echo the exception message (it may contain the
    // Authorization header value in network-layer errors).
    console.warn(
      '[lifecycle/health] resend fetch threw',
      e instanceof Error ? e.name : 'unknown',
    );
    await incrementSkipCounter(supabase);
    return { ok: false, status: 'fetch_error' };
  }

  if (!res.ok) {
    // T-22-13: don't echo body — just stable code.
    const status = `resend_${res.status}`;
    console.warn(`[lifecycle/health] resend non-2xx: ${res.status}`);
    try {
      await res.text();
    } catch {
      /* best-effort drain */
    }
    await incrementSkipCounter(supabase);
    return { ok: false, status };
  }

  let payload: ResendDomainListResponse;
  try {
    payload = (await res.json()) as ResendDomainListResponse;
  } catch {
    console.warn('[lifecycle/health] resend body not JSON');
    await incrementSkipCounter(supabase);
    return { ok: false, status: 'bad_response' };
  }

  const domain = (payload.data ?? []).find((d) => d?.name === RESEND_DOMAIN);
  const status = domain?.status ?? 'not_found';
  const verified = status === 'verified';

  if (!verified) {
    // D-03: counter + Sentry-friendly breadcrumb via stable warn line.
    console.warn(
      `[lifecycle/health] Resend domain ${RESEND_DOMAIN} status=${status} — skipping send`,
    );
    await incrementSkipCounter(supabase);
  }
  return { ok: verified, status };
}

async function incrementSkipCounter(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase.rpc('increment_resend_domain_unverified_skips');
  } catch (e) {
    // Counter failure is non-fatal — log a stable string only.
    console.warn(
      '[lifecycle/health] increment counter failed',
      e instanceof Error ? e.name : 'unknown',
    );
  }
}
