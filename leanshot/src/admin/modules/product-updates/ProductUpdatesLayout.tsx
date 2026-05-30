/**
 * Phase 71 Plan 71-01 (PU-01) — ProductUpdatesLayout (admin "Push Updates").
 *
 * Pathname-routed module (no react-router), following ModerationLayout:
 *   /admin/product-updates           → EntryListView
 *   /admin/product-updates/new       → EntryEditorView (new-entry mode)
 *   /admin/product-updates/:id       → EntryEditorView (edit mode; loads the row)
 *
 * Registered via ADMIN_MODULES (src/lib/admin/modules.ts, key='product-updates').
 * AdminShell prefix-routes /admin/product-updates/* here automatically.
 *
 * Pattern S1 dual-layer: the ADMIN_MODULES entry has minRole: 'admin' (UX gate);
 * this page re-checks supabase.auth.getUser() + profiles.admin_role and renders
 * NotAuthorizedCard on denial; RLS on changelog_entries is the DB gate.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NotAuthorizedCard } from '@/components/admin/AdminShell';
import { Skeleton } from '@/components/ui/Skeleton';
import { listEntries, type ProductUpdateEntry } from '@/lib/admin/product-updates';
import type { AdminRole } from '@/lib/admin/roles';
import { supabase } from '@/lib/supabase';
import { EntryEditorView } from './EntryEditorView';
import { EntryListView } from './EntryListView';

interface ProfileRow {
  admin_role?: AdminRole | null;
}

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: string };

export function resolveView(pathname: string): View {
  const m = pathname.match(/^\/admin\/product-updates\/?([^/]+)?/);
  const sub = m?.[1] ?? '';
  if (sub === '') return { kind: 'list' };
  if (sub === 'new') return { kind: 'new' };
  return { kind: 'edit', id: sub };
}

const ADMIN_ROLES: ReadonlyArray<AdminRole> = ['admin', 'superadmin'];

export default function ProductUpdatesLayout() {
  const [pathname, setPathname] = useState<string>(window.location.pathname);
  const [authState, setAuthState] = useState<'loading' | 'admin' | 'denied'>('loading');
  const [editEntry, setEditEntry] = useState<ProductUpdateEntry | null | undefined>(undefined);

  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const view = useMemo(() => resolveView(pathname), [pathname]);

  const navigate = useCallback((path: string): void => {
    window.history.pushState({}, '', path);
    setPathname(path);
  }, []);

  // Page-level admin re-check (Pattern S1).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) {
          if (!cancelled) setAuthState('denied');
          return;
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('admin_role')
          .eq('id', uid)
          .maybeSingle();
        const role = (profile as ProfileRow | null)?.admin_role ?? null;
        if (cancelled) return;
        setAuthState(role && ADMIN_ROLES.includes(role) ? 'admin' : 'denied');
      } catch {
        if (!cancelled) setAuthState('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the row when in edit mode.
  useEffect(() => {
    if (authState !== 'admin' || view.kind !== 'edit') {
      setEditEntry(undefined);
      return;
    }
    let cancelled = false;
    setEditEntry(undefined);
    void (async () => {
      try {
        const rows = await listEntries(supabase);
        const found = rows.find((r) => r.id === view.id) ?? null;
        if (!cancelled) setEditEntry(found);
      } catch {
        if (!cancelled) setEditEntry(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authState, view]);

  if (authState === 'loading') return null;
  if (authState === 'denied') return <NotAuthorizedCard />;

  return (
    <div className="product-updates-admin-module space-y-6">
      {view.kind === 'list' && (
        <EntryListView
          onNew={() => navigate('/admin/product-updates/new')}
          onEdit={(entry) => navigate(`/admin/product-updates/${entry.id}`)}
        />
      )}
      {view.kind === 'new' && (
        <EntryEditorView
          entry={null}
          onCancel={() => navigate('/admin/product-updates')}
          onSaved={() => navigate('/admin/product-updates')}
        />
      )}
      {view.kind === 'edit' &&
        (editEntry === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <EntryEditorView
            entry={editEntry}
            onCancel={() => navigate('/admin/product-updates')}
            onSaved={() => navigate('/admin/product-updates')}
          />
        ))}
    </div>
  );
}
