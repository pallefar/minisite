// Phase 40 Plan 40-02 — pause_resumed_t0 email template (D-09, T-0 confirmation).
//
// Sent on the day a paused subscription auto-resumes (billing restarts).
// Triggered by stripe-webhook/events/subscription-updated.ts when it detects
// the pause_collection → null transition (auto-resume event).
// PHI flag is caller-authoritative (derived from subscription.clinic_id IS NOT NULL).
//
// vars expected:
//   user_first_name  string  — recipient first name (falls back to 'there')
//   resumed_at       string  — ISO timestamp of resume (for display only)

export function subject(_vars: Record<string, unknown>): string {
  return 'Welcome back — your LeanShot subscription resumed today';
}

export function render(vars: Record<string, unknown>): string {
  const firstName = String(vars.user_first_name ?? 'there');

  return [
    `Hi ${firstName},`,
    '',
    'Great news — your LeanShot subscription resumed today and full access has been restored.',
    '',
    'You can now log injections, meals, workouts, and body measurements again. Your med-level curve and all historical data are still there, updated and ready.',
    '',
    'Welcome back!',
    '',
    'Visit app.leanshot.app to get started.',
    '',
    'If anything looks off, reply to this email and we\'ll sort it out.',
    '',
    '— The LeanShot Team',
  ].join('\n');
}
