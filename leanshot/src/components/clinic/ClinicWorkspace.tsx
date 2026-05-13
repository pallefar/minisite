// Phase 9 Plan 09-01 Wave-0 stub. Plan 09-02 OVERWRITES this file with the
// real workspace home (operator roster shell + Invite patient CTA + clinic-
// context bar).
//
// B-2 ownership rule (plan-checker iter 1): Plan 09-01 creates this stub
// AND wires App.tsx's lazy routing to it; Plan 09-02 only overwrites the
// stub body — it does NOT touch App.tsx.

export function ClinicWorkspace() {
  return (
    <div
      role="main"
      className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text-secondary)]"
    >
      <p>Phase 9 stub — Plan 09-02 overwrites this file.</p>
    </div>
  );
}

export default ClinicWorkspace;
