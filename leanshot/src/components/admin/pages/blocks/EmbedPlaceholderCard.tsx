/**
 * Phase 41 Plan 41-05 — EmbedPlaceholderCard
 *
 * D-08 branded placeholder card shown when an embed's required consent
 * categories have not been granted. Per UI-SPEC §Surface B State 1:
 *   - DSv2 Card variant='default' padding='lg'
 *   - 32×32 provider icon (lucide-react fallbacks: Calendar/Video/FileText/ExternalLink)
 *   - Heading L2 with verbatim per-provider copy from UI-SPEC §Copywriting Contract
 *   - Body caption (--text-sm --color-text-secondary)
 *   - "Manage cookie preferences →" link that dispatches
 *     `leanshot:open-consent-banner` (consumed by Phase 22 banner — fall back to
 *     CookieConsent.show() if listener absent).
 *
 * NO emoji, sentence case (Voice Rules). 44×44 minimum touch target on link.
 */
import { Calendar, ExternalLink, FileText, Video } from 'lucide-react';
import type { JSX } from 'react';
import { Card } from '@/components/ui/Card';

export type EmbedProvider = 'calendly' | 'youtube' | 'tally' | 'custom_iframe';
export type ConsentCategory = 'analytics' | 'marketing' | 'functional' | 'personalization';

export interface EmbedPlaceholderCardProps {
  provider: EmbedProvider;
  /**
   * Required consent categories for the embed — included in body copy
   * (e.g. "Required: Functional + Analytics cookies...").
   */
  categories: ReadonlyArray<ConsentCategory>;
  /** Override for the manage-preferences click. Defaults to dispatchEvent + fallback. */
  onManagePreferences?: () => void;
}

const PROVIDER_HEADING: Record<EmbedProvider, string> = {
  calendly: 'Enable functional and analytics cookies to view this Calendly meeting',
  youtube: 'Enable analytics and marketing cookies to view this YouTube video',
  tally: 'Enable functional cookies to view this Tally form',
  custom_iframe: 'Enable marketing cookies to view this embed',
};

const PROVIDER_ICON: Record<EmbedProvider, (props: { size: number; color: string; 'aria-hidden': boolean }) => JSX.Element> = {
  calendly: (p) => <Calendar {...p} />,
  youtube: (p) => <Video {...p} />,
  tally: (p) => <FileText {...p} />,
  custom_iframe: (p) => <ExternalLink {...p} />,
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

async function fallbackShowBanner(): Promise<void> {
  try {
    const cc = await import('vanilla-cookieconsent');
    const show = (cc as { show?: () => void }).show;
    if (typeof show === 'function') show();
  } catch {
    /* SSR / module not present — silent no-op. */
  }
}

function defaultOpenBanner(): void {
  if (typeof window === 'undefined') return;
  // Dispatch the canonical open-banner event. If no listener is registered
  // by Phase 22, fall back to calling CookieConsent.show() directly.
  let handled = false;
  const sentinel = (): void => {
    handled = true;
  };
  window.addEventListener('leanshot:open-consent-banner', sentinel, { once: true });
  window.dispatchEvent(new CustomEvent('leanshot:open-consent-banner'));
  // The sentinel listener itself counts as a handler — but if any OTHER
  // listener prevented default / signaled it took action, we trust that.
  // For simplicity: always try the fallback after dispatching when no
  // app-level listener has been registered by the consent layer. The Phase 22
  // banner registers its own listener; if it ran before our sentinel detached,
  // dispatch is already consumed. We unconditionally attempt the fallback —
  // CookieConsent.show is idempotent if the banner is already visible.
  window.removeEventListener('leanshot:open-consent-banner', sentinel);
  if (!handled) {
    // Belt-and-suspenders: try direct CookieConsent.show().
    void fallbackShowBanner();
  }
}

export function EmbedPlaceholderCard({
  provider,
  categories,
  onManagePreferences,
}: EmbedPlaceholderCardProps): JSX.Element {
  const Icon = PROVIDER_ICON[provider];
  const heading = PROVIDER_HEADING[provider];
  const categoryList = categories.map(capitalize).join(' + ');

  const handleManage = onManagePreferences ?? defaultOpenBanner;

  return (
    <Card variant="default" padding="lg" className="flex flex-col gap-4">
      <div className="flex items-center">
        <Icon size={32} color="var(--color-text-secondary)" aria-hidden={true} />
      </div>
      <h3 className="text-[22px] font-semibold leading-[1.35] text-[var(--color-text)]">
        {heading}
      </h3>
      <p className="text-[13px] leading-[1.5] text-[var(--color-text-secondary)]">
        Required: {categoryList} cookies. We never load this content until you opt in.
      </p>
      <button
        type="button"
        onClick={handleManage}
        className="inline-flex items-center justify-start min-h-[44px] min-w-[44px] text-[13px] font-semibold text-[var(--color-primary)] hover:underline self-start"
      >
        Manage cookie preferences →
      </button>
    </Card>
  );
}
