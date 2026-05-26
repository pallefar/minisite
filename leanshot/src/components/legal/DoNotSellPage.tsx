/**
 * Phase 64 Plan 64-05 stub — DoNotSellPage component.
 * Plan 64-07 routes #/privacy/do-not-sell here; Plan 64-05 replaces this stub
 * with the full CPRA opt-out form wired to the privacy_optout_requests table.
 *
 * Stub follows feedback_stub_then_replace_sibling_collision pattern:
 * exports the final prop signature so the App.tsx lazy import resolves.
 */
import { LegalLayout } from './LegalLayout';

export function DoNotSellPage() {
  return (
    <LegalLayout title="Do Not Sell or Share My Personal Information">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">
        Do Not Sell or Share My Personal Information
      </h1>
      <p className="text-[var(--color-text-secondary)]">
        This page is loading. Please check back shortly.
      </p>
    </LegalLayout>
  );
}
