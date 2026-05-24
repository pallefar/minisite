// Phase 45 Plan 45-02 — community_admin_report_digest email template.
//
// Sent daily (per cron) to staff opted into 'community-admin-report' as a
// summary of open community moderation reports awaiting triage.
//
// Non-PHI (no health data; only target_type + counts) → routes via Resend.
//
// vars expected:
//   open_count    number  — total open reports awaiting triage
//   by_type       Array<{ target_type: string; count: number }>
//                         — per-target-type breakdown rows for the table body
//   digest_date   string  — ISO date string (e.g. "2026-05-24")
//   admin_url     string  — full HTTPS URL to the Phase 48 moderation queue
//                           (placeholder `/admin/community/reports`)
//
// Security (T-45-05): all user-supplied variables are HTML-escaped before
// interpolation. The body_excerpt path doesn't apply here, but target_type
// strings (server-derived but defense-in-depth) are escaped too.
//
// Footer/unsubscribe link is rendered inline here; email-router does NOT
// append a global footer for community templates.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function subject(vars: Record<string, unknown>): string {
  const openCount  = Number.isFinite(vars.open_count as number)
    ? String(vars.open_count)
    : '0';
  const digestDate = escapeHtml(String(vars.digest_date ?? ''));
  return `[LeanShot Admin] ${openCount} open community reports — ${digestDate}`;
}

export function render(vars: Record<string, unknown>): string {
  const openCount  = Number.isFinite(vars.open_count as number)
    ? String(vars.open_count)
    : '0';
  const digestDate = escapeHtml(String(vars.digest_date ?? ''));
  // admin_url is a full https:// URL constructed server-side; encode to be safe.
  const adminUrl   = encodeURI(String(vars.admin_url ?? '#'));

  const byTypeRaw  = Array.isArray(vars.by_type)
    ? vars.by_type as Array<{ target_type?: unknown; count?: unknown }>
    : [];
  const rows = byTypeRaw.map((row) => {
    const targetType = escapeHtml(String(row.target_type ?? 'unknown'));
    const count      = Number.isFinite(row.count as number)
      ? String(row.count)
      : '0';
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:14px;color:#0B1413;">${targetType}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:14px;color:#0B1413;text-align:right;">${count}</td>
    </tr>`;
  }).join('\n');

  return `<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;background:#fff;">

  <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">
    Community moderation digest — ${digestDate}
  </h2>

  <p style="margin:0 0 16px;font-size:14px;color:#555;">
    <strong>${openCount}</strong> open report${openCount === '1' ? '' : 's'} are awaiting staff review.
  </p>

  ${rows ? `<table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 16px;background:#f9f9f9;">
    <thead>
      <tr>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#555;border-bottom:2px solid #ccc;text-transform:uppercase;letter-spacing:0.04em;">Target type</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#555;border-bottom:2px solid #ccc;text-transform:uppercase;letter-spacing:0.04em;">Open count</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>` : ''}

  <p style="margin:0 0 24px;">
    <a href="${adminUrl}"
       style="display:inline-block;padding:10px 20px;background:#0B1413;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
      Review queue
    </a>
  </p>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#999;margin:0;">
    You received this email because you are opted into the LeanShot Community admin report digest.<br>
    To change your notification preferences, visit your
    <a href="https://app.leanshot.app/settings/notifications" style="color:#555;">notification settings</a>.
  </p>

</body>
</html>`;
}
