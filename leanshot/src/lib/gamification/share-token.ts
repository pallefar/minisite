/**
 * Client-side share-token utilities for GAME-07 (level-up OG share card).
 *
 * mintShareToken: calls the SECDEF RPC `mint_share_token(p_level)` which
 *   signs the token server-side using HMAC-SHA256 with the vault secret.
 *   The signing key never reaches the browser.
 *
 * buildShareUrl: constructs the full share URL with a cache-bust ?v= param
 *   (Pitfall 9 — Twitter caches by URL; changing ?v forces a fresh OG image fetch).
 */
import { supabase } from '@/lib/supabase';

export async function mintShareToken(level: number): Promise<string> {
  const { data, error } = await supabase.rpc('mint_share_token', {
    p_level: level,
  });
  if (error || typeof data !== 'string') {
    throw new Error('share_token_mint_failed: ' + (error?.message ?? 'unexpected null'));
  }
  return data;
}

export function buildShareUrl(token: string, _level: number): string {
  const baseUrl = import.meta.env.VITE_LEANSHOT_MARKETING_URL ?? 'https://leanshot.app';
  // Append cache-bust ?v=<unix_ts> so each share yields a unique Twitter card key.
  return `${baseUrl}/share/level/${encodeURIComponent(token)}?v=${Date.now()}`;
}
