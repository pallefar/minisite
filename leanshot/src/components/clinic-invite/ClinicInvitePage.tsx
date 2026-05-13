// Phase 9 Plan 09-01 Wave-0 stub. Plan 09-04 OVERWRITES this file with the
// invite-acceptance flow (token lookup → State A/B/C/D branch → consent
// dialog → accept/reject).
//
// Anti-pattern guard: Plan 09-04's real component MUST NOT call useStore
// from this path — patient may be anonymous when the page first loads
// (Pitfall RESEARCH §"Anti-Patterns"). Read query params + Edge Function
// lookup result first; defer store reads until State B (consent dialog).

export function ClinicInvitePage() {
  return (
    <div
      role="main"
      className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text-secondary)]"
    >
      <p>Phase 9 stub — Plan 09-04 overwrites this file.</p>
    </div>
  );
}

export default ClinicInvitePage;
