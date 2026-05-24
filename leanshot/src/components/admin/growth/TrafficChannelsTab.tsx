/**
 * Phase 51 Plan 51-05 — TrafficChannelsTab STUB.
 *
 * This is a placeholder rendered by TrafficDashboardPage while the real
 * Channels tab implementation lands in **Plan 51-06**. The stub exists so
 * that the Wave-4 parallel Plans 51-06..09 can each overwrite their own
 * sub-tab file without forcing a same-file merge on TrafficDashboardPage
 * (per project memory `feedback_stub_then_replace_sibling_collision`).
 *
 * Plan 51-06 contract (DO NOT BREAK ON OVERWRITE):
 *   - Named export: `TrafficChannelsTab`
 *   - Signature: `React.FC` (no props)
 *   - Module path: `@/components/admin/growth/TrafficChannelsTab`
 *   - Default export: optional — TrafficDashboardPage imports the NAMED export.
 *
 * The lazy import in TrafficDashboardPage.tsx unwraps `m.TrafficChannelsTab`,
 * so the named export above is the load-bearing contract.
 */
import { EmptyState } from '@/components/ui/EmptyState';

export const TrafficChannelsTab: React.FC = () => (
  <EmptyState
    inline
    title="Channels tab"
    body="Channel rollup table + retention sparklines ship in Plan 51-06."
  />
);

export default TrafficChannelsTab;
