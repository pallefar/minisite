/**
 * Phase 62 Plan 62-06 Task 2 — Top-level router for the public /research/* hub.
 *
 * Uses react-router <BrowserRouter basename="/research"> scoped to the
 * /research subtree. This is the SAME pattern as KnowledgeRoute.tsx.
 * Consumer-phase widening per reference_react_router_consumer_admin_split.
 *
 * Route structure:
 *   /research/         → ResearchIndexPage (index route)
 *   /research/<slug>   → ResearchArticlePage with slug from params
 *   /research/*        → ResearchNotFound
 *
 * No Sidebar / Topbar / MobileNav — this is a public no-auth leaf surface
 * (same isolation model as /knowledge/* and /verify/).
 *
 * Lazy-loaded individually so each route is its own Vite chunk.
 * Target ≤30 kB gz per CLAUDE.md bundle constraint.
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { ResearchNotFound } from './ResearchNotFound';

const ResearchIndexPage = lazy(() =>
  import('./ResearchIndexPage').then((m) => ({ default: m.ResearchIndexPage })),
);

// Wrapper component to extract slug from URL params and pass to ResearchArticlePage
function ResearchArticleWrapper() {
  const { slug = '' } = useParams<{ slug: string }>();
  const ResearchArticlePageLazy = lazy(() =>
    import('./ResearchArticlePage').then((m) => ({ default: m.ResearchArticlePage })),
  );
  return (
    <Suspense fallback={<ResearchFallback />}>
      <ResearchArticlePageLazy slug={slug} />
    </Suspense>
  );
}

function ResearchFallback() {
  return (
    <div className="max-w-screen-md mx-auto px-4 py-8 space-y-4">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

export default function ResearchRoute() {
  return (
    // BrowserRouter scoped to /research — never bleeds into the consumer
    // SPA routing (Zustand TabId). The entire /research subtree is isolated.
    <BrowserRouter basename="/research">
      <Routes>
        <Route
          index
          element={
            <Suspense fallback={<ResearchFallback />}>
              <ResearchIndexPage />
            </Suspense>
          }
        />
        <Route path=":slug" element={<ResearchArticleWrapper />} />
        <Route path="*" element={<ResearchNotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
