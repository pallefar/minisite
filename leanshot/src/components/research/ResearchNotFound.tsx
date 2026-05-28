/**
 * Phase 62 Plan 62-06 Task 2 — 404 fallback for unknown /research/* paths.
 *
 * Rendered when:
 *   - URL matches /research/<slug> but slug is not a published publication.
 *   - Pathname does not match /research or /research/<slug>.
 *
 * UI-SPEC §Surface 4 (404 state):
 *   - Heading "Paper not found" (18px/600, text-secondary) — UI-SPEC specifies 18px here
 *   - Body "This publication is not available or has not been published." (13px/400, text-secondary)
 *   - "Browse all research →" link (text-primary)
 *
 * Note: NO noindex meta — the research hub is SEO-discoverable (inverts Phase 60-13 decision).
 * Phase 60-13 KnowledgeNotFound added noindex; this component intentionally omits it.
 */

import { Helmet } from 'react-helmet-async';

export function ResearchNotFound() {
  return (
    <>
      <Helmet>
        <title>Paper Not Found — LeanShot Research</title>
      </Helmet>
      <div className="max-w-screen-md mx-auto px-4 py-16 text-center">
        <h1 className="text-[18px] font-semibold text-[var(--color-text)] mb-2">Paper not found</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
          This publication is not available or has not been published.
        </p>
        <a
          href="/research"
          className="text-[13px] text-[var(--color-primary)] hover:underline underline-offset-4"
        >
          Browse all research →
        </a>
      </div>
    </>
  );
}

export default ResearchNotFound;
