/**
 * Branded HTML email template for clinic invitations (Phase 9 Plan 09-06 D-16).
 *
 * Copy verbatim from UI-SPEC §"Patient-side: Invitation email" lines 364-381.
 * WMHMDA footer carry-forward from Phase 7 transactional template.
 *
 * Design constraints:
 *   - Pure server-side string template — no React renderer (keeps Edge
 *     Function startup fast + bundle thin).
 *   - Inline CSS only (Gmail/Outlook/Apple Mail strip <style> blocks).
 *   - Org logo via public bucket URL when present; teal-700 monogram
 *     fallback when null.
 *   - All user-controlled strings (orgName, operatorFirstName, expiresAt
 *     formatted, inviteUrl) are HTML-escaped before interpolation. T-09-35
 *     mitigation: no open-redirect surface — inviteUrl is built server-side
 *     from a known origin + the freshly-minted token; never echoed back
 *     from a request body.
 */

export interface InviteEmailParams {
  orgName: string;
  orgLogoUrl: string | null;
  operatorFirstName: string;
  inviteUrl: string;
  expiresAt: string; // ISO timestamp
}

/** Minimal HTML escape — protect against operator-entered org names with `<`/`&`/`"`. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Use the first code point so emoji org names don't render as a `?`.
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}

function logoBlock(params: InviteEmailParams): string {
  const altOrg = escapeHtml(params.orgName);
  if (params.orgLogoUrl) {
    return `
      <tr>
        <td style="padding:24px 0 8px 0;text-align:center;">
          <img src="${escapeHtml(params.orgLogoUrl)}" alt="${altOrg}"
            width="72" height="72"
            style="display:inline-block;width:72px;height:72px;border-radius:16px;object-fit:cover;border:1px solid #e5e7eb;" />
        </td>
      </tr>`;
  }
  const initial = escapeHtml(firstInitial(params.orgName));
  return `
    <tr>
      <td style="padding:24px 0 8px 0;text-align:center;">
        <div style="display:inline-block;width:72px;height:72px;border-radius:16px;background:#0f766e;color:#ffffff;line-height:72px;font-size:32px;font-weight:700;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;">
          ${initial}
        </div>
      </td>
    </tr>`;
}

/** Plain-text fallback for clients that don't render HTML. */
export function renderInviteText(params: InviteEmailParams): string {
  return (
    `${params.orgName} invited you to share your LeanShot data.\n\n` +
    `${params.operatorFirstName} from ${params.orgName} sent you a private invitation. ` +
    `You decide what to share — and you can change or revoke access at any time.\n\n` +
    `Review the invitation here:\n${params.inviteUrl}\n\n` +
    `This invitation expires in 7 days. If you didn't expect this, you can safely ignore this email.\n\n` +
    `LeanShot keeps your AI coach conversations and account settings private. ` +
    `Only the data you choose is shared.\n\n` +
    `— The LeanShot team`
  );
}

export function renderInviteHtml(params: InviteEmailParams): string {
  const orgName = escapeHtml(params.orgName);
  const operatorFirstName = escapeHtml(params.operatorFirstName);
  const inviteUrl = escapeHtml(params.inviteUrl);

  // UI-SPEC line 369 ("preheader") — hidden preview text shown in inbox row.
  const preheader = `Choose what to share. You can revoke any time.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${orgName} invited you to share your LeanShot data</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f1;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0b1413;">
    <!-- preheader (hidden in body, surfaced in inbox preview) -->
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
      ${escapeHtml(preheader)}
    </div>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
      style="background:#f4f4f1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"
            width="560" style="max-width:560px;background:#ffffff;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
            <!-- Wordmark header -->
            <tr>
              <td style="padding:24px 24px 8px 24px;text-align:center;">
                <span style="font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#0f766e;">
                  LeanShot
                </span>
              </td>
            </tr>

            ${logoBlock(params)}

            <!-- Body heading -->
            <tr>
              <td style="padding:8px 32px 0 32px;text-align:center;">
                <h1 style="margin:0;font-size:22px;line-height:1.25;font-weight:700;color:#0b1413;">
                  ${orgName} invited you to share your data
                </h1>
              </td>
            </tr>

            <!-- Body intro -->
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <p style="margin:0;font-size:15px;line-height:1.5;color:#374151;">
                  ${operatorFirstName} from ${orgName} sent you a private invitation.
                  You decide what to share — and you can change or revoke access at any time.
                </p>
              </td>
            </tr>

            <!-- What happens next -->
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <h2 style="margin:0 0 8px 0;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;">
                  What happens next
                </h2>
                <p style="margin:0;font-size:14px;line-height:1.55;color:#374151;">
                  Click the button below to see what ${orgName} would like access to. You&rsquo;ll
                  review each data type and can uncheck anything you don&rsquo;t want to share
                  before accepting.
                </p>
              </td>
            </tr>

            <!-- Primary CTA -->
            <tr>
              <td style="padding:24px 32px 8px 32px;text-align:center;">
                <a href="${inviteUrl}"
                  style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:12px;">
                  Review invitation
                </a>
              </td>
            </tr>

            <!-- Raw URL fallback for buttons-blocked clients -->
            <tr>
              <td style="padding:8px 32px 24px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
                  Or paste this URL into your browser:<br/>
                  <span style="color:#374151;word-break:break-all;">${inviteUrl}</span>
                </p>
              </td>
            </tr>

            <!-- Expiry footer -->
            <tr>
              <td style="padding:0 32px 16px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;">
                  This invitation expires in 7 days. If you didn&rsquo;t expect this, you can
                  safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- WMHMDA-style privacy reminder (Phase 7 carry-forward) -->
            <tr>
              <td style="padding:0 32px 16px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6b7280;">
                  LeanShot keeps your AI coach conversations and account settings private.
                  Only the data you choose is shared.
                </p>
              </td>
            </tr>

            <!-- Signature -->
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
                  &mdash; The LeanShot team
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
