/**
 * client.ts — DailyMed SPL REST client for rag-federated-dailymed.
 *
 * Phase 60 Plan 60-07. Task 4.
 *
 * Exports:
 *   searchSPLs(opts)   — search SPL documents by drug_name and date range
 *   getSPLDetail(setId) — fetch full SPL detail for a set_id
 *
 * Security: assertAllowedHost before every request (T-60-07-01 SSRF).
 * Rate limit: conservative 5 req/s via token bucket (DailyMed has no documented limit
 *   but community-observed IP throttle; per CONTEXT.md AI-SPEC §6 T-60-07-05).
 * Backoff: 429 OR 503 → 4s/8s/16s (slower because throttle is opaque).
 * Cache: 24h TTL via federated_source_cache.
 *
 * [[T-60-07-01]] [[T-60-07-05]]
 */

import { assertAllowedHost } from '../_shared/federated-host-allowlist.ts';
import { hashQuery, readCachedFetch, writeCachedFetch } from '../_shared/federated-cache.ts';
import type { SupabaseLike } from '../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DAILYMED_BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
const SPLS_SEARCH_URL = `${DAILYMED_BASE}/spls.json`;
const USER_AGENT = 'leanshot-rag-federated/1.0 (karsten.haldan@gmail.com)';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = [4000, 8000, 16000] as const;

// Token bucket: 5 req/s
const TOKEN_BUCKET_MAX = 5;
const TOKEN_BUCKET_INTERVAL_MS = 1000; // 1 second
let _tokenBucketTokens = TOKEN_BUCKET_MAX;
let _tokenBucketLastRefill = Date.now();

// ──────────────────────────────────────────────────────────────────────────────
// Error classes
// ──────────────────────────────────────────────────────────────────────────────

export class DailyMedFetchError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastStatus: number,
  ) {
    super(`[rag-federated-dailymed] Fetch failed after ${attempts} attempts. Last status: ${lastStatus}`);
    this.name = 'DailyMedFetchError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dependency injection interface
// ──────────────────────────────────────────────────────────────────────────────

export interface DailyMedClientDeps {
  fetchImpl?: typeof fetch;
  supabase: SupabaseLike;
  env?: Record<string, string | undefined>;
  sleepImpl?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Token bucket rate limiter
// ──────────────────────────────────────────────────────────────────────────────

/** Reset token bucket state (for testing). */
export function _resetTokenBucket(): void {
  _tokenBucketTokens = TOKEN_BUCKET_MAX;
  _tokenBucketLastRefill = Date.now();
}

async function _consumeToken(deps: DailyMedClientDeps): Promise<void> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const now = nowMs();
  const elapsed = now - _tokenBucketLastRefill;

  // Refill tokens based on elapsed time
  const tokensToAdd = Math.floor(elapsed / TOKEN_BUCKET_INTERVAL_MS) * TOKEN_BUCKET_MAX;
  if (tokensToAdd > 0) {
    _tokenBucketTokens = Math.min(TOKEN_BUCKET_MAX, _tokenBucketTokens + tokensToAdd);
    _tokenBucketLastRefill = now;
  }

  if (_tokenBucketTokens > 0) {
    _tokenBucketTokens--;
    return;
  }

  // No tokens — wait for refill
  const waitMs = TOKEN_BUCKET_INTERVAL_MS - (now - _tokenBucketLastRefill) + 100;
  await (deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(Math.max(200, waitMs));
  _tokenBucketTokens = TOKEN_BUCKET_MAX - 1; // consume one after refill
  _tokenBucketLastRefill = nowMs();
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal fetch helper
// ──────────────────────────────────────────────────────────────────────────────

async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  deps: DailyMedClientDeps,
): Promise<unknown> {
  // SSRF guard (T-60-07-01)
  assertAllowedHost(url);

  await _consumeToken(deps);

  const fetchImpl = deps.fetchImpl ?? fetch;
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetchImpl(url, init);
    lastStatus = res.status;

    if (res.status === 429 || res.status === 503) {
      const retryMs = BASE_BACKOFF_MS[attempt] ?? 16000;
      if (attempt < MAX_RETRIES - 1) {
        await (deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(retryMs);
        continue;
      }
      throw new DailyMedFetchError(attempt + 1, res.status);
    }

    if (!res.ok) {
      if (attempt < MAX_RETRIES - 1) {
        await (deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(BASE_BACKOFF_MS[attempt] ?? 16000);
        continue;
      }
      throw new DailyMedFetchError(attempt + 1, res.status);
    }

    return res.json();
  }

  throw new DailyMedFetchError(MAX_RETRIES, lastStatus);
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface SPLSearchOpts {
  topicTag: string;
  published_date_gte: string; // YYYY-MM-DD
  published_date_lte: string; // YYYY-MM-DD
  pagesize?: number;
}

export interface SPLSearchResult {
  data: Array<{ setid: string; title?: string; published_date?: string }>;
}

/**
 * Search DailyMed SPL documents by drug name and publication date range.
 *
 * API: GET /dailymed/services/v2/spls.json?drug_name=<tag>&published_date_gte=...&published_date_lte=...&pagesize=100
 */
export async function searchSPLs(
  opts: SPLSearchOpts,
  deps: DailyMedClientDeps,
): Promise<SPLSearchResult> {
  const pagesize = opts.pagesize ?? 100;
  const params: Record<string, unknown> = {
    drug_name: opts.topicTag,
    published_date_gte: opts.published_date_gte,
    published_date_lte: opts.published_date_lte,
    pagesize,
  };

  const queryHash = await hashQuery({ endpoint: 'spls', params });
  const cached = await readCachedFetch('dailymed', queryHash, deps.supabase);
  if (cached) {
    const c = cached as { data?: Array<{ setid: string }> };
    return { data: c.data ?? [] };
  }

  const urlParams = new URLSearchParams({
    drug_name: opts.topicTag,
    published_date_gte: opts.published_date_gte,
    published_date_lte: opts.published_date_lte,
    pagesize: String(pagesize),
  });
  const url = `${SPLS_SEARCH_URL}?${urlParams.toString()}`;

  const response = await fetchWithBackoff(url, {
    headers: { 'User-Agent': USER_AGENT },
  }, deps);

  await writeCachedFetch('dailymed', queryHash, response, deps.supabase);
  const r = response as { data?: Array<{ setid: string }> };
  return { data: r.data ?? [] };
}

export interface SPLDetailResult {
  setid: string;
  spl_version: number;
  title: string;
  published_date: string;
  sections: Array<{
    code?: string;
    title?: string;
    text?: string;
  }>;
}

/**
 * Fetch full SPL detail for a given set_id.
 *
 * API: GET /dailymed/services/v2/spls/<setId>.json
 */
export async function getSPLDetail(
  setId: string,
  deps: DailyMedClientDeps,
): Promise<SPLDetailResult | null> {
  const queryHash = await hashQuery({ endpoint: `spls/${setId}`, params: {} });
  const cached = await readCachedFetch('dailymed', queryHash, deps.supabase);
  if (cached) {
    return cached as SPLDetailResult;
  }

  const url = `${DAILYMED_BASE}/spls/${setId}.json`;

  // Check for 404 first with a direct preflight (no backoff on 404)
  // Use fetchWithBackoff which handles 429/503 with 4s/8s/16s backoff
  let response: unknown;
  try {
    response = await fetchWithBackoff(url, {
      headers: { 'User-Agent': USER_AGENT },
    }, deps);
  } catch (err) {
    if (err instanceof DailyMedFetchError && err.lastStatus === 404) return null;
    throw err;
  }

  await writeCachedFetch('dailymed', queryHash, response, deps.supabase);
  return response as SPLDetailResult;
}
