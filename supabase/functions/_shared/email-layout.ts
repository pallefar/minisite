/**
 * Shared inline-style HTML email layout — Phase 22 plan 22-02 (ON-02).
 *
 * Per `22-UI-SPEC.md` §Email Templates lines 419-425 + Pitfall 8
 * (Gmail strips `<style>` blocks → inline-only).
 *
 * Token → inline-CSS mapping per UI-SPEC table lines 402-417:
 *   --color-bg          → #F2EDE0  (body bg)
 *   --color-surface     → #FEFCF7  (card bg)
 *   --color-primary     → #1B4842  (CTA bg + link color)
 *   --color-primary-fg  → #FFFFFF  (CTA text)
 *   --color-text        → #0B1413
 *   --color-text-sec    → #5B6764
 *   --color-border      → #E0DAC8
 *
 * NO `<style>` tags anywhere. Every visible element carries `style="..."`.
 */

export interface EmailLayoutInput {
  preheader: string;
  heroHeadline: string;
  bodyHtml: string; // already inline-styled fragment
  ctaText?: string;
  ctaUrl?: string;
  footerExtraHtml?: string; // optional extra footer block (above unsub line)
  unsubscribeUrl: string;
}

const BG = '#F2EDE0';
const SURFACE = '#FEFCF7';
const PRIMARY = '#1B4842';
const TEXT = '#0B1413';
const TEXT_SECONDARY = '#5B6764';
const BORDER = '#E0DAC8';
const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const PHYSICAL_ADDRESS =
  'LeanShot, 2261 Market Street #4775, San Francisco, CA 94114, USA';

/** Minimal HTML escape — guard user-controlled fields (name, amount, email). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const cta = input.ctaText && input.ctaUrl
    ? `
        <tr>
          <td style="padding:8px 32px 24px 32px;text-align:center;">
            <a href="${escapeHtml(input.ctaUrl)}"
              style="display:inline-block;background:${PRIMARY};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:4px;font-family:${FONT_SANS};">
              ${escapeHtml(input.ctaText)}
            </a>
          </td>
        </tr>`
    : '';

  const footerExtra = input.footerExtraHtml
    ? `
        <tr>
          <td style="padding:0 32px 16px 32px;">
            ${input.footerExtraHtml}
          </td>
        </tr>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(input.heroHeadline)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BG};font-family:${FONT_SANS};color:${TEXT};">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
      ${escapeHtml(input.preheader)}
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
      style="background:${BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"
            width="600" style="max-width:600px;background:${SURFACE};border:1px solid ${BORDER};border-radius:8px;">
            <tr>
              <td style="padding:24px 24px 8px 24px;text-align:center;">
                <span style="font-size:18px;font-weight:800;letter-spacing:-0.01em;color:${PRIMARY};font-family:${FONT_SANS};">
                  LeanShot
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;text-align:left;">
                <h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:700;color:${TEXT};font-family:${FONT_SANS};">
                  ${escapeHtml(input.heroHeadline)}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;font-size:16px;line-height:1.55;color:${TEXT};font-family:${FONT_SANS};">
                ${input.bodyHtml}
              </td>
            </tr>
            ${cta}
            ${footerExtra}
            <tr>
              <td style="padding:24px 32px 24px 32px;border-top:1px solid ${BORDER};">
                <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:${TEXT_SECONDARY};font-family:${FONT_SANS};">
                  You're receiving this email because you have an account with LeanShot.
                  <br/>
                  <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${TEXT_SECONDARY};text-decoration:underline;">
                    Manage email preferences
                  </a>
                  &middot;
                  <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${TEXT_SECONDARY};text-decoration:underline;">
                    Unsubscribe
                  </a>
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:${TEXT_SECONDARY};font-family:${FONT_SANS};">
                  ${escapeHtml(PHYSICAL_ADDRESS)}
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

/** Plain-text version helper — keep simple paragraph layout. */
export function renderPlainText(
  headline: string,
  body: string,
  cta?: { text: string; url: string },
): string {
  let out = `${headline}\n\n${body}\n\n`;
  if (cta) {
    out += `${cta.text}: ${cta.url}\n\n`;
  }
  out += `— The LeanShot team\n\n`;
  out += `Manage email preferences or unsubscribe by replying to this email or visiting your settings.\n`;
  out += `${PHYSICAL_ADDRESS}\n`;
  return out;
}
