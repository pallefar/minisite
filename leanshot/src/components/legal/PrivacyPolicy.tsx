// Phase 7 Plan 07-02 — Privacy Policy placeholder page.
// Content lands in Plan 07-04 (Termly-derived authoring).
//
// The `data-todo` attribute is the contract the e2e spec asserts; the value
// names the authoring plan that fills this slot. Do not remove it without
// updating e2e/legal-pages.spec.ts.

import { LegalLayout } from './LegalLayout';

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Privacy Policy</h1>
      <div data-todo="07-04" hidden />
      <p className="text-[var(--color-text-secondary)] leading-relaxed">
        This policy is being authored. Plan 07-04 will enumerate the 17 data
        categories the app collects (injection logs, body metrics, mood, sleep,
        meals, workouts, photos, etc.) and the local-first storage posture
        described in the marketing footer.
      </p>
    </LegalLayout>
  );
}

export default PrivacyPolicy;
