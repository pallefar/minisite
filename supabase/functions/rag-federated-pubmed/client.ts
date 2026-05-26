/**
 * client.ts — PubMed E-utilities REST client for rag-federated-pubmed.
 *
 * Phase 60 Plan 60-07. Task 2.
 *
 * Exports:
 *   esearchByDateRange(opts) — search PMIDs by topic + date range
 *   efetchByPmids(pmids)     — batch-fetch article details by PMIDs
 *
 * Security: assertAllowedHost called before every network request (T-60-07-01 SSRF).
 * Rate limit: 3 req/s without API key, 10 req/s with key (exponential backoff on 429).
 * Cache: readCachedFetch / writeCachedFetch via federated-cache.ts (24h TTL).
 *
 * Dependency injection: all external deps injectable via PubMedClientDeps for testing.
 * No Deno-specific imports in this module — testable under Node/Vitest.
 *
 * [[T-60-07-01]] [[T-60-07-02]] [[T-60-07-05]]
 */

import { assertAllowedHost, SSRFHostBlockedError } from '../_shared/federated-host-allowlist.ts';
import { hashQuery, readCachedFetch, writeCachedFetch } from '../_shared/federated-cache.ts';
import type { SupabaseLike } from '../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const EUTILS_BASE = 'https://api.ncbi.nlm.nih.gov/entrez/eutils';
const ESEARCH_URL = `${EUTILS_BASE}/esearch.fcgi`;
const EFETCH_URL = `${EUTILS_BASE}/efetch.fcgi`;
const USER_AGENT = 'leanshot-rag-federated/1.0 (karsten.haldan@gmail.com)';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = [1000, 2000, 4000] as const;
const DEFAULT_RETMAX = 100;

// ──────────────────────────────────────────────────────────────────────────────
// Error classes
// ──────────────────────────────────────────────────────────────────────────────

export class RateLimitTruncationError extends Error {
  constructor(message: string) {
    super(`[rag-federated-pubmed] Rate-limit truncation detected: ${message}`);
    this.name = 'RateLimitTruncationError';
  }
}

export class PubMedFetchError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastStatus: number,
  ) {
    super(`[rag-federated-pubmed] Fetch failed after ${attempts} attempts. Last status: ${lastStatus}`);
    this.name = 'PubMedFetchError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dependency injection interface
// ──────────────────────────────────────────────────────────────────────────────

export interface PubMedClientDeps {
  fetchImpl?: typeof fetch;
  supabase: SupabaseLike;
  env?: Record<string, string | undefined>;
  sleepImpl?: (ms: number) => Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

function getEnv(deps: PubMedClientDeps, key: string): string | undefined {
  if (deps.env) return deps.env[key];
  try {
    // deno-lint-ignore no-explicit-any
    return (globalThis as any).Deno?.env?.get(key) as string | undefined;
  } catch {
    return undefined;
  }
}

async function sleep(ms: number, deps: PubMedClientDeps): Promise<void> {
  if (deps.sleepImpl) return deps.sleepImpl(ms);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with retry on 429.
 * Validates response is JSON (not HTML rate-limit page) per AI-SPEC §3 Pitfall #8.
 */
async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  deps: PubMedClientDeps,
): Promise<unknown> {
  // SSRF: assertAllowedHost before every fetch (T-60-07-01)
  assertAllowedHost(url);

  const fetchImpl = deps.fetchImpl ?? fetch;
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetchImpl(url, init);
    lastStatus = res.status;

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : BASE_BACKOFF_MS[attempt] ?? 4000;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(retryAfterMs, deps);
        continue;
      }
      throw new PubMedFetchError(attempt + 1, res.status);
    }

    if (!res.ok) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_BACKOFF_MS[attempt] ?? 4000, deps);
        continue;
      }
      throw new PubMedFetchError(attempt + 1, res.status);
    }

    // Validate content-type — reject HTML rate-limit pages (AI-SPEC §3 Pitfall #8)
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new RateLimitTruncationError(
        `Expected JSON response but received HTML (content-type: ${contentType}). Possible rate-limit interception.`,
      );
    }

    return res.json();
  }

  throw new PubMedFetchError(MAX_RETRIES, lastStatus);
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface ESearchResult {
  pmids: string[];
}

export interface ESearchOpts {
  topicTag: string;
  mindate: string;
  maxdate: string;
  retmax?: number;
}

/**
 * Search PubMed for PMIDs matching a topic tag in a date range.
 *
 * Uses E-utilities esearch with retmode=json.
 * Appends &api_key when PUBMED_API_KEY env var is set (relaxes 3→10 req/s).
 * Results cached for 24h via federated_source_cache.
 */
export async function esearchByDateRange(
  opts: ESearchOpts,
  deps: PubMedClientDeps,
): Promise<ESearchResult> {
  const retmax = opts.retmax ?? DEFAULT_RETMAX;
  const apiKey = getEnv(deps, 'PUBMED_API_KEY');

  const params: Record<string, unknown> = {
    db: 'pubmed',
    term: opts.topicTag,
    mindate: opts.mindate,
    maxdate: opts.maxdate,
    datetype: 'pdat',
    retmax: retmax,
    retmode: 'json',
  };

  const queryHash = await hashQuery({ endpoint: 'esearch', params });
  const cached = await readCachedFetch('pubmed', queryHash, deps.supabase);
  if (cached) {
    const c = cached as { esearchresult?: { idlist?: string[] } };
    return { pmids: c.esearchresult?.idlist ?? [] };
  }

  // Build URL with optional API key
  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) urlParams.set(k, String(v));
  if (apiKey) urlParams.set('api_key', apiKey);
  const url = `${ESEARCH_URL}?${urlParams.toString()}`;

  const response = await fetchWithBackoff(url, {
    headers: { 'User-Agent': USER_AGENT },
  }, deps);

  await writeCachedFetch('pubmed', queryHash, response, deps.supabase);

  const r = response as { esearchresult?: { idlist?: string[] } };
  return { pmids: r.esearchresult?.idlist ?? [] };
}

export interface EFetchOpts {
  pmids: string[];
}

/**
 * Fetch full article records for a list of PMIDs.
 *
 * Batches into a single POST with id=pmid1,pmid2,...
 * Returns raw parsed JSON (zod validation happens in normalize.ts).
 */
export async function efetchByPmids(
  pmids: string[],
  deps: PubMedClientDeps,
): Promise<unknown[]> {
  if (pmids.length === 0) return [];

  const params: Record<string, unknown> = {
    db: 'pubmed',
    id: pmids.join(','),
    rettype: 'abstract',
    retmode: 'xml',
  };
  const apiKey = getEnv(deps, 'PUBMED_API_KEY');

  const queryHash = await hashQuery({ endpoint: 'efetch', params });
  const cached = await readCachedFetch('pubmed', queryHash, deps.supabase);
  if (cached) {
    return (cached as unknown[]);
  }

  // Build POST body (E-utilities recommends POST for large id lists)
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  if (apiKey) body.set('api_key', apiKey);

  // assertAllowedHost is called inside fetchWithBackoff
  const fetchImpl = deps.fetchImpl ?? fetch;
  assertAllowedHost(EFETCH_URL);

  const res = await fetchImpl(EFETCH_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new PubMedFetchError(1, res.status);
  }

  // efetch returns XML — parse as text and return as an array of "raw XML string" items
  // The normalize step (normalize.ts) handles XML → structured object conversion
  const xmlText = await res.text();
  const result = [xmlText]; // wrapped in array for uniform interface

  await writeCachedFetch('pubmed', queryHash, result, deps.supabase);
  return result;
}
