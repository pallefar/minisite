/**
 * Transactional templates — Phase 22 plan 22-02 ON-02.
 *
 * Four templates per UI-SPEC §Email Templates lines 438-439 + carryover:
 *   - receipt              (Stripe invoice.paid)
 *   - password_reset       (re-skin of existing P5)
 *   - dsar_ready           (DSAR export bundle ready — consumed by plan 22-04)
 *   - deletion_scheduled   (7-day soft-delete with cancel link — consumed by plan 22-05)
 *
 * Pitfall 8: NO `<style>` blocks (Gmail strips them).
 */
import { escapeHtml, renderEmailLayout, renderPlainText } from '../_shared/email-layout.ts';

export interface ReceiptData {
  first_name?: string;
  plan_name?: string;
  amount_usd?: string; // already formatted, e.g. "29.00"
  invoice_date?: string; // ISO or human
  card_last4?: string;
  invoice_url?: string;
  unsubscribe_url: string;
}

export interface PasswordResetData {
  first_name?: string;
  reset_url: string;
  unsubscribe_url: string;
}

export interface DsarReadyData {
  first_name?: string;
  download_url: string;
  expires_at: string; // human date
  unsubscribe_url: string;
}

export interface DeletionScheduledData {
  first_name?: string;
  cancel_url: string; // already includes HMAC token
  scheduled_deletion_date: string; // human date — now + 7d
  unsubscribe_url: string;
}

export type TransactionalTemplateName =
  | 'receipt'
  | 'password_reset'
  | 'dsar_ready'
  | 'deletion_scheduled';

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

export function renderTemplate(
  name: string,
  data: Record<string, unknown>,
): RenderedTemplate {
  switch (name as TransactionalTemplateName) {
    case 'receipt':
      return receipt(data as unknown as ReceiptData);
    case 'password_reset':
      return passwordReset(data as unknown as PasswordResetData);
    case 'dsar_ready':
      return dsarReady(data as unknown as DsarReadyData);
    case 'deletion_scheduled':
      return deletionScheduled(data as unknown as DeletionScheduledData);
    default:
      throw new Error(`unknown_transactional_template:${name}`);
  }
}

function receipt(d: ReceiptData): RenderedTemplate {
  const amount = d.amount_usd ?? '0.00';
  const subject = `Your LeanShot receipt — $${amount}`;
  const headline = 'Payment received';
  const body = `
    <p style="margin:0 0 12px 0;">Thanks${d.first_name ? `, ${escapeHtml(d.first_name)}` : ''} — your subscription is active.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:12px 0;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#5B6764;font-size:14px;">Plan</td><td style="padding:6px 0;font-size:14px;text-align:right;">${escapeHtml(d.plan_name ?? 'LeanShot')}</td></tr>
      <tr><td style="padding:6px 0;color:#5B6764;font-size:14px;">Amount</td><td style="padding:6px 0;font-size:14px;text-align:right;">$${escapeHtml(amount)}</td></tr>
      <tr><td style="padding:6px 0;color:#5B6764;font-size:14px;">Date</td><td style="padding:6px 0;font-size:14px;text-align:right;">${escapeHtml(d.invoice_date ?? '')}</td></tr>
      <tr><td style="padding:6px 0;color:#5B6764;font-size:14px;">Card</td><td style="padding:6px 0;font-size:14px;text-align:right;">${d.card_last4 ? `&bull;&bull;&bull;&bull; ${escapeHtml(d.card_last4)}` : '—'}</td></tr>
    </table>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: `Receipt for $${amount}.`,
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: d.invoice_url ? 'View invoice' : undefined,
      ctaUrl: d.invoice_url,
      unsubscribeUrl: d.unsubscribe_url,
    }),
    text: renderPlainText(
      headline,
      `Plan: ${d.plan_name ?? 'LeanShot'}\nAmount: $${amount}\nDate: ${d.invoice_date ?? ''}\nCard: ${d.card_last4 ? `**** ${d.card_last4}` : '—'}`,
      d.invoice_url ? { text: 'View invoice', url: d.invoice_url } : undefined,
    ),
  };
}

function passwordReset(d: PasswordResetData): RenderedTemplate {
  const subject = 'Reset your LeanShot password';
  const headline = 'Reset request';
  const body = `
    <p style="margin:0 0 12px 0;">${d.first_name ? `Hi ${escapeHtml(d.first_name)} — w` : 'W'}e got a request to reset the password on your LeanShot account.</p>
    <p style="margin:0 0 12px 0;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Reset link expires in 1 hour.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Reset password',
      ctaUrl: d.reset_url,
      unsubscribeUrl: d.unsubscribe_url,
    }),
    text: renderPlainText(
      headline,
      `Reset link (expires in 1 hour). If you didn't request this, ignore this email.`,
      { text: 'Reset password', url: d.reset_url },
    ),
  };
}

function dsarReady(d: DsarReadyData): RenderedTemplate {
  const subject = 'Your LeanShot data export is ready';
  const headline = 'Your data export is ready';
  const body = `
    <p style="margin:0 0 12px 0;">${d.first_name ? `Hi ${escapeHtml(d.first_name)} — y` : 'Y'}our data export is ready to download.</p>
    <p style="margin:0 0 12px 0;">The link below is available until <strong>${escapeHtml(d.expires_at)}</strong>.</p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Your data export is available.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Download bundle',
      ctaUrl: d.download_url,
      unsubscribeUrl: d.unsubscribe_url,
    }),
    text: renderPlainText(
      headline,
      `Your data export is ready. Available until ${d.expires_at}.`,
      { text: 'Download bundle', url: d.download_url },
    ),
  };
}

function deletionScheduled(d: DeletionScheduledData): RenderedTemplate {
  const subject = 'Your LeanShot account is scheduled for deletion';
  const headline = 'Account scheduled for deletion';
  const body = `
    <p style="margin:0 0 12px 0;">${d.first_name ? `Hi ${escapeHtml(d.first_name)} — w` : 'W'}e've scheduled your LeanShot account for deletion on <strong>${escapeHtml(d.scheduled_deletion_date)}</strong>.</p>
    <p style="margin:0 0 12px 0;">If you change your mind, you have 7 days to cancel. After that, your account and all associated data are permanently deleted (Stripe records and the affiliate ledger are retained for 7 years per IRS requirements, in anonymized form).</p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'You can cancel within 7 days.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Cancel deletion',
      ctaUrl: d.cancel_url,
      unsubscribeUrl: d.unsubscribe_url,
    }),
    text: renderPlainText(
      headline,
      `Account scheduled for deletion on ${d.scheduled_deletion_date}. Cancel within 7 days.`,
      { text: 'Cancel deletion', url: d.cancel_url },
    ),
  };
}
