/**
 * Retention templates — Phase 22 plan 22-02 ON-02.
 *
 * Three templates per UI-SPEC §Email Templates lines 440-442:
 *   - reengagement_7d_inactive   (last_sign_in_at = now - 7d)
 *   - cancellation_winback_30d   (cancelled subscription, 30d post-cancel)
 *   - weekly_digest              (opt-in, Monday cron)
 *
 * Pitfall 8: NO `<style>` blocks (Gmail strips them).
 */
import { escapeHtml, renderEmailLayout, renderPlainText } from '../_shared/email-layout.ts';

export interface RetentionTemplateData {
  first_name?: string;
  app_url?: string;
  unsubscribe_url: string;
  // weekly_digest extras
  doses_logged?: number;
  photos_added?: number;
  weight_delta?: string; // already-formatted, e.g. "-1.2 lb"
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

type RetentionTemplateName = 'reengagement_7d_inactive' | 'cancellation_winback_30d' | 'weekly_digest';

const APP_URL_DEFAULT = 'https://app.leanshot.app';

export function renderTemplate(name: string, data: RetentionTemplateData): RenderedTemplate {
  const firstName = (data.first_name ?? '').trim() || 'there';
  const appUrl = data.app_url ?? APP_URL_DEFAULT;
  const unsub = data.unsubscribe_url;
  switch (name as RetentionTemplateName) {
    case 'reengagement_7d_inactive':
      return reengagement(firstName, appUrl, unsub);
    case 'cancellation_winback_30d':
      return winback(firstName, appUrl, unsub);
    case 'weekly_digest':
      return weeklyDigest(firstName, appUrl, unsub, data);
    default:
      throw new Error(`unknown_retention_template:${name}`);
  }
}

function reengagement(firstName: string, appUrl: string, unsub: string): RenderedTemplate {
  const subject = 'We miss you at LeanShot';
  const headline = `Pick up where you left off, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">
      It's been a week since your last visit. Your data is right where you left it —
      and a single new dose log brings your curve back to current.
    </p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Your data is waiting.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Open LeanShot',
      ctaUrl: `${appUrl}/dashboard`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `A week away. Your data is right where you left it.`,
      { text: 'Open LeanShot', url: `${appUrl}/dashboard` },
    ),
  };
}

function winback(firstName: string, appUrl: string, unsub: string): RenderedTemplate {
  const subject = 'Come back to LeanShot?';
  const headline = `We've added some things, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">A few things that landed since you left:</p>
    <ul style="margin:0 0 12px 20px;padding:0;">
      <li style="margin-bottom:6px;">Improved injection-site rotation map</li>
      <li style="margin-bottom:6px;">Faster AI coach with full-history context</li>
      <li style="margin-bottom:6px;">Doctor-share with one-tap PDF export</li>
    </ul>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'New since you left.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Restart subscription',
      ctaUrl: `${appUrl}/settings/billing`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `New: rotation map · faster AI · one-tap doctor-share PDF.`,
      { text: 'Restart subscription', url: `${appUrl}/settings/billing` },
    ),
  };
}

function weeklyDigest(
  firstName: string,
  appUrl: string,
  unsub: string,
  d: RetentionTemplateData,
): RenderedTemplate {
  const subject = 'Your LeanShot week';
  const headline = `Your week in numbers, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">Here's how the last 7 days went:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:12px 0;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#5B6764;font-size:14px;">Doses logged</td><td style="padding:6px 0;font-size:14px;text-align:right;">${d.doses_logged ?? 0}</td></tr>
      <tr><td style="padding:6px 0;color:#5B6764;font-size:14px;">Photos added</td><td style="padding:6px 0;font-size:14px;text-align:right;">${d.photos_added ?? 0}</td></tr>
      <tr><td style="padding:6px 0;color:#5B6764;font-size:14px;">Weight change</td><td style="padding:6px 0;font-size:14px;text-align:right;">${escapeHtml(d.weight_delta ?? '—')}</td></tr>
    </table>
    <p style="margin:0 0 12px 0;">Tip: aim for one new site this week — rotation matters more than precision.</p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Doses, photos, and weight from the last 7 days.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Open LeanShot',
      ctaUrl: `${appUrl}/dashboard`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `Doses logged: ${d.doses_logged ?? 0}\nPhotos added: ${d.photos_added ?? 0}\nWeight change: ${d.weight_delta ?? '—'}`,
      { text: 'Open LeanShot', url: `${appUrl}/dashboard` },
    ),
  };
}
