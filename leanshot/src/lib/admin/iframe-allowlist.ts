/**
 * Phase 41 Plan 41-02 — Custom-iframe allowlist client wrappers.
 *
 * Thin supabase-js wrappers around the SECDEF RPCs shipped in
 * `supabase/migrations/20271101000002_p41_iframe_allowlist_rpcs.sql`:
 *   • public.add_iframe_allowlist_hostname(p_hostname text) returns uuid
 *   • public.remove_iframe_allowlist_hostname(p_id uuid) returns void
 *
 * These wrappers exist for Plan 41-06's superadmin admin UI; they accept the
 * caller's authenticated supabase-js client so the RPC's auth.uid() picks up
 * the superadmin JWT (per `feedback_rpc_auth_uid_vs_service_role_mismatch`
 * — service-role contexts would fail the SECDEF gate).
 *
 * Pattern S1 (dual-layer): UI hides the module from non-superadmin
 * (`minRole: 'superadmin'`); the RPC re-checks server-side. The UI gate is
 * UX-only — the security boundary is the SECDEF body.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AllowlistRow {
  id: string;
  hostname: string;
  added_by_user_id: string | null;
  added_at: string;
  last_used_at: string | null;
}

/**
 * Lists allowlist rows newest-first. RLS allows anon + authenticated SELECT
 * (see Plan 41-02 table migration), but this wrapper is intended for the
 * admin surface — typed result + ordered for table display.
 */
export async function listHostnames(
  client: SupabaseClient,
): Promise<AllowlistRow[]> {
  const { data, error } = await client
    .from('iframe_allowlist')
    .select('id, hostname, added_by_user_id, added_at, last_used_at')
    .order('added_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AllowlistRow[];
}

/**
 * Adds a hostname. Server-side SECDEF gate enforces superadmin; malformed
 * hostnames (containing '://', '/', '*', or leading '.') raise 22023.
 * Resolves to the new row id.
 */
export async function addHostname(
  client: SupabaseClient,
  hostname: string,
): Promise<{ id: string }> {
  const { data, error } = await client.rpc('add_iframe_allowlist_hostname', {
    p_hostname: hostname,
  });
  if (error) throw error;
  return { id: data as string };
}

/**
 * Removes a hostname by id. Server-side SECDEF gate enforces superadmin.
 * Raises 22023 on null id; PostgREST returns success even when the row
 * already doesn't exist (DELETE is naturally idempotent).
 */
export async function removeHostname(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client.rpc('remove_iframe_allowlist_hostname', {
    p_id: id,
  });
  if (error) throw error;
}
