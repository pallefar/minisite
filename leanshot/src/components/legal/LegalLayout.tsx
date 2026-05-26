// Phase 7 Plan 07-02 — Shared chrome for all four policy pages.
//
// Purpose: structural-only layout (header with back-to-app link, max-width
// content container, footer reusing <LegalFooter />). Plans 07-03 (WMHMDA
// CHDP) and 07-04 (privacy/terms/disclaimer) fill the children slot with
// authored content; this file should NOT change between Phase 7 plans.
//
// Renders the title prop as the page H1 per Phase 64 UI-SPEC §Surfaces in Scope.
// All /legal/* callers that previously rendered their own internal <h1> must
// remove that internal heading to maintain the single-H1 invariant.
// (Plan 64-04 owns PrivacyPolicy.tsx + TermsOfService.tsx — merger/Plan 64-08
// close-out must verify: `grep -c "<h1" src/components/legal/*.tsx` expects 1
// per file. MedicalDisclaimer.tsx + ConsumerHealthData.tsx are patched in this plan.)

import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { LegalFooter } from '@/components/layout/LegalFooter';

export interface LegalLayoutProps {
  title: string;
  children: ReactNode;
}

export function LegalLayout({ title, children }: LegalLayoutProps): ReactNode {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="border-b border-[var(--color-border)] py-4 px-5">
        <div className="max-w-[800px] mx-auto flex items-center justify-between">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] hover:underline focus-visible:underline"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to LeanShot
          </a>
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Legal
          </span>
        </div>
      </header>
      <main className="max-w-[800px] mx-auto px-5 py-10">
        <h1 className="text-heading font-display font-semibold mb-8 text-[var(--color-text)]">
          {title}
        </h1>
        {children}
      </main>
      <LegalFooter variant="marketing" />
    </div>
  );
}
