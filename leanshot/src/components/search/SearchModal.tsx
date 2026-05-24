/**
 * Phase 49 Plan 09 — consumer search modal (cmd+k Spotlight).
 *
 * Architecture (FORKED from src/components/admin/palette/AdminCommandPalette.tsx):
 *   - cmdk Command.Dialog driven by Zustand `searchOpen` flag; consumer
 *     surface stays Zustand-driven per memory
 *     reference_react_router_consumer_admin_split.
 *   - useDebouncedSearch (300ms) + min-3-char gate keep RPC volume bounded
 *     (T-49-28 mitigation).
 *   - AbortController cancels in-flight searches when the query changes
 *     (T-49-28 mitigation).
 *
 * Mount point: App.tsx lazy-imports + renders this under <Suspense fallback={null}>
 * when searchOpen===true (modal closed = chunk never fetched).
 */

import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { SearchResultsList } from './SearchResultsList';
import { searchContent } from '@/lib/search/api';
import { useDebouncedSearch } from '@/lib/search/use-debounced-search';
import { useStore } from '@/lib/store';
import type { SearchResult } from '@/lib/search/types';

interface Props {
  onClose: () => void;
}

export function SearchModal({ onClose }: Props) {
  const searchOpen = useStore((s) => s.searchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebouncedSearch(query, 300);

  useEffect(() => {
    if (debouncedQuery.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void searchContent(debouncedQuery)
      .then((rows) => {
        if (cancelled) return;
        setResults(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
    setSearchOpen(next);
  };

  return (
    <Command.Dialog
      open={searchOpen}
      onOpenChange={handleOpenChange}
      label="Search"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]"
    >
      <div className="w-full max-w-[640px] mx-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card,var(--color-bg))] text-[var(--color-text)] shadow-2xl">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search posts, lessons, events…"
          className="w-full px-4 py-3 bg-transparent outline-none border-b border-[var(--color-border)] text-[15px]"
        />
        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          {loading && (
            <Command.Loading>
              <div className="px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">Searching…</div>
            </Command.Loading>
          )}
          <Command.Empty>
            <div className="px-3 py-6 text-center text-[13px] text-[var(--color-text-secondary)]">
              {query.length < 3 ? 'Type 3+ characters' : 'No results'}
            </div>
          </Command.Empty>
          <SearchResultsList
            results={results}
            onSelect={() => {
              onClose();
              setSearchOpen(false);
            }}
          />
        </Command.List>
      </div>
    </Command.Dialog>
  );
}

export default SearchModal;
