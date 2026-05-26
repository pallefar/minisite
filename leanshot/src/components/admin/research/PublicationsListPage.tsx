/**
 * Phase 62 Plan 62-05 — PublicationsListPage.
 *
 * List + filter + keyboard nav + New Publication CTA for /admin/research/publications.
 * Mirrors ProtocolsListPage.tsx per [[feedback_planner_prompt_explicit_reuse_targets]].
 *
 * Typography: ONLY text-[11px] / text-[13px] / text-[18px] / text-heading
 * Color tokens: ONLY @theme-defined tokens (verified against src/index.css @theme)
 * @theme audit scope: src/components/admin/research/* only (WARNING 6 fix per plan).
 */
import { FileText, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import type { ResearchPublication, ResearchPublicationStatus } from '@/types/research';
import { PublicationStatusBadge } from './PublicationStatusBadge';
import { ResearchKeyboardHelpModal } from './ResearchKeyboardHelpModal';

// ─── Filter pill types ────────────────────────────────────────────────────────

type FilterKey = 'all' | ResearchPublicationStatus;

interface FilterPill {
  key: FilterKey;
  label: string;
}

const FILTER_PILLS: FilterPill[] = [
  { key: 'all',       label: 'All' },
  { key: 'draft',     label: 'Draft' },
  { key: 'in_review', label: 'In Review' },
  { key: 'published', label: 'Published' },
  { key: 'archived',  label: 'Archived' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PublicationsListPageProps {
  /** Optionally pre-filter to a specific status (e.g. 'in_review' for Review Queue sub-nav). */
  initialStatusFilter?: ResearchPublicationStatus;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function tempSlug(): string {
  return `untitled-${crypto.randomUUID().slice(0, 8)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PublicationsListPage({ initialStatusFilter }: PublicationsListPageProps = {}) {
  const currentUserId: string | null = useStore((s) => {
    const state = s as { signedIn?: { user?: { id?: string } } };
    return state.signedIn?.user?.id ?? null;
  });

  const [publications, setPublications] = useState<ResearchPublication[]>([]);
  const [filter, setFilter] = useState<FilterKey>(initialStatusFilter ?? 'all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  // ─── Fetch publications on mount ─────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void supabase
      .from('research_publications')
      .select(
        'id, slug, title, abstract, status, created_by, reviewer_id, published_at, cohort_size, epsilon, suppressed_buckets, created_at, updated_at',
      )
      .order('updated_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError('Failed to load research data. Try refreshing.');
          setLoading(false);
          return;
        }
        setPublications(((data as unknown) as ResearchPublication[]) ?? []);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Filtered rows via useMemo ────────────────────────────────────────────

  const filteredPublications = useMemo(() => {
    if (filter === 'all') return publications;
    return publications.filter((p) => p.status === filter);
  }, [publications, filter]);

  // ─── Keyboard navigation ──────────────────────────────────────────────────

  const moveActive = useCallback(
    (delta: number) => {
      if (filteredPublications.length === 0) return;
      setActiveIdx((prev) => {
        const nextIdx = Math.max(0, Math.min(filteredPublications.length - 1, prev + delta));
        return nextIdx;
      });
    },
    [filteredPublications.length],
  );

  const navigateToPublication = useCallback((id: string) => {
    window.history.pushState(null, '', `/admin/research/publications/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const handleNew = useCallback(async () => {
    if (!currentUserId) return;
    const slug = tempSlug();
    const { data, error: insertError } = await supabase
      .from('research_publications')
      .insert({
        slug,
        title: 'Untitled Research',
        markdown_path: '',
        status: 'draft' satisfies ResearchPublicationStatus,
        created_by: currentUserId,
      })
      .select('id')
      .single();

    if (insertError || !data) return;
    navigateToPublication((data as { id: string }).id);
  }, [currentUserId, navigateToPublication]);

  // Keyboard handler: J/K=nav, N=new, Enter=open highlighted, Shift+?=help
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
        case 'Enter': {
          const pub = filteredPublications[activeIdx];
          if (pub) navigateToPublication(pub.id);
          break;
        }
        case '?':
          if (e.shiftKey) setHelpOpen(true);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [helpOpen, handleNew, moveActive, filteredPublications, activeIdx, navigateToPublication]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-w-0">
      {/* Sticky header */}
      <div
        className="sticky top-0 bg-[var(--color-surface)] z-10 pb-3 border-b border-[var(--color-border)] mb-4"
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-[18px] font-semibold tracking-tight">Research Publications</h1>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleNew()}
            aria-label="New publication"
          >
            <Plus className="size-4 me-1" aria-hidden />
            New Publication
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

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-card bg-[var(--color-surface-elevated)] animate-pulse"
              aria-hidden
            />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
      )}

      {/* Empty state */}
      {!loading && !error && filteredPublications.length === 0 && (
        <EmptyState
          illustration={<FileText className="size-10" aria-hidden />}
          title="No publications yet"
          body="Create your first research paper to share findings with the scientific community."
          cta={
            <Button variant="primary" onClick={() => void handleNew()}>
              New Publication
            </Button>
          }
        />
      )}

      {/* Table */}
      {!loading && !error && filteredPublications.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              <tr>
                <th className="text-start py-2 pe-4" aria-sort="none">
                  Title
                </th>
                <th className="text-start py-2 pe-4">Slug</th>
                <th className="text-start py-2 pe-4">Status</th>
                <th className="text-start py-2 pe-4">Created by</th>
                <th className="text-start py-2 pe-4" aria-sort="none">
                  Published date
                </th>
                <th className="text-start py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPublications.map((row, idx) => {
                const isActive = activeIdx === idx;
                return (
                  <tr
                    key={row.id}
                    className={`border-t border-[var(--color-border)] transition-colors ${
                      isActive
                        ? 'bg-[var(--color-admin-table-row-hover)]'
                        : 'hover:bg-[var(--color-admin-table-row-hover)]'
                    }`}
                    onClick={() => setActiveIdx(idx)}
                  >
                    {/* Title */}
                    <td className="py-3 pe-4">
                      <a
                        href={`/admin/research/publications/${row.id}`}
                        className="font-semibold text-[var(--color-primary)] hover:underline"
                        onClick={(e) => {
                          e.preventDefault();
                          navigateToPublication(row.id);
                        }}
                      >
                        {row.title}
                      </a>
                    </td>

                    {/* Slug */}
                    <td className="py-3 pe-4 text-[var(--color-text-secondary)] font-mono text-[11px]">
                      {row.slug}
                    </td>

                    {/* Status badge */}
                    <td className="py-3 pe-4">
                      <PublicationStatusBadge status={row.status} />
                    </td>

                    {/* Created by */}
                    <td className="py-3 pe-4 text-[var(--color-text-secondary)]">
                      {row.created_by ? (
                        <span className="font-mono text-[11px]">
                          {row.created_by.slice(0, 8)}…
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-tertiary)]">—</span>
                      )}
                    </td>

                    {/* Published date */}
                    <td className="py-3 pe-4 text-[11px] text-[var(--color-text-secondary)] whitespace-nowrap">
                      {formatDate(row.published_at)}
                    </td>

                    {/* Actions */}
                    <td className="py-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToPublication(row.id);
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

      <ResearchKeyboardHelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}

export default PublicationsListPage;
