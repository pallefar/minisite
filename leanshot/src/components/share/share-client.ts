/**
 * Typed fetch wrappers for the doctor read-share Edge Function (Plan 08-02).
 *
 * INVARIANT — no supabase client imports anywhere in this module. The
 * recipient cookie (set by /share/redeem on success) IS the auth on
 * /share/snapshot; no JWT involved. We talk to the Edge Function with plain
 * `fetch` and `credentials: 'include'`. Bundle-size memory
 * `project_phase5_bundle_regression.md`: src/components/share/* MUST stay off
 * the supabase-js static graph (bundle CI enforces).
 *
 * Per BL-1 (Plan 08-02), /share/snapshot 200 includes an opaque `share_id`
 * field that the print mode (Plan 08-06) uses for the display ID. We return
 * `SnapshotResponse` verbatim to callers so they can capture it.
 */

import type { RedeemError, SnapshotError, SnapshotResponse } from '@/types/share';

/**
 * Functions-origin base URL. ME-3: `VITE_SUPABASE_FUNCTIONS_URL` lets ops
 * point local dev at a deployed functions instance (and vice versa) without
 * touching the supabase-js URL. When unset, default to the standard
 * `${VITE_SUPABASE_URL}/functions/v1` path.
 */
const FN_BASE =
  (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined) ??
  `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`;

export type SnapshotResult =
  | { ok: true; data: SnapshotResponse }
  | { ok: false; error: SnapshotError };

export async function fetchSnapshot(token: string): Promise<SnapshotResult> {
  const url = `${FN_BASE}/share/snapshot?token=${encodeURIComponent(token)}`;
  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', credentials: 'include' });
  } catch {
    // Network error → caller renders state F (generic load error).
    return { ok: false, error: 'not-found' };
  }
  if (resp.ok) {
    const data = (await resp.json()) as SnapshotResponse;
    return { ok: true, data };
  }
  let body: { error?: SnapshotError } = {};
  try {
    body = (await resp.json()) as { error?: SnapshotError };
  } catch {
    /* noop — body unreadable */
  }
  const errorCode: SnapshotError = body.error ?? 'not-found';
  return { ok: false, error: errorCode };
}

export type RedeemResult = { ok: true } | { ok: false; error: RedeemError; retryAfterSec?: number };

export async function redeemShare(token: string, code: string): Promise<RedeemResult> {
  const url = `${FN_BASE}/share/redeem`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, code }),
    });
  } catch {
    return { ok: false, error: 'invalid-code' };
  }
  if (resp.ok) return { ok: true };
  let body: { error?: RedeemError; retry_after_sec?: number } = {};
  try {
    body = (await resp.json()) as { error?: RedeemError; retry_after_sec?: number };
  } catch {
    /* noop */
  }
  const errorCode: RedeemError = body.error ?? 'invalid-code';
  return { ok: false, error: errorCode, retryAfterSec: body.retry_after_sec };
}
