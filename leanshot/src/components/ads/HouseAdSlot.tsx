/**
 * Phase 56 Plan 03 — HouseAdSlot: first-party promotion by slug.
 *
 * Renders a self-promo unit identified by placement.house_ad_slug.
 * Content is internal, so no sandboxed iframe needed.
 * FIREWALL: MUST NOT import native/health.
 */

interface HouseAdSlotProps {
  slug: string;
  placementId: string;
}

/**
 * Minimal first-party ad copy keyed by slug.
 * Real copy wired via CMS or hardcoded map in Phase 70.
 */
const HOUSE_AD_COPY: Record<string, { headline: string; cta: string; href: string }> = {
  'upgrade-pro': {
    headline: 'Upgrade to LeanShot Pro',
    cta: 'Remove ads & unlock advanced insights',
    href: '/upgrade',
  },
  'refer-friend': {
    headline: 'Share LeanShot',
    cta: 'Invite a friend and get 1 month free',
    href: '/refer',
  },
};

export function HouseAdSlot({ slug, placementId }: HouseAdSlotProps) {
  const copy = HOUSE_AD_COPY[slug];

  if (!copy) {
    // Unknown slug — render placeholder until CMS wired.
    return (
      <div
        data-testid={`house-ad-${placementId}`}
        style={{
          padding: '12px',
          background: 'var(--color-surface-muted, #f5f5f5)',
          borderRadius: '8px',
          fontSize: '13px',
        }}
        aria-label="LeanShot promotion"
      >
        LeanShot — coming soon
      </div>
    );
  }

  return (
    <a
      href={copy.href}
      data-testid={`house-ad-${placementId}`}
      style={{
        display: 'block',
        padding: '12px 16px',
        background: 'var(--color-surface-muted, #f5f5f5)',
        borderRadius: '8px',
        textDecoration: 'none',
        color: 'inherit',
      }}
      aria-label={`LeanShot promotion: ${copy.headline}`}
    >
      <strong style={{ fontSize: '14px' }}>{copy.headline}</strong>
      <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-text-muted, #666)' }}>
        {copy.cta}
      </p>
    </a>
  );
}
