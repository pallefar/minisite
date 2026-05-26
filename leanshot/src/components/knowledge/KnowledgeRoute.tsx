/**
 * Phase 60 Plan 60-13 — Top-level router for the public /knowledge/* SEO hub.
 *
 * Uses react-router <BrowserRouter basename="/knowledge"> scoped to the
 * /knowledge subtree. This is the SAME pattern as admin pages (AdminLayout),
 * NOT a full SPA router — CLAUDE.md "No router" constraint applies only to
 * the consumer dashboard (TabId + Zustand). Consumer-phase widening is
 * EXPLICITLY ALLOWED per reference_react_router_consumer_admin_split.
 *
 * Page chunks are lazy-loaded individually so each route is its own Vite
 * chunk (≤30 kB gz target per CLAUDE.md bundle constraint).
 *
 * No Sidebar / Topbar / MobileNav — this is a public no-auth leaf surface
 * (same isolation model as /verify/ and /share/).
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { KnowledgeNotFound } from './KnowledgeNotFound';

const KnowledgeRootPage = lazy(() =>
  import('./KnowledgeRootPage').then((m) => ({ default: m.KnowledgeRootPage })),
);
const KnowledgeTopicIndexPage = lazy(() =>
  import('./KnowledgeTopicIndexPage').then((m) => ({ default: m.KnowledgeTopicIndexPage })),
);
const KnowledgeArticleDetailPage = lazy(() =>
  import('./KnowledgeArticleDetailPage').then((m) => ({ default: m.KnowledgeArticleDetailPage })),
);

function KnowledgeFallback() {
  return (
    <div className="max-w-screen-lg mx-auto px-4 py-8 space-y-4">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

export default function KnowledgeRoute() {
  return (
    // BrowserRouter scoped to /knowledge — never bleeds into the consumer
    // SPA routing (Zustand TabId). The entire /knowledge subtree is isolated.
    <BrowserRouter basename="/knowledge">
      <Routes>
        <Route
          index
          element={
            <Suspense fallback={<KnowledgeFallback />}>
              <KnowledgeRootPage />
            </Suspense>
          }
        />
        <Route
          path=":topic"
          element={
            <Suspense fallback={<KnowledgeFallback />}>
              <KnowledgeTopicIndexPage />
            </Suspense>
          }
        />
        <Route
          path=":topic/:slug"
          element={
            <Suspense fallback={<KnowledgeFallback />}>
              <KnowledgeArticleDetailPage />
            </Suspense>
          }
        />
        <Route path="*" element={<KnowledgeNotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
