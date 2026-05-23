// Phase 44 Plan 44-02 — community_reply email template.
//
// Sent when a user receives a reply/comment on their post.
// Non-PHI (no health data in the notification payload) → routes via Resend.
// Note: per D-14 + category_config seed, email_enabled_default=false for
// community-replies — this template is only sent if the user has explicitly
// opted in to email notifications for replies.
//
// vars expected:
//   commenter_name  string  — display name of the user who replied
//   post_excerpt    string  — first ≤200 chars of the original post body
//   comment_excerpt string  — first ≤200 chars of the new comment
//   post_url        string  — full HTTPS URL to the post (anchor to comment if possible)
//
// Security (T-44-05): all user-supplied variables are HTML-escaped before
// interpolation. post_excerpt and comment_excerpt are server-truncated to
// 200 chars before being passed to this template.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function subject(_vars: Record<string, unknown>): string {
  return 'New reply on your post';
}

export function render(vars: Record<string, unknown>): string {
  const commenterName   = escapeHtml(String(vars.commenter_name  ?? 'Someone'));
  const rawPost         = String(vars.post_excerpt    ?? '');
  const rawComment      = String(vars.comment_excerpt ?? '');
  const postExcerpt     = escapeHtml(rawPost.length > 200
    ? rawPost.slice(0, 200) + '…'
    : rawPost);
  const commentExcerpt  = escapeHtml(rawComment.length > 200
    ? rawComment.slice(0, 200) + '…'
    : rawComment);
  // post_url is a full https:// URL constructed server-side; encode to be safe.
  const postUrl         = encodeURI(String(vars.post_url ?? '#'));

  return `<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;background:#fff;">

  <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">
    New reply on your post
  </h2>

  <p style="margin:0 0 16px;font-size:14px;color:#555;">
    <strong>${commenterName}</strong> replied to your post.
  </p>

  ${postExcerpt ? `<p style="margin:0 0 8px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Your post</p>
  <blockquote style="border-left:3px solid #ccc;margin:0 0 16px;padding:8px 12px;color:#666;font-size:13px;background:#f9f9f9;">
    ${postExcerpt}
  </blockquote>` : ''}

  ${commentExcerpt ? `<p style="margin:0 0 8px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Their reply</p>
  <blockquote style="border-left:3px solid #0B1413;margin:0 0 16px;padding:8px 12px;color:#333;font-size:13px;background:#f5f5f5;">
    ${commentExcerpt}
  </blockquote>` : ''}

  <p style="margin:0 0 24px;">
    <a href="${postUrl}"
       style="display:inline-block;padding:10px 20px;background:#0B1413;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
      View the reply
    </a>
  </p>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#999;margin:0;">
    You received this email because someone replied to your post in LeanShot Community.<br>
    To change your notification preferences, visit your
    <a href="https://app.leanshot.app/settings/notifications" style="color:#555;">notification settings</a>.
  </p>

</body>
</html>`;
}
