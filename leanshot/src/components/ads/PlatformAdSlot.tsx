/**
 * Phase 56 Plan 03 — PlatformAdSlot: AdMob (native) / AdSense (web) branching.
 *
 * - web: renders an AdSense <ins> element (placeholder div when VITE_ADSENSE_PUBLISHER_ID
 *   empty — real fill arrives Phase 70 D-08).
 * - native (ios/android/capacitor-web): triggers imperative AdMob banner via ads.ts.
 *
 * FIREWALL: MUST NOT import native/health.
 */
import { useEffect } from 'react';
import { showBannerAd } from '@/lib/native/ads';
import { detectPlatform } from '@/lib/native/platform';

interface PlatformAdSlotProps {
  placementId: string;
}

const ADSENSE_PUBLISHER_ID = import.meta.env.VITE_ADSENSE_PUBLISHER_ID as string | undefined;
const ADMOB_BANNER_IOS = import.meta.env.VITE_ADMOB_BANNER_ID_IOS as string | undefined;
const ADMOB_BANNER_ANDROID = import.meta.env.VITE_ADMOB_BANNER_ID_ANDROID as string | undefined;

export function PlatformAdSlot({ placementId }: PlatformAdSlotProps) {
  const platform = detectPlatform();
  const isNative = platform === 'ios' || platform === 'android' || platform === 'capacitor-web';

  useEffect(() => {
    if (!isNative) return;

    const adUnitId =
      platform === 'ios'
        ? (ADMOB_BANNER_IOS ?? '')
        : (ADMOB_BANNER_ANDROID ?? '');

    if (!adUnitId) return;

    // Fire-and-forget; errors are non-fatal (ad is a nice-to-have).
    void showBannerAd(adUnitId).catch(() => {
      // Silently swallow — native ad failure must not break the app.
    });
  }, [isNative, platform]);

  // Native: AdMob renders its own native overlay; nothing to render in React DOM.
  if (isNative) return null;

  // Web: AdSense slot element.
  if (!ADSENSE_PUBLISHER_ID) {
    // Phase 70 D-08: real publisher ID not yet set. Render placeholder.
    return (
      <div
        data-testid={`ad-placeholder-${placementId}`}
        style={{
          width: '100%',
          height: '90px',
          background: 'var(--color-surface-muted, #f5f5f5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          color: 'var(--color-text-muted, #999)',
        }}
        aria-hidden="true"
      >
        Ad slot — coming soon
      </div>
    );
  }

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block' }}
      data-ad-client={ADSENSE_PUBLISHER_ID}
      data-ad-slot={placementId}
      data-ad-format="auto"
      data-full-width-responsive="true"
      aria-label="Advertisement"
    />
  );
}
