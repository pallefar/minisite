/**
 * Phase 61 Plan 61-04 — ProtocolsListPage.
 *
 * List + filter + keyboard nav + New Protocol CTA for /admin/protocols/list.
 * Mirrors RagQueuePage.tsx structure per [[feedback_planner_prompt_explicit_reuse_targets]].
 *
 * Typography: ONLY text-[11px] / text-[13px] / text-[18px] / text-heading
 * Color tokens: ONLY @theme-defined tokens (verified against src/index.css @theme)
 */
import { ClipboardList, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { Protocol } from '@/types/protocols';
import type { ProtocolReviewState } from '@/types/protocols';
import { ProtocolKeyboardHelpModal } from './ProtocolKeyboardHelpModal';
import { ProtocolStatusBadge } from './ProtocolStatusBadge';

// ─── Filter pill types ────────────────────────────────────────────────────────

type FilterKey = 'all' | ProtocolReviewState;

interface FilterPill {
  key: FilterKey;
  label: string;
}

const FILTER_PILLS: FilterPill[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'in_review', label: 'In Review' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Archived' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProtocolsListPage() {
  const currentUserId: string | null = useStore((s) => {
    const state = s as { signedIn?: { user?: { id?: string } } };
    return state.signedIn?.user?.id ?? null;
  });

  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  // Fetch protocols on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void supabase
      .from('protocols')
      .select(
        'id, version, name, compound, audience, slug, base_slug, review_state, created_by, updated_at, published_at',
      )
      .order('updated_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError('Failed to load protocols. Refresh to try again.');
          setLoading(false);
          return;
        }

        // Dedupe to one row per id (highest version) for the list view

        const rows = (data as unknown as Protocol[]) ?? [];
        const byId = new Map<string, Protocol>();
        for (const row of rows) {
          const existing = byId.get(row.id);
          if (!existing || row.version > existing.version) {
            byId.set(row.id, row);
          }
        }
        setProtocols(Array.from(byId.values()));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Filtered rows via useMemo
  const filteredProtocols = useMemo(() => {
    if (filter === 'all') return protocols;
    return protocols.filter((p) => p.review_state === filter);
  }, [protocols, filter]);

  const moveActive = useCallback(
    (delta: number) => {
      if (filteredProtocols.length === 0) return;
      setActiveIdx((prev) => {
        const nextIdx = Math.max(0, Math.min(filteredProtocols.length - 1, prev + delta));
        return nextIdx;
      });
    },
    [filteredProtocols.length],
  );

  const handleNew = useCallback(async () => {
    if (!currentUserId) return;
    const baseSlug = `untitled-${crypto.randomUUID().slice(0, 8)}`;
    const { data, error: insertError } = await supabase
      .from('protocols')
      .insert({
        name: 'Untitled Protocol',
        compound: '',
        audience: [],
        base_slug: baseSlug,
        slug: `${baseSlug}-v1`,
        version: 1,
        review_state: 'draft' satisfies ProtocolReviewState,
        created_by: currentUserId,
      })
      .select('id')
      .single();

    if (insertError || !data) return;
    // Navigate to editor; dispatch popstate so AdminShell re-resolves the route
    window.history.pushState(null, '', `/admin/protocols/${data.id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [currentUserId]);

  // Keyboard handler: N=new, J/K=nav, Shift+?=help
  useEffect(() => {
    if (helpOpen) return undefined;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        typeof target.matches === 'function' &&
        target.matches('input, textarea, [contenteditable="true"]')
      )
        return;

      switch (e.key) {
        case 'n':
        case 'N':
          void handleNew();
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
  }, [helpOpen, handleNew, moveActive]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-w-0">
      {/* Sticky header */}
      <div className="sticky top-0 bg-[var(--color-surface)] z-10 pb-3 border-b border-[var(--color-border)] mb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-[18px] font-semibold tracking-tight">Protocols</h1>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleNew()}
            aria-label="New protocol"
          >
            <Plus className="size-4 me-1" aria-hidden />
            New Protocol
          </Button>
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

      {!loading && error && <p className="text-[13px] text-[var(--color-danger)]">{error}</p>}

      {!loading && !error && filteredProtocols.length === 0 && (
        <EmptyState
          illustration={<ClipboardList className="size-10" aria-hidden />}
          title="No protocols yet"
          body="Create your first dosing protocol to distribute to clinicians and patients."
          cta={
            <Button variant="primary" onClick={() => void handleNew()}>
              New Protocol
            </Button>
          }
        />
      )}

      {!loading && !error && filteredProtocols.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              <tr>
                <th className="text-start py-2 pe-4" aria-sort="none">
                  Name
                </th>
                <th className="text-start py-2 pe-4">Compound</th>
                <th className="text-start py-2 pe-4">Audience</th>
                <th className="text-start py-2 pe-4">Version</th>
                <th className="text-start py-2 pe-4">Status</th>
                <th className="text-start py-2 pe-4" aria-sort="descending">
                  Last Updated
                </th>
                <th className="text-start py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProtocols.map((row, idx) => {
                const isActive = activeIdx === idx;
                return (
                  <tr
                    key={`${row.id}-${row.version}`}
                    className={`border-t border-[var(--color-border)] transition-colors ${
                      isActive
                        ? 'bg-[var(--color-surface-elevated)]'
                        : 'hover:bg-[var(--color-surface-elevated)]'
                    }`}
                    onClick={() => setActiveIdx(idx)}
                  >
                    <td className="py-3 pe-4">
                      <a
                        href={`/admin/protocols/${row.id}`}
                        className="font-semibold text-[var(--color-primary)] hover:underline"
                        onClick={(e) => {
                          e.preventDefault();
                          window.history.pushState(null, '', `/admin/protocols/${row.id}`);
                          window.dispatchEvent(new PopStateEvent('popstate'));
                        }}
                      >
                        {row.name}
                      </a>
                    </td>
                    <td className="py-3 pe-4 text-[var(--color-text-secondary)]">
                      {row.compound || <span className="text-[var(--color-text-tertiary)]">—</span>}
                    </td>
                    <td className="py-3 pe-4">
                      <div className="flex gap-1 flex-wrap">
                        {(row.audience ?? []).map((aud) => (
                          <Pill key={aud} size="sm" className="pointer-events-none">
                            {aud}
                          </Pill>
                        ))}
                        {(row.audience ?? []).length === 0 && (
                          <span className="text-[var(--color-text-tertiary)]">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pe-4">
                      <Badge tone="neutral">v{row.version}</Badge>
                    </td>
                    <td className="py-3 pe-4">
                      <ProtocolStatusBadge status={row.review_state} />
                    </td>
                    <td className="py-3 pe-4 text-[var(--color-text-tertiary)] whitespace-nowrap">
                      {formatDate(row.updated_at ?? row.created_at)}
                    </td>
                    <td className="py-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.history.pushState(null, '', `/admin/protocols/${row.id}`);
                          window.dispatchEvent(new PopStateEvent('popstate'));
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProtocolKeyboardHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

export default ProtocolsListPage;
