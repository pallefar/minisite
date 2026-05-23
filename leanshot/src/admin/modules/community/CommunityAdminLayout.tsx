/**
 * Phase 44 Plan 09 — CommunityAdminLayout.
 *
 * Admin module entry for Community Spaces CRUD.
 *
 * Routing model: pathname-based (consistent with other admin modules
 * per ReviewsLayout.tsx, AdminShell.tsx — no react-router-dom).
 *
 * Sub-routes:
 *   /admin/community           → SpacesListPage (list)
 *   /admin/community/new       → SpaceEditor (create)
 *   /admin/community/:id/edit  → SpaceEditor (edit)
 *
 * Registers in ADMIN_MODULES manifest via src/lib/admin/modules.ts
 * (separate PR/plan adds the manifest entry — this file is the module entrypoint).
 *
 * Admin surface — react-router-dom NOT required here; pathname-based switching
 * matches the existing project convention for admin modules.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const SpaceEditor = lazy(() =>
  import('./SpaceEditor').then((m) => ({ default: m.SpaceEditor })),
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

function SpacesListPage({
  onNew,
  onEdit,
}: {
  onNew: () => void;
  onEdit: (id: string) => void;
}) {
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

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading spaces…</p>
      )}

      {!loading && spaces.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">No community spaces yet.</p>
      )}

      {!loading && spaces.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">Name</th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">Tier</th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">Org</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {spaces.map((s) => (
              <tr key={s.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]">
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
  | { type: 'edit'; spaceId: string };

function resolveView(pathname: string): View {
  const m = pathname.match(/^\/admin\/community\/?([^/]+)?(?:\/([^/]+))?/);
  const seg1 = m?.[1];
  const seg2 = m?.[2];
  if (seg1 === 'new') return { type: 'new' };
  if (seg1 && seg2 === 'edit') return { type: 'edit', spaceId: seg1 };
  return { type: 'list' };
}

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
      <Suspense
        fallback={
          <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>
        }
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
      </Suspense>
    </div>
  );
}
