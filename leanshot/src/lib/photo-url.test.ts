/**
 * Phase 16 Plan 16-01 Task 4 — storageTransformUrl unit tests.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { storageTransformUrl } from './photo-url';

beforeAll(() => {
  // photo-url.ts reads VITE_SUPABASE_URL at module-load time; ensure tests
  // run against a deterministic project URL.
  // vitest jsdom env exposes import.meta.env via Vite's transform; the
  // helper falls back to '' when unset which is also fine — we test path
  // construction independently of the host prefix.
});

describe('storageTransformUrl', () => {
  it('applies default opts when none provided (width=200, height=200, resize=cover, quality=75)', () => {
    const url = storageTransformUrl('user-123/photos/abc.jpg');
    expect(url).toContain('/storage/v1/render/image/public/photos/user-123/photos/abc.jpg');
    expect(url).toContain('width=200');
    expect(url).toContain('height=200');
    expect(url).toContain('resize=cover');
    expect(url).toContain('quality=75');
  });

  it('overrides all opts when provided', () => {
    const url = storageTransformUrl('user-123/photos/abc.jpg', {
      width: 400,
      height: 400,
      resize: 'contain',
      quality: 90,
    });
    expect(url).toContain('width=400');
    expect(url).toContain('height=400');
    expect(url).toContain('resize=contain');
    expect(url).toContain('quality=90');
  });

  it('URL-encodes special chars in path segments', () => {
    const url = storageTransformUrl('user with space/photos/file:name.jpg');
    // Each segment is encoded independently; `/` separators preserved.
    expect(url).toContain('user%20with%20space/photos/file%3Aname.jpg');
    // The encoded path must NOT contain raw spaces or colons. We test the
    // PATH portion only — peel off scheme+host (when present) or leading `/`
    // (when VITE_SUPABASE_URL is unset and url is relative). Both shapes
    // happen: local has VITE_SUPABASE_URL set, CI build sometimes doesn't.
    const pathPortion = url.split('?')[0]!.replace(/^https?:\/\/[^/]+/, '');
    // Now pathPortion is /storage/v1/render/.../<encoded-path>; assert no raw
    // spaces or colons.
    expect(pathPortion).not.toMatch(/[ :]/);
  });

  it('throws when path is empty', () => {
    expect(() => storageTransformUrl('')).toThrow(/path must be a non-empty string/);
    expect(() => storageTransformUrl('   ')).toThrow(/path must be a non-empty string/);
  });

  it('clamps very-large width/height to 800 (WKWebView OOM budget)', () => {
    const url = storageTransformUrl('user-123/photos/abc.jpg', {
      width: 5000,
      height: 9000,
    });
    expect(url).toContain('width=800');
    expect(url).toContain('height=800');
    expect(url).not.toContain('width=5000');
    expect(url).not.toContain('height=9000');
  });
});
