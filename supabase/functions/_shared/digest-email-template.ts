/**
 * Phase 38 Plan 38-05 — weekly digest email template (non-PHI consumer path).
 *
 * Per CONTEXT D-04: the sanitized narrative is non-PHI for ALL tiers in v1 —
 * the digest body therefore routes via the Resend consumer path (NOT SES).
 * This helper composes the plaintext + HTML email body using the shared
 * `_shared/email-layout.ts` wrapper (inline-styled, Gmail-safe) and a plaintext
 * fallback. The caller (`weekly-digest/index.ts`) hands the rendered output to
 * `sendResendEmail` from `_shared/lifecycle-send.ts`.
 *
 * Subject line per plan 38-05 spec:
 *   "Your LeanShot week — <weekStartDateLocale>"
 *
 * Footer carries a 1-click unsubscribe link per Phase 49 DIGEST-04 pattern;
 * the URL points to `/settings/email-preferences` (matches lifecycle-welcome
 * conventions) so the user lands on a page where they can toggle
 * `user_preferences.weekly_digest_opt_in = false`.
 *
 * Action rendering is deliberately terse — the actions[] array is rendered as
 * a short bullet list under the narrative paragraph. Action IDs are mapped to
 * a one-word label via ACTION_LABELS; the action.reason text is shown verbatim
 * (already post-scanned for clinical keywords upstream — Guardrail O2).
 *
 * PII safety: the user's email + display name are escaped via the layout's
 * escapeHtml helper. Per D-04 the narrative contains no PHI by construction
 * (the renderer in render-user-facts.ts only emits deltas + counts, never raw
 * values + names).
 */

import { renderEmailLayout, renderPlainText, escapeHtml } from './email-layout.ts';
import type { DigestOutput, DigestAction } from './digest-schema.ts';

const SITE_URL_DEFAULT = 'https://app.leanshot.app';

/** Friendly one-word labels for whitelist action IDs (used in HTML + text). */
const ACTION_LABELS: Record<string, string> = {
  read_kb: 'Read article',
  log_weight: 'Log a weigh-in',
  log_injection: 'Log injection',
  log_meal: 'Log a meal',
  view_curve: 'View your curve',
  share_with_doctor: 'Share with your doctor',
  complete_onboarding_step: 'Finish onboarding',
  try_recipe: 'Try a recipe',
  watch_tutorial: 'Watch tutorial',
};

export interface RenderDigestEmailInput {
  digest: DigestOutput;
  user: {
    email: string;
    displayName?: string;
    locale?: string;
  };
  /** ISO date (YYYY-MM-DD) marking Monday of the digest window. */
  weekStartIso: string;
  /** Override site URL — defaults to https://app.leanshot.app. */
  siteUrl?: string;
}

export interface RenderedDigestEmail {
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

/**
 * Format weekStartIso per the user's locale. Defaults to 'en-US' if locale is
 * unset/invalid; the locale string travels straight into Intl.DateTimeFormat
 * so a malformed value silently falls back to the runtime default (same UX
 * as the lifecycle templates' subject lines).
 *
 * Output style: long month + numeric day (e.g. "May 12") — keeps the subject
 * scannable in iOS/Android lock screens.
 */
function formatWeekStart(iso: string, locale: string | undefined): string {
  // Parse as UTC noon to avoid DST shifts moving the displayed date back a day.
  const d = new Date(`${iso}T12:00:00Z`);
  try {
    return new Intl.DateTimeFormat(locale ?? 'en-US', {
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    // Locale rejected by Intl — fall back to ISO date.
    return iso;
  }
}

/** Render a single action row to HTML <li>. */
function renderActionHtml(action: DigestAction): string {
  const label = ACTION_LABELS[action.id] ?? action.id;
  return `<li style="margin:0 0 6px 0;">
    <strong style="font-weight:600;">${escapeHtml(label)}</strong> — ${escapeHtml(action.reason)}
  </li>`;
}

/** Render a single action row to plaintext bullet. */
function renderActionText(action: DigestAction): string {
  const label = ACTION_LABELS[action.id] ?? action.id;
  return `- ${label}: ${action.reason}`;
}

/**
 * Compose the weekly digest email (subject + HTML + plaintext + unsub URL).
 *
 * Caller wires the output into `sendResendEmail` — this helper has NO side
 * effects (no fetch, no DB, no Sentry). Pure render so unit tests can snapshot
 * the exact subject + body byte-for-byte.
 */
export function renderDigestEmail(input: RenderDigestEmailInput): RenderedDigestEmail {
  const siteUrl = input.siteUrl ?? SITE_URL_DEFAULT;
  const unsubscribeUrl = `${siteUrl}/settings/email-preferences`;
  const dateLabel = formatWeekStart(input.weekStartIso, input.user.locale);
  const subject = `Your LeanShot week — ${dateLabel}`;
  const greetingName = input.user.displayName?.trim()
    ? escapeHtml(input.user.displayName.trim())
    : 'there';
  const preheader = input.digest.narrative.slice(0, 110);

  // HTML body fragment — paragraph + actions list. Inline-styled per Gmail
  // rules (no <style> block — see email-layout.ts header).
  const actionsHtml = input.digest.actions.map(renderActionHtml).join('');
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${greetingName},</p>
    <p style="margin:0 0 16px 0;">${escapeHtml(input.digest.narrative)}</p>
    <p style="margin:0 0 8px 0;font-weight:600;">A few things you can do this week:</p>
    <ul style="margin:0 0 16px 0;padding-left:20px;">${actionsHtml}</ul>
  `.trim();

  const html = renderEmailLayout({
    preheader,
    heroHeadline: `Your week — ${dateLabel}`,
    bodyHtml,
    ctaText: 'Open LeanShot',
    ctaUrl: siteUrl,
    unsubscribeUrl,
  });

  // Plaintext fallback — keep parallel structure with HTML.
  const actionsText = input.digest.actions.map(renderActionText).join('\n');
  const textBody = `${input.digest.narrative}\n\nA few things you can do this week:\n${actionsText}`;
  const text = renderPlainText(`Your week — ${dateLabel}`, textBody, {
    text: 'Open LeanShot',
    url: siteUrl,
  });

  return { subject, html, text, unsubscribeUrl };
}
