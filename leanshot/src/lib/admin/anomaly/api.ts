/**
 * Phase 27 plan 27-04 — admin anomaly API client wrappers.
 *
 * - acknowledgeAnomalyAlert(alertId): wraps the funnel_anomaly_acknowledge
 *   SECDEF RPC (migration 20260601000034). Discriminated AnomalyApiError.
 * - listFiringAlerts(): SELECT funnel_anomaly_alerts joined to
 *   anomaly_tracked_funnels for the event_name display column. Filtered to
 *   resolution_status='firing' by default; the queue UI can call listAll for
 *   the history tab.
 *
 * Mirrors src/lib/admin/affiliate-review.ts (lines 19-82) per 27-PATTERNS C2.
 */
import { supabase } from '@/lib/supabase';

export type AnomalyApiErrorCode =
  | 'not_staff'
  | 'not_authenticated'
  | 'not_found'
  | 'network'
  | 'unknown';

export class AnomalyApiError extends Error {
  code: AnomalyApiErrorCode;
  constructor(code: AnomalyApiErrorCode, options?: { cause?: unknown }) {
    super(`anomaly:${code}`, options);
    this.name = 'AnomalyApiError';
    this.code = code;
  }
}

interface SupabaseRpcError {
  code?: string;
  message?: string;
  details?: string;
}

function mapRpcError(err: SupabaseRpcError | null | undefined): AnomalyApiErrorCode {
  if (!err) return 'unknown';
  const msg = err.message ?? '';
  if (msg.includes('not_found')) return 'not_found';
  switch (err.code) {
    case '42501':
      return 'not_staff';
    case '28000':
      return 'not_authenticated';
    case '22023':
      return 'not_found';
    default:
      return 'unknown';
  }
}

export async function acknowledgeAnomalyAlert(alertId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('funnel_anomaly_acknowledge', {
      p_alert_id: alertId,
    });
    if (error) {
      throw new AnomalyApiError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
  } catch (e) {
    if (e instanceof AnomalyApiError) throw e;
    throw new AnomalyApiError('network', { cause: e });
  }
}

export type AnomalyResolutionStatus = 'firing' | 'resolved' | 'acknowledged';

export interface AnomalyAlertRow {
  id: string;
  funnel_id: string;
  fired_at: string;
  tick_bucket: string;
  observed_count: number;
  expected_mean: number;
  expected_stddev: number;
  z_score: number;
  resolution_status: AnomalyResolutionStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  event_name: string | null;
}

/**
 * List alerts joined to the tracked-funnels table for the event_name column.
 *
 * statusFilter:
 *   - 'firing' (default) — queue view
 *   - 'acknowledged' — history tab
 *   - 'all' — every status
 */
export async function listFiringAlerts(
  statusFilter: AnomalyResolutionStatus | 'all' = 'firing',
  limit = 200,
): Promise<AnomalyAlertRow[]> {
  try {
    let query = supabase
      .from('funnel_anomaly_alerts')
      .select(
        'id, funnel_id, fired_at, tick_bucket, observed_count, expected_mean, expected_stddev, z_score, resolution_status, acknowledged_by, acknowledged_at, anomaly_tracked_funnels(event_name)',
      )
      .order('fired_at', { ascending: false })
      .limit(limit);
    if (statusFilter !== 'all') {
      query = query.eq('resolution_status', statusFilter);
    }
    const { data, error } = await query;
    if (error) {
      throw new AnomalyApiError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
    type RawRow = Omit<AnomalyAlertRow, 'event_name'> & {
      anomaly_tracked_funnels?: { event_name?: string } | { event_name?: string }[] | null;
    };
    return ((data ?? []) as RawRow[]).map((r) => {
      let eventName: string | null = null;
      const j = r.anomaly_tracked_funnels;
      if (j) {
        if (Array.isArray(j)) eventName = j[0]?.event_name ?? null;
        else eventName = j.event_name ?? null;
      }
      return {
        id: r.id,
        funnel_id: r.funnel_id,
        fired_at: r.fired_at,
        tick_bucket: r.tick_bucket,
        observed_count: r.observed_count,
        expected_mean: r.expected_mean,
        expected_stddev: r.expected_stddev,
        z_score: r.z_score,
        resolution_status: r.resolution_status,
        acknowledged_by: r.acknowledged_by,
        acknowledged_at: r.acknowledged_at,
        event_name: eventName,
      };
    });
  } catch (e) {
    if (e instanceof AnomalyApiError) throw e;
    throw new AnomalyApiError('network', { cause: e });
  }
}
