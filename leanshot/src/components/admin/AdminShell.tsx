/**
 * Phase 24 Plan 24-03 — AdminShell.
 *
 * Hosts all 12 v1.3 admin modules via the ADMIN_MODULES manifest.
 * Provides:
 *   1. Nav filtered by role ordinal + PostHog feature flag.
 *   2. Content area: renders the matching module for the current pathname,
 *      or <NotAuthorizedCard /> when role/flag gate blocks access.
 *
 * Pattern S1 (dual-layer security):
 *   - UX layer: AdminShell filters nav + renders NotAuthorizedCard for blocked routes.
 *   - DB layer: every admin RPC re-checks is_admin_at_least() (Plans 24-01, 24-05, 24-06).
 *
 * Routing model: pathname-based, no react-router (CLAUDE.md constraint).
 *   - Reads `window.location.pathname` (or `currentPath` prop for testing).
 *   - Matches /admin/<route> segments against module.route.
 *
 * PostHog flag resolution:
 *   - `undefined` (not yet resolved) → treated as VISIBLE to avoid first-paint flash.
 *   - `false` → module hidden from nav AND route blocked.
 *   - `true` → module visible.
 *
 * NOTE: Per [[project_phase5_bundle_regression]], this file MUST NOT statically import
 * posthog-js — the SDK is already initialized in main.tsx via the deferred-init path.
 * We access the global `posthog` instance via the `posthog-js` module (which is already
 * in the vendor-telemetry chunk and loaded before admin routes are reachable).
 */
import posthog from 'posthog-js';
import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Card } from '@/components/ui/Card';
import { ADMIN_MODULES, type AdminModule } from '@/lib/admin/modules';
import { hasMinRole, type AdminRole } from '@/lib/admin/roles';

// ---------------------------------------------------------------------------
// NotAuthorizedCard — local inline variant matching AdminLayout's card.
// Exported for reuse by refactored AdminLayout.
// ---------------------------------------------------------------------------
export function NotAuthorizedCard() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12 text-center">
        <h1 className="text-xl font-semibold mb-2">This area is for admins only</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          You don&apos;t have access to the admin console.
        </p>
        <a href="/" className="text-sm font-semibold text-[var(--color-primary)] hover:underline">
          Back to home →
        </a>
      </Card>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Lazy cache — memoize React.lazy() per module entry so the lazy component
// is not re-created on re-render (would cause Suspense to flash repeatedly).
// ---------------------------------------------------------------------------
const lazyCache = new WeakMap<() => Promise<{ default: ComponentType }>, ReturnType<typeof lazy>>();

function lazyOnce(fn: () => Promise<{ default: ComponentType }>): ReturnType<typeof lazy> {
  let l = lazyCache.get(fn);
  if (!l) {
    l = lazy(fn);
    lazyCache.set(fn, l);
  }
  return l;
}

// ---------------------------------------------------------------------------
// Module visibility predicate.
// ---------------------------------------------------------------------------
function isModuleVisible(mod: AdminModule, adminRole: AdminRole | null): boolean {
  if (!hasMinRole(adminRole, mod.minRole)) return false;
  // undefined (not yet resolved) → visible; false → hidden
  return posthog.isFeatureEnabled(mod.flagKey) !== false;
}

// ---------------------------------------------------------------------------
// AdminShell component.
// ---------------------------------------------------------------------------
export interface AdminShellProps {
  adminRole: AdminRole | null;
  /** Override pathname for testing. Defaults to window.location.pathname. */
  currentPath?: string;
  /**
   * When true, renders ONLY the nav bar (no content area).
   * Used by AdminLayout Mode B (legacy pages that render their own content).
   */
  navOnly?: boolean;
}

export default function AdminShell({ adminRole, currentPath, navOnly }: AdminShellProps) {
  // Re-render when PostHog /decide completes so flag-dependent visibility updates.
  const [, forceUpdate] = useState({});
  useEffect(() => {
    // posthog.onFeatureFlags fires once /decide resolves.
    posthog.onFeatureFlags(() => forceUpdate({}));
    // posthog-js doesn't expose an off() for onFeatureFlags; cleanup is a no-op.
  }, []);

  const pathname = currentPath ?? window.location.pathname;

  const visibleModules = useMemo(
    () => ADMIN_MODULES.filter((m) => isModuleVisible(m, adminRole)),

    [adminRole],
  );

  // If no role, show full-screen gate immediately (unless navOnly — parent handles gate).
  if (!adminRole && !navOnly) {
    return <NotAuthorizedCard />;
  }

  // Determine which module the current path targets.
  const activeModule = ADMIN_MODULES.find(
    (m) => pathname === `/admin/${m.route}` || pathname.startsWith(`/admin/${m.route}/`),
  );

  // Determine the content to render.
  let content: React.ReactNode;
  if (!activeModule) {
    // No module matches — render a 404-style placeholder.
    content = (
      <Card variant="flat" padding="lg" className="max-w-md mt-8">
        <p className="text-sm text-[var(--color-text-secondary)]">Admin module not found.</p>
      </Card>
    );
  } else if (!isModuleVisible(activeModule, adminRole)) {
    // Module exists but role/flag gate blocks it — Pattern S1 client gate.
    content = <NotAuthorizedCard />;
  } else {
    // Authorized — render lazy component.
    const LazyComp = lazyOnce(activeModule.lazy);
    content = (
      <Suspense
        fallback={<div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>}
      >
        <LazyComp />
      </Suspense>
    );
  }

  // navOnly mode: render ONLY the nav bar; parent handles content area.
  if (navOnly) {
    return (
      <nav
        aria-label="Admin modules"
        className="border-b border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <ul className="flex flex-wrap gap-1 px-4 md:px-6 py-2">
          {visibleModules.map((m) => {
            const isActive =
              pathname === `/admin/${m.route}` || pathname.startsWith(`/admin/${m.route}/`);
            return (
              <li key={m.key}>
                <a
                  href={`/admin/${m.route}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'inline-flex items-center gap-1.5 h-8 px-3 rounded-pill text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'inline-flex items-center gap-1.5 h-8 px-3 rounded-pill text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
                  }
                >
                  <m.icon size={14} aria-hidden />
                  {m.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <div className="admin-shell">
      <nav
        aria-label="Admin modules"
        className="border-b border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <ul className="flex flex-wrap gap-1 px-4 md:px-6 py-2">
          {visibleModules.map((m) => {
            const isActive =
              pathname === `/admin/${m.route}` || pathname.startsWith(`/admin/${m.route}/`);
            return (
              <li key={m.key}>
                <a
                  href={`/admin/${m.route}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'inline-flex items-center gap-1.5 h-8 px-3 rounded-pill text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'inline-flex items-center gap-1.5 h-8 px-3 rounded-pill text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
                  }
                >
                  <m.icon size={14} aria-hidden />
                  {m.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="p-4 md:p-6">{content}</main>
    </div>
  );
}
