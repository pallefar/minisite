/**
 * Phase 10 Plan 10-06 — useRankRoster hook.
 *
 * Calls rank_org_patients RPC (Plan 10-02) with sort + pagination params.
 * Tracks lastFetchedAt for "Refreshed Xs ago" hint.
 * Error: 401/403-like → set error state (let caller handle; workspace-level
 * error boundary handles auth-bounce).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { RankRosterRow } from '@/types/snapshot';

export interface UseRankRosterOptions {
  orgId: string;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  offset: number;
  limit: number;
}

export interface UseRankRosterResult {
  rows: RankRosterRow[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  lastFetchedAt: Date | null;
}

export function useRankRoster({
  orgId,
  sortColumn,
  sortDirection,
  offset,
  limit,
}: UseRankRosterOptions): UseRankRosterResult {
  const [rows, setRows] = useState<RankRosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  // Stable revision counter so refresh() can increment and force a re-fetch
  // even if the deps haven't changed.
  const [revision, setRevision] = useState(0);

  // Prevent stale-closure issues with concurrent fetches
  const abortRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    abortRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('rank_org_patients', {
        p_org_id: orgId,
        p_sort_column: sortColumn,
        p_sort_direction: sortDirection,
        p_offset: offset,
        p_limit: limit,
      });
      if (abortRef.current) return;
      if (rpcError) {
        setError(new Error(rpcError.message));
        setLoading(false);
        return;
      }
      setRows((data as RankRosterRow[]) ?? []);
      setLastFetchedAt(new Date());
    } catch (err) {
      if (!abortRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (!abortRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, sortColumn, sortDirection, offset, limit]);

  useEffect(() => {
    void fetchData();
    return () => {
      abortRef.current = true;
    };
    // revision is intentionally included so refresh() triggers a new fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, revision]);

  const refresh = useCallback(() => {
    setRevision((r) => r + 1);
  }, []);

  return { rows, loading, error, refresh, lastFetchedAt };
}
