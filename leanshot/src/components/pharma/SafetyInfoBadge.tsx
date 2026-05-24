/**
 * Phase 39 Plan 39-05 Task 1 — SafetyInfoBadge.
 *
 * D-05 mandates a visible "always free" affordance accompanying every piece
 * of safety-category content (the 5 enumerated categories in Phase 39
 * CONTEXT.md). The badge is rendered alongside the content (NEVER instead
 * of it) — see PharmaContentBlock for the cascade.
 *
 * UI-SPEC color: sage success tone (--color-success-soft bg + --color-success
 * text). NOT teal (teal sits on the UI-SPEC accent reserved-list and is the
 * brand accent for the marketing surface; using it here would steal accent
 * recognition from the brand surface).
 *
 * Copy is fixed per UI-SPEC; only the aria-label varies with the category
 * for screen-reader clarity ("Always free safety information (overdose-warning)").
 */
import { Badge } from '@/components/ui/Badge';

export interface SafetyInfoBadgeProps {
  /** One of the 5 D-05 enumerated safety categories. */
  category: string;
}

export function SafetyInfoBadge({ category }: SafetyInfoBadgeProps) {
  return (
    <Badge tone="success" aria-label={`Always free safety information (${category})`}>
      Safety info — always free
    </Badge>
  );
}
