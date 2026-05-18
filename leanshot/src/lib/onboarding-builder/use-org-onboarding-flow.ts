/**
 * Phase 31 Plan 06 — useOrgOnboardingFlow hook.
 *
 * Returns the onboarding flow state for the currently signed-in user.
 * Drives the render-branch in OnboardingFlow.tsx (D-10) and the
 * dashboard-entry gate in App.tsx (D-14).
 *
 * Design decisions:
 *   - Two-phase query: thin profiles SELECT first (primary_org_id + completed_onboarding_at),
 *     then conditional org/flow queries only when needed. Avoids unnecessary JOIN for
 *     consumer-path signed-in users who never joined a clinic (plan-checker WARNING 2).
 *   - Fail-open: ANY error returns 'consumer' so the patient is never blocked
 *     (T-31-06-04 availability mitigation + CLAUDE.md local-first invariant).
 *   - Empty dep array on useEffect: one fetch per mount, not on every render.
 *   - Single setState call to avoid intermediate inconsistent reads.
 *   - Does NOT introduce new VITE_ env vars (per [[reference_vite_static_env_inlining]]).
 *
 * Status state machine:
 *   'loading'   — initial state while async query is in-flight
 *   'consumer'  — no signed-in user, or no primary_org_id, or org has no active flow
 *   'org'       — user has primary_org_id + active org flow (show org-customized steps)
 *   'completed' — user.completed_onboarding_at IS NOT NULL (skip onboarding entirely)
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { OnboardingStepNode } from '@/types/onboarding-step';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OrgOnboardingFlowState {
  status: 'loading' | 'consumer' | 'org' | 'completed';
  orgId: string | null;
  orgName: string | null;
  steps: OnboardingStepNode[] | null;
}

const INITIAL_STATE: OrgOnboardingFlowState = {
  status: 'loading',
  orgId: null,
  orgName: null,
  steps: null,
};

const CONSUMER_STATE: OrgOnboardingFlowState = {
  status: 'consumer',
  orgId: null,
  orgName: null,
  steps: null,
};

const COMPLETED_STATE: OrgOnboardingFlowState = {
  status: 'completed',
  orgId: null,
  orgName: null,
  steps: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the org onboarding flow state for the currently signed-in user.
 *
 * Usage in OnboardingFlow.tsx:
 *   const flowState = useOrgOnboardingFlow();
 *   switch (flowState.status) { ... }
 *
 * Usage in App.tsx dashboard-entry gate:
 *   const orgFlow = useOrgOnboardingFlow();
 *   if (orgFlow.status === 'org') { return <Onboarding ... />; }
 */
export function useOrgOnboardingFlow(): OrgOnboardingFlowState {
  const [state, setState] = useState<OrgOnboardingFlowState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    async function fetchFlowState(): Promise<void> {
      try {
        // Phase 1: check auth
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (cancelled) return;

        if (authError || !authData?.user) {
          // Anonymous / pre-signin → consumer path, no DB round-trip
          setState(CONSUMER_STATE);
          return;
        }

        const userId = authData.user.id;

        // Phase 2: thin profiles SELECT — primary_org_id + completed_onboarding_at only
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('primary_org_id, completed_onboarding_at')
          .eq('id', userId)
          .maybeSingle();

        if (cancelled) return;

        if (profileError) {
          console.warn('[useOrgOnboardingFlow] profiles SELECT failed:', profileError.message);
          setState(CONSUMER_STATE);
          return;
        }

        // D-14: completed_onboarding_at IS NOT NULL → never re-onboard (D-15 first-clinic-wins)
        if (profileData?.completed_onboarding_at != null) {
          setState(COMPLETED_STATE);
          return;
        }

        const primaryOrgId = profileData?.primary_org_id ?? null;

        // No clinic affiliation → consumer path (avoids unnecessary org_onboarding_flows JOIN)
        if (!primaryOrgId) {
          setState(CONSUMER_STATE);
          return;
        }

        // Phase 3: fetch org name
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', primaryOrgId)
          .maybeSingle();

        if (cancelled) return;

        if (orgError) {
          console.warn('[useOrgOnboardingFlow] organizations SELECT failed:', orgError.message);
          setState(CONSUMER_STATE);
          return;
        }

        const orgName = orgData?.name ?? null;

        // Phase 4: fetch active onboarding flow for the org
        const { data: flowData, error: flowError } = await supabase
          .from('org_onboarding_flows')
          .select('steps')
          .eq('org_id', primaryOrgId)
          .eq('is_active', true)
          .maybeSingle();

        if (cancelled) return;

        if (flowError) {
          console.warn('[useOrgOnboardingFlow] org_onboarding_flows SELECT failed:', flowError.message);
          setState(CONSUMER_STATE);
          return;
        }

        const steps = flowData?.steps ?? null;

        // No active flow configured → consumer fallback
        if (!steps || !Array.isArray(steps) || steps.length === 0) {
          setState(CONSUMER_STATE);
          return;
        }

        // Org has an active flow → show org-customized onboarding
        setState({
          status: 'org',
          orgId: primaryOrgId,
          orgName,
          steps: steps as OnboardingStepNode[],
        });
      } catch (err) {
        if (cancelled) return;
        // Fail-open: ANY error → consumer path (T-31-06-04 + CLAUDE.md local-first)
        console.warn('[useOrgOnboardingFlow] unexpected error, failing open:', err);
        setState(CONSUMER_STATE);
      }
    }

    void fetchFlowState();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only; intentional empty dep array (one fetch per mount)

  return state;
}
