/**
 * Resend HTTPS dispatch helper for the `clinic-invite` Edge Function
 * (Phase 9 Plan 09-06 D-16).
 *
 * Design constraints:
 *   - NO SDK — direct HTTPS POST to `https://api.resend.com/emails`. Keeps
 *     the function bundle thin and the supply-chain surface minimal.
 *   - `RESEND_API_KEY` is sourced from `Deno.env.get('RESEND_API_KEY')` —
 *     server-only, NEVER reaches the browser (verified by Plan 09-06
 *     verification step `grep -rn "RESEND_API_KEY" src/`).
 *   - CI stub: when `RESEND_API_KEY === 'test-stub'`, return `{ok: true}`
 *     without making an HTTPS call. Pitfall #7 mitigation — the e2e suite
 *     cannot burn through the 100/day free tier.
 *   - T-09-34 (key leak): the Authorization header is set per request from
 *     `Deno.env`; the key is never logged. T-09-37 (Resend response leak):
 *     non-2xx responses wrap as `{ok:false, error:'resend_<status>'}` —
 *     we NEVER echo `res.text()` (which can contain dispatch metadata).
 *
 * The caller is `index.ts handleSend`; failure here MUST NOT block the
 * /send response (we still return a universal 200 to the operator —
 * email-provider hiccups are out-of-band from the invite-creation
 * contract). See `index.ts` `handleSend` step 7 for the audit_log row.
 */
import { renderInviteHtml, renderInviteText, type InviteEmailParams } from './template-clinic-invite.ts';

const FROM = Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';

export interface SendInviteEmailResult {
  ok: boolean;
  error?: string;
  /** When the CI stub fires, set so tests can assert dispatch was skipped. */
  stubbed?: boolean;
}

export async function sendInviteEmail(
  params: InviteEmailParams & { to: string; subjectOverride?: string; textOverride?: string },
): Promise<SendInviteEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    // Missing key in production = misconfigured Supabase secret. Surface
    // it as a stable error code so the caller can log + still 200 the
    // operator. We never echo the missing-key state to the operator.
    return { ok: false, error: 'no_api_key' };
  }
  // Pitfall #7 CI stub — bypass actual HTTPS dispatch.
  if (apiKey === 'test-stub') {
    return { ok: true, stubbed: true };
  }

  // Phase 32 plan 32-05 (I18N-04): caller (clinic-invite/index.ts handleSend)
  // may pass a locale-rendered subject + plain-text alt computed via
  // _shared/i18n-server.ts. Default to the legacy EN strings when absent
  // (callers outside the i18n wiring path still work).
  const subject = params.subjectOverride ?? `${params.orgName} invited you to share your LeanShot data`;
  const html = renderInviteHtml(params);
  const text = params.textOverride ?? renderInviteText(params);

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: params.to,
        subject,
        html,
        text,
      }),
    });
  } catch (e) {
    // T-09-34: never echo the exception's message — it may contain the
    // Authorization header in network-layer errors. Log a stable string.
    console.error('[clinic-invite] resend fetch threw', e instanceof Error ? e.name : 'unknown');
    return { ok: false, error: 'resend_network' };
  }

  if (!res.ok) {
    // T-09-37: never echo `res.text()` — wrap as a stable code only.
    console.error(`[clinic-invite] resend non-2xx: ${res.status}`);
    if (res.status === 429) return { ok: false, error: 'resend_429' };
    return { ok: false, error: `resend_${res.status}` };
  }
  // Drain the body so the connection can be pooled. Don't parse or log it.
  try {
    await res.text();
  } catch {
    /* best-effort */
  }
  return { ok: true };
}
