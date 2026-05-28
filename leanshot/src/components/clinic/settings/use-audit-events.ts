/**
 * Phase 10 Plan 10-08 — useAuditEvents hook.
 *
 * Fetches audit_logs directly via supabase-js. RLS on audit_logs gates by
 * org_id IN <user's orgs with audit_log.read> — no new Edge Function needed.
 *
 * PHI contract: filter state is never logged to PostHog. Only boolean flags
 * (has_member_filter, has_action_filter, has_time_filter) are captured via
 * the clinic_audit_filter_applied event (see AuditFilterBar.tsx).
 *
 * 13-month retention: the `created_at` filter enforces a client-side floor
 * of 13 months ago. Phase 7's retention cron handles DB-level purge.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface AuditEvent {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  target_user_id: string | null;
  row_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  /** Joined from auth.users via actor_user_id — display_name */
  actor_display_name: string | null;
}

export type TimeRangePreset = '24h' | '7d' | '30d' | 'custom';

export interface CustomRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface UseAuditEventsOptions {
  orgId: string | null;
  memberFilter: string | null; // actor_user_id to filter on
  actionFilter: string | null; // action enum value to filter on
  timeRangeFilter: TimeRangePreset;
  customRange: CustomRange | null;
  offset: number;
  limit: number;
}

export interface UseAuditEventsResult {
  rows: AuditEvent[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  refresh: () => void;
}

/** Compute the ISO start time for a time-range preset. */
function presetToGte(preset: TimeRangePreset, customRange: CustomRange | null): string | null {
  const now = new Date();
  if (preset === '24h') {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }
  if (preset === '7d') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (preset === '30d') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (preset === 'custom' && customRange) {
    return new Date(`${customRange.from}T00:00:00.000Z`).toISOString();
  }
  return null;
}

function presetToLte(preset: TimeRangePreset, customRange: CustomRange | null): string | null {
  if (preset === 'custom' && customRange) {
    return new Date(`${customRange.to}T23:59:59.999Z`).toISOString();
  }
  return null;
}

/** 13-month retention floor — rows older than this are never surfaced. */
function retentionFloor(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 13);
  return d.toISOString();
}

export function useAuditEvents({
  orgId,
  memberFilter,
  actionFilter,
  timeRangeFilter,
  customRange,
  offset,
  limit,
}: UseAuditEventsOptions): UseAuditEventsResult {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const refreshToken = useRef(0);

  const fetch = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);

    const floor = retentionFloor();
    const gte = presetToGte(timeRangeFilter, customRange);
    const lte = presetToLte(timeRangeFilter, customRange);
    // The effective start is max(preset start, retention floor)
    const effectiveGte = gte && gte > floor ? gte : floor;

    // Count query (head:true to get count without fetching rows)
    let countQuery = supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', effectiveGte);

    if (memberFilter) countQuery = countQuery.eq('actor_user_id', memberFilter);
    if (actionFilter) countQuery = countQuery.eq('action', actionFilter);
    if (lte) countQuery = countQuery.lte('created_at', lte);

    // Data query — join actor display_name via metadata (no foreign-key join;
    // read raw_user_meta_data via select expansion; falls back to null if absent)
    let dataQuery = supabase
      .from('audit_logs')
      .select(
        'id, org_id, actor_user_id, actor_type, action, target_user_id, row_id, metadata, created_at, actor:actor_user_id(raw_user_meta_data)',
      )
      .eq('org_id', orgId)
      .gte('created_at', effectiveGte)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (memberFilter) dataQuery = dataQuery.eq('actor_user_id', memberFilter);
    if (actionFilter) dataQuery = dataQuery.eq('action', actionFilter);
    if (lte) dataQuery = dataQuery.lte('created_at', lte);

    const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);

    if (countResult.error) {
      setError("Couldn't load audit events. Check your connection and try again.");
      setLoading(false);
      return;
    }

    if (dataResult.error) {
      setError("Couldn't load audit events. Check your connection and try again.");
      setLoading(false);
      return;
    }

    const raw = (dataResult.data ?? []) as Array<Record<string, unknown>>;
    const mapped: AuditEvent[] = raw.map((r) => {
      // actor join result — supabase-js returns it as an object or null
      const actorMeta = r['actor'] as Record<string, unknown> | null;
      let displayName: string | null = null;
      if (actorMeta && typeof actorMeta === 'object') {
        const meta = actorMeta['raw_user_meta_data'] as Record<string, unknown> | null;
        if (meta && typeof meta['display_name'] === 'string') {
          displayName = meta['display_name'];
        }
      }
      return {
        id: r['id'] as string,
        org_id: r['org_id'] as string,
        actor_user_id: (r['actor_user_id'] as string | null) ?? null,
        actor_type: r['actor_type'] as string,
        action: r['action'] as string,
        target_user_id: (r['target_user_id'] as string | null) ?? null,
        row_id: (r['row_id'] as string | null) ?? null,
        metadata: (r['metadata'] as Record<string, unknown> | null) ?? null,
        created_at: r['created_at'] as string,
        actor_display_name: displayName,
      };
    });

    setRows(mapped);
    setTotalCount(countResult.count ?? 0);
    setLoading(false);
  }, [orgId, memberFilter, actionFilter, timeRangeFilter, customRange, offset, limit]);

  const refresh = useCallback(() => {
    refreshToken.current += 1;
    void fetch();
  }, [fetch]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { rows, loading, error, totalCount, refresh };
}
