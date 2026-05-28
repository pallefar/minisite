/**
 * Phase 22 plan 22-11 — D-06 / GDPR-03 client invoker.
 *
 * Thin wrapper around the user-facing DSAR contract:
 *   - `public.create_dsar_request()` RPC (plan 22-04 migration 18) — INSERTs a
 *     `pending` row + skeleton `audit_logs` row. SECURITY DEFINER on the RPC
 *     enforces auth.uid() + the "one active request at a time" guard.
 *   - SELECT on `dsar_requests` for status polling (RLS = select-own).
 *   - Supabase Realtime channel subscription for live status transitions.
 *
 * The server-side cascade (bundle assembly + jsPDF + ZIP + Storage upload +
 * signed URL) is owned by `supabase/functions/dsar-export` (plan 22-04). This
 * client NEVER invokes that Fn directly — the service-role bearer is the
 * required auth and lives only in the pg_cron tick (plan 22-11 migration 21).
 *
 * Error contract (discriminated union — UI can branch without parsing strings):
 *   - 'already_pending' — Postgres error code P0008 from the RPC guard
 *   - 'not_authenticated' — Postgres error code 28000 (defensive — client should
 *     not reach this since the DSAR portal route is auth-gated upstream)
 *   - 'forbidden' — RLS denial on SELECT (defensive)
 *   - 'unknown' — anything else
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type DsarRequestStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';

export interface DsarRequestRow {
  id: string;
  user_id: string;
  requested_at: string;
  completed_at: string | null;
  status: DsarRequestStatus;
  rejection_reason: string | null;
  export_path: string | null;
  export_signed_url_expires_at: string | null;
}

export type DsarErrorCode = 'already_pending' | 'not_authenticated' | 'forbidden' | 'unknown';

export class DsarError extends Error {
  constructor(
    public readonly code: DsarErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DsarError';
  }
}

/**
 * Map a Supabase/Postgres error into the typed `DsarError` discriminated union.
 * Inspects `code` (Postgres SQLSTATE) and the message body for known signals.
 */
export function mapDsarError(err: unknown): DsarError {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : null;
    const message = typeof e.message === 'string' ? e.message : '';
    if (code === 'P0008' || /already_pending/i.test(message)) {
      return new DsarError('already_pending', message);
    }
    if (code === '28000' || /not_authenticated/i.test(message)) {
      return new DsarError('not_authenticated', message);
    }
    if (code === '42501' || /forbidden|permission denied/i.test(message)) {
      return new DsarError('forbidden', message);
    }
    return new DsarError('unknown', message || 'unknown_error');
  }
  return new DsarError('unknown', 'unknown_error');
}

/**
 * INSERT a `pending` DSAR request via the SECURITY DEFINER RPC.
 * Returns the new request UUID on success; throws `DsarError` on failure.
 */
export async function requestDsarExport(): Promise<string> {
  const { data, error } = await supabase.rpc('create_dsar_request');
  if (error) throw mapDsarError(error);
  if (typeof data !== 'string') {
    throw new DsarError('unknown', 'rpc_returned_non_string');
  }
  return data;
}

/**
 * Fetch a single DSAR request row. Returns `null` when not found (e.g. user
 * tries to poll an ID that was deleted server-side — defensive).
 */
export async function getDsarRequest(requestId: string): Promise<DsarRequestRow | null> {
  const { data, error } = await supabase
    .from('dsar_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw mapDsarError(error);
  return (data ?? null) as DsarRequestRow | null;
}

/**
 * List the caller's DSAR request history (most recent first). RLS scopes to
 * own rows; no user_id parameter needed.
 */
export async function listDsarRequests(limit = 25): Promise<DsarRequestRow[]> {
  const { data, error } = await supabase
    .from('dsar_requests')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (error) throw mapDsarError(error);
  return (Array.isArray(data) ? data : []) as DsarRequestRow[];
}

/**
 * Subscribe to live status transitions for the current user's DSAR requests.
 * `callback` fires whenever the dsar_requests row changes (status flip from
 * pending → in_progress → completed, or pending → rejected). RLS already
 * scopes the row stream to the current user; the optional `userId` arg is
 * a defense-in-depth client-side filter so a misconfigured Realtime policy
 * never leaks another user's transitions.
 *
 * Returns the RealtimeChannel — call `supabase.removeChannel(channel)` (or
 * the returned `unsubscribe`) on unmount.
 */
export function subscribeDsarRequests(
  userId: string,
  callback: (row: DsarRequestRow) => void,
): { channel: RealtimeChannel; unsubscribe: () => void } {
  const channel = supabase
    .channel(`dsar_requests:${userId}`)
    .on(
      // Supabase v2 Realtime payload typing is loose; cast for ergonomics.
      'postgres_changes' as never,
      {
        event: '*',
        schema: 'public',
        table: 'dsar_requests',
        filter: `user_id=eq.${userId}`,
      } as never,
      (payload: { new?: DsarRequestRow }) => {
        const row = payload.new;
        if (row && typeof row === 'object' && row.user_id === userId) {
          callback(row);
        }
      },
    )
    .subscribe();
  const unsubscribe = (): void => {
    void supabase.removeChannel(channel);
  };
  return { channel, unsubscribe };
}

/**
 * Format an expiry timestamp for display ("Available until Mar 22, 2026").
 * Returns null when expires_at is missing/malformed so the UI can fall back
 * to a generic caption.
 */
export function formatExpiryDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
