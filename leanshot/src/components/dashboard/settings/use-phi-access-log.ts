/**
 * Phase 25 Plan 02 — `usePhiAccessLog` hook.
 *
 * Fetches the patient's own PHI access log rows from `phi_access_log` using
 * the RLS-scoped SELECT (accessed_user_id = auth.uid() enforced by policy
 * `phi_access_log_select_own_as_subject` — no explicit predicate needed here).
 *
 * Mirrors the pagination shape of `use-patient-activity.ts` (Phase 10 Plan 10-09).
 *
 * Security note (D-08 / PatientActivityModal D-19 pattern):
 * This hook intentionally does NOT call posthog.capture.
 * The patient PHI access viewer is a transparency surface under HIPAA right-of-
 * accounting-of-disclosures. Meta-auditing a patient transparency view would be
 * surveillance theater and violates the D-08 / D-19 explicit decisions.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface PhiAccessRow {
  id: number;
  accessed_at: string;
  actor_user_id: string | null;
  accessed_fields: string[];
  reason: string;
  /** Resolved from profiles table; null if profile not found. */
  actor_display_name: string | null;
}

export interface UsePhiAccessLogResult {
  rows: PhiAccessRow[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  refresh: () => void;
}

export function usePhiAccessLog(offset: number, limit: number = 25): UsePhiAccessLogResult {
  const [rows, setRows] = useState<PhiAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [rev, setRev] = useState(0);

  const refresh = useCallback(() => setRev((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    const fetchLog = async () => {
      setLoading(true);
      setError(null);

      // RLS policy `phi_access_log_select_own_as_subject` filters to
      // accessed_user_id = auth.uid() — no explicit predicate needed.
      const {
        data,
        count,
        error: fetchErr,
      } = await supabase
        .from('phi_access_log')
        .select('id, accessed_at, actor_user_id, accessed_fields, reason', {
          count: 'exact',
        })
        .order('accessed_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (cancelled) return;

      if (fetchErr) {
        setError('server');
        setRows([]);
        setLoading(false);
        return;
      }

      const rawRows = data ?? [];
      const total_ = count ?? 0;

      // Resolve actor display names via a follow-up profiles SELECT.
      // RLS on profiles allows SELECT of basic fields for authenticated users.
      // Fallback to "Staff member" label if profile not found or query fails.
      const actorIds = [
        ...new Set(rawRows.map((r) => r.actor_user_id).filter((id): id is string => id !== null)),
      ];

      const displayNameMap: Record<string, string> = {};
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', actorIds);

        if (!cancelled && profiles) {
          for (const p of profiles) {
            const name = (p as { id: string; display_name: string | null }).display_name;
            if (name) {
              displayNameMap[(p as { id: string }).id] = name;
            }
          }
        }
      }

      if (cancelled) return;

      const resolved: PhiAccessRow[] = rawRows.map((r) => ({
        id: r.id as number,
        accessed_at: r.accessed_at as string,
        actor_user_id: r.actor_user_id as string | null,
        accessed_fields: r.accessed_fields as string[],
        reason: r.reason as string,
        actor_display_name:
          r.actor_user_id !== null ? (displayNameMap[r.actor_user_id] ?? 'Staff member') : 'System',
      }));

      setRows(resolved);
      setTotal(total_);
      setHasMore(offset + rawRows.length < total_);
      setLoading(false);
    };

    void fetchLog();

    return () => {
      cancelled = true;
    };
  }, [offset, limit, rev]);

  return { rows, loading, error, hasMore, total, refresh };
}
