/**
 * Phase 60 Plan 60-08 — RagQueuePage.
 *
 * Two-column queue page mounted at /admin/rag/queue via RagLayout SUB_ROUTES.
 * Per D-AdminQueue-01 through D-AdminQueue-14.
 *
 * Layout: lg:grid-cols-[7fr_5fr] — left list, right detail pane.
 * 2-person rule UI layer: Approve disabled when currentUserId === chunk.created_by.
 * Keyboard shortcuts: A=approve, R=reject, E=edit, J/K=nav, Shift+?=help.
 *
 * Typography: ONLY text-[11px] / text-[13px] / text-[18px].
 */
import { CheckCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import {
  ragApproveChunk,
  ragListReviewQueue,
  ragQueueChunk,
  ragRejectChunk,
  ragRetractChunk,
} from '@/lib/admin/rag/chunk-api';
import type { ReviewQueueRow } from '@/lib/admin/rag/chunk-api';
import { useStore } from '@/lib/store';
import { EditChunkModal } from './EditChunkModal';
import { QueueDetailPane } from './QueueDetailPane';
import { QueueKeyboardHelpModal } from './QueueKeyboardHelpModal';
import { RejectReasonSheet } from './RejectReasonSheet';
import { RetractChunkModal } from './RetractChunkModal';
import { TierBadge } from './TierBadge';

// ─── Filter pill types ────────────────────────────────────────────────────────

type FilterKey = 'all' | 'tier-b' | 'tier-c' | 'by-tag' | 'by-source';

interface FilterPill {
  key: FilterKey;
  label: string;
}

const FILTER_PILLS: FilterPill[] = [
  { key: 'all', label: 'All' },
  { key: 'tier-b', label: 'Tier B' },
  { key: 'tier-c', label: 'Tier C' },
  { key: 'by-tag', label: 'by tag' },
  { key: 'by-source', label: 'by source' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, (now - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RagQueuePage() {
  const currentUserId: string | null = useStore((s) => {
    const state = s as { signedIn?: { user?: { id?: string } } };
    return state.signedIn?.user?.id ?? null;
  });

  const showToastFn = useStore((s) => {
    const state = s as { showToast?: (msg: string, kind?: string) => void };
    return state.showToast;
  });

  const showToast = useCallback(
    (message: string, kind?: 'success' | 'error' | 'info') => {
      if (showToastFn) showToastFn(message, kind ?? 'success');
    },
    [showToastFn],
  );

  const [rows, setRows] = useState<ReviewQueueRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [retractOpen, setRetractOpen] = useState(false);

  // Fetch rows on mount + filter change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const opts =
      filter === 'tier-b'
        ? { tier: 'B' as const }
        : filter === 'tier-c'
          ? { tier: 'C' as const }
          : {};

    ragListReviewQueue(opts)
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError('Failed to load queue. Refresh to try again.');
          return;
        }
        setRows(data ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load queue. Refresh to try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filter]);

  const activeChunk = rows.find((r) => r.id === activeId) ?? null;

  const moveActive = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const currentIdx = rows.findIndex((r) => r.id === activeId);
      const nextIdx = Math.max(0, Math.min(rows.length - 1, currentIdx + delta));
      setActiveId(rows[nextIdx]?.id ?? null);
    },
    [rows, activeId],
  );

  const handleApprove = useCallback(
    async (row: ReviewQueueRow) => {
      if (row.created_by === currentUserId) return; // 2-person rule UI guard
      const removed = row;
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      if (activeId === row.id) setActiveId(null);
      const { error: approveError } = await ragApproveChunk(row.id, {
        sourceTier: row.source_tier,
        queueAgeHours: row.queue_age_hours,
      });
      if (approveError) {
        setRows((rs) => [removed, ...rs]);
        showToast('Approve failed', 'error');
        return;
      }
      showToast('Approved', 'success');
    },
    [currentUserId, activeId, showToast],
  );

  const handleRejectSelect = useCallback(
    async (reason: Parameters<typeof ragRejectChunk>[1]) => {
      if (!activeChunk) return;
      const removed = activeChunk;
      setRows((rs) => rs.filter((r) => r.id !== activeChunk.id));
      setActiveId(null);
      const { error: rejectError } = await ragRejectChunk(activeChunk.id, reason, {
        sourceTier: activeChunk.source_tier,
        queueAgeHours: activeChunk.queue_age_hours,
      });
      if (rejectError) {
        setRows((rs) => [removed, ...rs]);
        showToast('Reject failed', 'error');
        return;
      }
      showToast('Rejected', 'success');
    },
    [activeChunk, showToast],
  );

  const handleRetract = useCallback(
    async (reason: string) => {
      if (!activeChunk) return;
      const { error: retractError } = await ragRetractChunk(
        activeChunk.id,
        reason,
        { sourceTier: activeChunk.source_tier, queueAgeHours: activeChunk.queue_age_hours },
      );
      if (!retractError) showToast('Retracted', 'success');
      else showToast('Retract failed', 'error');
    },
    [activeChunk, showToast],
  );

  const handleQueueWithEdits = useCallback(
    async (edits: { tier: 'A' | 'B' | 'C'; topicTag: string }) => {
      if (!activeChunk) return;
      await ragQueueChunk(
        activeChunk.id,
        {
          summary: activeChunk.summary,
          quoteBlocks: activeChunk.quote_blocks,
          tier: edits.tier,
          topicTag: edits.topicTag,
        },
        { sourceTier: activeChunk.source_tier, queueAgeHours: activeChunk.queue_age_hours },
      );
    },
    [activeChunk],
  );

  // Keyboard handler
  useEffect(() => {
    const overlayOpen = rejectOpen || editOpen || helpOpen || retractOpen;
    if (overlayOpen) return undefined;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Guard: check if target is an element that supports matches()
      if (typeof target.matches === 'function' && target.matches('input, textarea, [contenteditable="true"]')) return;
      if (!activeChunk) return;

      switch (e.key) {
        case 'a':
        case 'A':
          handleApprove(activeChunk);
          break;
        case 'r':
        case 'R':
          setRejectOpen(true);
          break;
        case 'e':
        case 'E':
          setEditOpen(true);
          break;
        case 'j':
        case 'J':
          moveActive(+1);
          break;
        case 'k':
        case 'K':
          moveActive(-1);
          break;
        case '?':
          if (e.shiftKey) setHelpOpen(true);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeChunk, rejectOpen, editOpen, helpOpen, retractOpen, handleApprove, moveActive]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-6 lg:grid-cols-[7fr_5fr]">
      {/* Left column */}
      <div className="min-w-0">
        {/* Sticky header */}
        <div className="sticky top-0 bg-[var(--color-surface)] z-10 pb-3 border-b border-[var(--color-border)] mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[18px] font-semibold tracking-tight">Curation Queue</h1>
            <Badge tone={rows.length > 100 ? 'warning' : 'neutral'}>
              Backlog: {rows.length} items
            </Badge>
          </div>

          {/* Filter pills */}
          <div className="flex gap-1.5 flex-wrap mt-3">
            {FILTER_PILLS.map((fp) => (
              <Pill
                key={fp.key}
                size="sm"
                active={filter === fp.key}
                aria-pressed={filter === fp.key}
                onClick={() => setFilter(fp.key)}
              >
                {fp.label}
              </Pill>
            ))}
          </div>
        </div>

        {/* Content */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 rounded-card bg-[var(--color-surface-elevated)] animate-pulse"
                aria-hidden
              />
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
        )}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            illustration={<CheckCheck className="size-10" />}
            title="Queue clear"
            body="Nothing to review. Tier-A chunks auto-publish; new Tier-B/C items will appear here for review."
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((row) => {
              const isSelf = row.created_by === currentUserId;
              const isActive = activeId === row.id;
              return (
                <li key={row.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isActive}
                    onClick={() => setActiveId(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveId(row.id);
                      }
                    }}
                    className={`w-full text-start p-4 rounded-card border cursor-pointer transition-[transform,box-shadow,border-color] ${
                      isActive
                        ? 'bg-[var(--color-surface-elevated)] border-[var(--color-primary)] shadow-sm'
                        : 'bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-primary-soft)] hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold">{row.source_name}</span>
                          <TierBadge tier={row.source_tier} />
                          <Pill size="sm" className="pointer-events-none">
                            {row.topic_tag}
                          </Pill>
                        </div>
                        <p className="text-[13px] text-[var(--color-text-secondary)] mt-1 line-clamp-1">
                          {row.summary}
                        </p>
                        {isSelf && (
                          <Badge tone="warning" className="mt-1">
                            You created this — needs a different reviewer
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-[var(--color-text-tertiary)] whitespace-nowrap">
                          queued {formatRelative(row.queued_at)}
                        </span>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={isSelf}
                          aria-disabled={isSelf}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleApprove(row);
                          }}
                        >
                          Approve chunk
                        </Button>
                        <button
                          type="button"
                          aria-label="Reject chunk"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveId(row.id);
                            setRejectOpen(true);
                          }}
                          className="inline-flex items-center justify-center size-9 rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Right column: detail pane (hidden when no active chunk or empty state) */}
      {activeChunk && (
        <div className="min-w-0">
          <QueueDetailPane
            chunk={activeChunk}
            currentUserId={currentUserId}
            onApprove={async () => handleApprove(activeChunk)}
            onReject={() => setRejectOpen(true)}
            onEdit={() => setEditOpen(true)}
            onQueueWithEdits={handleQueueWithEdits}
          />
        </div>
      )}

      {/* Overlays */}
      <RejectReasonSheet
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onSelect={(reason) => {
          setRejectOpen(false);
          void handleRejectSelect(reason);
        }}
      />

      {activeChunk && (
        <EditChunkModal
          open={editOpen}
          chunk={activeChunk}
          onClose={() => setEditOpen(false)}
          onSave={async (fields) => {
            await ragQueueChunk(
              activeChunk.id,
              {
                summary: fields.summary,
                quoteBlocks: fields.quoteBlocks,
                tier: activeChunk.source_tier,
                topicTag: activeChunk.topic_tag,
              },
              {
                sourceTier: activeChunk.source_tier,
                queueAgeHours: activeChunk.queue_age_hours,
              },
            );
            setEditOpen(false);
            showToast('Saved & re-queued', 'success');
          }}
        />
      )}

      <RetractChunkModal
        open={retractOpen}
        onClose={() => setRetractOpen(false)}
        onRetract={async (reason) => {
          await handleRetract(reason);
          setRetractOpen(false);
        }}
      />

      <QueueKeyboardHelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}
