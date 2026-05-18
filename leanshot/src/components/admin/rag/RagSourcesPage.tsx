/**
 * Phase 50 Plan 50-02 — RagSourcesPage.
 *
 * UI-SPEC §A2: lists rag_sources with tier badge, health badge, topics-using
 * count, 30d reject count (colored danger when ≥5 per D-16), last scrape time.
 *
 * Rollup strategy:
 *   - Fetch rag_sources directly.
 *   - Fetch rag_chunks twice in parallel (count-only) to build the
 *     topics_using and rejects_30d maps client-side. PostgREST's
 *     embedded-aggregate syntax is brittle across versions; two cheap
 *     count queries are clearer and RLS-safe.
 *
 * Mirrors RagTopicsPage layout pattern.
 */
import { Globe } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';
import { ragSourcePause, ragSourceResume } from '@/lib/admin/rag/rag-api';
import { supabase } from '@/lib/supabase';
import { AddSourceSheet } from './AddSourceSheet';
import { HealthBadge } from './HealthBadge';
import { TierBadge } from './TierBadge';

interface RagSourceRow {
  id: string;
  name: string;
  domain: string;
  tier: 'A' | 'B' | 'C';
  health: 'ok' | 'paused' | 'failing';
  paused_reason: string | null;
  last_scrape_at: string | null;
}

interface SourceWithRollups extends RagSourceRow {
  topics_using: number;
  rejects_30d: number;
}

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

export function RagSourcesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<SourceWithRollups[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const fetchRows = useCallback(async (): Promise<void> => {
    setErr(null);
    const { data: srcData, error: srcErr } = await supabase
      .from('rag_sources')
      .select('id, name, domain, tier, health, paused_reason, last_scrape_at')
      .order('tier', { ascending: true })
      .order('name', { ascending: true });
    if (srcErr) {
      setErr(srcErr.message);
      return;
    }
    const sources = (srcData as RagSourceRow[] | null) ?? [];

    // Rollup: topics_using (distinct topic_id count per source via rag_chunks join
    // to non-deleted rag_topics). Single client-side reduce is sufficient — admin
    // pages process <500 sources.
    const { data: chunkData } = await supabase
      .from('rag_chunks')
      .select('source_id, topic_id, status, reviewed_at, rag_topics!inner(deleted_at)');
    type ChunkRow = {
      source_id: string;
      topic_id: string;
      status: string;
      reviewed_at: string | null;
      rag_topics: { deleted_at: string | null } | { deleted_at: string | null }[];
    };
    const chunks = (chunkData as ChunkRow[] | null) ?? [];
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const topicMap = new Map<string, Set<string>>();
    const rejectMap = new Map<string, number>();
    for (const c of chunks) {
      const rt = Array.isArray(c.rag_topics) ? c.rag_topics[0] : c.rag_topics;
      if (rt?.deleted_at == null) {
        if (!topicMap.has(c.source_id)) topicMap.set(c.source_id, new Set());
        topicMap.get(c.source_id)!.add(c.topic_id);
      }
      if (
        c.status === 'rejected' &&
        c.reviewed_at &&
        new Date(c.reviewed_at).getTime() >= cutoff
      ) {
        rejectMap.set(c.source_id, (rejectMap.get(c.source_id) ?? 0) + 1);
      }
    }

    const withRollups: SourceWithRollups[] = sources.map((s) => ({
      ...s,
      topics_using: topicMap.get(s.id)?.size ?? 0,
      rejects_30d: rejectMap.get(s.id) ?? 0,
    }));
    setRows(withRollups);
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  async function handlePause(id: string): Promise<void> {
    const reason =
      typeof window !== 'undefined'
        ? window.prompt('Pause reason (visible in audit log)') ?? ''
        : '';
    if (!reason.trim()) return;
    setBusyRowId(id);
    const { error } = await ragSourcePause(id, reason.trim());
    setBusyRowId(null);
    if (error) {
      toast('Failed to pause source', 'error');
      return;
    }
    toast('Source paused');
    await fetchRows();
  }

  async function handleResume(id: string): Promise<void> {
    setBusyRowId(id);
    const { error } = await ragSourceResume(id);
    setBusyRowId(null);
    if (error) {
      toast('Failed to resume source', 'error');
      return;
    }
    toast('Source resumed');
    await fetchRows();
  }

  return (
    <section className="p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Sources ({rows?.length ?? 0})
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Allowlisted domains the scrape pipeline is permitted to fetch. Tier
            determines default freshness window and trust weighting in retrieval.
          </p>
        </div>
        <Button variant="primary" onClick={() => setSheetOpen(true)}>
          Add source
        </Button>
      </header>

      {err && (
        <Card variant="flat" padding="lg">
          <p className="text-sm text-[var(--color-danger)]">Failed to load sources: {err}</p>
        </Card>
      )}

      {!err && rows === null && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading sources…</p>
      )}

      {!err && rows !== null && rows.length === 0 && (
        <Card variant="flat" padding="lg" className="max-w-md mx-auto">
          <EmptyState
            illustration={<Globe className="size-8" aria-hidden />}
            title="No sources allowlisted"
            body="Add a source to permit the scrape pipeline to fetch from a new domain."
            cta={
              <Button variant="primary" onClick={() => setSheetOpen(true)}>
                Add source
              </Button>
            }
          />
        </Card>
      )}

      {!err && rows !== null && rows.length > 0 && (
        <Card variant="default" padding="none" className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="hidden md:table-header-group">
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                <th className="text-left px-4 py-3">Source name</th>
                <th className="text-left px-4 py-3">Domain</th>
                <th className="text-left px-4 py-3">Trust tier</th>
                <th className="text-left px-4 py-3">Health</th>
                <th className="text-right px-4 py-3">Topics using</th>
                <th className="text-right px-4 py-3">Rejects 30d</th>
                <th className="text-right px-4 py-3">Last scrape</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-border)] flex flex-col md:table-row gap-1 md:gap-0 p-3 md:p-0"
                >
                  <td className="md:px-4 md:py-3">
                    <a
                      href={`https://${r.domain}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[var(--color-primary)] hover:underline"
                    >
                      {r.name}
                    </a>
                  </td>
                  <td className="md:px-4 md:py-3 font-mono text-[12px] text-[var(--color-text-secondary)]">
                    {r.domain}
                  </td>
                  <td className="md:px-4 md:py-3">
                    <TierBadge tier={r.tier} />
                  </td>
                  <td className="md:px-4 md:py-3">
                    <HealthBadge state={r.health} reason={r.paused_reason ?? undefined} />
                  </td>
                  <td className="md:px-4 md:py-3 md:text-right font-mono tabular-nums">
                    {r.topics_using}
                  </td>
                  <td
                    className={`md:px-4 md:py-3 md:text-right font-mono tabular-nums ${
                      r.rejects_30d >= 5 ? 'text-[var(--color-danger)] font-semibold' : ''
                    }`}
                  >
                    {r.rejects_30d}
                  </td>
                  <td className="md:px-4 md:py-3 md:text-right font-mono tabular-nums text-[var(--color-text-secondary)]">
                    {formatRelative(r.last_scrape_at)}
                  </td>
                  <td className="md:px-4 md:py-3 md:text-right">
                    {r.health === 'paused' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleResume(r.id)}
                        disabled={busyRowId === r.id}
                      >
                        Resume
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handlePause(r.id)}
                        disabled={busyRowId === r.id}
                      >
                        Pause
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AddSourceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={() => {
          void fetchRows();
        }}
      />
    </section>
  );
}

export default RagSourcesPage;
