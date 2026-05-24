/**
 * Phase 41 Plan 41-06 — AllowlistPage.
 *
 * Superadmin admin page at /admin/embeds (AdminShell prefix-routes
 * /admin/embeds/allowlist into the same module per
 * feedback_admin_module_manifest_vs_router_branch_drift — the parent module
 * entry uses `route: 'embeds'`).
 *
 * Pattern S1 dual-layer:
 *   - UX: ADMIN_MODULES entry has `minRole: 'superadmin'` → hidden from non-superadmin
 *     sidebar via AdminShell visibility filter.
 *   - Page-level: re-check via supabase.auth.getUser + profiles.admin_role.
 *   - DB: SECDEF RPCs in Plan 41-02 re-verify server-side.
 *
 * Renders 4 states: loading (Skeleton rows), empty (EmptyState), loaded
 * (AddHostnameForm + AllowlistTable), error (WifiOff Card + Retry).
 */
import { ShieldOff, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NotAuthorizedCard } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { AdminRole } from '@/lib/admin/roles';
import {
  listHostnames,
  type AllowlistRow,
} from '@/lib/admin/iframe-allowlist';
import { supabase } from '@/lib/supabase';
import { AddHostnameForm } from './AddHostnameForm';
import {
  AllowlistTable,
  type AllowlistTableRow,
} from './AllowlistTable';
import { ReferencesSheet } from './ReferencesSheet';
import { RemoveHostnameConfirm } from './RemoveHostnameConfirm';

interface ProfileRow {
  admin_role?: AdminRole | null;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; rows: AllowlistTableRow[] }
  | { status: 'error'; message: string };

function LoadingRows() {
  return (
    <div className="mt-6 space-y-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded" />
      ))}
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card
      variant="flat"
      padding="lg"
      className="mt-6"
      style={{ backgroundColor: 'var(--color-danger-soft)' }}
    >
      <div className="flex items-start gap-3">
        <WifiOff
          aria-hidden
          size={24}
          className="text-[var(--color-danger)] shrink-0 mt-0.5"
        />
        <div className="flex-1">
          <p className="text-[14px] text-[var(--color-text)] leading-relaxed">
            We couldn&rsquo;t load the allowlist. Check your connection and try again.
          </p>
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function AllowlistPage() {
  const [authState, setAuthState] = useState<'loading' | 'superadmin' | 'denied'>(
    'loading',
  );
  const [fetch, setFetch] = useState<FetchState>({ status: 'loading' });
  const [removeTarget, setRemoveTarget] = useState<AllowlistTableRow | null>(null);
  const [referencesFor, setReferencesFor] = useState<string | null>(null);

  // Page-level superadmin re-check (Pattern S1).
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        const p = profile as ProfileRow | null;
        if (cancelled) return;
        setAuthState(p?.admin_role === 'superadmin' ? 'superadmin' : 'denied');
      } catch {
        if (!cancelled) setAuthState('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refetch = useCallback(async () => {
    setFetch({ status: 'loading' });
    try {
      const rows = await listHostnames(supabase);
      const mapped: AllowlistTableRow[] = rows.map((r: AllowlistRow) => ({
        ...r,
        // WR-04 fix (41-REVIEW.md): no synthesized count. Until v1.4 ships a
        // real reference scan over landing_page_revisions.blocks, the table
        // shows a binary "In use" / "Unused" derived from last_used_at —
        // matching ReferencesSheet's honesty ("Reference scanning ships in
        // v1.4"). Previously the table rendered "1 page" for any used
        // hostname even when 50 pages embedded it.
        in_use: r.last_used_at !== null,
        added_by_email: null,
      }));
      setFetch({ status: 'ready', rows: mapped });
    } catch (err) {
      const e = err as { message?: string };
      setFetch({ status: 'error', message: e?.message ?? 'Failed to load' });
    }
  }, []);

  useEffect(() => {
    if (authState === 'superadmin') void refetch();
  }, [authState, refetch]);

  if (authState === 'loading') return null;
  if (authState === 'denied') return <NotAuthorizedCard />;

  const rows = fetch.status === 'ready' ? fetch.rows : [];

  return (
    <main
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-8"
      aria-labelledby="allowlist-page-heading"
    >
      <header className="max-w-6xl">
        <h1
          id="allowlist-page-heading"
          className="text-[26px] font-semibold tracking-tight"
        >
          Custom iframe allowlist
        </h1>
        <p className="mt-2 text-[16px] text-[var(--color-text-secondary)] leading-relaxed">
          Hostnames on this list can be embedded via the Custom-iframe block on landing
          pages and KB articles. Exact-match only — no wildcards or subdomains.
        </p>
      </header>

      <section className="max-w-6xl">
        {fetch.status === 'ready' && (
          <>
            <AddHostnameForm allowlist={rows} onAdded={() => void refetch()} />
            {rows.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  illustration={<ShieldOff size={48} aria-hidden />}
                  title="No hostnames on the allowlist yet"
                  body="Add the first hostname above. Any page using the Custom-iframe block requires its hostname here first — exact match only."
                />
              </div>
            ) : (
              <AllowlistTable
                rows={rows}
                onRequestRemove={(row) => setRemoveTarget(row)}
                onOpenReferences={(hostname) => setReferencesFor(hostname)}
              />
            )}
          </>
        )}
        {fetch.status === 'loading' && <LoadingRows />}
        {fetch.status === 'error' && <ErrorCard onRetry={() => void refetch()} />}
      </section>

      {removeTarget !== null && (
        <RemoveHostnameConfirm
          open
          hostname={removeTarget.hostname}
          hostnameId={removeTarget.id}
          inUse={removeTarget.in_use ?? false}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => void refetch()}
        />
      )}

      <ReferencesSheet
        open={referencesFor !== null}
        hostname={referencesFor ?? ''}
        onClose={() => setReferencesFor(null)}
      />
    </main>
  );
}

export default AllowlistPage;
