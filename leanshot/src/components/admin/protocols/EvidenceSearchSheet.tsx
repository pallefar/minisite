/**
 * Phase 61 Plan 61-05 — EvidenceSearchSheet.
 *
 * Right-side drawer for searching RAG evidence and attaching chunks to a
 * protocol step. Calls rag-retrieve Edge Fn, renders top-10 results with
 * checkboxes, inserts into protocol_evidence on Attach.
 *
 * Per PATTERNS.md RejectReasonSheet analog:
 *  - Sheet DS primitive wraps all content (role=dialog + aria-modal inherited).
 *  - Arrow-key cycling for keyboard navigation.
 *  - TierBadge on each result row.
 *
 * Evidence attach: INSERT INTO protocol_evidence with step_id NOT NULL per schema.
 *
 * Typography: text-[11px] / text-[13px] only per Phase 60 BLOCKER lesson.
 */
import { Search } from 'lucide-react';
import { useState, useCallback } from 'react';
import { TierBadge } from '@/components/admin/rag/TierBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

export interface RagChunk {
  chunk_id: string;
  title: string;
  text: string;
  tier: 'A' | 'B' | 'C';
}

export interface EvidenceSearchSheetProps {
  open: boolean;
  onClose: () => void;
  protocolId: string;
  stepId: string;
  onAttached: (newCount: number) => void;
}

export function EvidenceSearchSheet({
  open,
  onClose,
  protocolId,
  stepId,
  onAttached,
}: EvidenceSearchSheetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RagChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [attaching, setAttaching] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('rag-retrieve', {
        body: { query: query.trim(), k: 10, filters: { surface: 'coach' } },
      });
      if (fnError) {
        setError(fnError.message ?? 'Search failed');
        setResults([]);
        return;
      }
      const chunks: RagChunk[] = (data?.chunks ?? []) as RagChunk[];
      setResults(chunks);
      setChecked(new Set());
      setFocusIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((p) => (p + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((p) => (p - 1 + results.length) % results.length);
    } else if (e.key === ' ') {
      e.preventDefault();
      const chunk = results[focusIdx];
      if (chunk) toggleCheck(chunk.chunk_id);
    }
  };

  const toggleCheck = (chunkId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }
      return next;
    });
  };

  const handleAttach = async () => {
    if (checked.size === 0) return;
    setAttaching(true);
    try {
      const rows = results
        .filter((c) => checked.has(c.chunk_id))
        .map((c) => ({
          protocol_id: protocolId,
          step_id: stepId,
          citation_text: c.text.slice(0, 200),
          rag_source_id: c.chunk_id,
          verbatim_quote: c.text,
        }));

      const { error: insertError } = await supabase.from('protocol_evidence').insert(rows);
      if (insertError) throw insertError;

      onAttached(checked.size);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attach failed');
    } finally {
      setAttaching(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Cite evidence">
      <div className="flex flex-col gap-4 h-full">
        {/* Search input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-text-tertiary)]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSearch();
                }
              }}
              placeholder="Search RAG evidence…"
              aria-label="Search evidence query"
              className="w-full h-10 pl-9 pr-4 text-[13px] border border-[var(--color-border)] rounded-pill bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleSearch()}
            loading={loading}
            aria-label="Search"
          >
            Search
          </Button>
        </div>

        {/* Results list */}
        <div
          role="listbox"
          tabIndex={-1}
          aria-label="RAG evidence results"
          aria-live="polite"
          aria-busy={loading}
          className="flex-1 overflow-y-auto"
          onKeyDown={handleKeyDown}
        >
          {loading && (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-card" />
              ))}
            </div>
          )}

          {!loading && error && (
            <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
          )}

          {!loading && !error && results.length === 0 && query && (
            <EmptyState
              title="No evidence found"
              body="Try a different search term or add sources to the RAG queue."
            />
          )}

          {!loading && !error && results.length > 0 && (
            <ul className="space-y-2">
              {results.map((chunk, idx) => {
                const isChecked = checked.has(chunk.chunk_id);
                return (
                  <li key={chunk.chunk_id}>
                    <label
                      className={`flex items-start gap-3 p-3 rounded-card border cursor-pointer transition-colors ${
                        isChecked
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                          : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                      } ${focusIdx === idx ? 'ring-1 ring-[var(--color-primary)]' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCheck(chunk.chunk_id)}
                        onFocus={() => setFocusIdx(idx)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                        aria-label={`Select evidence: ${chunk.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-[13px] font-semibold text-[var(--color-text)] truncate">
                            {chunk.title}
                          </span>
                          <TierBadge tier={chunk.tier} />
                        </div>
                        <p className="text-[13px] text-[var(--color-text-secondary)] line-clamp-2">
                          {chunk.text}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer action */}
        <div className="pt-2 border-t border-[var(--color-border)]">
          <Button
            variant="primary"
            onClick={() => void handleAttach()}
            loading={attaching}
            disabled={checked.size === 0}
            className="w-full"
          >
            {checked.size > 0
              ? `Attach ${checked.size} source${checked.size === 1 ? '' : 's'}`
              : 'Attach sources'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export default EvidenceSearchSheet;
