/**
 * Phase 36 Plan 36-04 — admin reviews module entry.
 *
 * AdminShell consumes this via `@/admin/modules/reviews` and expects the
 * default export to be a router component. AdminShell.tsx already prefix-
 * branches `/admin/reviews/*` to here (per [[admin-module-manifest-vs-router-branch-drift]]);
 * this layout owns the trailing-segment switch.
 *
 * Sub-routes:
 *   /admin/reviews             → rules (default landing)
 *   /admin/reviews/rules       → RulesListPage
 *   /admin/reviews/funnel      → FunnelDashboardPage
 *   /admin/reviews/cta-catalog → CtaCatalogPage
 *
 * No react-router — pathname-based routing (CLAUDE.md constraint).
 */
import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType } from 'react';

const RulesListPage = lazy(() => import('./RulesListPage'));
const FunnelDashboardPage = lazy(() => import('./FunnelDashboardPage'));
const CtaCatalogPage = lazy(() => import('./CtaCatalogPage'));

interface SubRoute {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly Component: ComponentType;
}

const SUB_ROUTES: readonly SubRoute[] = [
  { key: 'rules', label: 'Rules', path: 'rules', Component: RulesListPage },
  { key: 'funnel', label: 'Funnel', path: 'funnel', Component: FunnelDashboardPage },
  { key: 'cta-catalog', label: 'CTA Catalog', path: 'cta-catalog', Component: CtaCatalogPage },
];

function resolveActive(pathname: string): SubRoute {
  // Match the segment AFTER /admin/reviews/. Bare /admin/reviews → 'rules' default.
  const m = pathname.match(/^\/admin\/reviews\/?([^/]+)?/);
  const seg = (m?.[1] ?? 'rules').toLowerCase();
  return SUB_ROUTES.find((r) => r.path === seg) ?? SUB_ROUTES[0];
}

export default function ReviewsLayout(): React.JSX.Element {
  const [pathname, setPathname] = useState<string>(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const active = useMemo(() => resolveActive(pathname), [pathname]);

  return (
    <div className="reviews-module space-y-6">
      <nav
        aria-label="Reviews sub-pages"
        className="flex flex-wrap gap-1 border-b border-[var(--color-border)] pb-2"
      >
        {SUB_ROUTES.map((r) => {
          const isActive = r.key === active.key;
          return (
            <a
              key={r.key}
              href={`/admin/reviews/${r.path}`}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive
                  ? 'inline-flex items-center h-8 px-3 rounded-pill text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'inline-flex items-center h-8 px-3 rounded-pill text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
              }
            >
              {r.label}
            </a>
          );
        })}
      </nav>

      <Suspense
        fallback={<div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>}
      >
        <active.Component />
      </Suspense>
    </div>
  );
}
