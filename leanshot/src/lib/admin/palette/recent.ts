/**
 * Phase 27 Plan 27-03 — recent-items fetcher wrapping the admin_palette_recent
 * SECDEF RPC (supabase/migrations/20260601000020_admin_palette_recent_rpc.sql).
 *
 * Discriminated error contract per Pattern S7 — call sites switch on
 * `PaletteRecentError.code` rather than parsing Postgres error strings.
 *
 * Called lazily on palette open by AdminCommandPalette (CONTEXT D-11):
 *   `setOpen(true)` → useEffect → fetchRecentItems().then(setRecentItems)
 */
import { supabase } from '@/lib/supabase';

export interface RecentItem {
  /** 'member' | 'helpdesk_ticket' | 'affiliate' | 'cohort' | 'audit_log_entry' */
  readonly item_type: string;
  readonly item_id: string;
  readonly label: string;
  readonly route: string;
  readonly last_interacted_at: string;
}

export type PaletteRecentErrorCode =
  | 'not_authenticated' // 28000
  | 'forbidden' // 42501 — caller failed is_admin_at_least('admin')
  | 'network'
  | 'unknown';

export class PaletteRecentError extends Error {
  code: PaletteRecentErrorCode;
  constructor(code: PaletteRecentErrorCode, options?: { cause?: unknown }) {
    super(`palette-recent:${code}`, options);
    this.name = 'PaletteRecentError';
    this.code = code;
  }
}

interface SupabaseRpcErrorShape {
  code?: string;
  message?: string;
}

function mapRpcError(err: SupabaseRpcErrorShape | null | undefined): PaletteRecentErrorCode {
  if (!err) return 'unknown';
  switch (err.code) {
    case '28000':
      return 'not_authenticated';
    case '42501':
      return 'forbidden';
    default:
      // supabase-js surfaces network failures as PostgrestError with no .code
      if (!err.code && err.message?.toLowerCase().includes('fetch')) return 'network';
      return 'unknown';
  }
}

/**
 * Calls public.admin_palette_recent() and maps the result to RecentItem[].
 *
 * Returns an empty array if the RPC reports a forbidden/auth error so the
 * palette stays usable for callers without the admin role (the modules group
 * + quick-actions group still render). Throws only on truly unknown errors.
 */
export async function fetchRecentItems(): Promise<RecentItem[]> {
  const { data, error } = await supabase.rpc('admin_palette_recent');
  if (error) {
    const code = mapRpcError(error as SupabaseRpcErrorShape);
    // Soft-fail on auth/forbid — the palette must still open
    if (code === 'forbidden' || code === 'not_authenticated') return [];
    throw new PaletteRecentError(code, { cause: error });
  }
  if (!Array.isArray(data)) return [];
  return data as RecentItem[];
}
