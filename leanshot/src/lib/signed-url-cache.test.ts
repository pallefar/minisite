/**
 * Phase 6 06-04 — signed-url-cache.ts unit tests.
 *
 * Mocks @/lib/supabase's storage.from().createSignedUrl and globalThis.fetch
 * so the tests assert call-shape (caching, pre-emptive refresh, 401 retry)
 * rather than network behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrl = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: (...args: unknown[]) => createSignedUrl(...args),
      })),
    },
  },
}));

async function importFresh() {
  vi.resetModules();
  return await import('./signed-url-cache');
}

beforeEach(() => {
  createSignedUrl.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('signed-url-cache', () => {
  it('getSignedPhotoUrl caches first call; second call within TTL returns cached URL', async () => {
    const mod = await importFresh();
    createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://mock/u1/photos/a.jpg?token=1' },
      error: null,
    });

    const u1 = await mod.getSignedPhotoUrl('u1/photos/a.jpg');
    const u2 = await mod.getSignedPhotoUrl('u1/photos/a.jpg');

    expect(u1).toBe('https://mock/u1/photos/a.jpg?token=1');
    expect(u2).toBe(u1);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('pre-emptive refresh: when cached.expiresAt - now < 30s, a fresh createSignedUrl fires', async () => {
    const mod = await importFresh();
    createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://mock/u1/photos/a.jpg?token=first' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://mock/u1/photos/a.jpg?token=refresh' },
        error: null,
      });

    // First call populates the cache with expiresAt = now + 300_000ms
    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockReturnValue(1_000_000);
    const u1 = await mod.getSignedPhotoUrl('u1/photos/a.jpg');
    expect(u1).toContain('token=first');

    // Jump forward so the cached entry is < 30s away from expiry
    dateSpy.mockReturnValue(1_000_000 + 290_000); // 10s remaining < 30s window
    const u2 = await mod.getSignedPhotoUrl('u1/photos/a.jpg');
    expect(u2).toContain('token=refresh');
    expect(createSignedUrl).toHaveBeenCalledTimes(2);

    dateSpy.mockRestore();
  });

  it('fetchPhotoWithRefresh: 401 on first fetch triggers cache invalidation + retry', async () => {
    const mod = await importFresh();
    createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://mock/photo?token=stale' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://mock/photo?token=fresh' },
        error: null,
      });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('OK', { status: 200 }));

    const res = await mod.fetchPhotoWithRefresh('u1/photos/x.jpg');

    expect(res.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]![0]).toContain('token=stale');
    expect(fetchSpy.mock.calls[1]![0]).toContain('token=fresh');

    fetchSpy.mockRestore();
  });

  it('clearSignedUrlCache empties the Map', async () => {
    const mod = await importFresh();
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://mock/x?token=1' },
      error: null,
    });

    await mod.getSignedPhotoUrl('a/photos/x.jpg');
    expect(mod._peekCacheForTests().size).toBe(1);

    mod.clearSignedUrlCache();
    expect(mod._peekCacheForTests().size).toBe(0);
  });

  it('coalesces concurrent calls for the same path into a single createSignedUrl invocation', async () => {
    const mod = await importFresh();
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://mock/coalesce?token=1' },
      error: null,
    });

    const [a, b, c] = await Promise.all([
      mod.getSignedPhotoUrl('u1/photos/z.jpg'),
      mod.getSignedPhotoUrl('u1/photos/z.jpg'),
      mod.getSignedPhotoUrl('u1/photos/z.jpg'),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('propagates error when createSignedUrl returns null signedUrl', async () => {
    const mod = await importFresh();
    createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'not found' },
    });

    await expect(mod.getSignedPhotoUrl('missing.jpg')).rejects.toBeDefined();
  });
});
