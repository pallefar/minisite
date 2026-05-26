/**
 * client.test.ts — Vitest unit tests for PubMed E-utilities client.
 *
 * Phase 60 Plan 60-07. Task 2 (TDD RED → GREEN).
 *
 * 6 tests:
 *  T1: esearchByDateRange calls correct URL with params (+api_key when env set)
 *  T2: assertAllowedHost mock-throw blocks network (SSRF guard)
 *  T3: 429 + Retry-After: 1 → 3 retries with backoff (fake timers)
 *  T4: HTML response → throws RateLimitTruncationError
 *  T5: efetchByPmids batches into single POST with id=pmid1,pmid2
 *  T6: Cache hit short-circuits — no network call when readCachedFetch returns data
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  esearchByDateRange,
  efetchByPmids,
  RateLimitTruncationError,
  PubMedFetchError,
} from '../client.ts';
import { SSRFHostBlockedError } from '../../_shared/federated-host-allowlist.ts';
import type { SupabaseLike } from '../../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────────

// Mock the host allowlist module
vi.mock('../../_shared/federated-host-allowlist.ts', () => ({
  assertAllowedHost: vi.fn(),
  SSRFHostBlockedError: class extends Error {
    constructor(url: string, reason: string) {
      super(`SSRF blocked: ${reason}. URL: ${url}`);
      this.name = 'SSRFHostBlockedError';
    }
  },
  FEDERATED_ALLOWED_HOSTS: ['api.ncbi.nlm.nih.gov', 'api.fda.gov', 'dailymed.nlm.nih.gov'],
}));

// Mock the cache module
vi.mock('../../_shared/federated-cache.ts', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    readCachedFetch: vi.fn().mockResolvedValue(null),
    writeCachedFetch: vi.fn().mockResolvedValue(undefined),
    hashQuery: vi.fn().mockResolvedValue('mock-hash-12345'),
  };
});

import { assertAllowedHost } from '../../_shared/federated-host-allowlist.ts';
import { readCachedFetch, writeCachedFetch } from '../../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Helper factories
// ──────────────────────────────────────────────────────────────────────────────

function makeESearchResponse(pmids: string[] = ['12345', '67890']): Response {
  return new Response(
    JSON.stringify({
      esearchresult: {
        count: String(pmids.length),
        retmax: '100',
        idlist: pmids,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeSupabase(): SupabaseLike {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  };
}

const BASE_OPTS = {
  topicTag: 'GLP-1',
  mindate: '2026/04/26',
  maxdate: '2026/05/26',
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('esearchByDateRange', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('T1: calls correct NCBI URL with db=pubmed params and api_key when set', async () => {
    const capturedCalls: { url: string }[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      capturedCalls.push({ url: String(url) });
      return makeESearchResponse(['11111']);
    });
    const supabase = makeSupabase();

    const result = await esearchByDateRange(BASE_OPTS, {
      fetchImpl: mockFetch,
      supabase,
      env: { PUBMED_API_KEY: 'test-key-123' },
    });

    expect(result.pmids).toEqual(['11111']);
    expect(capturedCalls).toHaveLength(1);
    const url = capturedCalls[0].url;
    expect(url).toContain('api.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
    expect(url).toContain('db=pubmed');
    expect(url).toContain('term=GLP-1');
    expect(url).toContain('mindate=2026%2F04%2F26');
    expect(url).toContain('maxdate=2026%2F05%2F26');
    expect(url).toContain('retmode=json');
    expect(url).toContain('api_key=test-key-123');
  });

  it('T1b: does NOT append api_key when env var is not set', async () => {
    const capturedCalls: { url: string }[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      capturedCalls.push({ url: String(url) });
      return makeESearchResponse([]);
    });
    const supabase = makeSupabase();

    await esearchByDateRange(BASE_OPTS, { fetchImpl: mockFetch, supabase, env: {} });

    expect(capturedCalls[0].url).not.toContain('api_key');
  });

  it('T2: assertAllowedHost throwing blocks network call (SSRF guard)', async () => {
    const mockFetch = vi.fn();
    const supabase = makeSupabase();
    vi.mocked(assertAllowedHost).mockImplementationOnce(() => {
      throw new SSRFHostBlockedError('https://api.ncbi.nlm.nih.gov', 'test block');
    });

    await expect(
      esearchByDateRange(BASE_OPTS, { fetchImpl: mockFetch, supabase, env: {} }),
    ).rejects.toThrow(SSRFHostBlockedError);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T3: 429 with Retry-After triggers exponential backoff, succeeds on retry', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Rate Limited', {
          status: 429,
          headers: { 'Retry-After': '1', 'Content-Type': 'text/plain' },
        });
      }
      return makeESearchResponse(['99999']);
    });
    const supabase = makeSupabase();
    const sleepCalls: number[] = [];

    const promise = esearchByDateRange(BASE_OPTS, {
      fetchImpl: mockFetch,
      supabase,
      env: {},
      sleepImpl: async (ms) => { sleepCalls.push(ms); },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.pmids).toEqual(['99999']);
    expect(callCount).toBe(2);
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]).toBe(1000); // Retry-After: 1 → 1000ms
  });

  it('T4: HTML response throws RateLimitTruncationError (rate-limit page detection)', async () => {
    const mockFetch = vi.fn(async () =>
      new Response('<html><body>Rate limit exceeded</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
    const supabase = makeSupabase();

    await expect(
      esearchByDateRange(BASE_OPTS, { fetchImpl: mockFetch, supabase, env: {} }),
    ).rejects.toThrow(RateLimitTruncationError);
  });
});

describe('efetchByPmids', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('T5: batches PMIDs into single POST to efetch.fcgi with correct params', async () => {
    const capturedRequests: { url: string; method: string; body: string }[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: String(init?.body ?? ''),
      });
      return new Response('<PubmedArticleSet></PubmedArticleSet>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    });
    const supabase = makeSupabase();

    await efetchByPmids(['12345', '67890'], { fetchImpl: mockFetch, supabase, env: {} });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].url).toContain('efetch.fcgi');
    expect(capturedRequests[0].method).toBe('POST');
    expect(capturedRequests[0].body).toContain('id=12345%2C67890');
    expect(capturedRequests[0].body).toContain('db=pubmed');
    expect(capturedRequests[0].body).toContain('rettype=abstract');
  });

  it('T6: cache hit short-circuits — no network call when cache returns data', async () => {
    const mockFetch = vi.fn();
    const supabase = makeSupabase();
    vi.mocked(readCachedFetch).mockResolvedValueOnce([
      { pmid: '99999', title: 'Cached Article', abstract: 'Cached abstract', year: '2026' },
    ]);

    const result = await efetchByPmids(['99999'], { fetchImpl: mockFetch, supabase, env: {} });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });
});
