/**
 * Phase 49 Plan 09 — debounced search hook.
 *
 * Two guarantees:
 *   1. When query.length < 3, debounced value resets to '' immediately and the
 *      callback never fires.
 *   2. Otherwise the value updates after `delayMs` of typing inactivity (300ms
 *      default per plan); rapid typing coalesces into a single update.
 *
 * Returns the debounced query string; callers run the actual RPC inside their
 * own effect keyed on the returned value.
 */
import { useEffect, useState } from 'react';

export function useDebouncedSearch(query: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(query.length < 3 ? '' : query);
  useEffect(() => {
    if (query.length < 3) {
      setDebounced('');
      return;
    }
    const t = setTimeout(() => setDebounced(query), delayMs);
    return () => clearTimeout(t);
  }, [query, delayMs]);
  return debounced;
}
