/**
 * Resend HTTPS dispatch helper for the `lead-capture` Edge Function (Phase
 * 15 Plan 15-07 D-12).
 *
 * Design constraints:
 *   - NO SDK — direct HTTPS POST to `https://api.resend.com/emails`. Keeps
 *     the function bundle thin and the supply-chain surface minimal.
 *   - `RESEND_API_KEY` is sourced from `Deno.env.get('RESEND_API_KEY')` —
 *     server-only, NEVER reaches the browser.
 *   - CI stub: when `RESEND_API_KEY === 'test-stub'`, return
 *     `{ ok: true, stubbed: true }` without making an HTTPS call. The
 *     e2e/Deno suite cannot burn through the free tier.
 *   - When `LEAD_NOTIFY_TO` is absent the helper SKIPS the dispatch entirely
 *     and returns `{ ok: true, stubbed: true }` — notification is optional
 *     per D-12 ("optional Resend notification").
 *   - When `RESEND_API_KEY` is absent (and we have a `LEAD_NOTIFY_TO`) we
 *     return `{ ok: false, error: 'no_api_key' }` — the caller still 200s
 *     the visitor (Resend failure MUST NOT block the submit response).
 *   - T-15-LF-04: visitor `leadEmail` / `leadName` / `pageSlug` are escaped
 *     before interpolation into the staff notification HTML. The
 *     `escapeHtml` helper here mirrors `template-clinic-invite.ts`'s
 *     implementation (the canonical project pattern; see also
 *     `page-render/render.ts`).
 *   - Non-2xx responses wrap as stable `resend_<status>` codes — we NEVER
 *     echo `res.text()`.
 */

const FROM = Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';

export interface SendLeadNotificationParams {
  to: string;
  leadEmail: string;
  leadName?: string;
  pageSlug?: string;
}

export interface SendLeadNotificationResult {
  ok: boolean;
  error?: string;
  stubbed?: boolean;
}

/**
 * HTML-escape `& < > " '` — mirrors the project canonical helper. Inlined
 * here so the lead-capture function module graph stays self-contained
 * (no shared module imports across `supabase/functions/` boundaries).
 */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendLeadNotification(
  params: SendLeadNotificationParams,
): Promise<SendLeadNotificationResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const notifyTo = Deno.env.get('LEAD_NOTIFY_TO') ?? '';

  // Optional notification (D-12). When no recipient is configured, this is
  // a no-op success — the leads row is still written by the caller.
  if (!notifyTo) {
    return { ok: true, stubbed: true };
  }

  if (!apiKey) {
    // Misconfigured: notification recipient set but no API key. Surface as a
    // stable error code; the caller logs + still 200s the visitor.
    return { ok: false, error: 'no_api_key' };
  }

  // CI stub — bypass actual HTTPS dispatch.
  if (apiKey === 'test-stub') {
    return { ok: true, stubbed: true };
  }

  const leadEmail = escapeHtml(params.leadEmail);
  const leadName = params.leadName ? escapeHtml(params.leadName) : '';
  const pageSlug = params.pageSlug ? escapeHtml(params.pageSlug) : '';

  const subject = `New lead${pageSlug ? ` on /${pageSlug}` : ''}`;
  const html =
    `<div style="font-family:Geist,system-ui,sans-serif;font-size:16px;line-height:1.55;">` +
    `<h2 style="margin:0 0 16px 0;">New lead captured</h2>` +
    `<p style="margin:0 0 8px 0;"><strong>Email:</strong> ${leadEmail}</p>` +
    (leadName ? `<p style="margin:0 0 8px 0;"><strong>Name:</strong> ${leadName}</p>` : '') +
    (pageSlug
      ? `<p style="margin:0 0 8px 0;"><strong>Page:</strong> /${pageSlug}</p>`
      : '') +
    `<p style="margin:16px 0 0 0;color:#6b7280;font-size:14px;">Sent by the LeanShot lead-capture function.</p>` +
    `</div>`;
  const text =
    `New lead captured\n\n` +
    `Email: ${params.leadEmail}\n` +
    (params.leadName ? `Name: ${params.leadName}\n` : '') +
    (params.pageSlug ? `Page: /${params.pageSlug}\n` : '');

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
        to: notifyTo,
        subject,
        html,
        text,
      }),
    });
  } catch (e) {
    // Never echo the exception's message — may contain Auth header
    // fragments in network-layer errors. Log a stable string.
    console.error('[lead-capture] resend fetch threw', e instanceof Error ? e.name : 'unknown');
    return { ok: false, error: 'resend_network' };
  }

  if (!res.ok) {
    // Never echo res.text() — wrap as a stable code only (T-15-LF-04).
    console.error(`[lead-capture] resend non-2xx: ${res.status}`);
    if (res.status === 429) return { ok: false, error: 'resend_429' };
    return { ok: false, error: `resend_${res.status}` };
  }
  // Drain the body so the connection can be pooled.
  try {
    await res.text();
  } catch {
    /* best-effort */
  }
  return { ok: true };
}
