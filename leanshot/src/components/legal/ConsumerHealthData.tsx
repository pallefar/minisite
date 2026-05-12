// Phase 7 Plan 07-02 — WMHMDA Consumer Health Data Privacy Policy placeholder.
// RCW 19.373.030(1)(b) requires this notice be linked separately +
// conspicuously from the homepage; that wiring lands in Task 3 (LegalFooter
// rendered on Landing.tsx + AppShell.tsx). Content authoring lands in
// Plan 07-03.
//
// The `data-todo` attribute is the contract the e2e spec asserts.

import { LegalLayout } from './LegalLayout';

export function ConsumerHealthData() {
  return (
    <LegalLayout title="Consumer Health Data">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Consumer Health Data</h1>
      <div data-todo="07-03" hidden />
      <p className="text-[var(--color-text-secondary)] leading-relaxed">
        Washington residents: this notice describes how LeanShot collects, uses,
        and shares consumer health data under My Health, My Data Act
        (RCW 19.373). Full text lands in Plan 07-03.
      </p>
    </LegalLayout>
  );
}

export default ConsumerHealthData;
