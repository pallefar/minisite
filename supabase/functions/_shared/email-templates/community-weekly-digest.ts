/**
 * Phase 49 Plan 49-07 — community-weekly-digest email template (non-PHI → Resend).
 *
 * Per CONTEXT D-09 — Phase 38 weekly-digest (AI summary) is UNTOUCHED; Phase 49
 * weekly is a SEPARATE Sunday-09:00 email. Per CONTEXT D-11 — Sunday 09:00
 * user-local TZ; content = course progress recap + upcoming events RSVP'd +
 * community top-3.
 *
 * Caller (`community-weekly-digest/index.ts`) hands the rendered HTML/text into
 * `sendEmail({ template: 'community_weekly_digest', phi: false, ... })` via the
 * shared `_shared/email-router.ts`. Per RFC 8058 the caller MUST also pass
 * `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * headers (Gmail bulk-sender requirement). The footer also carries a visible
 * unsubscribe link so users with HTML-only clients can opt out manually.
 *
 * PII safety:
 *   - User-supplied content (course titles, event titles, post bodies) is
 *     HTML-escaped via the local `escapeHtml` helper before interpolation.
 *   - The recipient's email is NOT rendered into the body (caller supplies it
 *     to Resend separately).
 *   - The unsubscribe URL is rendered verbatim — caller is responsible for
 *     URL-encoding the token query param.
 *
 * Per memory `feedback_negation_grep_defeated_by_comment_string` — do NOT
 * include rejected alternate identifier strings in any comment in this file.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A course-progress row (from `digest_course_progress_delta_7d` RPC). */
export interface WeeklyDigestCourseProgress {
  course_id: string;
  course_title: string;
  completed_this_week: number;
  total_lessons: number;
  percent_complete: number;
}

/** An upcoming-event row (from `digest_upcoming_events_7d_rsvpd` RPC). */
export interface WeeklyDigestUpcomingEvent {
  event_id: string;
  title: string;
  start_at: string;
}

/** A community-top-3 row (from `digest_community_top3_7d` RPC). */
export interface WeeklyDigestCommunityTop3 {
  post_id: string;
  space_id: string;
  space_name: string;
  body: string;
  score: number;
  author_id: string;
}

/** The 3-bucket content payload built by `community-weekly-digest/index.ts`. */
export interface WeeklyDigestContent {
  courseProgress: WeeklyDigestCourseProgress[];
  upcomingEvents: WeeklyDigestUpcomingEvent[];
  communityTop3: WeeklyDigestCommunityTop3[];
}

/** Template variables passed in via the shared `sendEmail({vars})` payload. */
export interface WeeklyDigestTemplateVars {
  /** The 3-bucket content blob; must be present + at least one bucket non-empty. */
  content: WeeklyDigestContent;
  /** Visible unsubscribe URL (also used in List-Unsubscribe HTTP header). */
  unsubUrl: string;
  /** Optional override of the LeanShot site URL used in the CTA button. */
  siteUrl?: string;
}

const SITE_URL_DEFAULT = 'https://app.leanshot.app';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cap body excerpts so a 5000-char post does not balloon the email. */
function truncate(s: string, max = 280): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function isVars(v: unknown): v is WeeklyDigestTemplateVars {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.unsubUrl === 'string' && !!r.content && typeof r.content === 'object';
}

/**
 * Render an inline-styled progress bar for a single course row.
 * Width is the percent_complete clamped to 0..100. Pure inline CSS so email
 * clients render it consistently (no external stylesheets, no <style> blocks).
 */
function progressBarHtml(percent: number): string {
  const safe = Math.max(0, Math.min(100, Math.floor(Number.isFinite(percent) ? percent : 0)));
  return `<div style="background:#EEE;border-radius:4px;height:8px;width:160px;display:inline-block;vertical-align:middle;">
    <div style="background:#0B1413;border-radius:4px;height:8px;width:${safe}%;"></div>
  </div>`;
}

/**
 * Format an ISO timestamp as a relative descriptor for the email body.
 * Email rendering happens at send-time (Sunday 09:00 user-local) so we don't
 * try to honor the user's locale here — we just give a coarse human anchor.
 */
function relativeStart(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const now = Date.now();
    if (!Number.isFinite(t)) return iso;
    const deltaHours = Math.round((t - now) / 3600_000);
    if (deltaHours < 0) return 'soon';
    if (deltaHours < 24) return `in ${deltaHours}h`;
    const days = Math.round(deltaHours / 24);
    return days <= 1 ? 'tomorrow' : `in ${days}d`;
  } catch {
    return iso;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Subject line. Static phrasing — body counts vary per send, but the subject
 * stays consistent so Gmail/Outlook can collapse the weekly thread.
 */
export function subject(_vars: unknown): string {
  return 'Your LeanShot week ahead';
}

/**
 * Render the full HTML + plaintext body for the weekly community digest.
 *
 * Returns `{ html, text }` so the caller can hand both to Resend (HTML +
 * plaintext fallback). The shared router's `renderTemplate` switch arm only
 * forwards the HTML, but the plaintext is exposed for direct-Resend callers
 * that want it.
 */
export function render(vars: unknown): { html: string; text: string } {
  // Defensive: shared `sendEmail({vars})` payload is typed as Record<string, unknown>;
  // be tolerant of malformed input so the email at least renders a footer with
  // the unsubscribe link.
  const safeVars: WeeklyDigestTemplateVars = isVars(vars)
    ? vars
    : {
        content: { courseProgress: [], upcomingEvents: [], communityTop3: [] },
        unsubUrl: '',
      };
  const siteUrl = safeVars.siteUrl ?? SITE_URL_DEFAULT;
  const content = safeVars.content;
  const unsubUrlSafe = encodeURI(safeVars.unsubUrl || '');

  // ─── Section: Your course progress ───────────────────────────────────────
  const courseProgressHtml = content.courseProgress.length
    ? `
      <h3 style="margin:24px 0 8px 0;font-family:sans-serif;font-size:16px;color:#0B1413;">Your course progress</h3>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:sans-serif;font-size:14px;color:#0B1413;">
        ${content.courseProgress
          .map(
            (c) =>
              `<tr>
                <td style="padding:6px 0;vertical-align:middle;">
                  <div><strong style="font-weight:600;">${escapeHtml(c.course_title)}</strong></div>
                  <div style="color:#666;font-size:12px;margin-top:2px;">
                    +${Math.max(0, Math.floor(c.completed_this_week))} this week · ${Math.max(0, Math.floor(c.percent_complete))}% of ${Math.max(0, Math.floor(c.total_lessons))} lessons
                  </div>
                </td>
                <td align="right" style="padding:6px 0;vertical-align:middle;width:170px;">
                  ${progressBarHtml(c.percent_complete)}
                </td>
              </tr>`,
          )
          .join('')}
      </table>
    `.trim()
    : '';

  // ─── Section: Upcoming events ────────────────────────────────────────────
  const upcomingEventsHtml = content.upcomingEvents.length
    ? `
      <h3 style="margin:24px 0 8px 0;font-family:sans-serif;font-size:16px;color:#0B1413;">Upcoming events</h3>
      <ul style="margin:0 0 8px 0;padding-left:20px;font-family:sans-serif;font-size:14px;color:#0B1413;">
        ${content.upcomingEvents
          .map(
            (e) =>
              `<li style="margin:0 0 8px 0;">
                <strong style="font-weight:600;">${escapeHtml(e.title)}</strong>
                <span style="color:#666;"> · ${escapeHtml(relativeStart(e.start_at))}</span>
                &nbsp;<a href="${encodeURI(siteUrl)}/events/${encodeURIComponent(e.event_id)}" style="color:#0B1413;text-decoration:underline;">View event</a>
              </li>`,
          )
          .join('')}
      </ul>
    `.trim()
    : '';

  // ─── Section: Community top 3 ────────────────────────────────────────────
  const communityTop3Html = content.communityTop3.length
    ? `
      <h3 style="margin:24px 0 8px 0;font-family:sans-serif;font-size:16px;color:#0B1413;">Community top 3 this week</h3>
      <ul style="margin:0 0 8px 0;padding-left:20px;font-family:sans-serif;font-size:14px;color:#0B1413;">
        ${content.communityTop3
          .map(
            (p) =>
              `<li style="margin:0 0 12px 0;">
                <div><strong style="font-weight:600;">${escapeHtml(p.space_name)}</strong> <span style="color:#666;">· score ${Math.max(0, Math.floor(p.score))}</span></div>
                <div style="margin-top:2px;">${escapeHtml(truncate(p.body))}</div>
              </li>`,
          )
          .join('')}
      </ul>
    `.trim()
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#EFEBE0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFEBE0;">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#FFFFFF;border-radius:12px;padding:24px;font-family:sans-serif;color:#0B1413;">
            <tr><td>
              <h2 style="margin:0 0 8px 0;font-family:sans-serif;font-size:20px;color:#0B1413;">Your LeanShot week ahead</h2>
              <p style="margin:0 0 16px 0;font-family:sans-serif;font-size:14px;color:#0B1413;">Here is your weekly recap and what's coming up in your spaces.</p>
              ${courseProgressHtml}
              ${upcomingEventsHtml}
              ${communityTop3Html}
              <p style="margin:24px 0 8px 0;text-align:center;">
                <a href="${encodeURI(siteUrl)}" style="display:inline-block;padding:10px 18px;background:#0B1413;color:#FFFFFF;text-decoration:none;border-radius:8px;font-family:sans-serif;font-size:14px;">Open LeanShot</a>
              </p>
              <hr style="border:none;border-top:1px solid #EEE;margin:24px 0;">
              <p style="margin:0;font-family:sans-serif;font-size:12px;color:#666;text-align:center;">
                You are receiving this weekly digest because you joined a LeanShot community space.
                <br>
                <a href="${unsubUrlSafe}" style="color:#666;text-decoration:underline;">Unsubscribe from weekly community digest</a>
              </p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  // ─── Plaintext fallback ──────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('Your LeanShot week ahead');
  lines.push('');
  lines.push("Here is your weekly recap and what's coming up in your spaces.");
  if (content.courseProgress.length) {
    lines.push('');
    lines.push('YOUR COURSE PROGRESS');
    for (const c of content.courseProgress) {
      lines.push(
        `- ${c.course_title}: +${Math.max(0, Math.floor(c.completed_this_week))} this week · ${Math.max(0, Math.floor(c.percent_complete))}% of ${Math.max(0, Math.floor(c.total_lessons))} lessons`,
      );
    }
  }
  if (content.upcomingEvents.length) {
    lines.push('');
    lines.push('UPCOMING EVENTS');
    for (const e of content.upcomingEvents) {
      lines.push(`- ${e.title} (${relativeStart(e.start_at)}) — ${siteUrl}/events/${e.event_id}`);
    }
  }
  if (content.communityTop3.length) {
    lines.push('');
    lines.push('COMMUNITY TOP 3 THIS WEEK');
    for (const p of content.communityTop3) {
      lines.push(`- [${p.space_name}] (score ${Math.max(0, Math.floor(p.score))}) ${truncate(p.body)}`);
    }
  }
  lines.push('');
  lines.push(`Open LeanShot: ${siteUrl}`);
  lines.push('');
  lines.push(`Unsubscribe: ${safeVars.unsubUrl || '(no unsubscribe URL provided)'}`);
  const text = lines.join('\n');

  return { html, text };
}
