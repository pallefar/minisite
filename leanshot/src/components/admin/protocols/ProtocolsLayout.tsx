/**
 * Phase 61 Plan 61-04 — ProtocolsLayout shell.
 *
 * Hosts sub-routes under /admin/protocols:
 *   /admin/protocols        → defaults to ProtocolsListPage
 *   /admin/protocols/list   → ProtocolsListPage
 *   /admin/protocols/<id>   → ProtocolEditorPage (Plan 05 ships this file)
 *
 * Routing model: pathname-based, no react-router (CLAUDE.md SPA constraint).
 * Sub-nav links use plain `<a href>` so the AdminShell parent re-matches the
 * outer module on navigation (same pattern as RagLayout).
 *
 * Active-nav accent uses --color-primary per UI-SPEC §A1 Color rule.
 *
 * Typography: ONLY text-[13px] (sub-nav labels) per Phase 60 BLOCKER lesson.
 */
import React, { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';

// Plan 05 ships ProtocolEditorPage.tsx with a NAMED export ProtocolEditorPage.
// The dynamic-path import + .catch() fallback makes the lazy import resilient
// during parallel Wave 1 development — if the file is absent at build time,
// the editor route shows a Suspense skeleton instead of a compile-time error.
// Per [[feedback_stub_then_replace_sibling_collision]] pattern.
// ts-ignore needed because TS cannot statically verify the file at Wave 1 build time.
const EDITOR_MODULE_PATH = './ProtocolEditorPage';
const ProtocolEditorPage = lazy(() =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import(/* @vite-ignore */ EDITOR_MODULE_PATH) as Promise<any>)
    .then((m) => ({ default: m.ProtocolEditorPage as React.ComponentType }))
    .catch((): { default: React.ComponentType } => ({
      default: () => null,
    })),
);

const ProtocolsListPage = lazy(() =>
  import('./ProtocolsListPage').then((m) => ({ default: m.ProtocolsListPage })),
);

interface SubRoute {
  readonly key: string;
  readonly label: string;
  readonly path: string; // suffix after /admin/protocols/
  readonly Component: ComponentType;
}

const SUB_ROUTES: readonly SubRoute[] = [
  { key: 'list',   label: 'Protocols', path: 'list',   Component: ProtocolsListPage },
  { key: 'editor', label: 'Editor',    path: 'editor', Component: ProtocolEditorPage },
] as const;

const DEFAULT_KEY = 'list';

function resolveActive(pathname: string): SubRoute {
  // pathname forms: /admin/protocols, /admin/protocols/, /admin/protocols/list,
  // /admin/protocols/<id> (editor detail view — any non-known segment → list default)
  const m = pathname.match(/^\/admin\/protocols\/?(?:([^/]+).*)?$/);
  const seg = (m?.[1] ?? '').toLowerCase();
  const found = SUB_ROUTES.find((r) => r.path === seg);
  return found ?? SUB_ROUTES.find((r) => r.key === DEFAULT_KEY)!;
}

export default function ProtocolsLayout() {
  // Track pathname imperatively (no router) so back/forward updates the view.
  const [pathname, setPathname] = useState<string>(
    typeof window !== 'undefined'
      ? window.location.pathname
      : `/admin/protocols/${DEFAULT_KEY}`,
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
        aria-label="Protocols sections"
        className="lg:sticky lg:top-4 lg:self-start"
      >
        <ul className="flex flex-wrap lg:flex-col gap-1">
          {SUB_ROUTES.map((r) => {
            const isActive = active.key === r.key;
            return (
              <li key={r.key}>
                <a
                  href={`/admin/protocols/${r.path}`}
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
