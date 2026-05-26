/**
 * Phase 62 Plan 62-04 — ResearchLayout shell.
 *
 * Hosts sub-routes under /admin/research:
 *   /admin/research          → defaults to CohortBuilderPage (cohort)
 *   /admin/research/cohort   → CohortBuilderPage
 *   /admin/research/publications → PublicationsListPage (Plan 62-05)
 *   /admin/research/review   → PublicationsListPage with status=in_review filter (Plan 62-05)
 *
 * Routing model: pathname-based, no react-router (CLAUDE.md SPA constraint).
 * Sub-nav links use plain <a href> so the AdminShell parent re-matches the
 * outer module on navigation (same pattern as ProtocolsLayout, RagLayout).
 *
 * Active-nav accent uses --color-primary per UI-SPEC §accent reserved-for #2.
 *
 * Typography: ONLY text-[13px] (sub-nav labels) per Phase 60 BLOCKER lesson.
 *
 * Mirrors ProtocolsLayout.tsx verbatim per PATTERNS.md + feedback_planner_prompt_explicit_reuse_targets.
 */
import React, { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';

// CohortBuilderPage ships in this plan (Task 2).
// Resilient lazy import — avoids compile-time errors when building before Task 2 commits.
// Per [[feedback_stub_then_replace_sibling_collision]] pattern.
const COHORT_MODULE_PATH = './CohortBuilderPage';
const CohortBuilderPage = lazy(() =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import(/* @vite-ignore */ COHORT_MODULE_PATH) as Promise<any>)
    .then((m) => ({ default: (m.CohortBuilderPage ?? m.default) as React.ComponentType }))
    .catch((): { default: React.ComponentType } => ({
      default: () => null,
    })),
);

// PublicationsListPage ships in Plan 62-05. Resilient stub via @vite-ignore
// to avoid compile-time errors in parallel Wave 1 development.
// Per [[feedback_stub_then_replace_sibling_collision]] pattern.
const PUBLICATIONS_MODULE_PATH = './PublicationsListPage';
const PublicationsListPage = lazy(() =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import(/* @vite-ignore */ PUBLICATIONS_MODULE_PATH) as Promise<any>)
    .then((m) => ({ default: (m.PublicationsListPage ?? m.default) as React.ComponentType }))
    .catch((): { default: React.ComponentType } => ({
      default: () => null,
    })),
);

interface SubRoute {
  readonly key: string;
  readonly label: string;
  readonly path: string; // suffix after /admin/research/
  readonly Component: ComponentType;
}

const SUB_ROUTES: readonly SubRoute[] = [
  { key: 'cohort',       label: 'Cohort Builder', path: 'cohort',       Component: CohortBuilderPage },
  { key: 'publications', label: 'Publications',   path: 'publications', Component: PublicationsListPage },
  { key: 'review',       label: 'Review Queue',   path: 'review',       Component: PublicationsListPage },
] as const;

type SubRouteKey = 'cohort' | 'publications' | 'review';
const DEFAULT_KEY: SubRouteKey = 'cohort';

function resolveActive(pathname: string): SubRoute {
  // pathname forms: /admin/research, /admin/research/, /admin/research/cohort,
  // /admin/research/publications, /admin/research/review
  const m = pathname.match(/^\/admin\/research\/?(?:([^/]+).*)?$/);
  const seg = (m?.[1] ?? '').toLowerCase();
  const found = SUB_ROUTES.find((r) => r.path === seg);
  return found ?? SUB_ROUTES.find((r) => r.key === DEFAULT_KEY)!;
}

export function ResearchLayout() {
  // Track pathname imperatively (no router) so back/forward updates the view.
  const [pathname, setPathname] = useState<string>(
    typeof window !== 'undefined'
      ? window.location.pathname
      : `/admin/research/${DEFAULT_KEY}`,
  );

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const active = resolveActive(pathname);
  const Active = active.Component;

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      {/* Left sub-nav */}
      <nav
        aria-label="Research sections"
        className="lg:sticky lg:top-4 lg:self-start"
      >
        <ul className="flex flex-wrap lg:flex-col gap-1">
          {SUB_ROUTES.map((r) => {
            const isActive = active.key === r.key;
            return (
              <li key={r.key}>
                <a
                  href={`/admin/research/${r.path}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'inline-flex w-full items-center h-9 px-3 rounded-pill text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'inline-flex w-full items-center h-9 px-3 rounded-pill text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
                  }
                >
                  {r.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Content area — UI-SPEC §A1 container rule */}
      <main className="max-w-screen-xl">
        <Suspense
          fallback={
            <div className="p-6 text-[13px] text-[var(--color-text-secondary)]">Loading…</div>
          }
        >
          <Active />
        </Suspense>
      </main>
    </div>
  );
}

export default ResearchLayout;
