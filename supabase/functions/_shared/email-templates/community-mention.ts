// Phase 44 Plan 44-02 — community_mention email template.
//
// Sent when a user is @mentioned in a community post or comment.
// Non-PHI (no health data in the notification payload) → routes via Resend.
//
// vars expected:
//   mentioned_by    string  — display name of the user who mentioned the recipient
//   space_name      string  — name of the community space where the mention occurred
//   post_excerpt    string  — first ≤200 chars of the post body (server-truncated)
//   post_url        string  — full HTTPS URL to the post
//
// Security (T-44-05): all user-supplied variables are HTML-escaped before
// interpolation. The footer/unsubscribe link is rendered inline here;
// email-router does NOT append a global footer for community templates.
//
// Note: post_excerpt is truncated to 200 chars server-side before calling
// this template. The template adds a trailing ellipsis if needed.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function subject(vars: Record<string, unknown>): string {
  const mentionedBy = escapeHtml(String(vars.mentioned_by ?? 'Someone'));
  const spaceName = escapeHtml(String(vars.space_name ?? 'a space'));
  return `${mentionedBy} mentioned you in ${spaceName}`;
}

export function render(vars: Record<string, unknown>): string {
  const mentionedBy  = escapeHtml(String(vars.mentioned_by  ?? 'Someone'));
  const spaceName    = escapeHtml(String(vars.space_name    ?? 'a space'));
  const rawExcerpt   = String(vars.post_excerpt ?? '');
  const postExcerpt  = escapeHtml(rawExcerpt.length > 200
    ? rawExcerpt.slice(0, 200) + '…'
    : rawExcerpt);
  // post_url is a full https:// URL constructed server-side; encode to be safe.
  const postUrl      = encodeURI(String(vars.post_url ?? '#'));

  return `<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;background:#fff;">

  <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">
    ${mentionedBy} mentioned you in <em>${spaceName}</em>
  </h2>

  <p style="margin:0 0 16px;font-size:14px;color:#555;">
    You were mentioned in a post in the <strong>${spaceName}</strong> community space.
  </p>

  ${postExcerpt ? `<blockquote style="border-left:3px solid #ccc;margin:0 0 16px;padding:8px 12px;color:#444;font-size:14px;background:#f9f9f9;">
    ${postExcerpt}
  </blockquote>` : ''}

  <p style="margin:0 0 24px;">
    <a href="${postUrl}"
       style="display:inline-block;padding:10px 20px;background:#0B1413;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
      View the post
    </a>
  </p>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#999;margin:0;">
    You received this email because you were mentioned in LeanShot Community.<br>
    To change your notification preferences, visit your
    <a href="https://app.leanshot.app/settings/notifications" style="color:#555;">notification settings</a>.
  </p>

</body>
</html>`;
}
