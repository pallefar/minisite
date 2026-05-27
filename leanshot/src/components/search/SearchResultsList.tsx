/**
 * Phase 49 Plan 09 — grouped search results.
 *
 * Buckets the results array by `type` and renders 3 cmdk Command.Group
 * sections (Posts / Lessons / Events). Top-5 per group; ordering is
 * preserved from the RPC (already sorted by rank desc).
 */

import { Command } from 'cmdk';
import type { SearchResult } from '@/lib/search/types';
import { SearchResultRow } from './SearchResultRow';

interface Props {
  results: SearchResult[];
  onSelect: () => void;
}

const GROUP_ORDER: Array<{ type: SearchResult['type']; heading: string }> = [
  { type: 'post', heading: 'Posts' },
  { type: 'lesson', heading: 'Lessons' },
  { type: 'event', heading: 'Events' },
];

export function SearchResultsList({ results, onSelect }: Props) {
  return (
    <>
      {GROUP_ORDER.map(({ type, heading }) => {
        const rows = results.filter((r) => r.type === type).slice(0, 5);
        if (rows.length === 0) return null;
        return (
          <Command.Group
            key={type}
            heading={heading}
            className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] px-2 pt-2 pb-1"
          >
            {rows.map((r) => (
              <Command.Item
                key={`${r.type}:${r.id}`}
                value={`${r.title ?? ''} ${r.id}`}
                onSelect={onSelect}
              >
                <SearchResultRow result={r} onSelect={onSelect} />
              </Command.Item>
            ))}
          </Command.Group>
        );
      })}
    </>
  );
}

export default SearchResultsList;
