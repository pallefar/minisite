/**
 * AWS SES vendor-gated health check — Phase 25 Plan 25-03 (HIPAA-05, Pattern S4).
 *
 * Mirrors `resend-domain-health-check.ts` pattern exactly.
 *
 * Contract per Pattern S4:
 *   - Read `AWS_SES_ACCESS_KEY_ID` + `AWS_SES_SECRET_ACCESS_KEY` lazily.
 *   - If either missing → return `{ok:false, status:'no_credentials'}` (no fetch).
 *   - If `AWS_SES_BAA_ACTIVE` env != '1' → return `{ok:false, status:'baa_pending'}`.
 *     This is the primary vendor gate: PHI sends are silently no-op until the
 *     founder signs the AWS Artifact BAA AND sets this flag. Zero code changes
 *     required at cutover.
 *   - If `AWS_SES_ACCESS_KEY_ID === 'test-stub'` → return `{ok:true, status:'verified'}`.
 *     (RESEARCH Pitfall 7 avoidance: prevents live AWS calls from Deno test suite.)
 *   - Otherwise probe `SESv2 GetAccount` to verify credentials + quota status.
 *   - On any throw: log e.name only (T-25-03-S3 — never echo e.message which may
 *     contain Authorization header fragments); return `{ok:false, status:'fetch_error'}`.
 *
 * Vendor-gate behavior:
 *   When health check returns `{ok:false}`, the caller (email-router) MUST return
 *   a skipped no-op result — it MUST NOT fall back to Resend (T-25-03-S4 anti-pattern:
 *   silent Resend fallback would send PHI outside the BAA boundary).
 *
 * PII safety (T-25-03-I2): NEVER log e.message — AWS SDK network errors can contain
 * the full Authorization header value.
 */

import { GetAccountCommand, SESv2Client } from 'npm:@aws-sdk/client-sesv2@^3.700.0';

export interface AwsSesHealth {
  ok: boolean;
  status: 'verified' | 'no_credentials' | 'baa_pending' | 'fetch_error' | 'http_error';
}

export async function awsSesHealthCheck(): Promise<AwsSesHealth> {
  const ak = Deno.env.get('AWS_SES_ACCESS_KEY_ID');
  const sk = Deno.env.get('AWS_SES_SECRET_ACCESS_KEY');

  // No credentials → gate immediately (no fetch, no counter).
  if (!ak || !sk) {
    return { ok: false, status: 'no_credentials' };
  }

  // BAA not yet signed → vendor gate (Pattern S4 primary gate).
  if (Deno.env.get('AWS_SES_BAA_ACTIVE') !== '1') {
    return { ok: false, status: 'baa_pending' };
  }

  // Test stub shortcut — Deno test suite avoids live AWS calls (RESEARCH Pitfall 7).
  if (ak === 'test-stub') {
    return { ok: true, status: 'verified' };
  }

  // Live probe: SESv2 GetAccount is the cheapest "are we up" API call.
  try {
    const client = new SESv2Client({
      region: Deno.env.get('AWS_SES_REGION') ?? 'us-east-1',
      credentials: {
        accessKeyId: ak,
        secretAccessKey: sk,
      },
    });
    await client.send(new GetAccountCommand({}));
    return { ok: true, status: 'verified' };
  } catch (e) {
    // T-25-03-I2: NEVER echo e.message — may contain Authorization header value.
    console.warn(
      '[email-router/ses-health] probe threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false, status: 'fetch_error' };
  }
}
