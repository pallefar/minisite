/**
 * Phase 37 Plan 37-07 — HelpdeskLayout (HELP-04, HELP-12).
 *
 * Sub-nav shell for the helpdesk admin module. Models on
 * `src/components/admin/rag/RagLayout.tsx` (CSS-grid 2-col with sticky nav).
 *
 * Sub-route resolution:
 *   /admin/helpdesk            → inbox
 *   /admin/helpdesk/inbox      → inbox
 *   /admin/helpdesk/kb         → KB editor       (Plan 37-08 — placeholder)
 *   /admin/helpdesk/macros     → Macro editor    (Plan 37-08 — placeholder)
 *   /admin/helpdesk/routing    → Routing rules   (Plan 37-08 — placeholder)
 *   /admin/helpdesk/sla        → SLA targets     (Plan 37-08 — placeholder)
 *   /admin/helpdesk/sentiment  → Needs-attention queue (this plan)
 *   /admin/helpdesk/trends     → Trends dashboard (Plan 37-08 — placeholder)
 *
 * AdminShell prefix-branch (line 124 of AdminShell.tsx) already routes ALL
 * /admin/helpdesk/* paths here; this layout owns the secondary navigation.
 *
 * Unknown sub-segments fall through to inbox (default) — see resolveActive().
 * This prevents 404 drift per [[admin-module-manifest-vs-router-branch-drift]].
 */
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';

const HelpdeskInboxPage = lazy(() => import('./HelpdeskInboxPage'));
const SentimentQueuePage = lazy(() => import('./SentimentQueuePage'));

// Placeholder factory — returns a tiny inline component that doesn't need its
// own file. Plan 37-08 will replace these lazy imports with real pages.
function makePlaceholder(label: string): ComponentType {
  const C = () => (
    <div className="p-6 text-sm text-[var(--color-text-secondary)]">
      {label}
    </div>
  );
  C.displayName = `HelpdeskPlaceholder(${label})`;
  return C;
}

const KBEditorPage = makePlaceholder('Knowledge Base — see Plan 08');
const MacroEditorPage = makePlaceholder('Macros — see Plan 08');
const RoutingRulesPage = makePlaceholder('Routing Rules — see Plan 08');
const SLATargetsPage = makePlaceholder('SLA Targets — see Plan 08');
const TrendsDashboardPage = makePlaceholder('Trends — see Plan 08');

interface SubRoute {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly Component: ComponentType;
}

const SUB_ROUTES: readonly SubRoute[] = [
  { key: 'inbox', label: 'Inbox', path: 'inbox', Component: HelpdeskInboxPage },
  { key: 'kb', label: 'Knowledge Base', path: 'kb', Component: KBEditorPage },
  { key: 'macros', label: 'Macros', path: 'macros', Component: MacroEditorPage },
  { key: 'routing', label: 'Routing Rules', path: 'routing', Component: RoutingRulesPage },
  { key: 'sla', label: 'SLA Targets', path: 'sla', Component: SLATargetsPage },
  { key: 'sentiment', label: 'Sentiment Queue', path: 'sentiment', Component: SentimentQueuePage },
  { key: 'trends', label: 'Trends', path: 'trends', Component: TrendsDashboardPage },
];

function resolveActive(pathname: string): SubRoute {
  // Match the segment AFTER /admin/helpdesk/ — e.g.
  //   /admin/helpdesk          → '' → falls to default (inbox)
  //   /admin/helpdesk/inbox    → 'inbox'
  //   /admin/helpdesk/sentiment → 'sentiment'
  //   /admin/helpdesk/inbox/<id> → 'inbox' (deeper paths resolve to top segment)
  const m = pathname.match(/^\/admin\/helpdesk\/?([^/]+)?/);
  const seg = (m?.[1] ?? 'inbox').toLowerCase();
  return SUB_ROUTES.find((r) => r.path === seg) ?? SUB_ROUTES[0];
}

export default function HelpdeskLayout(): React.JSX.Element {
  // Mirror AdminShell's pathname-based routing — re-render on popstate.
  // We also listen for `pushstate`/`replacestate` synthesised events; sub-pages
  // mutating history.pushState() can dispatch a synthetic `popstate` to trigger
  // a re-render here (HelpdeskInboxPage slide-over is in-process only and does
  // not change pathname, so this is mostly forward-compat).
  const [pathname, setPathname] = useState<string>(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const active = useMemo(() => resolveActive(pathname), [pathname]);
  const Active = active.Component;

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <nav
        aria-label="Helpdesk sections"
        className="flex flex-col gap-1 lg:sticky lg:top-4 lg:self-start"
      >
        {SUB_ROUTES.map((r) => {
          const isActive = active.key === r.key;
          return (
            <a
              key={r.key}
              href={`/admin/helpdesk/${r.path}`}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive
                  ? 'px-3 py-2 rounded text-sm font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'px-3 py-2 rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]'
              }
            >
              {r.label}
            </a>
          );
        })}
      </nav>
      <main className="max-w-screen-xl">
        <Suspense
          fallback={
            <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>
          }
        >
          <Active />
        </Suspense>
      </main>
    </div>
  );
}
