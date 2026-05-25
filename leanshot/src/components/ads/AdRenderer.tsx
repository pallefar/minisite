/**
 * Phase 56 Plan 03 — AdRenderer: canShowAds gate + freq-cap + 3-mode dispatch (AD-04, AD-07).
 *
 * This is the single entry point for all ad rendering. Sub-components (EmbedAdSlot,
 * PlatformAdSlot, HouseAdSlot) MUST NOT re-read tier — T-56-10 elevation-of-privilege
 * mitigation. The gate is enforced here and nowhere else.
 *
 * 3 serving modes (from placementRegistry.ts):
 *   'embed-code'  → EmbedAdSlot (sandboxed iframe)
 *   'ad-platform' → PlatformAdSlot (AdMob native / AdSense web)
 *   'house-ads'   → HouseAdSlot (first-party promo)
 *
 * A/B (AD-07): reads PostHog feature flag for placement.ab_variant when non-null;
 * falls back to placement.network when no flag result is available.
 *
 * FIREWALL: MUST NOT import native/health.
 */
import { useStore } from '@/lib/store';
import { canShowAds, type AdSurface } from '@/lib/ads/canShowAds';
import { canShowNextImpression } from '@/lib/ads/freqCap';
import type { AdPlacementConfig } from '@/lib/ads/placementRegistry';

import { EmbedAdSlot } from './EmbedAdSlot';
import { HouseAdSlot } from './HouseAdSlot';
import { PlatformAdSlot } from './PlatformAdSlot';

// ─── PostHog A/B helper ───────────────────────────────────────────────────────

/**
 * Resolve A/B variant from PostHog feature flag.
 * posthog-js is loaded dynamically in analytics.ts — access via window.posthog
 * when available. Falls back to null (caller uses placement.network default).
 */
function resolveAbVariant(flagKey: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ph = (window as any).posthog;
    if (ph && typeof ph.getFeatureFlag === 'function') {
      const val: unknown = ph.getFeatureFlag(flagKey);
      if (typeof val === 'string') return val;
    }
  } catch {
    // PostHog not loaded yet — fall through to null.
  }
  return null;
}

// ─── AdRendererProps ──────────────────────────────────────────────────────────

export interface AdRendererProps {
  /** The current app surface. Used for EXCLUDED_SURFACES compliance check. */
  surface: AdSurface;
  /** Placement config fetched from ad_placements table via fetchPlacements(). */
  placement: AdPlacementConfig;
}

// ─── AdRenderer ──────────────────────────────────────────────────────────────

/**
 * Single-gate ad renderer.
 *
 * Gate order (must be exact — T-56-10):
 *   1. canShowAds(surface, tier) — tier check FIRST, then EXCLUDED_SURFACES
 *   2. placement.enabled — registry-level kill switch
 *   3. canShowNextImpression — session freq-cap
 *   4. Dispatch to sub-renderer by placement.mode
 */
export function AdRenderer({ surface, placement }: AdRendererProps) {
  // Selector: one primitive per selector convention.
  const tier = useStore((s) => s.tier);

  // Gate 1: paid tier OR excluded surface → no ad.
  if (!canShowAds(surface, tier)) return null;

  // Gate 2: placement disabled in registry.
  if (!placement.enabled) return null;

  // Gate 3: session freq-cap exhausted.
  if (!canShowNextImpression(placement.placement_id, placement.freq_cap_per_session)) return null;

  // A/B (AD-07): resolve variant via PostHog when ab_variant flag key is set.
  let network = placement.network;
  if (placement.ab_variant) {
    const variant = resolveAbVariant(placement.ab_variant);
    if (variant) network = variant as 'admob' | 'adsense';
  }

  // Dispatch to sub-renderer.
  switch (placement.mode) {
    case 'embed-code':
      return (
        <EmbedAdSlot
          embedHtml={placement.embed_html ?? ''}
          placementId={placement.placement_id}
        />
      );

    case 'ad-platform':
      // network resolved above (admob/adsense/A/B variant).
      void network; // used for future routing; PlatformAdSlot branches on detectPlatform()
      return <PlatformAdSlot placementId={placement.placement_id} />;

    case 'house-ads':
      return (
        <HouseAdSlot
          slug={placement.house_ad_slug ?? ''}
          placementId={placement.placement_id}
        />
      );

    default:
      return null;
  }
}
