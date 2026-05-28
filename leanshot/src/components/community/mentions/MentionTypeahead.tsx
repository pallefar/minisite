// This file is lazy-imported → lands in 'community-mentions' chunk, NOT 'community-feed'
// Fuse.js bytes stay isolated (8 kB gz) per vite.config.ts manualChunks routing.
import Fuse from 'fuse.js';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Phase 44 Plan 07 — MentionTypeahead.
 *
 * Lazy-loaded @-handle picker for CommunityPostComposer and CommunityCommentComposer.
 * Fuse.js fuzzy matching against `handle` + `display_name` from the `profiles` table.
 *
 * Bundle note: this file MUST be imported via React.lazy() from composer components
 * so Fuse.js stays in the 'community-mentions' sub-chunk and never leaks into
 * 'community-feed' (≤20 kB gz ceiling). See 44-09 vite.config.ts manualChunks rule.
 *
 * T-44-06 mitigation: suggestion cap of 8 results limits mention-spam surface.
 */

type UserHandle = {
  id: string;
  handle: string;
  display_name: string | null;
};

export interface MentionTypeaheadProps {
  /** Current @-query string (after the @ character). Already debounced by parent or internally. */
  query: string;
  /** User IDs to exclude from suggestions (e.g. the current user's own id). */
  excludeUserIds?: string[];
  /** Called when the user selects a suggestion. */
  onSelect: (handle: string, userId: string) => void;
}

// ─── Inline debounce hook ─────────────────────────────────────────────────────

function useDebounce<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MentionTypeahead({
  query,
  excludeUserIds,
  onSelect,
}: MentionTypeaheadProps): JSX.Element | null {
  const [items, setItems] = useState<UserHandle[] | null>(null);

  const debouncedQuery = useDebounce(query, 300);

  // Fetch matching profiles whenever the debounced query changes.
  // Cancelled-fetch guard prevents stale responses from overwriting fresh ones.
  useEffect(() => {
    if (debouncedQuery.length === 0) {
      setItems([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, handle, display_name')
        .ilike('handle', `${debouncedQuery}%`)
        .limit(8);
      if (cancelled) return;
      if (error || !data) {
        setItems([]);
        return;
      }
      setItems(data as UserHandle[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Build Fuse instance whenever the result set changes.
  const fuse = useMemo(() => {
    if (!items || items.length === 0) return null;
    return new Fuse(items, {
      keys: ['handle', 'display_name'],
      threshold: 0.4,
      includeScore: true,
    });
  }, [items]);

  // Pre-load state: render nothing until first response arrives.
  if (items === null) return null;

  // Filter out excluded user IDs (e.g. self).
  const filtered = excludeUserIds?.length
    ? items.filter((u) => !excludeUserIds.includes(u.id))
    : items;

  // Apply Fuse fuzzy re-ranking when we have a fuse instance.
  const visible =
    fuse && debouncedQuery.length > 0
      ? fuse
          .search(debouncedQuery)
          .map((r) => r.item)
          .filter((u) => !excludeUserIds?.includes(u.id))
      : filtered;

  if (visible.length === 0) return null;

  return (
    <ul
      role="listbox"
      aria-label="Mention suggestions"
      className="border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] shadow-md max-h-48 overflow-y-auto"
    >
      {visible.map((u) => (
        <li key={u.id}>
          <button
            type="button"
            role="option"
            aria-selected="false"
            onClick={() => onSelect(u.handle, u.id)}
            className="text-start w-full p-2 hover:bg-[var(--color-surface-elevated)] flex flex-col"
          >
            <span className="text-xs text-[var(--color-fg-muted)]">@{u.handle}</span>
            <span className="text-sm">{u.display_name ?? u.handle}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
