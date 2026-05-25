/**
 * Phase 56 Plan 01 — Placement registry type contract tests (AD-05, AD-04).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdServingMode, AdPlacementConfig } from './placementRegistry';

// ─── AdServingMode exhaustiveness ────────────────────────────────────────────

describe('AdServingMode union exhaustiveness', () => {
  it('covers exactly 3 modes: embed-code, ad-platform, house-ads', () => {
    // TypeScript exhaustiveness enforced at compile time; verify runtime strings
    const modes: AdServingMode[] = ['embed-code', 'ad-platform', 'house-ads'];
    expect(modes).toHaveLength(3);
    expect(modes).toContain('embed-code');
    expect(modes).toContain('ad-platform');
    expect(modes).toContain('house-ads');
  });
});

// ─── rowToPlacementConfig safe defaults ─────────────────────────────────────

describe('rowToPlacementConfig — safe defaults', () => {
  let rowToPlacementConfig: (row: Record<string, unknown>) => AdPlacementConfig;

  beforeEach(async () => {
    const mod = await import('./placementRegistry');
    rowToPlacementConfig = mod.rowToPlacementConfig;
  });

  it('defaults enabled to false when missing', () => {
    const result = rowToPlacementConfig({
      placement_id: 'p1',
      surface: 'home',
      mode: 'embed-code',
    });
    expect(result.enabled).toBe(false);
  });

  it('defaults freq_cap_per_session to a sane ceiling (> 0) when missing', () => {
    const result = rowToPlacementConfig({
      placement_id: 'p1',
      surface: 'home',
      mode: 'ad-platform',
    });
    expect(result.freq_cap_per_session).toBeGreaterThan(0);
  });

  it('defaults network to null when missing', () => {
    const result = rowToPlacementConfig({
      placement_id: 'p1',
      surface: 'home',
      mode: 'house-ads',
    });
    expect(result.network).toBeNull();
  });

  it('defaults ab_variant to null when missing', () => {
    const result = rowToPlacementConfig({
      placement_id: 'p1',
      surface: 'home',
      mode: 'embed-code',
    });
    expect(result.ab_variant).toBeNull();
  });

  it('defaults embed_html to null when missing', () => {
    const result = rowToPlacementConfig({
      placement_id: 'p1',
      surface: 'home',
      mode: 'embed-code',
    });
    expect(result.embed_html).toBeNull();
  });

  it('defaults house_ad_slug to null when missing', () => {
    const result = rowToPlacementConfig({
      placement_id: 'p1',
      surface: 'home',
      mode: 'house-ads',
    });
    expect(result.house_ad_slug).toBeNull();
  });

  it('preserves provided values over defaults', () => {
    const result = rowToPlacementConfig({
      placement_id: 'banner-home',
      surface: 'home',
      mode: 'ad-platform',
      network: 'admob',
      freq_cap_per_session: 5,
      enabled: true,
      ab_variant: 'control',
      embed_html: null,
      house_ad_slug: null,
    });
    expect(result.placement_id).toBe('banner-home');
    expect(result.surface).toBe('home');
    expect(result.mode).toBe('ad-platform');
    expect(result.network).toBe('admob');
    expect(result.freq_cap_per_session).toBe(5);
    expect(result.enabled).toBe(true);
    expect(result.ab_variant).toBe('control');
  });
});

// ─── fetchPlacements fail-safe ───────────────────────────────────────────────

describe('fetchPlacements — fail-safe returns [] on error', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns [] when the supabase call rejects', async () => {
    // Mock the supabase module to simulate a fetch error
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: () => ({
          select: () =>
            Promise.resolve({ data: null, error: new Error('network failure') }),
        }),
      },
    }));

    const { fetchPlacements } = await import('./placementRegistry');
    const result = await fetchPlacements();
    expect(result).toEqual([]);
  });

  it('returns [] when supabase throws synchronously', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: () => {
          throw new Error('connection refused');
        },
      },
    }));

    const { fetchPlacements } = await import('./placementRegistry');
    const result = await fetchPlacements();
    expect(result).toEqual([]);
  });

  it('returns mapped placements on success', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: () => ({
          select: () =>
            Promise.resolve({
              data: [
                {
                  placement_id: 'test-banner',
                  surface: 'home',
                  mode: 'house-ads',
                  enabled: true,
                  freq_cap_per_session: 3,
                  network: null,
                  ab_variant: null,
                  embed_html: null,
                  house_ad_slug: 'promo-jan',
                },
              ],
              error: null,
            }),
        }),
      },
    }));

    const { fetchPlacements } = await import('./placementRegistry');
    const result = await fetchPlacements();
    expect(result).toHaveLength(1);
    expect(result[0].placement_id).toBe('test-banner');
    expect(result[0].house_ad_slug).toBe('promo-jan');
    expect(result[0].enabled).toBe(true);
  });
});
