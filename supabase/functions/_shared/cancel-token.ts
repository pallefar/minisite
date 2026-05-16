/**
 * HMAC cancel-deletion token mint — Phase 22 plan 22-02.
 *
 * Mints a 3-part token matching the `public.cancel_account_deletion(p_token)`
 * RPC contract shipped by plan 22-01 File 14 (migration
 * 20270601000014_cancel_account_deletion_rpc.sql):
 *
 *   token shape:  <uid>.<epoch_seconds>.<hex_hmac_sha256>
 *   payload:      uid || '.' || epoch_seconds
 *   key:          vault.decrypted_secrets WHERE name='CANCEL_DELETION_HMAC_KEY'
 *   ttl check:    now() - epoch ≤ 7 days   (enforced inside the RPC)
 *
 * The RPC verifies the same shape; this helper produces matching tokens.
 *
 * Vault read seam: per `reference_supabase_db_query_linked.md` we use
 * `admin.rpc('get_cancel_deletion_hmac_key')` if such an RPC exists; if
 * not, we fall back to selecting from the view directly via service-role.
 * Plan 22-01 did NOT ship a getter RPC, so we use the view select.
 *
 * Failure modes:
 *   - Vault key missing → returns `{ok:false, reason:'no_vault_key'}`.
 *   - WebCrypto unavailable → returns `{ok:false, reason:'no_crypto'}`.
 *   - Vault select throws → returns `{ok:false, reason:'select_error'}`.
 *
 * Caller (lifecycle-transactional `deletion_scheduled`) handles the
 * failure by emitting a placeholder cancel URL + logging a warning.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface MintResult {
  ok: boolean;
  token?: string;
  reason?: string;
}

export async function mintCancelDeletionToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<MintResult> {
  let key: string | null;
  try {
    key = await loadVaultKey(supabase);
  } catch (e) {
    console.warn(
      '[cancel-token] vault select threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false, reason: 'select_error' };
  }
  if (!key) return { ok: false, reason: 'no_vault_key' };

  const epoch = Math.floor(Date.now() / 1000).toString();
  const payload = `${userId}.${epoch}`;

  let sigHex: string;
  try {
    sigHex = await hmacSha256Hex(key, payload);
  } catch (e) {
    console.warn(
      '[cancel-token] hmac compute failed',
      e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false, reason: 'no_crypto' };
  }
  return { ok: true, token: `${payload}.${sigHex}` };
}

async function loadVaultKey(supabase: SupabaseClient): Promise<string | null> {
  // service_role can SELECT from vault.decrypted_secrets.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (supabase.schema('vault' as any) as any)
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', 'CANCEL_DELETION_HMAC_KEY')
    .limit(1)) as {
      data: Array<{ decrypted_secret?: string }> | null;
      error: { message?: string } | null;
    };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[cancel-token] vault select error', error.message ?? 'unknown');
    return null;
  }
  const row = data?.[0];
  return (row?.decrypted_secret as string | undefined) ?? null;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const keyBuf = new TextEncoder().encode(key);
  const msgBuf = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, msgBuf);
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
