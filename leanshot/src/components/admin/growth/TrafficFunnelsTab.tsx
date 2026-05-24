/**
 * Phase 51 Plan 51-05 — TrafficFunnelsTab STUB.
 *
 * Placeholder for **Plan 51-07** (Conversion Funnels tab). See sibling
 * TrafficChannelsTab.tsx for the slot-contract rationale + overwrite rules.
 *
 * Plan 51-07 contract:
 *   - Named export: `TrafficFunnelsTab`
 *   - Signature: `React.FC` (no props)
 *   - Module path: `@/components/admin/growth/TrafficFunnelsTab`
 */
import { EmptyState } from '@/components/ui/EmptyState';

export const TrafficFunnelsTab: React.FC = () => (
  <EmptyState
    inline
    title="Funnels tab"
    body="Conversion funnels (Consumer / Clinic-org / Affiliate) ship in Plan 51-07."
  />
);

export default TrafficFunnelsTab;
