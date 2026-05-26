/**
 * federated-cache.test.ts — Vitest unit tests for 24h cache helper.
 *
 * Phase 60 Plan 60-07. Task 1 (TDD RED → GREEN).
 *
 * 6 test cases per plan spec:
 *  T1: hashQuery is deterministic — same input → same sha256 hex
 *  T2: readCachedFetch returns null when no row exists
 *  T3: readCachedFetch returns payload when row exists and expires_at > now()
 *  T4: readCachedFetch returns null when row exists but expires_at <= now() (expired)
 *  T5: writeCachedFetch upserts via ON CONFLICT (source_name, cache_key) DO UPDATE
 *  T6: writeCachedFetch does NOT mutate response after insert (deep-copy semantics)
 */

import { describe, expect, it, vi } from 'vitest';
import { hashQuery, readCachedFetch, writeCachedFetch } from '../federated-cache.ts';
import type { SupabaseLike } from '../federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Mock Supabase client factory
// ──────────────────────────────────────────────────────────────────────────────

function makeMockSupabase(opts: {
  selectData?: unknown;
  selectError?: { message: string } | null;
  upsertError?: { message: string } | null;
}): SupabaseLike & { _mockUpsert: ReturnType<typeof vi.fn> } {
  const mockUpsert = vi.fn().mockResolvedValue({
    data: null,
    error: opts.upsertError ?? null,
  });

  const mockSupabase: SupabaseLike & { _mockUpsert: ReturnType<typeof vi.fn> } = {
    _mockUpsert: mockUpsert,
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col1: string, _val1: unknown) {
              return {
                eq(_col2: string, _val2: unknown) {
                  return {
                    gt(_col3: string, _val3: unknown) {
                      return {
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: opts.selectData ?? null,
                          error: opts.selectError ?? null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
        upsert: mockUpsert,
      };
    },
  };
  return mockSupabase;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('hashQuery', () => {
  it('T1: is deterministic — same input produces same sha256 hex', async () => {
    const input = { endpoint: 'esearch', params: { db: 'pubmed', term: 'GLP-1', retmax: 100 } };
    const hash1 = await hashQuery(input);
    const hash2 = await hashQuery(input);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // 256-bit = 64 hex chars
  });

  it('param order does not affect hash (sorted canonicalization)', async () => {
    const h1 = await hashQuery({ endpoint: 'test', params: { b: 2, a: 1 } });
    const h2 = await hashQuery({ endpoint: 'test', params: { a: 1, b: 2 } });
    expect(h1).toBe(h2);
  });
});

describe('readCachedFetch', () => {
  it('T2: returns null when no row exists (maybeSingle returns null)', async () => {
    const supabase = makeMockSupabase({ selectData: null });
    const result = await readCachedFetch('pubmed', 'some-hash', supabase);
    expect(result).toBeNull();
  });

  it('T3: returns payload when row exists and expires_at > now()', async () => {
    const futureExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    const cachedPayload = { pmids: ['12345', '67890'] };
    const supabase = makeMockSupabase({
      selectData: { payload: cachedPayload, expires_at: futureExpiry },
    });

    const result = await readCachedFetch('pubmed', 'hash-123', supabase);
    expect(result).toEqual(cachedPayload);
  });

  it('T4: returns null when row is expired (gt filter returns null)', async () => {
    // The query applies .gt('expires_at', now) — if no row passes the filter, maybeSingle returns null
    const supabase = makeMockSupabase({ selectData: null }); // expired row not returned by query
    const result = await readCachedFetch('pubmed', 'expired-hash', supabase);
    expect(result).toBeNull();
  });
});

describe('writeCachedFetch', () => {
  it('T5: upserts with ON CONFLICT (source_name, cache_key) DO UPDATE semantics', async () => {
    const supabase = makeMockSupabase({ upsertError: null });
    await writeCachedFetch('pubmed', 'hash-abc', { data: 'test' }, supabase);

    expect(supabase._mockUpsert).toHaveBeenCalledOnce();
    const [row, opts] = supabase._mockUpsert.mock.calls[0];
    expect(row).toMatchObject({
      source_name: 'pubmed',
      cache_key: 'hash-abc',
      payload: { data: 'test' },
    });
    expect(row.expires_at).toBeDefined();
    expect(opts).toMatchObject({ onConflict: 'source_name,cache_key' });
  });

  it('T6: does NOT mutate response object after write (deep-copy semantics)', async () => {
    const supabase = makeMockSupabase({ upsertError: null });
    const original = { data: 'original', nested: { value: 42 } };

    await writeCachedFetch('pubmed', 'hash-xyz', original, supabase);

    // Mutate the original after the write
    original.data = 'mutated';
    original.nested.value = 99;

    // The stored payload should reflect the ORIGINAL values, not the mutations
    const [storedRow] = supabase._mockUpsert.mock.calls[0];
    expect(storedRow.payload).toEqual({ data: 'original', nested: { value: 42 } });
  });
});
