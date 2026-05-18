/**
 * Phase 50 Plan 50-02 — HealthBadge.
 *
 * Thin wrapper around Badge for rag_sources.health states.
 *
 * UI-SPEC §Color "health badge contract":
 *   ok      → success tone, NO pulse
 *   paused  → warning tone, NO pulse, optional ": reason" suffix
 *   failing → danger tone, pulse=true (pulse-intent rule: only failing)
 */
import { Badge } from '@/components/ui/Badge';

export type HealthState = 'ok' | 'paused' | 'failing';

export interface HealthBadgeProps {
  state: HealthState;
  reason?: string;
}

export function HealthBadge({ state, reason }: HealthBadgeProps) {
  if (state === 'ok') {
    return <Badge tone="success">Healthy</Badge>;
  }
  if (state === 'paused') {
    return <Badge tone="warning">{reason ? `Paused: ${reason}` : 'Paused'}</Badge>;
  }
  // state === 'failing'
  return (
    <Badge tone="danger" pulse>
      Failing
    </Badge>
  );
}

export default HealthBadge;
