/**
 * Unit tests for community tier-gate + community-storage (44-03 Task 2 — RED phase).
 *
 * Covers:
 *   - isVideoAllowed: trial gets Pro features (Claude's Discretion per Phase 44 context)
 *   - canAccessSpace: tier hierarchy
 *   - uploadCommunityMedia: client-side validation (size cap, MIME allowlist, path format)
 *   - assertImageCap: 10-image cap gate (COMMUNITY-04 client-side)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isVideoAllowed, canAccessSpace } from '@/lib/community/tier-gate';
import {
  uploadCommunityMedia,
  assertImageCap,
} from '@/lib/community/community-storage';

// ─── Tier gate ─────────────────────────────────────────────────────────────────

describe('isVideoAllowed', () => {
  it('returns false for free tier', () => {
    expect(isVideoAllowed('free')).toBe(false);
  });

  it('returns true for pro tier', () => {
    expect(isVideoAllowed('pro')).toBe(true);
  });

  it('returns true for lifetime tier', () => {
    expect(isVideoAllowed('lifetime')).toBe(true);
  });

  it('returns true for trial tier (Claude\'s Discretion — trial = Pro features)', () => {
    expect(isVideoAllowed('trial')).toBe(true);
  });
});

describe('canAccessSpace', () => {
  it('free space is accessible by free users', () => {
    expect(canAccessSpace('free', 'free')).toBe(true);
  });

  it('pro space is NOT accessible by free users', () => {
    expect(canAccessSpace('pro', 'free')).toBe(false);
  });

  it('pro space is accessible by pro users', () => {
    expect(canAccessSpace('pro', 'pro')).toBe(true);
  });

  it('pro space is accessible by trial users (trial = Pro features)', () => {
    expect(canAccessSpace('pro', 'trial')).toBe(true);
  });

  it('lifetime space is NOT accessible by pro users', () => {
    expect(canAccessSpace('lifetime', 'pro')).toBe(false);
  });

  it('lifetime space is accessible by lifetime users', () => {
    expect(canAccessSpace('lifetime', 'lifetime')).toBe(true);
  });
});

// ─── community-storage ─────────────────────────────────────────────────────────

// Mock @/lib/supabase to avoid hitting the network
vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://signed.url/test' },
          error: null,
        }),
      })),
    },
  },
}));

describe('uploadCommunityMedia', () => {
  const MB = 1024 * 1024;

  it('rejects file_too_large when file size exceeds 10 MB', async () => {
    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 11 * MB });
    const result = await uploadCommunityMedia(file, 'user-1', 'post-1');
    expect(result).toEqual({ ok: false, error: 'file_too_large' });
  });

  it('rejects invalid_mime for image/svg+xml', async () => {
    const file = new File(['<svg/>'], 'test.svg', { type: 'image/svg+xml' });
    Object.defineProperty(file, 'size', { value: 1 * MB });
    const result = await uploadCommunityMedia(file, 'user-1', 'post-1');
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('accepts image/jpeg and calls supabase.storage.from().upload() with correct path shape', async () => {
    const file = new File(['binary'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 5 * MB });

    const result = await uploadCommunityMedia(file, 'user-abc', 'post-xyz');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Path must match: {userId}/{postId}/{uuid}.{ext}
      expect(result.path).toMatch(/^user-abc\/post-xyz\/[0-9a-f-]+\.jpeg$/);
    }
  });
});

describe('assertImageCap', () => {
  it('returns { ok: true } when count is below 10', () => {
    expect(assertImageCap(9)).toEqual({ ok: true });
  });

  it('returns { ok: false, error: image_cap_reached } when count equals 10', () => {
    expect(assertImageCap(10)).toEqual({ ok: false, error: 'image_cap_reached' });
  });

  it('returns { ok: false, error: image_cap_reached } when count exceeds 10 (11th upload)', () => {
    expect(assertImageCap(11)).toEqual({ ok: false, error: 'image_cap_reached' });
  });

  it('returns { ok: true } when count is 0', () => {
    expect(assertImageCap(0)).toEqual({ ok: true });
  });
});
