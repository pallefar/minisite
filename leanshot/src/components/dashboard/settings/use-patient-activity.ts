/**
 * Phase 10 Plan 10-09 — `usePatientActivity` hook.
 *
 * Fetches per-org audit rows for the authenticated patient from the
 * `patient-activity` Edge Function. Supports tab filtering and pagination.
 *
 * Security note (D-19): this hook intentionally does NOT call posthog.capture.
 * The patient-side mirror modal is a transparency surface; meta-auditing it
 * (recording that a patient viewed the modal) would be surveillance theater
 * and violates the D-19 explicit decision.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type ActivityTab = 'operator_views' | 'ranking_events';

export interface ActivityRow {
  id: number;
  timestamp: string;
  action: string;
  actor_type: string | null;
  org_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
  actor_display_name: string;
  actor_role: string | null;
}

export interface UsePatientActivityOptions {
  orgId: string;
  tab: ActivityTab;
  offset: number;
  limit?: number;
}

export interface UsePatientActivityResult {
  rows: ActivityRow[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  refresh: () => void;
}

export function usePatientActivity({
  orgId,
  tab,
  offset,
  limit = 25,
}: UsePatientActivityOptions): UsePatientActivityResult {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [rev, setRev] = useState(0);

  const refresh = useCallback(() => setRev((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    const fetchActivity = async () => {
      setLoading(true);
      setError(null);

      const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      if (!base) {
        if (!cancelled) {
          setError('network');
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const { data: sessData } = await supabase.auth.getSession();
      const jwt = sessData?.session?.access_token;
      if (!jwt) {
        if (!cancelled) {
          setError('auth');
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const params = new URLSearchParams({
        org_id: orgId,
        tab,
        offset: String(offset),
        limit: String(limit),
      });

      let res: Response;
      try {
        res = await fetch(`${base}/functions/v1/patient-activity?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
        });
      } catch {
        if (!cancelled) {
          setError('network');
          setRows([]);
          setLoading(false);
        }
        return;
      }

      if (!res.ok) {
        if (!cancelled) {
          setError('server');
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const json = (await res.json()) as {
        rows: ActivityRow[];
        has_more: boolean;
        total: number;
        offset: number;
        limit: number;
      };

      if (!cancelled) {
        setRows(json.rows ?? []);
        setHasMore(json.has_more ?? false);
        setTotal(json.total ?? 0);
        setLoading(false);
      }
    };

    void fetchActivity();

    return () => {
      cancelled = true;
    };
  }, [orgId, tab, offset, limit, rev]);

  return { rows, loading, error, hasMore, total, refresh };
}
