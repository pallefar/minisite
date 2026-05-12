// Phase 7 Plan 07-02 — Medical Disclaimer placeholder page.
// Content lands in Plan 07-04.

import { LegalLayout } from './LegalLayout';

export function MedicalDisclaimer() {
  return (
    <LegalLayout title="Medical Disclaimer">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Medical Disclaimer</h1>
      <div data-todo="07-04" hidden />
      <p className="text-[var(--color-text-secondary)] leading-relaxed">
        LeanShot is an educational tracking tool. It is not medical advice and
        does not replace consultation with a qualified prescriber. Full
        disclaimer text lands in Plan 07-04.
      </p>
    </LegalLayout>
  );
}

export default MedicalDisclaimer;
