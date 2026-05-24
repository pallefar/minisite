/**
 * Phase 51 Plan 51-05 — TrafficRealtimeTab STUB.
 *
 * Placeholder for **Plan 51-09** (Real-time activity tab). See sibling
 * TrafficChannelsTab.tsx for the slot-contract rationale + overwrite rules.
 *
 * Plan 51-09 contract:
 *   - Named export: `TrafficRealtimeTab`
 *   - Signature: `React.FC` (no props)
 *   - Module path: `@/components/admin/growth/TrafficRealtimeTab`
 *   - Internal: 5-min `setInterval` poll + document.visibilityState pause
 *     (no TanStack Query) per 51-UI-SPEC §Real-time polling.
 */
import { EmptyState } from '@/components/ui/EmptyState';

export const TrafficRealtimeTab: React.FC = () => (
  <EmptyState
    inline
    title="Real-time tab"
    body="Last-60-minute activity + 5-min polling ships in Plan 51-09."
  />
);

export default TrafficRealtimeTab;
