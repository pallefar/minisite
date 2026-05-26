/**
 * Phase 64 Plan 64-05 stub — AccessibilityPage component.
 * Plan 64-07 routes #/legal/accessibility here; Plan 64-05 replaces this stub
 * with the full WCAG 2.2 AA conformance statement.
 *
 * Stub follows feedback_stub_then_replace_sibling_collision pattern:
 * exports the final prop signature so the App.tsx lazy import resolves.
 */
import { LegalLayout } from './LegalLayout';

export function AccessibilityPage() {
  return (
    <LegalLayout title="Accessibility Statement">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">
        Accessibility Statement
      </h1>
      <p className="text-[var(--color-text-secondary)]">
        This page is loading. Please check back shortly.
      </p>
    </LegalLayout>
  );
}
