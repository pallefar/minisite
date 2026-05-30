/**
 * Phase 71 Plan 71-01 (PU-01) — EntryListView.
 *
 * Lists every changelog entry (admin sees drafts + archived too via RLS
 * published-or-admin) with title / version / status badge / published_at +
 * a "New update" button and a per-row Edit. Loading (Skeleton) / empty
 * (EmptyState) / error (Retry) states follow the AllowlistPage template.
 */
import { Megaphone, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { listEntries, type ProductUpdateEntry } from '@/lib/admin/product-updates';
import { supabase } from '@/lib/supabase';

export interface EntryListViewProps {
  onNew: () => void;
  onEdit: (entry: ProductUpdateEntry) => void;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; rows: ProductUpdateEntry[] }
  | { status: 'error'; message: string };

const STATUS_BADGE: Record<ProductUpdateEntry['status'], string> = {
  draft: 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]',
  published: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  archived: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function LoadingRows() {
  return (
    <div className="mt-6 space-y-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded" />
      ))}
    </div>
  );
}

export function EntryListView({ onNew, onEdit }: EntryListViewProps) {
  const [fetch, setFetch] = useState<FetchState>({ status: 'loading' });

  const refetch = useCallback(async () => {
    setFetch({ status: 'loading' });
    try {
      const rows = await listEntries(supabase);
      setFetch({ status: 'ready', rows });
    } catch (err) {
      const e = err as { message?: string };
      setFetch({ status: 'error', message: e?.message ?? 'Failed to load' });
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">Push Updates</h2>
          <p className="mt-1 text-[14px] text-[var(--color-text-secondary)]">
            Author changelog entries that surface in the in-app What&rsquo;s New drawer and the
            store release notes.
          </p>
        </div>
        <Button variant="primary" onClick={onNew}>
          New update
        </Button>
      </header>

      {fetch.status === 'loading' && <LoadingRows />}

      {fetch.status === 'error' && (
        <Card variant="flat" padding="lg" style={{ backgroundColor: 'var(--color-danger-soft)' }}>
          <div className="flex items-start gap-3">
            <WifiOff aria-hidden size={24} className="text-[var(--color-danger)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[14px] text-[var(--color-text)] leading-relaxed">
                We couldn&rsquo;t load the updates. Check your connection and try again.
              </p>
              <div className="mt-3">
                <Button variant="primary" size="sm" onClick={() => void refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {fetch.status === 'ready' && fetch.rows.length === 0 && (
        <EmptyState
          illustration={<Megaphone size={48} aria-hidden />}
          title="No updates yet"
          body="Author the first changelog entry above — it'll appear in the in-app What's New drawer once you publish it."
        />
      )}

      {fetch.status === 'ready' && fetch.rows.length > 0 && (
        <Card variant="default" padding="none">
          <table className="w-full text-start text-[14px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[12px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Published</th>
                <th className="px-4 py-3 font-medium text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fetch.rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-text)]">{row.title}</td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                    {row.version ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium ' +
                        STATUS_BADGE[row.status]
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                    {formatDate(row.published_at)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(row)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

export default EntryListView;
