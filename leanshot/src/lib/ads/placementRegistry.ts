/**
 * Phase 56 Plan 01 — Placement registry type contract + fetcher (AD-05, AD-04).
 *
 * Exports AdServingMode, AdPlacementConfig, rowToPlacementConfig, and
 * fetchPlacements. This is the contract downstream AdRenderer (56-03) and
 * admin dashboard (56-05) build against — keep field names stable.
 *
 * T-56-03: fail-safe [] on any error; no PHI in ad_placements table.
 */
import { supabase } from '@/lib/supabase';
import type { AdSurface } from './canShowAds';

// ─── AdServingMode ───────────────────────────────────────────────────────────

/**
 * Three serving modes (AD-04):
 *   'embed-code'  — raw HTML/JS snippet injected into the page (AdSense, etc.)
 *   'ad-platform' — SDK-driven (AdMob, native ad SDK)
 *   'house-ads'   — first-party promotion identified by a slug
 */
export type AdServingMode = 'embed-code' | 'ad-platform' | 'house-ads';

// ─── AdPlacementConfig ───────────────────────────────────────────────────────

/**
 * Typed placement config consumed by AdRenderer (56-03) and admin dashboard
 * (56-05). Mapped from the ad_placements table row (schema created by 56-02).
 */
export interface AdPlacementConfig {
  /** Unique identifier for this placement slot. */
  placement_id: string;
  /** Surface where this placement appears. */
  surface: AdSurface;
  /** How the ad is served. */
  mode: AdServingMode;
  /** Ad network identifier; null for house-ads mode. */
  network: 'admob' | 'adsense' | null;
  /** Maximum impressions allowed per session for this placement (AD-08). */
  freq_cap_per_session: number;
  /** Whether this placement is active. Defaults to false (fail-safe). */
  enabled: boolean;
  /** PostHog A/B variant identifier for AD-07 split; null if no split. */
  ab_variant: string | null;
  /** Raw HTML/JS snippet for embed-code mode; null otherwise. */
  embed_html: string | null;
  /** First-party promo slug for house-ads mode; null otherwise. */
  house_ad_slug: string | null;
}

// ─── DEFAULT_FREQ_CAP ────────────────────────────────────────────────────────

/** Sane default session ceiling when not specified in the DB row. */
const DEFAULT_FREQ_CAP = 3;

// ─── rowToPlacementConfig ─────────────────────────────────────────────────────

/**
 * Pure mapper: normalises a raw DB row to AdPlacementConfig with safe defaults.
 * enabled defaults false, freq_cap_per_session defaults DEFAULT_FREQ_CAP.
 */
export function rowToPlacementConfig(row: Record<string, unknown>): AdPlacementConfig {
  return {
    placement_id: String(row.placement_id ?? ''),
    surface: row.surface as AdSurface,
    mode: row.mode as AdServingMode,
    network: (row.network as 'admob' | 'adsense' | null) ?? null,
    freq_cap_per_session:
      typeof row.freq_cap_per_session === 'number' ? row.freq_cap_per_session : DEFAULT_FREQ_CAP,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : false,
    ab_variant: typeof row.ab_variant === 'string' ? row.ab_variant : null,
    embed_html: typeof row.embed_html === 'string' ? row.embed_html : null,
    house_ad_slug: typeof row.house_ad_slug === 'string' ? row.house_ad_slug : null,
  };
}

// ─── fetchPlacements ─────────────────────────────────────────────────────────

/**
 * Fetches all placement configs from the ad_placements table.
 * Fail-safe: returns [] on any error (no placements = no ads; never throws
 * into the render path — T-56-03).
 *
 * The ad_placements table schema is created by Plan 56-02.
 */
export async function fetchPlacements(): Promise<AdPlacementConfig[]> {
  try {
    const { data, error } = await supabase
      .from('ad_placements')
      .select(
        'placement_id, surface, mode, network, freq_cap_per_session, enabled, ab_variant, embed_html, house_ad_slug',
      );

    if (error || !data) return [];

    return (data as Record<string, unknown>[]).map(rowToPlacementConfig);
  } catch {
    return [];
  }
}
