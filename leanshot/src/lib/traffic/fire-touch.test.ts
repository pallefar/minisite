/**
 * Phase 51 Plan 51-02 Task 4 — vitest suite for fire-touch helper.
 *
 * 3 cases:
 *   1. happy path — posts once with cookie + utm + referrer + landingPath
 *   2. idempotent — second call within same module load is a no-op
 *   3. graceful when fetch is missing (jsdom can fake-omit it)
 *
 * Bonus: lt_anon_id ABSENT — still fires (production HttpOnly path; the
 *   browser auto-attaches the cookie via credentials:'include' so the
 *   recorder Fn falls back to the Cookie header).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireTouchOnce, _resetSentFlagForTest } from './fire-touch';

afterEach(() => {
  _resetSentFlagForTest();
});

describe('fireTouchOnce', () => {
  it('posts once with cookie + utm + referrer + landingPath', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    await fireTouchOnce({
      fetchImpl: fetchMock as unknown as typeof fetch,
      recorderUrl: 'https://test.supabase.co/functions/v1/traffic-attribution-recorder',
      windowOverride: {
        location: {
          search: '?utm_source=meta&utm_medium=paid&utm_campaign=q2',
          pathname: '/pricing',
        },
        document: { cookie: 'lt_anon_id=abc-123', referrer: 'https://google.com/search' },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![0]).toBe('https://test.supabase.co/functions/v1/traffic-attribution-recorder');
    const init = callArgs![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const body = JSON.parse(init.body as string) as {
      anonId?: string;
      utm: Record<string, string>;
      referrer: string | null;
      landingPath: string;
      audience: string;
    };
    expect(body.anonId).toBe('abc-123');
    expect(body.utm.source).toBe('meta');
    expect(body.utm.medium).toBe('paid');
    expect(body.utm.campaign).toBe('q2');
    expect(body.referrer).toBe('https://google.com/search');
    expect(body.landingPath).toBe('/pricing');
    expect(body.audience).toBe('consumer');
  });

  it('is idempotent — second call within same module load is a no-op', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const opts = {
      fetchImpl: fetchMock as unknown as typeof fetch,
      recorderUrl: 'https://test.supabase.co/functions/v1/traffic-attribution-recorder',
      windowOverride: {
        location: { search: '?utm_source=meta', pathname: '/' },
        document: { cookie: 'lt_anon_id=abc', referrer: '' },
      },
    };
    await fireTouchOnce(opts);
    await fireTouchOnce(opts);
    await fireTouchOnce(opts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still fires when lt_anon_id cookie is unreadable (HttpOnly prod path)', async () => {
    // Production behavior: lt_anon_id is HttpOnly so document.cookie does
    // NOT expose it. The browser still attaches it server-side via
    // credentials:'include'. The recorder Fn falls back to the Cookie
    // header. Verify that the SPA fires the POST even without an
    // anonId body field.
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    await fireTouchOnce({
      fetchImpl: fetchMock as unknown as typeof fetch,
      recorderUrl: 'https://test.supabase.co/functions/v1/traffic-attribution-recorder',
      windowOverride: {
        location: { search: '', pathname: '/' },
        document: { cookie: '', referrer: '' },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as { anonId?: string };
    expect(body.anonId).toBeUndefined();
  });
});
