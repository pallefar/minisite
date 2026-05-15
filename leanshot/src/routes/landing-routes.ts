/**
 * Phase 19 Plan 19-08 — landing route registry (BL-4).
 *
 * Mirrors `affiliate-apply-routes.ts` / `partner-routes.ts` etc. — declares
 * the `/r/{code}/landing` route as a descriptor only; Plan 19-09 (Wave 6)
 * is the single late-wave task that imports + wires every plan's registry
 * into `src/App.tsx`. This file explicitly does NOT mutate App.tsx so that
 * parallel route-adding plans don't collide on a shared file.
 *
 * Consumer contract (Plan 19-09):
 *   import { LANDING_ROUTES } from '@/routes/landing-routes';
 *
 * Path-shape note: `/r/{code}/landing` has TWO path segments after `/r/`
 * (the affiliate's referral code + the literal `landing` suffix). The
 * existing prefix-match semantics in App.tsx for `/r/` already cover this —
 * Plan 19-09 just needs to add the regex extraction
 * `^/r/([a-z0-9-]+)/landing$` and pass the captured code as the `code` prop
 * to `<AffiliateLandingResolver code={...} />`. The descriptor below leaves
 * that capture detail in Plan 19-09's hands by exporting a `prefix` match
 * on `/r/` + an explicit `landingSuffix` hint for the matcher.
 */
import { type ComponentType } from 'react';

export type RouteMatch = 'exact' | 'prefix';

export interface RouteDescriptor {
  match: RouteMatch;
  path: string;
  componentLoader: () => Promise<{ default: ComponentType<{ code: string }> }>;
  /** Optional regex hint for Plan 19-09's matcher. */
  pathRegex?: string;
  /** Name of the capture group App.tsx forwards as a prop. */
  captureProp?: string;
}

/**
 * Routes contributed by Plan 19-08:
 *   - `/r/{code}/landing` → AffiliateLandingResolver (anon public landing
 *     page; verify_jwt=false for the impression Edge Function it pings)
 *
 * The Plan 19-02 `/r/{code}` (no `/landing` suffix) route is the
 * cookie-set redirect handled by the affiliate-attribute Edge Function via
 * Vercel rewrite — distinct from this landing route.
 */
export const LANDING_ROUTES: RouteDescriptor[] = [
  {
    match: 'prefix',
    path: '/r/',
    pathRegex: '^/r/([a-z0-9-]+)/landing$',
    captureProp: 'code',
    componentLoader: () => import('@/components/landing/AffiliateLandingResolver'),
  },
];
