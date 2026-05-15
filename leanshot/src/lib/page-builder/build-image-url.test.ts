/**
 * Phase 15 Plan 09 — buildImageUrl tier-conditional helper tests (TDD RED).
 *
 * Asserts the RESEARCH Pitfall 3 contract: Supabase Storage image
 * transforms are Pro-tier-only — on the free tier they 400. buildImageUrl()
 * therefore reads `import.meta.env.VITE_SUPABASE_STORAGE_TRANSFORMS_ENABLED`
 * (or an explicit `transformsEnabled` override for testability) and routes
 * to either the transform URL (`render/image/...`) or the raw bucket URL
 * (`object/public/...`).
 *
 * The `transformsEnabled` arg is the injectable seam — these tests pass it
 * explicitly so we can exercise both branches without mutating
 * import.meta.env at runtime.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildImageUrl } from './build-image-url';

beforeAll(() => {
  // Stub VITE_SUPABASE_URL so the module under test can build absolute URLs.
  // (Set once globally; individual tests override transformsEnabled per call.)
  // Safe to stub AFTER the import because buildImageUrl reads import.meta.env
  // lazily inside each call (not at module load time).
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
});

describe('buildImageUrl — tier-conditional Supabase Storage URL builder', () => {
  it('returns a transform URL when transformsEnabled=true AND a size is supplied', () => {
    const url = buildImageUrl('photo.jpg', { width: 1200, transformsEnabled: true });
    expect(url).toContain('render/image');
    expect(url).toContain('width=1200');
    // Must NOT also match the raw `object/public` segment (that's the
    // other branch — the URL is either-or).
    expect(url).not.toContain('/object/public/');
  });

  it('returns the raw bucket URL when transformsEnabled=false even with a size opt', () => {
    const url = buildImageUrl('photo.jpg', { width: 1200, transformsEnabled: false });
    expect(url).toContain('/object/public/page-assets/');
    expect(url).not.toContain('render/image');
    expect(url).not.toContain('width=');
  });

  it('returns the raw bucket URL on either tier when no opts are supplied', () => {
    const onPro = buildImageUrl('photo.jpg');
    const onProExplicit = buildImageUrl('photo.jpg', { transformsEnabled: true });
    const onFree = buildImageUrl('photo.jpg', { transformsEnabled: false });
    // No transform requested → no transform applied, regardless of tier.
    for (const url of [onPro, onProExplicit, onFree]) {
      expect(url).toContain('/object/public/page-assets/');
      expect(url).not.toContain('render/image');
      expect(url).not.toContain('width=');
      expect(url).not.toContain('height=');
    }
  });

  it('passes height + resize through when both transformsEnabled AND a size are present', () => {
    const url = buildImageUrl('photo.jpg', {
      width: 800,
      height: 600,
      resize: 'cover',
      transformsEnabled: true,
    });
    expect(url).toContain('render/image');
    expect(url).toContain('width=800');
    expect(url).toContain('height=600');
    expect(url).toContain('resize=cover');
  });

  it('builds URLs against the configured VITE_SUPABASE_URL origin', () => {
    const url = buildImageUrl('photo.jpg', { transformsEnabled: false });
    expect(url.startsWith('https://test.supabase.co/storage/v1/')).toBe(true);
  });

  it('reads the default transformsEnabled from import.meta.env when not passed', () => {
    // Default behavior on the free tier (env var unset) is to disable
    // transforms. Stub a non-"true" value and assert no transform.
    vi.stubEnv('VITE_SUPABASE_STORAGE_TRANSFORMS_ENABLED', '');
    const url = buildImageUrl('photo.jpg', { width: 1200 });
    expect(url).toContain('/object/public/');
    expect(url).not.toContain('render/image');
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
  });
});
