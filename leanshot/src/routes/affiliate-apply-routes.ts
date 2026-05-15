/**
 * Phase 19 Plan 19-05 — affiliate-apply route registry.
 *
 * BL-4 resolution: instead of mutating `src/App.tsx` directly (which would
 * collide with the parallel route additions from Plans 19-06 and 19-08
 * across waves), each plan creates a thin route-descriptor file under
 * `src/routes/`. Plan 19-09 (Wave 5) is the single late-wave task that
 * imports the three registry files and wires them into App.tsx.
 *
 * Consumer contract (Plan 19-09):
 *   import { AFFILIATE_APPLY_ROUTES } from '@/routes/affiliate-apply-routes';
 *
 * Descriptors are intentionally light — they describe match semantics + a
 * lazy `componentLoader` only. App.tsx is the source of truth for how
 * descriptors compose with the rest of the routing tree.
 */
import { type ComponentType } from 'react';

export type RouteMatch = 'exact' | 'prefix';

export interface RouteDescriptor {
  match: RouteMatch;
  path: string;
  componentLoader: () => Promise<{ default: ComponentType }>;
}

/**
 * Routes contributed by Plan 19-05:
 *   - `/affiliate`          → AffiliateApplyPage (anonymous-visitor apply form)
 *   - `/admin/affiliates`   → AdminAffiliatesScaffold (is_staff-gated read-only list;
 *                             P22 ADMIN-06 replaces this with the full operator UX)
 */
export const AFFILIATE_APPLY_ROUTES: RouteDescriptor[] = [
  {
    match: 'exact',
    path: '/affiliate',
    componentLoader: () => import('@/components/affiliate/AffiliateApplyPage'),
  },
  {
    match: 'prefix',
    path: '/admin/affiliates',
    componentLoader: () => import('@/components/admin/AdminAffiliatesScaffold'),
  },
];
