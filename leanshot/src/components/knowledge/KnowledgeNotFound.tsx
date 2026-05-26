/**
 * Phase 60 Plan 60-13 — 404 surface for unknown /knowledge/* paths.
 *
 * Emits noindex meta (client-render caveat: HTTP 404 cannot be set from
 * a SPA; noindex is the accepted fallback per CONTEXT.md "client-render bet").
 */

import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

export function KnowledgeNotFound() {
  return (
    <>
      <Helmet>
        <meta name="robots" content="noindex,nofollow" />
        <title>Page Not Found — LeanShot Knowledge</title>
      </Helmet>
      <div className="max-w-screen-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-text-primary mb-2">Page not found</h1>
        <p className="text-sm text-text-secondary mb-6">
          The page you are looking for does not exist or has been removed.
        </p>
        <Link
          to="/"
          className="text-sm text-accent hover:underline"
        >
          ← Back to Knowledge Base
        </Link>
      </div>
    </>
  );
}
