/**
 * federated-cache.ts — 24h TTL cache for Phase 60 federated adapter Fns.
 *
 * Phase 60 Plan 60-07. T-60-07-07 cache-poisoning / cross-source-bleed mitigation.
 *
 * Cache key: (source_name, cache_key) — composite UNIQUE constraint on
 * `federated_source_cache` table (per 60-01 migration). The cache_key is a
 * sha256 of the canonical-stringified query `{endpoint, params}`.
 *
 * Write: INSERT ... ON CONFLICT (source_name, cache_key) DO UPDATE
 * Read:  SELECT WHERE expires_at > now() (treats expired rows as misses)
 *
 * Schema reality (from 60-01 migration):
 *   federated_source_cache.source_name  text NOT NULL REFERENCES federated_sources(name)
 *   federated_source_cache.cache_key    text NOT NULL
 *   federated_source_cache.payload      jsonb NOT NULL
 *   federated_source_cache.fetched_at   timestamptz
 *   federated_source_cache.expires_at   timestamptz NOT NULL
 *   UNIQUE (source_name, cache_key)
 *
 * Per [[reference_postgres_no_insert_on_conflict_do_delete]]:
 *   Uses INSERT ... ON CONFLICT DO UPDATE (correct), not any non-existent
 *   ON CONFLICT DO DELETE syntax.
 *
 * Dependency injection: all supabase calls receive a `SupabaseLike` client
 * from the caller. In production Fns, callers pass the service-role client
 * constructed in index.ts. This module NEVER imports supabase-server.ts
 * directly (which uses Deno `npm:` specifiers) — keeps this module testable
 * under Node/Vitest without hitting Deno-specific bundler limitations.
 *
 * [[T-60-07-07]] [[reference_minisite_monorepo_layout]]
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type FederatedSourceName = 'pubmed' | 'openfda' | 'dailymed';

/** Minimal Supabase-client interface needed by this module (injectable in tests). */
export interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        eq(col: string, val: unknown): {
          gt(col: string, val: unknown): {
            maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
      };
    };
    upsert(
      row: Record<string, unknown>,
      opts: Record<string, unknown>,
    ): Promise<{ error: { message: string } | null }>;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// hashQuery — deterministic sha256 hex
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compute sha256 hex of the canonical JSON string of {endpoint, params}.
 *
 * Params are sorted by key to ensure param-order doesn't cause hash collisions
 * (T-60-07-07 defense against param-order collision).
 *
 * Returns a hex string.
 */
export async function hashQuery(input: {
  endpoint: string;
  params: Record<string, unknown>;
}): Promise<string> {
  const canonicalStr = JSON.stringify({
    endpoint: input.endpoint,
    params: Object.fromEntries(
      Object.entries(input.params).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// readCachedFetch
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Read a cached fetch response for (source, queryHash).
 *
 * Returns the cached `payload` JSONB value when:
 *   - A row exists with the given (source_name, cache_key)
 *   - AND `expires_at > now()` (treats expired rows as misses)
 *
 * Returns null on miss, expired, or DB error.
 *
 * @param source - The federated source name
 * @param queryHash - sha256 hash from hashQuery()
 * @param supabase - Injectable Supabase client (service-role in production)
 */
export async function readCachedFetch(
  source: FederatedSourceName,
  queryHash: string,
  supabase: SupabaseLike,
): Promise<unknown | null> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('federated_source_cache')
    .select('payload, expires_at')
    .eq('source_name', source)
    .eq('cache_key', queryHash)
    .gt('expires_at', now)
    .maybeSingle();

  if (error) {
    console.warn('[federated-cache] readCachedFetch error:', error.message);
    return null;
  }

  if (!data) return null;

  // Deep-copy on read to prevent callers from mutating cached value
  const row = data as { payload: unknown; expires_at: string };
  return JSON.parse(JSON.stringify(row.payload));
}

// ──────────────────────────────────────────────────────────────────────────────
// writeCachedFetch
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Write/upsert a fetch response into the cache.
 *
 * Upserts via INSERT ... ON CONFLICT (source_name, cache_key) DO UPDATE
 * to ensure idempotency and 24h TTL reset on overwrite.
 *
 * Deep-copies the response to prevent mutation after insert.
 *
 * @param source - The federated source name
 * @param queryHash - sha256 hash from hashQuery()
 * @param response - The response payload to cache
 * @param supabase - Injectable Supabase client (service-role in production)
 */
export async function writeCachedFetch(
  source: FederatedSourceName,
  queryHash: string,
  response: unknown,
  supabase: SupabaseLike,
): Promise<void> {
  // Deep-copy semantics: never store a reference the caller might mutate
  const payloadCopy = JSON.parse(JSON.stringify(response));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('federated_source_cache')
    .upsert(
      {
        source_name: source,
        cache_key: queryHash,
        payload: payloadCopy,
        fetched_at: now.toISOString(),
        expires_at: expiresAt,
        updated_at: now.toISOString(),
      },
      { onConflict: 'source_name,cache_key' },
    );

  if (error) {
    console.warn('[federated-cache] writeCachedFetch error:', error.message);
  }
}
