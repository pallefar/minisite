// Phase 37 Plan 37-02 Task 3 — helpdesk_agent_reply template (PHI-aware).
//
// Sent when an agent replies to a ticket. The body may contain protected
// health information (PHI) — the CALLER is authoritative on `phi` and chooses
// the routing vendor (PHI → SES under BAA; non-PHI → Resend).
//
// The `reply_to` var is the per-ticket Reply-To address constructed via the
// HMAC token in `_shared/helpdesk-hmac.ts` (Task 4). When the patient replies,
// helpdesk-inbound (Plan 37-03) verifies the token + matches the message to
// the right ticket — no DB round-trip needed at verify time.

export function subject(vars: Record<string, unknown>): string {
  // Caller passes the original ticket subject prefixed with "Re: " — fall back
  // to a safe generic if absent. Plain text only on the subject line.
  return String(vars.subject ?? 'Re: Your support ticket');
}

export function render(vars: Record<string, unknown>): string {
  const body = String(vars.body ?? '');
  const replyTo = String(vars.reply_to ?? 'reply@app.leanshot.app');
  return [
    body,
    '',
    '—',
    'Reply to this email to continue the conversation, or visit',
    'https://app.leanshot.app/help to manage your ticket.',
    '',
    `Reply-To: ${replyTo}`,
  ].join('\n');
}
