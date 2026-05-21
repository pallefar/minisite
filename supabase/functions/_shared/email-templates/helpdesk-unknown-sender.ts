// Phase 37 Plan 37-02 Task 3 — helpdesk_unknown_sender auto-reply (non-PHI).
//
// CONTEXT D-21: when helpdesk-inbound receives an email from an address with
// no matching profile, we reply with a signup CTA rather than silently
// creating a ticket. Contains no patient data — routes via Resend.

export function subject(_vars: Record<string, unknown>): string {
  return 'Thanks for reaching out — quick next step';
}

export function render(vars: Record<string, unknown>): string {
  const signupUrl = String(vars.signup_url ?? 'https://app.leanshot.app/signup');
  return [
    'Hi!',
    '',
    'Thanks for emailing LeanShot support. To open a ticket and track its',
    'progress, please sign up here first:',
    '',
    signupUrl,
    '',
    "Once you're signed up, just reply to this email and we'll get your",
    'question into our queue.',
    '',
    '— LeanShot Support',
  ].join('\n');
}
