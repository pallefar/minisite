// Phase 7 Plan 07-02 — Terms of Service placeholder page.
// Content lands in Plan 07-04.

import { LegalLayout } from './LegalLayout';

export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Terms of Service</h1>
      <div data-todo="07-04" hidden />
      <p className="text-[var(--color-text-secondary)] leading-relaxed">
        These terms are being authored. Plan 07-04 will cover the educational- tool framing, the
        &ldquo;no medical advice&rdquo; stance, account-data rights, and the
        disclaimer-acknowledgement contract Phase 2 introduced.
      </p>
    </LegalLayout>
  );
}

export default TermsOfService;
