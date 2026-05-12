/**
 * Phase 6 D-05 — signed-URL cache for the photos Storage bucket.
 *
 * The bucket is private (D-04), so every read goes through a time-bounded
 * signed URL. Naïvely calling `createSignedUrl` per `<img>` mount would
 * hammer the Storage API; instead we cache the URL by storage_path with a
 * 30-second pre-expiry refresh window AND a 401-aware fetch helper so a
 * race between cache lookup and Storage clock-skew doesn't leave a broken
 * tile.
 *
 * TTL (D-05): 5 minutes (300 s) is the Phase 6 LOCKED default. A forwarded
 * URL is unusable beyond 5 minutes (T-06-04-03 mitigation).
 */
import { supabase } from '@/lib/supabase';

const TTL_SECONDS = 300;
const REFRESH_WINDOW_MS = 30_000;

interface CacheEntry {
  url: string;
  expiresAt: number; // epoch ms
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/**
 * Resolve a signed URL for `storagePath` (e.g. `${userId}/photos/${photoId}.jpg`).
 *
 * - Returns cached URL when fresh (expiresAt > now + 30s)
 * - Otherwise issues a new `createSignedUrl(path, TTL_SECONDS)` call
 * - Coalesces concurrent calls for the same path via an inflight Map so
 *   N tile mounts on the same photo only trigger one network round-trip
 */
export async function getSignedPhotoUrl(storagePath: string): Promise<string> {
  const cached = cache.get(storagePath);
  const now = Date.now();
  if (cached && cached.expiresAt - now > REFRESH_WINDOW_MS) {
    return cached.url;
  }

  const existing = inflight.get(storagePath);
  if (existing) return existing;

  const promise = (async () => {
    const { data, error } = await supabase.storage
      .from('photos')
      .createSignedUrl(storagePath, TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw error ?? new Error('SIGNED_URL_FAILED');
    }
    const url = data.signedUrl;
    cache.set(storagePath, {
      url,
      expiresAt: Date.now() + TTL_SECONDS * 1000,
    });
    return url;
  })().finally(() => {
    inflight.delete(storagePath);
  });

  inflight.set(storagePath, promise);
  return promise;
}

/**
 * Fetch the photo bytes via the signed URL, refreshing the cache once on a
 * 401 response (Storage clock-skew / aggressive TTL trim — Pitfall 5).
 * Returns the Response so callers can decide whether to `.blob()` or pipe.
 */
export async function fetchPhotoWithRefresh(storagePath: string): Promise<Response> {
  const url = await getSignedPhotoUrl(storagePath);
  let res = await fetch(url);
  if (res.status === 401) {
    cache.delete(storagePath);
    const refreshed = await getSignedPhotoUrl(storagePath);
    res = await fetch(refreshed);
  }
  return res;
}

/**
 * Sign-out cleanup mate for `clearAllPhotoBlobs`. T-06-04-04 — prior user's
 * cached URLs must not leak into the next sign-in. Fired in sync-defer's
 * onSignedOut branch alongside the IndexedDB clear.
 */
export function clearSignedUrlCache(): void {
  cache.clear();
  inflight.clear();
}

/** Test-only inspector. @internal */
export function _peekCacheForTests(): Map<string, CacheEntry> {
  return cache;
}
