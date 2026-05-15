/**
 * Phase 19 — StripeConnectOnboardingCard PLACEHOLDER.
 *
 * AUTHORED BY: Plan 19-06a (Wave 3) as a stub to satisfy Vite's static
 *              import-analysis on PartnerDashboard.tsx (I-4 cross-wave gate).
 *
 * OWNED BY:    Plan 19-06b (Wave 4).
 *
 * Plan 19-06b's executor MUST OVERWRITE this file with the real 4-state-machine
 * component per:
 *   - 19-UI-SPEC.md §"Stripe Connect Onboarding Card — State Machine"
 *   - 19-PATTERNS.md §C.13
 *
 * Until 19-06b ships, this component renders null on every state so that:
 *   1. /partner/dashboard renders cleanly for `active` accounts (correct behavior)
 *   2. Non-active states are silently no-op'd (placeholder visible only via tests
 *      that mock this module)
 *
 * DO NOT add real behavior here — it belongs in 19-06b.
 */
import { type ReactNode } from 'react';

export type ConnectState = 'pending' | 'needs_info' | 'active' | 'restricted';

export interface StripeConnectOnboardingCardProps {
  state: ConnectState;
  requirements: string[];
  disabledReason: string | null;
}

 
export function StripeConnectOnboardingCard(_props: StripeConnectOnboardingCardProps): ReactNode {
  // Plan 19-06b: replace the body below with the state-machine render per UI-SPEC.
  return null;
}

export default StripeConnectOnboardingCard;
