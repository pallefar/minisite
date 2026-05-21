// Phase 37 Plan 37-02 Task 3 — sla_breach_alert template (internal, non-PHI).
//
// Internal alert sent to the on-call agent list when a ticket misses its tier
// SLA. Contains only ticket reference, tier, breach-type, elapsed minutes,
// target minutes, and an admin URL — no patient identifiers, no message body.
// Caller hardcodes phi=false even when the underlying ticket is PHI.
//
// Subject line is plain text; vars are String()-coerced and length-clamped to
// guard against accidental control characters or oversized inputs in headers
// (T-37-02-06 in the threat register).

export function subject(vars: Record<string, unknown>): string {
  const ref  = String(vars.ticket_ref ?? '????????').slice(0, 8);
  const tier = String(vars.tier ?? 'p?').slice(0, 4).toUpperCase();
  return `[SLA breach] Ticket #${ref} — ${tier}`;
}

export function render(vars: Record<string, unknown>): string {
  const ref            = String(vars.ticket_ref ?? '').slice(0, 8);
  const tier           = String(vars.tier ?? 'p?');
  const breachType     = String(vars.breach_type ?? 'first_response');
  const elapsedMinutes = String(vars.elapsed_minutes ?? '?');
  const targetMinutes  = String(vars.target_minutes ?? '?');
  const url            = String(vars.admin_url ?? 'https://app.leanshot.app/admin/helpdesk');
  return [
    'SLA breach detected.',
    '',
    `Ticket:         #${ref}`,
    `Tier:           ${tier}`,
    `Breach type:    ${breachType}`,
    `Elapsed (min):  ${elapsedMinutes}`,
    `SLA target:     ${targetMinutes}`,
    '',
    `Open in admin: ${url}`,
  ].join('\n');
}
