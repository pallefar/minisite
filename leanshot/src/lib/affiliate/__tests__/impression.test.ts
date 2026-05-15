/**
 * Phase 19 Plan 19-08 — affiliate-impression client wrapper tests (BL-8 / D-38).
 *
 * 4 vitest assertions:
 *   T1: shouldRecordImpression() returns false when navigator.doNotTrack === '1'
 *   T2: shouldRecordImpression() returns true when DNT is unset
 *   T3: recordImpression() calls fetch with the correct POST body shape
 *   T4: recordImpression() does NOT call fetch when DNT is set (privacy gate)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordImpression,
  shouldRecordImpression,
} from '@/lib/affiliate/impression';

// jsdom does not expose `navigator.doNotTrack` as writable by default;
// we redefine the property per-test so the DNT gate is testable.
function setDnt(value: string | null): void {
  Object.defineProperty(globalThis.navigator, 'doNotTrack', {
    configurable: true,
    get: () => value,
  });
}

describe('shouldRecordImpression — DNT gate', () => {
  afterEach(() => {
    setDnt(null);
  });

  it('T1: returns false when navigator.doNotTrack === "1"', () => {
    setDnt('1');
    expect(shouldRecordImpression()).toBe(false);
  });

  it('T2: returns true when DNT is unset (null)', () => {
    setDnt(null);
    expect(shouldRecordImpression()).toBe(true);
  });

  it('returns true when DNT === "0" (explicit opt-in)', () => {
    setDnt('0');
    expect(shouldRecordImpression()).toBe(true);
  });
});

describe('recordImpression — fire-and-forget ping', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setDnt(null);
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    setDnt(null);
  });

  it('T3: calls fetch with affiliate_id + 64-hex ua_hash + referer body', async () => {
    await recordImpression('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(typeof url).toBe('string');
    expect(String(url)).toMatch(/\/functions\/v1\/affiliate-impression$/);
    expect(init!.method).toBe('POST');
    const body = JSON.parse(init!.body as string) as {
      affiliate_id: string;
      ua_hash: string;
      referer: string;
    };
    expect(body.affiliate_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(body.ua_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof body.referer).toBe('string');
  });

  it('T4: does NOT call fetch when DNT is set', async () => {
    setDnt('1');
    await recordImpression('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('silently swallows fetch rejection (non-blocking)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    // MUST resolve without throwing — landing render is non-blocking.
    await expect(
      recordImpression('cccccccc-cccc-cccc-cccc-cccccccccccc'),
    ).resolves.toBeUndefined();
  });

  it('does NOT call fetch when affiliateId is empty', async () => {
    await recordImpression('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
