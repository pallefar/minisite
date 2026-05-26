/**
 * client.ts — OpenFDA REST client for rag-federated-fda.
 *
 * Phase 60 Plan 60-07. Task 3.
 *
 * Exports:
 *   searchDrugLabels(opts)  — OpenFDA drug/label endpoint
 *   searchDrugEvents(opts)  — OpenFDA drug/event endpoint
 *
 * Security: assertAllowedHost called before every network request (T-60-07-01 SSRF).
 * Rate limit: 240 req/min unauth, 240k req/day with API key.
 *   Sliding-window ring buffer (240-slot, 60s window) — pause when full.
 * Backoff: 429 → 2s/4s/8s exponential (OpenFDA recommends ≥2s base).
 * Cache: readCachedFetch / writeCachedFetch via federated-cache.ts (24h TTL).
 *
 * Dependency injection: all external deps injectable for testing.
 *
 * [[T-60-07-01]] [[T-60-07-02]] [[T-60-07-05]]
 */

import { assertAllowedHost } from '../_shared/federated-host-allowlist.ts';
import { hashQuery, readCachedFetch, writeCachedFetch } from '../_shared/federated-cache.ts';
import type { SupabaseLike } from '../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const FDA_BASE = 'https://api.fda.gov';
const DRUG_LABEL_URL = `${FDA_BASE}/drug/label.json`;
const DRUG_EVENT_URL = `${FDA_BASE}/drug/event.json`;
const USER_AGENT = 'leanshot-rag-federated/1.0 (karsten.haldan@gmail.com)';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = [2000, 4000, 8000] as const;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds
const RATE_LIMIT_MAX_REQUESTS = 240;
const DEFAULT_LIMIT = 100;

// ──────────────────────────────────────────────────────────────────────────────
// Error classes
// ──────────────────────────────────────────────────────────────────────────────

export class FDAFetchError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastStatus: number,
  ) {
    super(`[rag-federated-fda] Fetch failed after ${attempts} attempts. Last status: ${lastStatus}`);
    this.name = 'FDAFetchError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dependency injection interface
// ──────────────────────────────────────────────────────────────────────────────

export interface FDAClientDeps {
  fetchImpl?: typeof fetch;
  supabase: SupabaseLike;
  env?: Record<string, string | undefined>;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable timestamp factory for rate-limit window (defaults to Date.now) */
  nowMs?: () => number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sliding-window rate limiter (module-level ring buffer)
// ──────────────────────────────────────────────────────────────────────────────

const _requestTimestamps: number[] = [];

function _checkRateLimit(nowMs: () => number): boolean {
  const now = nowMs();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  // Remove timestamps outside the window
  while (_requestTimestamps.length > 0 && _requestTimestamps[0]! < windowStart) {
    _requestTimestamps.shift();
  }
  if (_requestTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false; // rate limit hit
  }
  _requestTimestamps.push(now);
  return true;
}

/** Reset rate limit state (for testing). */
export function _resetRateLimit(): void {
  _requestTimestamps.length = 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

function getEnv(deps: FDAClientDeps, key: string): string | undefined {
  if (deps.env) return deps.env[key];
  try {
    // deno-lint-ignore no-explicit-any
    return (globalThis as any).Deno?.env?.get(key) as string | undefined;
  } catch {
    return undefined;
  }
}

async function sleep(ms: number, deps: FDAClientDeps): Promise<void> {
  if (deps.sleepImpl) return deps.sleepImpl(ms);
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  deps: FDAClientDeps,
): Promise<unknown> {
  // SSRF guard (T-60-07-01)
  assertAllowedHost(url);

  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? (() => Date.now());
  let lastStatus = 0;

  // Rate limit check — pause if at 240/min
  if (!_checkRateLimit(nowMs)) {
    // Wait until the oldest request falls out of the window
    const oldest = _requestTimestamps[0] ?? 0;
    const waitMs = RATE_LIMIT_WINDOW_MS - (nowMs() - oldest) + 100;
    await sleep(waitMs, deps);
    _checkRateLimit(nowMs); // Now we should be under limit
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetchImpl(url, init);
    lastStatus = res.status;

    if (res.status === 429) {
      const retryAfterMs = BASE_BACKOFF_MS[attempt] ?? 8000;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(retryAfterMs, deps);
        continue;
      }
      throw new FDAFetchError(attempt + 1, res.status);
    }

    if (!res.ok) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_BACKOFF_MS[attempt] ?? 8000, deps);
        continue;
      }
      throw new FDAFetchError(attempt + 1, res.status);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new FDAFetchError(attempt + 1, 200); // HTML = rate-limit page
    }

    return res.json();
  }

  throw new FDAFetchError(MAX_RETRIES, lastStatus);
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface DrugLabelSearchOpts {
  topicTag: string;
  effective_time_gte: string; // YYYYMMDD
  effective_time_lte: string; // YYYYMMDD
  limit?: number;
}

export interface DrugEventSearchOpts {
  topicTag: string;
  receivedate_gte: string; // YYYYMMDD
  receivedate_lte: string; // YYYYMMDD
  limit?: number;
}

export interface FDASearchResult {
  results: unknown[];
}

/**
 * Search OpenFDA drug/label endpoint.
 *
 * Builds search term: `openfda.generic_name:<topicTag> AND effective_time:[GTE TO LTE]`
 */
export async function searchDrugLabels(
  opts: DrugLabelSearchOpts,
  deps: FDAClientDeps,
): Promise<FDASearchResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const search = `openfda.generic_name:${opts.topicTag}+AND+effective_time:[${opts.effective_time_gte}+TO+${opts.effective_time_lte}]`;
  const apiKey = getEnv(deps, 'OPENFDA_API_KEY');

  const params: Record<string, unknown> = {
    search,
    limit,
    ...(apiKey ? { api_key: apiKey } : {}),
  };

  const queryHash = await hashQuery({ endpoint: 'drug/label', params });
  const cached = await readCachedFetch('openfda', queryHash, deps.supabase);
  if (cached) {
    const c = cached as { results?: unknown[] };
    return { results: c.results ?? [] };
  }

  const urlParams = new URLSearchParams({ search, limit: String(limit) });
  if (apiKey) urlParams.set('api_key', apiKey);
  const url = `${DRUG_LABEL_URL}?${urlParams.toString()}`;

  const response = await fetchWithBackoff(url, {
    headers: { 'User-Agent': USER_AGENT },
  }, deps);

  await writeCachedFetch('openfda', queryHash, response, deps.supabase);
  const r = response as { results?: unknown[] };
  // OpenFDA returns empty results (no 404) when nothing matches
  return { results: r.results ?? [] };
}

/**
 * Search OpenFDA drug/event endpoint.
 *
 * Builds search term: `patient.drug.openfda.generic_name:<topicTag> AND receivedate:[GTE TO LTE]`
 */
export async function searchDrugEvents(
  opts: DrugEventSearchOpts,
  deps: FDAClientDeps,
): Promise<FDASearchResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const search = `patient.drug.openfda.generic_name:${opts.topicTag}+AND+receivedate:[${opts.receivedate_gte}+TO+${opts.receivedate_lte}]`;
  const apiKey = getEnv(deps, 'OPENFDA_API_KEY');

  const params: Record<string, unknown> = {
    search,
    limit,
    ...(apiKey ? { api_key: apiKey } : {}),
  };

  const queryHash = await hashQuery({ endpoint: 'drug/event', params });
  const cached = await readCachedFetch('openfda', queryHash, deps.supabase);
  if (cached) {
    const c = cached as { results?: unknown[] };
    return { results: c.results ?? [] };
  }

  const urlParams = new URLSearchParams({ search, limit: String(limit) });
  if (apiKey) urlParams.set('api_key', apiKey);
  const url = `${DRUG_EVENT_URL}?${urlParams.toString()}`;

  const response = await fetchWithBackoff(url, {
    headers: { 'User-Agent': USER_AGENT },
  }, deps);

  await writeCachedFetch('openfda', queryHash, response, deps.supabase);
  const r = response as { results?: unknown[] };
  return { results: r.results ?? [] };
}
