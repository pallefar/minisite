/**
 * Phase 49 Plan 49-06 — community-daily-digest email template (non-PHI → Resend).
 *
 * Per CONTEXT D-04 (community content is non-PHI for ALL tiers in v1) the
 * digest body routes via Resend. Render output mirrors the Phase 38
 * `digest-email-template.ts` shape (subject + html + text) but adapted for
 * the 3 daily community buckets: top posts in spaces, new comments on the
 * user's own posts, and recent mentions.
 *
 * Caller (`community-daily-digest/index.ts`) hands the rendered HTML/text into
 * `sendEmail({ template: 'community_daily_digest', phi: false, ... })` via the
 * shared `_shared/email-router.ts`. Per RFC 8058 the caller MUST also pass
 * `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * headers (Gmail bulk-sender requirement). The footer also carries a visible
 * unsubscribe link so users with HTML-only clients can opt out manually.
 *
 * PII safety:
 *   - User-supplied content (post bodies, comment bodies) is HTML-escaped via
 *     the local `escapeHtml` helper before interpolation.
 *   - The recipient's email is NOT rendered into the body (caller supplies it
 *     to Resend separately).
 *   - The unsubscribe URL is rendered verbatim — caller is responsible for
 *     URL-encoding the token query param.
 *
 * Per memory `feedback_negation_grep_defeated_by_comment_string` — do NOT
 * include the rejected `phi: true` string or `auth.uid()` placeholder in any
 * comment in this file.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A post bucket row (from `digest_top_posts_in_spaces` RPC). */
export interface DailyDigestTopPost {
  post_id: string;
  space_id: string;
  space_name: string;
  body: string;
  score: number;
}

/** A comment bucket row (from `digest_new_comments_on_my_posts` RPC). */
export interface DailyDigestNewComment {
  comment_id: string;
  post_id: string;
  body: string;
  author_id: string;
  created_at: string;
}

/** A mention bucket row (from `digest_recent_mentions` RPC). */
export interface DailyDigestMention {
  post_id: string;
  post_body: string;
  mentioner_id: string;
  mention_kind: 'post' | 'comment' | string;
}

/** The 3-bucket content payload built by `community-daily-digest/index.ts`. */
export interface DailyDigestContent {
  topPosts: DailyDigestTopPost[];
  newComments: DailyDigestNewComment[];
  mentions: DailyDigestMention[];
}

/** Template variables passed in via the shared `sendEmail({vars})` payload. */
export interface DailyDigestTemplateVars {
  /** The 3-bucket content blob; must be present + at least one bucket non-empty. */
  content: DailyDigestContent;
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

function isVars(v: unknown): v is DailyDigestTemplateVars {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.unsubUrl === 'string' && !!r.content && typeof r.content === 'object';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Subject line. Static phrasing — body counts vary per send, but the subject
 * stays consistent so Gmail/Outlook can collapse the daily thread.
 */
export function subject(_vars: unknown): string {
  return 'Your LeanShot community — today';
}

/**
 * Render the full HTML + plaintext body for the daily community digest.
 *
 * Returns `{ html, text }` so the caller can hand both to Resend (HTML +
 * plaintext fallback). The shared router's `renderTemplate` switch arm only
 * forwards the HTML, but the plaintext is exposed for direct-Resend callers
 * (e.g. a future SES variant) that want it.
 */
export function render(vars: unknown): { html: string; text: string } {
  // Defensive: shared `sendEmail({vars})` payload is typed as Record<string, unknown>;
  // be tolerant of malformed input so the email at least renders a footer with
  // the unsubscribe link.
  const safeVars: DailyDigestTemplateVars = isVars(vars)
    ? vars
    : {
        content: { topPosts: [], newComments: [], mentions: [] },
        unsubUrl: '',
      };
  const siteUrl = safeVars.siteUrl ?? SITE_URL_DEFAULT;
  const content = safeVars.content;
  const unsubUrlSafe = encodeURI(safeVars.unsubUrl || '');

  // ─── Section: Top posts in your spaces ───────────────────────────────────
  const topPostsHtml = content.topPosts.length
    ? `
      <h3 style="margin:24px 0 8px 0;font-family:sans-serif;font-size:16px;color:#0B1413;">Top posts in your spaces</h3>
      <ul style="margin:0 0 8px 0;padding-left:20px;font-family:sans-serif;font-size:14px;color:#0B1413;">
        ${content.topPosts
          .map(
            (p) =>
              `<li style="margin:0 0 8px 0;">
                <strong style="font-weight:600;">${escapeHtml(p.space_name)}</strong>:
                ${escapeHtml(truncate(p.body))}
              </li>`,
          )
          .join('')}
      </ul>
    `.trim()
    : '';

  // ─── Section: New comments on your posts ─────────────────────────────────
  const newCommentsHtml = content.newComments.length
    ? `
      <h3 style="margin:24px 0 8px 0;font-family:sans-serif;font-size:16px;color:#0B1413;">New comments on your posts</h3>
      <ul style="margin:0 0 8px 0;padding-left:20px;font-family:sans-serif;font-size:14px;color:#0B1413;">
        ${content.newComments
          .map(
            (c) =>
              `<li style="margin:0 0 8px 0;">${escapeHtml(truncate(c.body))}</li>`,
          )
          .join('')}
      </ul>
    `.trim()
    : '';

  // ─── Section: Recent mentions ─────────────────────────────────────────────
  const mentionsHtml = content.mentions.length
    ? `
      <h3 style="margin:24px 0 8px 0;font-family:sans-serif;font-size:16px;color:#0B1413;">You were mentioned</h3>
      <ul style="margin:0 0 8px 0;padding-left:20px;font-family:sans-serif;font-size:14px;color:#0B1413;">
        ${content.mentions
          .map(
            (m) =>
              `<li style="margin:0 0 8px 0;">
                <span style="color:#666;">(${escapeHtml(m.mention_kind)})</span>
                ${escapeHtml(truncate(m.post_body))}
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
              <h2 style="margin:0 0 8px 0;font-family:sans-serif;font-size:20px;color:#0B1413;">Your LeanShot community — today</h2>
              <p style="margin:0 0 16px 0;font-family:sans-serif;font-size:14px;color:#0B1413;">Here is what happened in your spaces in the last 24 hours.</p>
              ${topPostsHtml}
              ${newCommentsHtml}
              ${mentionsHtml}
              <p style="margin:24px 0 8px 0;text-align:center;">
                <a href="${encodeURI(siteUrl)}" style="display:inline-block;padding:10px 18px;background:#0B1413;color:#FFFFFF;text-decoration:none;border-radius:8px;font-family:sans-serif;font-size:14px;">Open LeanShot</a>
              </p>
              <hr style="border:none;border-top:1px solid #EEE;margin:24px 0;">
              <p style="margin:0;font-family:sans-serif;font-size:12px;color:#666;text-align:center;">
                You are receiving this daily digest because you joined a LeanShot community space.
                <br>
                <a href="${unsubUrlSafe}" style="color:#666;text-decoration:underline;">Unsubscribe from daily community digest</a>
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
  lines.push('Your LeanShot community — today');
  lines.push('');
  lines.push('Here is what happened in your spaces in the last 24 hours.');
  if (content.topPosts.length) {
    lines.push('');
    lines.push('TOP POSTS IN YOUR SPACES');
    for (const p of content.topPosts) {
      lines.push(`- [${p.space_name}] ${truncate(p.body)}`);
    }
  }
  if (content.newComments.length) {
    lines.push('');
    lines.push('NEW COMMENTS ON YOUR POSTS');
    for (const c of content.newComments) {
      lines.push(`- ${truncate(c.body)}`);
    }
  }
  if (content.mentions.length) {
    lines.push('');
    lines.push('YOU WERE MENTIONED');
    for (const m of content.mentions) {
      lines.push(`- (${m.mention_kind}) ${truncate(m.post_body)}`);
    }
  }
  lines.push('');
  lines.push(`Open LeanShot: ${siteUrl}`);
  lines.push('');
  lines.push(`Unsubscribe: ${safeVars.unsubUrl || '(no unsubscribe URL provided)'}`);
  const text = lines.join('\n');

  return { html, text };
}
