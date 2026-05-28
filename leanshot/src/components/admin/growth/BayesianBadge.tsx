/**
 * Phase 39 Plan 39-07 — BayesianBadge (PAGEAB-07 + D-12).
 *
 * Tri-state Bayesian posterior badge wrapping the DSv2 Badge primitive.
 *
 * Tones (per 39-UI-SPEC table):
 *   posterior <  0.80 → neutral  "Insufficient data (N%)"
 *   posterior <  0.95 → warning  "Trending (N%)"
 *   posterior >= 0.95 → success  "Significant (N%)"
 *
 * The percent is Math.round(posterior * 100). Accent reservation honored — no
 * --color-primary on this badge (success uses sage success-soft, not teal).
 */
import { Badge } from '@/components/ui/Badge';

export interface BayesianBadgeProps {
  /** 0..1 — posterior probability that this variant beats control. */
  posterior: number;
}

export function BayesianBadge({ posterior }: BayesianBadgeProps): React.JSX.Element {
  const pct = Math.round(posterior * 100);
  if (posterior < 0.8) {
    return <Badge tone="neutral">Insufficient data ({pct}%)</Badge>;
  }
  if (posterior < 0.95) {
    return <Badge tone="warning">Trending ({pct}%)</Badge>;
  }
  return <Badge tone="success">Significant ({pct}%)</Badge>;
}

export default BayesianBadge;
