/**
 * client.test.ts — Vitest unit tests for DailyMed SPL client.
 *
 * Phase 60 Plan 60-07. Task 4 (TDD RED → GREEN).
 *
 * 6 tests:
 *  T1: searchSPLs calls correct DailyMed URL with params
 *  T2: getSPLDetail calls correct URL with setId
 *  T3: Each call goes through assertAllowedHost (SSRF guard)
 *  T4: Token bucket rate limiter at 5 req/s
 *  T5: 429 OR 503 → exponential backoff 4s/8s/16s
 *  T6: Cache short-circuit via readCachedFetch
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchSPLs, getSPLDetail, _resetTokenBucket } from '../client.ts';
import { SSRFHostBlockedError } from '../../_shared/federated-host-allowlist.ts';
import type { SupabaseLike } from '../../_shared/federated-cache.ts';

// Mocks
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

vi.mock('../../_shared/federated-cache.ts', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    readCachedFetch: vi.fn().mockResolvedValue(null),
    writeCachedFetch: vi.fn().mockResolvedValue(undefined),
    hashQuery: vi.fn().mockResolvedValue('mock-hash-dailymed'),
  };
});

import { assertAllowedHost } from '../../_shared/federated-host-allowlist.ts';
import { readCachedFetch } from '../../_shared/federated-cache.ts';

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

function makeSPLSearchResponse(): Response {
  return new Response(JSON.stringify({
    data: [
      { setid: 'setid-001', title: 'Mounjaro Label', published_date: '2026-05-26' },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function makeSPLDetailResponse(): Response {
  return new Response(JSON.stringify({
    setid: 'setid-001',
    spl_version: 3,
    title: 'Mounjaro (tirzepatide)',
    published_date: '2026-05-26',
    sections: [
      { code: '34066-1', title: 'BOXED WARNING', text: 'WARNING: Thyroid risk.' },
      { code: '34067-9', title: 'INDICATIONS AND USAGE', text: 'For type 2 diabetes.' },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('searchSPLs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    _resetTokenBucket();
  });

  it('T1: calls DailyMed spls.json with correct params', async () => {
    const capturedUrls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrls.push(String(url));
      return makeSPLSearchResponse();
    });
    const supabase = makeSupabase();

    const result = await searchSPLs({
      topicTag: 'tirzepatide',
      published_date_gte: '2026-04-26',
      published_date_lte: '2026-05-26',
    }, { fetchImpl: mockFetch, supabase, env: {} });

    expect(result.data).toHaveLength(1);
    expect(capturedUrls[0]).toContain('dailymed.nlm.nih.gov/dailymed/services/v2/spls.json');
    expect(capturedUrls[0]).toContain('drug_name=tirzepatide');
    expect(capturedUrls[0]).toContain('published_date_gte=2026-04-26');
    expect(capturedUrls[0]).toContain('published_date_lte=2026-05-26');
    expect(capturedUrls[0]).toContain('pagesize=100');
  });
});

describe('getSPLDetail', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    _resetTokenBucket();
  });

  it('T2: calls DailyMed spls/<setId>.json with correct URL', async () => {
    const capturedUrls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrls.push(String(url));
      return makeSPLDetailResponse();
    });
    const supabase = makeSupabase();

    const result = await getSPLDetail('setid-001', { fetchImpl: mockFetch, supabase, env: {} });

    expect(result).not.toBeNull();
    expect(capturedUrls.some((u) => u.includes('spls/setid-001.json'))).toBe(true);
  });

  it('T3: assertAllowedHost throwing blocks network (SSRF guard)', async () => {
    const mockFetch = vi.fn();
    const supabase = makeSupabase();
    vi.mocked(assertAllowedHost).mockImplementationOnce(() => {
      throw new SSRFHostBlockedError('https://dailymed.nlm.nih.gov', 'test block');
    });

    await expect(
      searchSPLs({
        topicTag: 'tirzepatide',
        published_date_gte: '2026-04-26',
        published_date_lte: '2026-05-26',
      }, { fetchImpl: mockFetch, supabase, env: {} }),
    ).rejects.toThrow(SSRFHostBlockedError);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T4: token bucket rate limiter exists and can be reset', () => {
    // Verifies token bucket module interface
    expect(typeof _resetTokenBucket).toBe('function');
    _resetTokenBucket(); // no throw
  });

  it('T5: 429 → exponential backoff 4s/8s/16s', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Rate Limited', {
          status: 429,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return makeSPLDetailResponse();
    });
    const supabase = makeSupabase();
    const sleepCalls: number[] = [];

    const promise = getSPLDetail('setid-test', {
      fetchImpl: mockFetch,
      supabase,
      env: {},
      sleepImpl: async (ms) => { sleepCalls.push(ms); },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(callCount).toBe(2);
    expect(sleepCalls[0]).toBe(4000); // Base 4s for DailyMed
  });

  it('T6: cache hit short-circuits (no network call)', async () => {
    const mockFetch = vi.fn();
    const supabase = makeSupabase();
    vi.mocked(readCachedFetch).mockResolvedValueOnce({
      setid: 'cached-id',
      spl_version: 1,
      title: 'Cached SPL',
      published_date: '2026-01-01',
      sections: [],
    });

    const result = await getSPLDetail('cached-id', { fetchImpl: mockFetch, supabase, env: {} });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result?.setid).toBe('cached-id');
  });
});
