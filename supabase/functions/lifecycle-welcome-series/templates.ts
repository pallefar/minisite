/**
 * Welcome-series templates — Phase 22 plan 22-02 ON-02.
 *
 * Four templates per UI-SPEC §Email Templates lines 431-434:
 *   - welcome_immediately       (day 0)
 *   - getting_started_day1      (+24h)
 *   - first_injection_reminder  (+72h, no injection logged)
 *   - week_1_check_in           (+7d)
 *
 * Pitfall 8: NO `<style>` blocks (Gmail strips them) — inline-only via
 * `_shared/email-layout.ts`.
 */
import { escapeHtml, renderEmailLayout, renderPlainText } from '../_shared/email-layout.ts';

export interface WelcomeTemplateData {
  first_name?: string;
  app_url?: string; // base SITE_URL
  unsubscribe_url: string;
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

type WelcomeTemplateName =
  | 'welcome_immediately'
  | 'getting_started_day1'
  | 'first_injection_reminder'
  | 'week_1_check_in';

const APP_URL_DEFAULT = 'https://app.leanshot.app';

export function renderTemplate(name: string, data: WelcomeTemplateData): RenderedTemplate {
  const firstName = (data.first_name ?? '').trim() || 'there';
  const appUrl = data.app_url ?? APP_URL_DEFAULT;
  const unsub = data.unsubscribe_url;

  switch (name as WelcomeTemplateName) {
    case 'welcome_immediately':
      return welcomeImmediately(firstName, appUrl, unsub);
    case 'getting_started_day1':
      return gettingStartedDay1(firstName, appUrl, unsub);
    case 'first_injection_reminder':
      return firstInjectionReminder(firstName, appUrl, unsub);
    case 'week_1_check_in':
      return week1CheckIn(firstName, appUrl, unsub);
    default:
      throw new Error(`unknown_welcome_template:${name}`);
  }
}

function welcomeImmediately(firstName: string, appUrl: string, unsub: string): RenderedTemplate {
  const subject = 'Welcome to LeanShot';
  const headline = `Hi ${escapeHtml(firstName)}, welcome to LeanShot`;
  const body = `
    <p style="margin:0 0 12px 0;">Here's what to do first:</p>
    <ul style="margin:0 0 12px 20px;padding:0;">
      <li style="margin-bottom:6px;">Log your first injection (10 seconds)</li>
      <li style="margin-bottom:6px;">Upload a progress photo</li>
      <li style="margin-bottom:6px;">Invite your doctor to read-share</li>
    </ul>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Your GLP-1 picture, in one place.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Open LeanShot',
      ctaUrl: `${appUrl}/dashboard`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `Here's what to do first:\n  - Log your first injection\n  - Upload a progress photo\n  - Invite your doctor`,
      { text: 'Open LeanShot', url: `${appUrl}/dashboard` },
    ),
  };
}

function gettingStartedDay1(firstName: string, appUrl: string, unsub: string): RenderedTemplate {
  const subject = 'Your first 24 hours with LeanShot';
  const headline = `Quick tour, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">Three things that make LeanShot click:</p>
    <ul style="margin:0 0 12px 20px;padding:0;">
      <li style="margin-bottom:6px;"><strong>Medication tab</strong> — see your drug-level curve (28 days past, 7 days projected).</li>
      <li style="margin-bottom:6px;"><strong>Body tab</strong> — weight, photos, measurements in one timeline.</li>
      <li style="margin-bottom:6px;"><strong>AI coach</strong> — context-aware answers about your own data.</li>
    </ul>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'A 60-second guided tour.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Take the tour',
      ctaUrl: `${appUrl}/dashboard?tour=1`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `Three tabs to know: Medication (drug-level curve), Body (weight + photos), AI coach.`,
      { text: 'Take the tour', url: `${appUrl}/dashboard?tour=1` },
    ),
  };
}

function firstInjectionReminder(
  firstName: string,
  appUrl: string,
  unsub: string,
): RenderedTemplate {
  const subject = 'Logged your first dose yet?';
  const headline = `It only takes 10 seconds, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">
      Quick how-to:
    </p>
    <ol style="margin:0 0 12px 20px;padding:0;">
      <li style="margin-bottom:6px;">Open the Medication tab.</li>
      <li style="margin-bottom:6px;">Tap the "Log dose" button at the top.</li>
      <li style="margin-bottom:6px;">Pick site, amount, and time. Save.</li>
    </ol>
    <p style="margin:0 0 12px 0;">
      Once you log a dose, the drug-level curve unlocks — that's the LeanShot superpower.
    </p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Unlock your drug-level curve.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Log a dose',
      ctaUrl: `${appUrl}/dashboard/medication`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `Open Medication tab → "Log dose" → pick site/amount/time. Curve unlocks after first dose.`,
      { text: 'Log a dose', url: `${appUrl}/dashboard/medication` },
    ),
  };
}

function week1CheckIn(firstName: string, appUrl: string, unsub: string): RenderedTemplate {
  const subject = "How's week 1?";
  const headline = `Your week-1 snapshot, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">
      You've made it through your first week. Here's a quick tip for week 2:
    </p>
    <p style="margin:0 0 12px 0;">
      Track <strong>injection site rotation</strong> — the body's response varies by site,
      and the rotation map keeps you from over-using the same area.
    </p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Week 2 tip: rotation matters.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Open LeanShot',
      ctaUrl: `${appUrl}/dashboard`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `Week 2 tip: track injection site rotation — body response varies by site.`,
      { text: 'Open LeanShot', url: `${appUrl}/dashboard` },
    ),
  };
}
