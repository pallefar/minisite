/**
 * Phase 50 Plan 50-02 — TierBadge.
 *
 * Thin wrapper around Badge. Renders source-tier label with an aria-label
 * that explains tier semantics per UI-SPEC Accessibility Contract:
 *   Tier A — primary / regulatory (highest trust)
 *   Tier B — secondary / clinical (established health source)
 *   Tier C — community / lay press
 *
 * Tone mapping (UI-SPEC §Color):
 *   A → info (cool blue — denotes "primary truth")
 *   B → info (same tone; differentiated by the "B" letter)
 *   C → neutral (no positive signal — community-tier should not look authoritative)
 */
import { Badge } from '@/components/ui/Badge';

export interface TierBadgeProps {
  tier: 'A' | 'B' | 'C';
}

const ARIA_DESCRIPTIONS: Record<TierBadgeProps['tier'], string> = {
  A: 'Tier A source (highest trust)',
  B: 'Tier B source (established health source)',
  C: 'Tier C source (lay press or community)',
};

export function TierBadge({ tier }: TierBadgeProps) {
  return (
    <Badge tone={tier === 'C' ? 'neutral' : 'info'} aria-label={ARIA_DESCRIPTIONS[tier]}>
      Tier {tier}
    </Badge>
  );
}

export default TierBadge;
