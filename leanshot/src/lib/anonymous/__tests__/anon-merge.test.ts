/**
 * Phase 34 Plan 34-05 — vitest integration smoke test for the browser ↔ Edge
 * Fn handshake for `merge-anon-session`.
 *
 * This test does NOT invoke the live Edge Fn — it validates the wire shape
 * that Plan 34-06's `useConsumerOnboardingFlow` will send, by exercising the
 * `callMergeAnonSession` helper with a fetch mock.
 *
 * Contract gates:
 *   - URL ends in `/functions/v1/merge-anon-session`
 *   - method POST, Authorization: Bearer <token>
 *   - body contains `cookie_ids` array + optional `anon_distinct_id`
 *   - 200 response `{ merged: true, draft_entries: [...] }` round-trips
 *     unmodified to the caller
 *   - 200 response `{ merged: false }` round-trips unmodified
 *   - non-200 response throws (Plan 34-06 catches and fails-open)
 */

import { describe, expect, it, vi } from 'vitest';

import { callMergeAnonSession } from '../merge';

function makeFetchSpy(
  status: number,
  body: Record<string, unknown>,
): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  // deno-lint-ignore no-explicit-any
  const fetch = vi.fn(async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as typeof fetch;
  return { fetch, calls };
}

describe('callMergeAnonSession — wire-shape contract', () => {
  it('POSTs to /functions/v1/merge-anon-session with Bearer + JSON body', async () => {
    const { fetch, calls } = makeFetchSpy(200, { merged: true, draft_entries: [] });
    await callMergeAnonSession({
      functionsBaseUrl: 'https://example.supabase.co/functions/v1',
      accessToken: 'token-xyz',
      body: {
        cookie_ids: ['11111111-1111-4111-8111-111111111111'],
        anon_distinct_id: 'ph-distinct-abc',
      },
      fetchImpl: fetch,
    });
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://example.supabase.co/functions/v1/merge-anon-session');
    expect(call.init?.method).toBe('POST');
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token-xyz');
    expect(headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(String(call.init?.body ?? '{}')) as {
      cookie_ids: string[];
      anon_distinct_id?: string;
    };
    expect(parsed.cookie_ids).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(parsed.anon_distinct_id).toBe('ph-distinct-abc');
  });

  it('round-trips a `{ merged: true, draft_entries: [...] }` response unmodified', async () => {
    const draftEntries = [
      { kind: 'weight', data: { kg: 80 }, created_at: '2026-05-19' },
      { kind: 'dose', data: { mg: 0.25 }, created_at: '2026-05-19' },
    ];
    const { fetch } = makeFetchSpy(200, { merged: true, draft_entries: draftEntries });
    const res = await callMergeAnonSession({
      functionsBaseUrl: 'https://example.supabase.co/functions/v1',
      accessToken: 'token-xyz',
      body: { cookie_ids: ['11111111-1111-4111-8111-111111111111'] },
      fetchImpl: fetch,
    });
    expect(res.merged).toBe(true);
    if (res.merged) {
      expect(res.draft_entries).toEqual(draftEntries);
    }
  });

  it('round-trips a `{ merged: false }` response unmodified', async () => {
    const { fetch } = makeFetchSpy(200, { merged: false });
    const res = await callMergeAnonSession({
      functionsBaseUrl: 'https://example.supabase.co/functions/v1',
      accessToken: 'token-xyz',
      body: { cookie_ids: ['11111111-1111-4111-8111-111111111111'] },
      fetchImpl: fetch,
    });
    expect(res.merged).toBe(false);
  });

  it('omits anon_distinct_id from the body when not supplied', async () => {
    const { fetch, calls } = makeFetchSpy(200, { merged: false });
    await callMergeAnonSession({
      functionsBaseUrl: 'https://example.supabase.co/functions/v1',
      accessToken: 'token-xyz',
      body: { cookie_ids: ['11111111-1111-4111-8111-111111111111'] },
      fetchImpl: fetch,
    });
    const parsed = JSON.parse(String(calls[0]?.init?.body ?? '{}')) as Record<string, unknown>;
    expect(parsed.cookie_ids).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect('anon_distinct_id' in parsed).toBe(false);
  });

  it('throws on non-200 response (Plan 34-06 hook catches + fails-open)', async () => {
    const { fetch } = makeFetchSpy(500, { error: 'rpc_error' });
    await expect(
      callMergeAnonSession({
        functionsBaseUrl: 'https://example.supabase.co/functions/v1',
        accessToken: 'token-xyz',
        body: { cookie_ids: ['11111111-1111-4111-8111-111111111111'] },
        fetchImpl: fetch,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('strips a trailing slash from functionsBaseUrl', async () => {
    const { fetch, calls } = makeFetchSpy(200, { merged: false });
    await callMergeAnonSession({
      functionsBaseUrl: 'https://example.supabase.co/functions/v1/',
      accessToken: 'token-xyz',
      body: { cookie_ids: ['11111111-1111-4111-8111-111111111111'] },
      fetchImpl: fetch,
    });
    expect(calls[0]?.url).toBe('https://example.supabase.co/functions/v1/merge-anon-session');
  });
});
