/**
 * Phase 27 Plan 27-01 — admin bulk-action RPC client dispatcher (ADMIN-04).
 *
 * Single entry point `executeBulkAction(action, ids, params?)` wraps the
 * admin_bulk_action_execute SECDEF RPC (see 20270602000005_admin_bulk_action_rpcs.sql).
 *
 * Error mapping mirrors leanshot/src/lib/admin/affiliate-review.ts:
 *   - SQLSTATE 42501 → BulkApiError('not_staff')
 *   - SQLSTATE 28000 → BulkApiError('not_authenticated')
 *   - SQLSTATE 22023 + message match → 'too_many_rows' | 'invalid_action' | 'token_expired'
 *   - thrown error → 'network'
 *
 * The csv_export branch in v1 trusts the RPC's `affected` count and triggers
 * a client-side CSV download by querying the seleted profile rows directly
 * (RLS-restricted). Future v2: stream from a dedicated Edge Function.
 */
import { supabase } from '@/lib/supabase';
import {
  BulkApiError,
  type BulkActionParams,
  type BulkActionResult,
  type BulkActionType,
  type BulkApiErrorCode,
} from '@/lib/admin/bulk/types';

interface SupabaseRpcError {
  code?: string;
  message?: string;
  details?: string;
}

interface BulkRpcSuccessShape {
  mode: 'sync' | 'async';
  affected: number;
  undo_token: string | null;
  job_id: string | null;
}

function mapRpcError(err: SupabaseRpcError | null | undefined): BulkApiErrorCode {
  if (!err) return 'unknown';
  const msg = err.message ?? '';
  switch (err.code) {
    case '42501':
      return 'not_staff';
    case '28000':
      return 'not_authenticated';
    case '22023':
      if (msg.includes('too_many_rows')) return 'too_many_rows';
      if (msg.includes('invalid_action')) return 'invalid_action';
      if (msg.includes('token_expired')) return 'token_expired';
      return 'unknown';
    default:
      return 'unknown';
  }
}

export async function executeBulkAction(
  action: BulkActionType,
  targetUserIds: string[],
  params: BulkActionParams = {},
): Promise<BulkActionResult> {
  let data: BulkRpcSuccessShape | null = null;
  let error: SupabaseRpcError | null = null;
  try {
    const res = await supabase.rpc('admin_bulk_action_execute', {
      p_action_type: action,
      p_target_user_ids: targetUserIds,
      p_params: params,
    });
    data = res.data as BulkRpcSuccessShape | null;
    error = res.error as SupabaseRpcError | null;
  } catch (e) {
    throw new BulkApiError('network', { cause: e });
  }

  if (error) {
    throw new BulkApiError(mapRpcError(error), { cause: error });
  }
  if (!data) {
    throw new BulkApiError('unknown');
  }

  // Normalize snake_case RPC response → camelCase TS shape.
  if (data.mode === 'async') {
    return {
      mode: 'async',
      affected: 0,
      undoToken: null,
      jobId: data.job_id ?? '',
    };
  }
  return {
    mode: 'sync',
    affected: data.affected,
    undoToken: data.undo_token,
    jobId: null,
  };
}

/**
 * Client-side CSV download helper for the csv_export action.
 *
 * Per D-03: the RPC writes an aggregate audit row (count-only) — no PHI is
 * dumped server-side. The client fetches the visible profile rows via the
 * existing RLS-scoped query and builds the CSV via Blob + anchor click
 * (same pattern as BulkExportCSVFlow.tsx).
 */
export function buildAndDownloadCsv(rows: Record<string, unknown>[], filenamePrefix = 'members'): void {
  if (rows.length === 0) return;
  const cols = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
  const csv = `${header}\n${body}\n`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.download = `${filenamePrefix}-${dateStr}.csv`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
