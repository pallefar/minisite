/**
 * Phase 50 Plan 50-02 — RagLayout shell.
 *
 * Hosts 5 sub-routes under /admin/rag:
 *   /admin/rag           → redirect-equivalent: defaults to Topics
 *   /admin/rag/topics    → RagTopicsPage
 *   /admin/rag/sources   → RagSourcesPage
 *   /admin/rag/queue     → placeholder (Plan 50-06 ships review queue)
 *   /admin/rag/telemetry → renders rag_topic_telemetry_7d() output
 *   /admin/rag/cost      → placeholder (Plan 50-09 finalizes cost dashboard)
 *
 * Routing model: pathname-based, no react-router (CLAUDE.md SPA constraint).
 * Sub-nav links use plain `<a href>` so the AdminShell parent re-matches the
 * outer module on navigation (same pattern as AdminShell).
 *
 * Active-nav accent uses --color-primary per UI-SPEC §A1 Color rule.
 */
import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

const RagTopicsPage = lazy(() => import('./RagTopicsPage'));
const RagSourcesPage = lazy(() => import('./RagSourcesPage'));
const RagQueuePage = lazy(() => import('./RagQueuePage'));

interface TelemetryRow {
  topic_id: string;
  tag: string;
  docs_ingested: number;
  rag_hits_7d: number;
  tip_impressions_7d: number;
  tip_clicks_7d: number;
  newsletter_inclusions_7d: number;
  tier_a_count: number;
  tier_b_count: number;
  tier_c_count: number;
}

/**
 * Telemetry page — co-located in RagLayout.tsx because it's a thin SQL-driven
 * table view. Promotes to its own file if it grows past ~80 lines.
 */
function RagTelemetryPage() {
  const [rows, setRows] = useState<TelemetryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('rag_topic_telemetry_7d');
      if (cancelled) return;
      if (error) {
        setErr(error.message);
        return;
      }
      setRows((data as TelemetryRow[]) ?? []);
    })().catch((e: unknown) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <Card variant="flat" padding="lg" className="max-w-xl">
        <p className="text-sm text-[var(--color-danger)]">Failed to load telemetry: {err}</p>
      </Card>
    );
  }
  if (rows === null) {
    return <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>;
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Telemetry · last 7 days</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Placeholder columns (RAG hits, tip impressions/clicks, newsletter inclusions)
          return 0 until Plan 50-08 wires server-side event capture.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            <tr>
              <th className="text-start py-2 pe-4">Tag</th>
              <th className="text-end py-2 pe-4">Docs</th>
              <th className="text-end py-2 pe-4">RAG hits</th>
              <th className="text-end py-2 pe-4">Tip imp.</th>
              <th className="text-end py-2 pe-4">Tip clicks</th>
              <th className="text-end py-2 pe-4">Newsletter</th>
              <th className="text-end py-2 pe-4">Tier A</th>
              <th className="text-end py-2 pe-4">Tier B</th>
              <th className="text-end py-2">Tier C</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.topic_id} className="border-t border-[var(--color-border)]">
                <td className="py-2 pe-4">{r.tag}</td>
                <td className="py-2 pe-4 text-end font-mono tabular-nums">{r.docs_ingested}</td>
                <td className="py-2 pe-4 text-end font-mono tabular-nums">{r.rag_hits_7d}</td>
                <td className="py-2 pe-4 text-end font-mono tabular-nums">{r.tip_impressions_7d}</td>
                <td className="py-2 pe-4 text-end font-mono tabular-nums">{r.tip_clicks_7d}</td>
                <td className="py-2 pe-4 text-end font-mono tabular-nums">{r.newsletter_inclusions_7d}</td>
                <td className="py-2 pe-4 text-end font-mono tabular-nums">{r.tier_a_count}</td>
                <td className="py-2 pe-4 text-end font-mono tabular-nums">{r.tier_b_count}</td>
                <td className="py-2 text-end font-mono tabular-nums">{r.tier_c_count}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-[var(--color-text-secondary)]">
                  No active topics yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface SubRoute {
  readonly key: string;
  readonly label: string;
  readonly path: string; // suffix after /admin/rag/
  readonly Component: ComponentType;
}

function PlaceholderCard({ heading, body }: { heading: string; body: string }) {
  return (
    <Card variant="flat" padding="lg" className="max-w-xl">
      <h2 className="text-[15px] font-semibold mb-1">{heading}</h2>
      <p className="text-[13px] text-[var(--color-text-secondary)]">{body}</p>
    </Card>
  );
}

function CostPlaceholder() {
  return (
    <PlaceholderCard
      heading="Cost dashboard"
      body="Plan 50-09 finalizes the cost dashboard. Until then, see Settings → Audit Log for the live cost ledger."
    />
  );
}

const SUB_ROUTES: readonly SubRoute[] = [
  { key: 'topics',    label: 'Topics',    path: 'topics',    Component: RagTopicsPage },
  { key: 'sources',   label: 'Sources',   path: 'sources',   Component: RagSourcesPage },
  { key: 'queue',     label: 'Queue',     path: 'queue',     Component: RagQueuePage },
  { key: 'telemetry', label: 'Telemetry', path: 'telemetry', Component: RagTelemetryPage },
  { key: 'cost',      label: 'Cost',      path: 'cost',      Component: CostPlaceholder },
] as const;

const DEFAULT_PATH = 'topics';

function resolveActive(pathname: string): SubRoute {
  // pathname forms: /admin/rag, /admin/rag/, /admin/rag/topics, /admin/rag/topics/anything
  const m = pathname.match(/^\/admin\/rag\/?(?:([^/]+).*)?$/);
  const seg = (m?.[1] ?? '').toLowerCase();
  const found = SUB_ROUTES.find((r) => r.path === seg);
  return found ?? SUB_ROUTES[0]!; // default → topics
}

export default function RagLayout() {
  // Track pathname imperatively (no router) so back/forward updates the view.
  const [pathname, setPathname] = useState<string>(
    typeof window !== 'undefined' ? window.location.pathname : `/admin/rag/${DEFAULT_PATH}`,
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
        aria-label="Knowledge Base sections"
        className="lg:sticky lg:top-4 lg:self-start"
      >
        <ul className="flex flex-wrap lg:flex-col gap-1">
          {SUB_ROUTES.map((r) => {
            const isActive = active.key === r.key;
            return (
              <li key={r.key}>
                <a
                  href={`/admin/rag/${r.path}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'inline-flex w-full items-center h-9 px-3 rounded-pill text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'inline-flex w-full items-center h-9 px-3 rounded-pill text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
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
            <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>
          }
        >
          <Active />
        </Suspense>
      </main>
    </div>
  );
}
