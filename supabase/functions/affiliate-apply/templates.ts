/**
 * Branded HTML + plain-text email templates for the affiliate-apply
 * "Application received" email (Phase 19 Plan 19-05).
 *
 * Copy verbatim from UI-SPEC §"Resend transactional emails" row 1:
 *   Subject: "LeanShot affiliate application received"
 *   Opening: "Thanks for applying to the LeanShot affiliate program.
 *            We'll review within 3-5 business days and email you with
 *            next steps."
 *
 * Design constraints (clones `clinic-invite/template-clinic-invite.ts`):
 *   - Pure server-side string template — no React renderer.
 *   - Inline CSS only (Gmail/Outlook/Apple Mail strip <style> blocks).
 *   - Phase 13 v2 brand colours hardcoded as hex — email clients don't
 *     read CSS custom properties so the `@theme` token values from
 *     `src/index.css` are copied here verbatim (cream `#f2ede0`,
 *     teal-700 `#1b4842`, near-black text `#0b1413`, grey-secondary
 *     `#374151`, grey-tertiary `#6b7280`, hairline `#e5e7eb`).
 *   - All user-controlled strings are HTML-escaped before interpolation
 *     (T-19-05-T XSS mitigation: name comes from untrusted form body).
 */

export interface ApplicationReceivedParams {
  /** Applicant display name from the form (V-T sanitized via escapeHtml). */
  name: string;
}

/** Minimal HTML escape — protect against applicant-entered names with `<`/`&`/`"`. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text fallback for clients that don't render HTML. */
export function renderApplicationReceivedText(params: ApplicationReceivedParams): string {
  const name = params.name.trim() || 'there';
  return (
    `Hi ${name},\n\n` +
    `Thanks for applying to the LeanShot affiliate program. We'll review within ` +
    `3-5 business days and email you with next steps.\n\n` +
    `Reply to this email if you have questions.\n\n` +
    `— Team LeanShot`
  );
}

export function renderApplicationReceived(params: ApplicationReceivedParams): string {
  const name = escapeHtml(params.name.trim() || 'there');
  // Hidden preview text shown in inbox row.
  const preheader = `We'll review your application within 3-5 business days.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>LeanShot affiliate application received</title>
  </head>
  <body style="margin:0;padding:0;background:#f2ede0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0b1413;">
    <!-- preheader (hidden in body, surfaced in inbox preview) -->
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
      ${escapeHtml(preheader)}
    </div>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
      style="background:#f2ede0;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"
            width="560" style="max-width:560px;background:#fefcf7;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
            <!-- Wordmark header -->
            <tr>
              <td style="padding:24px 24px 8px 24px;text-align:center;">
                <span style="font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#1b4842;font-family:Georgia,'Times New Roman',serif;">
                  LeanShot
                </span>
              </td>
            </tr>

            <!-- Heading -->
            <tr>
              <td style="padding:16px 32px 0 32px;text-align:center;">
                <h1 style="margin:0;font-size:22px;line-height:1.25;font-weight:700;color:#0b1413;font-family:Georgia,'Times New Roman',serif;">
                  Application received
                </h1>
              </td>
            </tr>

            <!-- Body intro -->
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <p style="margin:0;font-size:15px;line-height:1.55;color:#374151;">
                  Hi ${name},
                </p>
                <p style="margin:12px 0 0 0;font-size:15px;line-height:1.55;color:#374151;">
                  Thanks for applying to the LeanShot affiliate program. We&rsquo;ll
                  review within 3-5 business days and email you with next steps.
                </p>
              </td>
            </tr>

            <!-- What happens next -->
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <h2 style="margin:0 0 8px 0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;">
                  What happens next
                </h2>
                <p style="margin:0;font-size:14px;line-height:1.55;color:#374151;">
                  Our team will read every word of your application. If you&rsquo;re
                  approved, you&rsquo;ll get a follow-up email with your referral link
                  and tax onboarding details.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:24px 32px 8px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6b7280;">
                  Reply to this email if you have questions.
                </p>
              </td>
            </tr>

            <!-- Signature -->
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
                  &mdash; Team LeanShot
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
