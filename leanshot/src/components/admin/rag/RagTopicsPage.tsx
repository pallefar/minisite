/**
 * Phase 50 Plan 50-02 — RagTopicsPage.
 *
 * UI-SPEC §A1: lists active rag_topics; filter pills (curated / open-web / all);
 * Add-topic CTA opens AddTopicSheet; row actions (Archive, Restore) call the
 * RPC wrappers in rag-api.ts.
 *
 * Empty state: EmptyState primitive with Database lucide icon + UI-SPEC copy.
 * Responsive: at <md breakpoint, the table collapses to stacked rows via the
 * `md:` modifier classes (only the actions column always shows).
 */
import { Database } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import { ragTopicRestore, ragTopicSoftDelete } from '@/lib/admin/rag/rag-api';
import { supabase } from '@/lib/supabase';
import { AddTopicSheet } from './AddTopicSheet';

interface RagTopicRow {
  id: string;
  query: string;
  tag: string;
  posture: 'curated' | 'open-web';
  cadence: 'daily' | 'weekly' | 'monthly' | 'manual';
  last_scraped_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

type PostureFilter = 'all' | 'curated' | 'open-web';
type ViewFilter = 'active' | 'archived';

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, (now - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function RagTopicsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<RagTopicRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [postureFilter, setPostureFilter] = useState<PostureFilter>('all');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('active');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const fetchRows = useCallback(async (): Promise<void> => {
    setErr(null);
    const q = supabase
      .from('rag_topics')
      .select('id, query, tag, posture, cadence, last_scraped_at, deleted_at, created_at')
      .order('created_at', { ascending: false });
    const { data, error } =
      viewFilter === 'active' ? await q.is('deleted_at', null) : await q.not('deleted_at', 'is', null);
    if (error) {
      setErr(error.message);
      return;
    }
    setRows((data as RagTopicRow[] | null) ?? []);
  }, [viewFilter]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const visible = useMemo(() => {
    if (!rows) return [];
    if (postureFilter === 'all') return rows;
    return rows.filter((r) => r.posture === postureFilter);
  }, [rows, postureFilter]);

  async function handleArchive(id: string): Promise<void> {
    setBusyRowId(id);
    const { error } = await ragTopicSoftDelete(id);
    setBusyRowId(null);
    if (error) {
      toast('Failed to archive topic', 'error');
      return;
    }
    toast('Topic archived');
    await fetchRows();
  }

  async function handleRestore(id: string): Promise<void> {
    setBusyRowId(id);
    const { error } = await ragTopicRestore(id);
    setBusyRowId(null);
    if (error) {
      toast('Failed to restore topic', 'error');
      return;
    }
    toast('Topic restored');
    await fetchRows();
  }

  return (
    <section className="p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Topics ({rows?.length ?? 0})
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Admin-curated research topics. Each topic drives scraping cadence and
            powers the Research hub.
          </p>
        </div>
        <Button variant="primary" onClick={() => setSheetOpen(true)}>
          Add topic
        </Button>
      </header>

      <PillGroup>
        <Pill active={viewFilter === 'active'} onClick={() => setViewFilter('active')}>
          Active
        </Pill>
        <Pill active={viewFilter === 'archived'} onClick={() => setViewFilter('archived')}>
          Archived
        </Pill>
        <span aria-hidden className="mx-2 inline-block h-6 w-px bg-[var(--color-border)]" />
        <Pill active={postureFilter === 'all'} onClick={() => setPostureFilter('all')}>
          All postures
        </Pill>
        <Pill active={postureFilter === 'curated'} onClick={() => setPostureFilter('curated')}>
          Curated
        </Pill>
        <Pill
          active={postureFilter === 'open-web'}
          onClick={() => setPostureFilter('open-web')}
        >
          Open-web
        </Pill>
      </PillGroup>

      {err && (
        <Card variant="flat" padding="lg">
          <p className="text-sm text-[var(--color-danger)]">Failed to load topics: {err}</p>
        </Card>
      )}

      {!err && rows === null && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading topics…</p>
      )}

      {!err && rows !== null && visible.length === 0 && (
        <Card variant="flat" padding="lg" className="max-w-md mx-auto">
          <EmptyState
            illustration={<Database className="size-8" aria-hidden />}
            title="No topics yet"
            body="Add your first research topic to start scraping curated sources and feeding the coach."
            cta={
              <Button variant="primary" onClick={() => setSheetOpen(true)}>
                Add topic
              </Button>
            }
          />
        </Card>
      )}

      {!err && rows !== null && visible.length > 0 && (
        <Card variant="default" padding="none" className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="hidden md:table-header-group">
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                <th className="text-start px-4 py-3">Topic query</th>
                <th className="text-start px-4 py-3">Tag</th>
                <th className="text-start px-4 py-3">Mode</th>
                <th className="text-start px-4 py-3">Cadence</th>
                <th className="text-end px-4 py-3">Last scraped</th>
                <th className="text-end px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-border)] flex flex-col md:table-row gap-1 md:gap-0 p-3 md:p-0"
                >
                  <td className="md:px-4 md:py-3 max-w-prose truncate" title={r.query}>
                    <span className="md:hidden text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-secondary)] me-2">
                      Query:
                    </span>
                    {r.query}
                  </td>
                  <td className="md:px-4 md:py-3">
                    <Badge tone="neutral">{r.tag}</Badge>
                  </td>
                  <td className="md:px-4 md:py-3">
                    <Badge tone={r.posture === 'curated' ? 'info' : 'neutral'}>
                      {r.posture}
                    </Badge>
                  </td>
                  <td className="md:px-4 md:py-3 capitalize">{r.cadence}</td>
                  <td className="md:px-4 md:py-3 md:text-end font-mono tabular-nums text-[var(--color-text-secondary)]">
                    {formatRelative(r.last_scraped_at)}
                  </td>
                  <td className="md:px-4 md:py-3 md:text-end">
                    {r.deleted_at ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRestore(r.id)}
                        disabled={busyRowId === r.id}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleArchive(r.id)}
                        disabled={busyRowId === r.id}
                      >
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AddTopicSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={() => {
          void fetchRows();
        }}
      />
    </section>
  );
}

export default RagTopicsPage;
