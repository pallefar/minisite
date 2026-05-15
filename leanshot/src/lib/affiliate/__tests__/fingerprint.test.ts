/**
 * Phase 19 Plan 19-07 — vitest unit tests for the ThumbmarkJS lazy wrapper.
 *
 * 4 behaviors per the plan's Task 2 File 4:
 *   T1: getFingerprint() returns a string when ThumbmarkJS resolves.
 *   T2: getFingerprint() returns null when ThumbmarkJS throws.
 *   T3: cached result returned on second call (mock called only once).
 *   T4: getFingerprintForSubmit shares the same cache + module path
 *       (single dynamic-import evaluation), proving the dual-shape return
 *       handling works for the object form `{ thumbmark: string }`.
 *
 * Mock strategy:
 *   - `vi.mock('@thumbmarkjs/thumbmarkjs', ...)` replaces the module with
 *     a Thumbmark class whose .get() returns a controllable mock. Vitest
 *     hoists the mock factory above the dynamic import inside fingerprint.ts.
 *   - `_resetFingerprintCacheForTest` clears the module-scope cache between
 *     tests so each scenario starts cold.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock state — top-level so the vi.mock factory below closes over the same
// reference per test (vi.mock hoists; module re-eval per test resets `cached`
// via _resetFingerprintCacheForTest, but the mock module itself is created
// once).
const mockGet = vi.fn();

vi.mock('@thumbmarkjs/thumbmarkjs', () => ({
  Thumbmark: class {
    get(): Promise<unknown> {
      return mockGet();
    }
  },
}));

describe('@/lib/affiliate/fingerprint', () => {
  beforeEach(async () => {
    mockGet.mockReset();
    const mod = await import('@/lib/affiliate/fingerprint');
    mod._resetFingerprintCacheForTest();
  });

  it('T1: returns a string when ThumbmarkJS resolves with { thumbmark } object', async () => {
    mockGet.mockResolvedValueOnce({ thumbmark: 'fp-hash-abc123', components: {}, info: {}, version: '1.9.0' });
    const { getFingerprint } = await import('@/lib/affiliate/fingerprint');
    const fp = await getFingerprint();
    expect(fp).toBe('fp-hash-abc123');
  });

  it('T2: returns null when ThumbmarkJS throws (canvas blocked / API failure)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValueOnce(new Error('canvas blocked'));
    const { getFingerprint } = await import('@/lib/affiliate/fingerprint');
    const fp = await getFingerprint();
    expect(fp).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('thumbmark capture failed');
    warnSpy.mockRestore();
  });

  it('T3: cached result returned on second call (mock invoked exactly once)', async () => {
    mockGet.mockResolvedValueOnce({ thumbmark: 'fp-cached-zzz', components: {}, info: {}, version: '1.9.0' });
    const { getFingerprint } = await import('@/lib/affiliate/fingerprint');
    const fp1 = await getFingerprint();
    const fp2 = await getFingerprint();
    expect(fp1).toBe('fp-cached-zzz');
    expect(fp2).toBe('fp-cached-zzz');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('T4: getFingerprintForSubmit shares the same cache AND handles legacy string return', async () => {
    // Legacy string-shape return (W-2 hedge): the wrapper must accept this
    // even though 1.9.0 always returns the object form.
    mockGet.mockResolvedValueOnce('legacy-string-shape-fp');
    const { getFingerprint, getFingerprintForSubmit } = await import('@/lib/affiliate/fingerprint');
    const a = await getFingerprint();
    const b = await getFingerprintForSubmit();
    expect(a).toBe('legacy-string-shape-fp');
    expect(b).toBe('legacy-string-shape-fp');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
