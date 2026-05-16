/**
 * Behavior-triggered templates — Phase 22 plan 22-02 ON-02.
 *
 * Three templates per UI-SPEC §Email Templates lines 435-437:
 *   - first_injection_celebration   (first injection logged)
 *   - 7_day_streak                  (7-day logging streak)
 *   - missed_dose_day3              (3 days since last injection)
 *
 * Pitfall 8: NO `<style>` blocks (Gmail strips them).
 */
import { escapeHtml, renderEmailLayout, renderPlainText } from '../_shared/email-layout.ts';

export interface BehaviorTemplateData {
  first_name?: string;
  app_url?: string;
  unsubscribe_url: string;
  streak_days?: number; // for 7_day_streak
  days_since_last?: number; // for missed_dose_day3
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

type BehaviorTemplateName = 'first_injection_celebration' | '7_day_streak' | 'missed_dose_day3';

const APP_URL_DEFAULT = 'https://app.leanshot.app';

export function renderTemplate(name: string, data: BehaviorTemplateData): RenderedTemplate {
  const firstName = (data.first_name ?? '').trim() || 'there';
  const appUrl = data.app_url ?? APP_URL_DEFAULT;
  const unsub = data.unsubscribe_url;

  switch (name as BehaviorTemplateName) {
    case 'first_injection_celebration':
      return firstInjectionCelebration(firstName, appUrl, unsub);
    case '7_day_streak':
      return sevenDayStreak(firstName, appUrl, unsub, data.streak_days ?? 7);
    case 'missed_dose_day3':
      return missedDoseDay3(firstName, appUrl, unsub, data.days_since_last ?? 3);
    default:
      throw new Error(`unknown_behavior_template:${name}`);
  }
}

function firstInjectionCelebration(
  firstName: string,
  appUrl: string,
  unsub: string,
): RenderedTemplate {
  const subject = 'First dose logged';
  const headline = `Nice work on your first dose, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">
      That first log unlocks your <strong>drug-level curve</strong> — 28 days behind,
      7 days projected. It's the LeanShot headline feature.
    </p>
    <p style="margin:0 0 12px 0;">
      Up next: tag the injection site so the rotation map lights up across weeks.
    </p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Your drug-level curve is now live.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'See your med-level',
      ctaUrl: `${appUrl}/dashboard/medication`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `Drug-level curve unlocked. Next: tag the injection site to build the rotation map.`,
      { text: 'See your med-level', url: `${appUrl}/dashboard/medication` },
    ),
  };
}

function sevenDayStreak(
  firstName: string,
  appUrl: string,
  unsub: string,
  streakDays: number,
): RenderedTemplate {
  const subject = `${streakDays}-day streak`;
  const headline = `You're on a ${streakDays}-day roll, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">
      ${streakDays} days of consistent logging. That's the kind of data your
      doctor actually wants to see at the next visit.
    </p>
    <p style="margin:0 0 12px 0;">
      Share your snapshot — it's a single image of your med-level curve plus weight trend.
    </p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Share your progress in one tap.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Share your progress',
      ctaUrl: `${appUrl}/dashboard?modal=share`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `${streakDays} days of consistent logging. Share your snapshot in one tap.`,
      { text: 'Share your progress', url: `${appUrl}/dashboard?modal=share` },
    ),
  };
}

function missedDoseDay3(
  firstName: string,
  appUrl: string,
  unsub: string,
  daysSince: number,
): RenderedTemplate {
  const subject = 'Did you skip a dose?';
  const headline = `It happens, ${escapeHtml(firstName)}`;
  const body = `
    <p style="margin:0 0 12px 0;">
      We noticed it's been ${daysSince} days since your last logged dose.
      Whether you skipped or just forgot to log — both are fine.
    </p>
    <p style="margin:0 0 12px 0;">
      If you took a dose but forgot to log it, you can backdate the entry.
    </p>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preheader: 'Catch up in 10 seconds.',
      heroHeadline: headline,
      bodyHtml: body,
      ctaText: 'Catch up',
      ctaUrl: `${appUrl}/dashboard/medication`,
      unsubscribeUrl: unsub,
    }),
    text: renderPlainText(
      headline,
      `${daysSince} days since last dose. Backdate the entry if you took it but forgot to log.`,
      { text: 'Catch up', url: `${appUrl}/dashboard/medication` },
    ),
  };
}
