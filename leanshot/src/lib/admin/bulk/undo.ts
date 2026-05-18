/**
 * Phase 27 Plan 27-01 — admin bulk-action undo redeem helper (ADMIN-04).
 *
 * Wraps admin_bulk_action_undo SECDEF RPC. The token is single-use (the RPC
 * deletes it as part of redemption) — replay raises 'token_expired'.
 *
 * Server-side TTL is 60s (bulk_action_undo_token.expires_at). The UI
 * countdown in AdminUndoBanner is UX-only; expiry is enforced by the RPC.
 */
import { supabase } from '@/lib/supabase';
import { BulkApiError, type BulkApiErrorCode } from '@/lib/admin/bulk/types';

interface SupabaseRpcError {
  code?: string;
  message?: string;
}

function mapUndoError(err: SupabaseRpcError | null | undefined): BulkApiErrorCode {
  if (!err) return 'unknown';
  const msg = err.message ?? '';
  switch (err.code) {
    case '42501':
      return 'not_staff';
    case '28000':
      return 'not_authenticated';
    case '22023':
      if (msg.includes('token_expired')) return 'token_expired';
      return 'unknown';
    default:
      return 'unknown';
  }
}

export interface UndoResult {
  reversed: number;
}

export async function redeemUndoToken(token: string): Promise<UndoResult> {
  let data: { reversed?: number } | null = null;
  let error: SupabaseRpcError | null = null;
  try {
    const res = await supabase.rpc('admin_bulk_action_undo', { p_undo_token: token });
    data = res.data as { reversed?: number } | null;
    error = res.error as SupabaseRpcError | null;
  } catch (e) {
    throw new BulkApiError('network', { cause: e });
  }

  if (error) {
    throw new BulkApiError(mapUndoError(error), { cause: error });
  }
  if (!data || typeof data.reversed !== 'number') {
    throw new BulkApiError('unknown');
  }
  return { reversed: data.reversed };
}
