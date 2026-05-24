// Phase 45 Plan 45-02 — community_dm_new email template.
//
// Sent when a user receives a new direct message in a community DM thread.
// Non-PHI (no health data in the notification payload) → routes via Resend.
//
// vars expected:
//   sender_handle   string  — anonymized handle of the sender (e.g. "leangrl_42")
//   body_excerpt    string  — first ≤80 chars of the DM body (dompurified +
//                             truncated server-side per D-21)
//   thread_url      string  — full HTTPS URL to the DM thread
//
// Security (T-45-05): all user-supplied variables are HTML-escaped before
// interpolation. The footer/unsubscribe link is rendered inline here;
// email-router does NOT append a global footer for community templates.
//
// Note: body_excerpt is truncated to 80 chars server-side before calling
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
  const senderHandle = escapeHtml(String(vars.sender_handle ?? 'Someone'));
  return `New message from @${senderHandle}`;
}

export function render(vars: Record<string, unknown>): string {
  const senderHandle = escapeHtml(String(vars.sender_handle ?? 'Someone'));
  const rawExcerpt   = String(vars.body_excerpt ?? '');
  const bodyExcerpt  = escapeHtml(rawExcerpt.length > 80
    ? rawExcerpt.slice(0, 80) + '…'
    : rawExcerpt);
  // thread_url is a full https:// URL constructed server-side; encode to be safe.
  const threadUrl    = encodeURI(String(vars.thread_url ?? '#'));

  return `<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;background:#fff;">

  <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">
    New message from <em>@${senderHandle}</em>
  </h2>

  <p style="margin:0 0 16px;font-size:14px;color:#555;">
    <strong>@${senderHandle}</strong> sent you a direct message in LeanShot Community.
  </p>

  ${bodyExcerpt ? `<blockquote style="border-left:3px solid #ccc;margin:0 0 16px;padding:8px 12px;color:#444;font-size:14px;background:#f9f9f9;">
    ${bodyExcerpt}
  </blockquote>` : ''}

  <p style="margin:0 0 24px;">
    <a href="${threadUrl}"
       style="display:inline-block;padding:10px 20px;background:#0B1413;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
      View thread
    </a>
  </p>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#999;margin:0;">
    You received this email because you have direct messages enabled in LeanShot Community.<br>
    To change your notification preferences, visit your
    <a href="https://app.leanshot.app/settings/notifications" style="color:#555;">notification settings</a>.
  </p>

</body>
</html>`;
}
