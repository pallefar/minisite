/**
 * Phase 44 Plan 09 — CommunityAdminLayout (extended by Phase 45 Plan 45-08).
 *
 * Admin module entry for Community Spaces CRUD + clinician verification +
 * report-digest opt-in.
 *
 * Routing model: pathname-based (consistent with other admin modules
 * per ReviewsLayout.tsx, AdminShell.tsx — no react-router-dom).
 *
 * Sub-routes:
 *   /admin/community           → SpacesListPage (list)
 *   /admin/community/new       → SpaceEditor (create)
 *   /admin/community/:id/edit  → SpaceEditor (edit)
 *   /admin/community/profiles  → AdminCliniciansPage   (P45-08)
 *   /admin/community/reports   → AdminReportsDigestPage (P45-08)
 *
 * Registers in ADMIN_MODULES manifest via src/lib/admin/modules.ts
 * (P45-08 adds the entry — keyed on URL prefix `/admin/community/*` per
 * memory feedback_admin_module_manifest_vs_router_branch_drift).
 *
 * Admin surface — react-router-dom NOT required here; pathname-based switching
 * matches the existing project convention for admin modules.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const SpaceEditor = lazy(() => import('./SpaceEditor').then((m) => ({ default: m.SpaceEditor })));
const AdminCliniciansPage = lazy(() =>
  import('./AdminCliniciansPage').then((m) => ({ default: m.AdminCliniciansPage })),
);
const AdminReportsDigestPage = lazy(() =>
  import('./AdminReportsDigestPage').then((m) => ({
    default: m.AdminReportsDigestPage,
  })),
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpaceRow {
  id: string;
  name: string;
  min_tier: string;
  org_id: string | null;
  created_at: string;
}

// ─── Space list subpage ───────────────────────────────────────────────────────

function SpacesListPage({ onNew, onEdit }: { onNew: () => void; onEdit: (id: string) => void }) {
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('community_spaces')
        .select('id, name, min_tier, org_id, created_at')
        .order('created_at', { ascending: false });
      setSpaces((data ?? []) as SpaceRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Community Spaces</h2>
        <button
          onClick={onNew}
          className="inline-flex h-8 items-center rounded-full bg-[var(--color-primary)] px-4 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          + New space
        </button>
      </div>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading spaces…</p>}

      {!loading && spaces.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">No community spaces yet.</p>
      )}

      {!loading && spaces.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Name
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Tier
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">Org</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {spaces.map((s) => (
              <tr
                key={s.id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]"
              >
                <td className="py-2 font-medium">{s.name}</td>
                <td className="py-2 capitalize text-[var(--color-text-secondary)]">{s.min_tier}</td>
                <td className="py-2 text-[var(--color-text-secondary)] font-mono text-xs">
                  {s.org_id ? s.org_id.slice(0, 8) + '…' : 'global'}
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => onEdit(s.id)}
                    className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Sub-route enum ───────────────────────────────────────────────────────────

type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; spaceId: string }
  | { type: 'clinicians' }
  | { type: 'reports-digest' };

export function resolveView(pathname: string): View {
  // P45-08 — match /admin/community/profiles + /admin/community/reports BEFORE
  // generic :id segment so they don't fall through to { type: 'edit' }.
  if (pathname.startsWith('/admin/community/profiles')) return { type: 'clinicians' };
  if (pathname.startsWith('/admin/community/reports')) return { type: 'reports-digest' };

  const m = pathname.match(/^\/admin\/community\/?([^/]+)?(?:\/([^/]+))?/);
  const seg1 = m?.[1];
  const seg2 = m?.[2];
  if (seg1 === 'new') return { type: 'new' };
  if (seg1 && seg2 === 'edit') return { type: 'edit', spaceId: seg1 };
  return { type: 'list' };
}

// ─── Sub-nav tabs ─────────────────────────────────────────────────────────────

const NAV_LINKS: ReadonlyArray<{
  href: string;
  label: string;
  match: (v: View) => boolean;
}> = [
  {
    href: '/admin/community',
    label: 'Spaces',
    match: (v) => v.type === 'list' || v.type === 'new' || v.type === 'edit',
  },
  {
    href: '/admin/community/profiles',
    label: 'Profiles',
    match: (v) => v.type === 'clinicians',
  },
  {
    href: '/admin/community/reports',
    label: 'Reports',
    match: (v) => v.type === 'reports-digest',
  },
];

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function CommunityAdminLayout() {
  const [pathname, setPathname] = useState<string>(window.location.pathname);

  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const view = useMemo(() => resolveView(pathname), [pathname]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  const handleSaved = (id: string) => {
    useStore.getState().showToast('Space saved successfully.', 'success');
    void id; // spaceId could be used to navigate to edit; for now return to list
    navigate('/admin/community');
  };

  return (
    <div className="community-admin-module space-y-6">
      <nav
        aria-label="Community sub-navigation"
        className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-2"
      >
        {NAV_LINKS.map((link) => {
          const active = link.match(view);
          return (
            <button
              key={link.href}
              type="button"
              onClick={() => navigate(link.href)}
              aria-current={active ? 'page' : undefined}
              className={
                'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ' +
                (active
                  ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')
              }
            >
              {link.label}
            </button>
          );
        })}
      </nav>

      <Suspense
        fallback={<div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>}
      >
        {view.type === 'list' && (
          <SpacesListPage
            onNew={() => navigate('/admin/community/new')}
            onEdit={(id) => navigate(`/admin/community/${id}/edit`)}
          />
        )}
        {view.type === 'new' && (
          <div className="space-y-4">
            <button
              onClick={() => navigate('/admin/community')}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to spaces
            </button>
            <SpaceEditor onSaved={handleSaved} />
          </div>
        )}
        {view.type === 'edit' && (
          <div className="space-y-4">
            <button
              onClick={() => navigate('/admin/community')}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to spaces
            </button>
            <SpaceEditor spaceId={view.spaceId} onSaved={handleSaved} />
          </div>
        )}
        {view.type === 'clinicians' && <AdminCliniciansPage />}
        {view.type === 'reports-digest' && <AdminReportsDigestPage />}
      </Suspense>
    </div>
  );
}
