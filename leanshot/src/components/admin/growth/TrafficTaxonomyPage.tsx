/**
 * Phase 51 Plan 51-05 — TrafficTaxonomyPage STUB.
 *
 * Placeholder for **Plan 51-09** (Channel Taxonomy admin sub-page). See
 * sibling TrafficChannelsTab.tsx for the slot-contract rationale.
 *
 * Plan 51-09 contract:
 *   - Named export: `TrafficTaxonomyPage`
 *   - Signature: `React.FC` (no props)
 *   - Module path: `@/components/admin/growth/TrafficTaxonomyPage`
 */
import { EmptyState } from '@/components/ui/EmptyState';

export const TrafficTaxonomyPage: React.FC = () => (
  <EmptyState
    inline
    title="Channel Taxonomy"
    body="Channel groups + referrer rules CRUD ships in Plan 51-09."
  />
);

export default TrafficTaxonomyPage;
