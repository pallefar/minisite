/**
 * Phase 27 plan 27-05 — admin anomaly CONFIG API client wrappers.
 *
 * Companion to api.ts (Plan 27-04). Where api.ts wraps the alert acknowledge
 * RPC and reads funnel_anomaly_alerts, this module wraps the three CONFIG
 * RPCs shipped by migration 20270602000040 and reads anomaly_tracked_funnels.
 *
 *   defineFunnel(eventName, lookbackDays?, sigmaThreshold?)
 *     → anomaly_funnel_define RPC → { funnelId }
 *
 *   updateFunnel(funnelId, patch:{ isEnabled?, lookbackDays?, sigmaThreshold? })
 *     → anomaly_funnel_update RPC → void
 *     Only the provided keys are sent to the RPC (so server-side COALESCE
 *     preserves untouched columns).
 *
 *   deleteFunnel(funnelId)
 *     → anomaly_funnel_delete RPC → void; throws 'has_alerts' when the
 *     server-side guard refuses delete because alert history exists for the
 *     funnel (T-27-05-02 mitigation).
 *
 *   listTrackedFunnels()
 *     → SELECT all rows from anomaly_tracked_funnels (RLS allows admin+
 *     SELECT per migration 20260601000031).
 *
 * Discriminated AnomalyConfigApiError covers the 5 server-side error states
 * plus auth + transport. Mirrors src/lib/admin/affiliate-review.ts +
 * src/lib/admin/anomaly/api.ts per 27-PATTERNS C2 + S7.
 */
import { supabase } from '@/lib/supabase';

export type AnomalyConfigApiErrorCode =
  | 'not_staff'
  | 'not_authenticated'
  | 'duplicate_event_name'
  | 'not_found'
  | 'has_alerts'
  | 'network'
  | 'unknown';

export class AnomalyConfigApiError extends Error {
  code: AnomalyConfigApiErrorCode;
  constructor(code: AnomalyConfigApiErrorCode, options?: { cause?: unknown }) {
    super(`anomaly-config:${code}`, options);
    this.name = 'AnomalyConfigApiError';
    this.code = code;
  }
}

interface SupabaseRpcError {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * Map a Postgres error from the SECDEF RPCs to a discriminated client code.
 *
 * Token-based message inspection takes precedence over generic SQLSTATEs
 * because errcode 22023 is shared between 'not_found' and 'has_alerts' (both
 * raised by the delete RPC) and errcode 23505 is shared between native
 * unique_violation and our re-raised 'duplicate_event_name'.
 */
function mapRpcError(err: SupabaseRpcError | null | undefined): AnomalyConfigApiErrorCode {
  if (!err) return 'unknown';
  const msg = err.message ?? '';
  if (msg.includes('duplicate_event_name')) return 'duplicate_event_name';
  if (msg.includes('has_alerts')) return 'has_alerts';
  if (msg.includes('not_found')) return 'not_found';
  if (msg.includes('not_authenticated')) return 'not_authenticated';
  if (msg.includes('forbidden')) return 'not_staff';
  switch (err.code) {
    case '42501':
      return 'not_staff';
    case '28000':
      return 'not_authenticated';
    case '23505':
      return 'duplicate_event_name';
    case '22023':
      return 'not_found';
    default:
      return 'unknown';
  }
}

type ConfigRpcName =
  | 'anomaly_funnel_define'
  | 'anomaly_funnel_update'
  | 'anomaly_funnel_delete';

async function callConfigRpc<T = unknown>(
  rpcName: ConfigRpcName,
  params: Record<string, unknown>,
): Promise<T> {
  try {
    const { data, error } = await supabase.rpc(rpcName, params);
    if (error) {
      throw new AnomalyConfigApiError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
    return data as T;
  } catch (e) {
    if (e instanceof AnomalyConfigApiError) throw e;
    throw new AnomalyConfigApiError('network', { cause: e });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface DefineFunnelResult {
  funnelId: string;
}

export async function defineFunnel(
  eventName: string,
  lookbackDays?: number,
  sigmaThreshold?: number,
): Promise<DefineFunnelResult> {
  const params: Record<string, unknown> = { p_event_name: eventName };
  if (lookbackDays !== undefined) params.p_lookback_days = lookbackDays;
  if (sigmaThreshold !== undefined) params.p_sigma_threshold = sigmaThreshold;
  const funnelId = await callConfigRpc<string>('anomaly_funnel_define', params);
  return { funnelId };
}

export interface UpdateFunnelPatch {
  isEnabled?: boolean;
  lookbackDays?: number;
  sigmaThreshold?: number;
}

export async function updateFunnel(funnelId: string, patch: UpdateFunnelPatch): Promise<void> {
  const params: Record<string, unknown> = { p_funnel_id: funnelId };
  if (patch.isEnabled !== undefined) params.p_is_enabled = patch.isEnabled;
  if (patch.lookbackDays !== undefined) params.p_lookback_days = patch.lookbackDays;
  if (patch.sigmaThreshold !== undefined) params.p_sigma_threshold = patch.sigmaThreshold;
  await callConfigRpc<null>('anomaly_funnel_update', params);
}

export async function deleteFunnel(funnelId: string): Promise<void> {
  await callConfigRpc<null>('anomaly_funnel_delete', { p_funnel_id: funnelId });
}

// ── Read path (RLS-gated SELECT) ───────────────────────────────────────────

export interface TrackedFunnel {
  funnelId: string;
  eventName: string;
  isEnabled: boolean;
  lookbackDays: number;
  sigmaThreshold: number;
  createdBy: string | null;
  createdAt: string;
}

interface TrackedFunnelRawRow {
  funnel_id: string;
  event_name: string;
  is_enabled: boolean;
  baseline_lookback_days: number;
  sigma_threshold: number | string;
  created_by: string | null;
  created_at: string;
}

export async function listTrackedFunnels(): Promise<TrackedFunnel[]> {
  try {
    const { data, error } = await supabase
      .from('anomaly_tracked_funnels')
      .select(
        'funnel_id, event_name, is_enabled, baseline_lookback_days, sigma_threshold, created_by, created_at',
      )
      .order('created_at', { ascending: false });
    if (error) {
      throw new AnomalyConfigApiError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
    return ((data ?? []) as TrackedFunnelRawRow[]).map((r) => ({
      funnelId: r.funnel_id,
      eventName: r.event_name,
      isEnabled: r.is_enabled,
      lookbackDays: r.baseline_lookback_days,
      // Postgres numeric round-trips as a string via PostgREST.
      sigmaThreshold: typeof r.sigma_threshold === 'string'
        ? Number(r.sigma_threshold)
        : r.sigma_threshold,
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  } catch (e) {
    if (e instanceof AnomalyConfigApiError) throw e;
    throw new AnomalyConfigApiError('network', { cause: e });
  }
}
