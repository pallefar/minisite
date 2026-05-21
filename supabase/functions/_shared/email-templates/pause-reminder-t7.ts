// Phase 40 Plan 40-02 — pause_reminder_t7 email template (D-09, T-7d reminder).
//
// Sent 7 days before a paused subscription auto-resumes.
// PHI flag is caller-authoritative (pause-reminder-fire Fn derives from clinic_id IS NOT NULL).
// Non-PHI for consumer subs → Resend.
// PHI for clinic-org subs → SES.
//
// vars expected:
//   user_first_name  string  — recipient first name (falls back to 'there')
//   resumes_at       string  — ISO timestamp of auto-resume date
//   last4            string? — card last 4 digits if available ('on file' fallback)

export function subject(vars: Record<string, unknown>): string {
  const date = _formatDate(vars.resumes_at);
  return `Your LeanShot subscription resumes ${date}`;
}

export function render(vars: Record<string, unknown>): string {
  const firstName = String(vars.user_first_name ?? 'there');
  const date = _formatDate(vars.resumes_at);
  const last4 = vars.last4 ? `ending in ${String(vars.last4)}` : 'on file';

  return [
    `Hi ${firstName},`,
    '',
    `Just a heads-up — your LeanShot subscription is set to automatically resume on ${date}.`,
    '',
    `Your card ${last4} will be charged on that date. Everything you've logged during your pause — your med curves, weight trends, and activity history — is right where you left it.`,
    '',
    'Your options before then:',
    '  • Extend your pause for another month',
    '  • Resume billing early and get back to full access now',
    '',
    'Visit app.leanshot.app/settings to manage your subscription.',
    '',
    'If you have any questions, reply to this email — we\'re happy to help.',
    '',
    '— The LeanShot Team',
  ].join('\n');
}

/** Format an ISO timestamp (or Unix seconds number) to a human-readable date. */
function _formatDate(resumes_at: unknown): string {
  if (!resumes_at) return 'soon';
  try {
    const ts = typeof resumes_at === 'number' ? resumes_at * 1000 : Date.parse(String(resumes_at));
    if (Number.isNaN(ts)) return 'soon';
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return 'soon';
  }
}
