/**
 * Phase 60 Plan 60-13 — Hub-specific TierBadge with NEUTRAL-ONLY palette.
 *
 * UI-SPEC §10 invariant 6: "Source tier badge palette is neutral-only
 * (no green/red) on the public hub." The admin-side TierBadge uses 'info'
 * for A/B; this hub variant forces 'neutral' for ALL tiers to avoid
 * misleading trust signals on a public consumer surface.
 *
 * leanshot_research disclosure (invariant 8): amber-soft tone applied when
 * source_type='leanshot_research', distinct from standard tier badge.
 */

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';

export interface KnowledgeTierBadgeProps {
  tier: 'A' | 'B' | 'C';
  /** source_type — used for amber-soft leanshot_research badge rendering by the caller */
  sourceType?: string;
}

export function KnowledgeTierBadge({ tier }: KnowledgeTierBadgeProps) {
  const { t } = useTranslation('rag');

  const ariaLabel =
    tier === 'A' ? t('tier.A.aria') : tier === 'B' ? t('tier.B.aria') : t('tier.C.aria');

  return (
    <Badge tone="neutral" aria-label={ariaLabel}>
      {t(`tier.${tier}.label`)}
    </Badge>
  );
}

/**
 * Disclosure badge for leanshot_research source type.
 * Renders amber-soft to distinguish internal research from external sources.
 * UI-SPEC §10 invariant 8.
 */
export function LeanShotResearchDisclosure() {
  const { t } = useTranslation('rag');
  return (
    <Badge tone="amber" aria-label="LeanShot internal research disclosure">
      {t('popover.leanshot_research_disclosure')}
    </Badge>
  );
}
