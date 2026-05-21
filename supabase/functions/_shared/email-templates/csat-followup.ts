// Phase 37 Plan 37-02 Task 3 — csat_followup template (non-PHI, routes via Resend).
//
// Sent ~5 minutes after a ticket is resolved (Plan 37-05 / HELP-04). Body
// contains no protected health data — only a CSAT score link with a one-way
// HMAC token (Plan 37-06 owns the score-link generation).
//
// Anti-patterns avoided per [[feedback_planner_iter1_anti_patterns]]:
//   - Templates do NOT infer phi from the name — the router reads `args.phi`
//     and the CALLER is authoritative. csat_followup is non-PHI by design but
//     a buggy caller passing phi=true would still route to SES (the
//     vendor-gate would then block if BAA is pending).

export function subject(vars: Record<string, unknown>): string {
  const ref = String(vars.ticket_ref ?? '????????').slice(0, 8);
  return `How did we do? — Ticket #${ref}`;
}

export function render(vars: Record<string, unknown>): string {
  const url = String(vars.csat_url ?? '');
  return [
    'Hi!',
    '',
    "Your support ticket was just resolved. We'd love your feedback — it takes 10 seconds:",
    '',
    url,
    '',
    '— LeanShot Support',
  ].join('\n');
}
