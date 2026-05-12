// Phase 7 Plan 07-02 — Shared chrome for all four policy pages.
//
// Purpose: structural-only layout (header with back-to-app link, max-width
// content container, footer reusing <LegalFooter />). Plans 07-03 (WMHMDA
// CHDP) and 07-04 (privacy/terms/disclaimer) fill the children slot with
// authored content; this file should NOT change between Phase 7 plans.
//
// The `title` prop is currently unused in render (Phase 7 ships no router
// and no <title> wiring) but is retained on the API surface to document the
// contract for 07-03/07-04 and to enable future per-page <title> writes
// without breaking signatures.

import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { LegalFooter } from '@/components/layout/LegalFooter';

export interface LegalLayoutProps {
  title: string;
  children: ReactNode;
}

export function LegalLayout({ title, children }: LegalLayoutProps): ReactNode {
  // `title` is part of the API contract (see file-header) but not currently
  // rendered — reference it once to keep TS strict (noUnusedParameters) happy
  // without an underscore-prefix rename that would change the public shape.
  void title;
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
      <main className="max-w-[800px] mx-auto px-5 py-10">{children}</main>
      <LegalFooter variant="marketing" />
    </div>
  );
}
