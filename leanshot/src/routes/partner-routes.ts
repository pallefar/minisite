/**
 * Phase 19 Plan 19-06b — partner route registry.
 *
 * BL-4 resolution: this plan does NOT modify `src/App.tsx`. Plan 19-09 (Wave 5)
 * imports `PARTNER_ROUTES` along with `AFFILIATE_APPLY_ROUTES` (Plan 19-05)
 * and wires them into the lazy-loaded route tree in one targeted edit.
 *
 * Single descriptor: `/partner` prefix → PartnerLayout. PartnerLayout itself
 * reads `window.location.pathname` (or the test-injected override) and
 * dynamic-imports the appropriate child page (Dashboard / Links / Payouts /
 * Assets). Plan 19-09 will extend PartnerLayout's child-rendering switch
 * if needed — at this plan's close, PartnerDashboard is the only wired child.
 *
 * Why a single prefix descriptor (vs. 4 exact descriptors):
 *   - Keeps `App.tsx`'s route matching loop O(1) for the partner shell.
 *   - PartnerLayout owns the sub-nav state + path-suffix routing logic in
 *     ONE place (already wired in 19-06a). Splitting into 4 entry-points
 *     would force PartnerLayout to be lazy-imported 4 times — every nav
 *     click in the partner area would re-fetch the layout chunk.
 */
import { type ComponentType } from 'react';
import type { RouteDescriptor } from './affiliate-apply-routes';

/**
 * Routes contributed by Plan 19-06 (a + b):
 *   - `/partner/*` → PartnerLayout (which dynamic-imports Dashboard / Links /
 *                    Payouts / Assets based on pathname suffix)
 *
 * The `componentLoader` cast erases PartnerLayout's `children` prop from the
 * descriptor contract. Plan 19-09's App.tsx wiring is responsible for passing
 * the right child page; the route descriptor only needs to surface "render
 * SOMETHING under /partner" to the route matcher.
 */
export const PARTNER_ROUTES: RouteDescriptor[] = [
  {
    match: 'prefix',
    path: '/partner',
    componentLoader: () =>
      import('@/components/partner/PartnerLayout') as unknown as Promise<{
        default: ComponentType;
      }>,
  },
];
