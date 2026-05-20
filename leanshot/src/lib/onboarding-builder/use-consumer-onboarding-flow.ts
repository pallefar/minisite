/**
 * Phase 34 Plan 34-06 — useConsumerOnboardingFlow hook.
 *
 * Mirrors {@link useOrgOnboardingFlow} state machine but targets the consumer
 * `public.onboarding_flows` table (added in Plan 34-01). Drives:
 *   - the render-branch in OnboardingFlow.tsx (consumer vs org renderer)
 *   - the AnonymousPreviewView surface mounted at the `/onboard` path-route
 *
 * Status state machine:
 *   'loading'   — initial state while async query is in-flight
 *   'preview'   — no signed-in user → anonymous preview (cookie-bootstrapped
 *                 by AnonymousPreviewLayer); flow.config may still be loaded
 *                 so we can render the same step library pre-signup
 *   'consumer'  — authenticated user with `completed_onboarding_at IS NULL`
 *   'completed' — authenticated user with `completed_onboarding_at IS NOT NULL`
 *
 * D-19/D-20 PostHog A/B variant resolution:
 *   - `posthog.onFeatureFlags()` callback signals flags-resolved (Pitfall 9 race);
 *     we wrap it with a 2-second timeout fallback so a PostHog outage cannot
 *     hang the entire onboarding surface (CLAUDE.md local-first invariant).
 *   - The 'onboarding-ab' flag payload, when present and shaped `{ version_id }`,
 *     selects a specific `onboarding_flows.id`. Otherwise the default `.eq('is_active', true)`
 *     row is loaded.
 *
 * Fail-open: ANY error → status='preview' (anonymous) or 'consumer' (authed) with
 * `flow=null` so the renderer's DEFAULT_STEPS fallback can render. Never throws.
 */

import { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import type { OnboardingStepNode } from '@/types/onboarding-step';

export type ConsumerOnboardingStatus = 'loading' | 'preview' | 'consumer' | 'completed';

export interface ConsumerOnboardingFlow {
  id: string;
  config: OnboardingStepNode[];
  version: number;
  variant_id: string | null;
}

export interface ConsumerOnboardingFlowState {
  status: ConsumerOnboardingStatus;
  flow: ConsumerOnboardingFlow | null;
}

const INITIAL_STATE: ConsumerOnboardingFlowState = { status: 'loading', flow: null };

/**
 * Resolve PostHog feature flags before reading payload.
 *
 * Pitfall 9 (34-RESEARCH): `posthog.getFeatureFlagPayload()` returns undefined
 * before /flags/ resolves; reading it eagerly on mount produces a stale
 * "no payload" result that locks every user into the control variant.
 *
 * `posthog.onFeatureFlags()` fires synchronously if flags are already resolved,
 * else fires once they land. We add a 2-second cap so a network failure or
 * blocked /flags/ request cannot wedge the loading state forever.
 */
function waitForFeatureFlags(): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    try {
      posthog.onFeatureFlags(() => finish());
    } catch {
      finish();
    }
    setTimeout(finish, 2000);
  });
}

export function useConsumerOnboardingFlow(): ConsumerOnboardingFlowState {
  const signedInUser = useStore((s) => s.signedIn?.user ?? null);
  const localUser = useStore((s) => s.user);
  const [state, setState] = useState<ConsumerOnboardingFlowState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        // ───── Phase 1: completion check for signed-in users ───────────────
        if (signedInUser?.id) {
          const { data: prof, error: profErr } = await supabase
            .from('profiles')
            .select('completed_onboarding_at')
            .eq('id', signedInUser.id)
            .maybeSingle();
          if (cancelled) return;
          if (!profErr && prof?.completed_onboarding_at != null) {
            setState({ status: 'completed', flow: null });
            return;
          }
        }

        // ───── Phase 2: resolve PostHog A/B variant ────────────────────────
        await waitForFeatureFlags();
        if (cancelled) return;

        let versionId: string | null = null;
        try {
          const payload = posthog.getFeatureFlagPayload('onboarding-ab');
          if (
            payload &&
            typeof payload === 'object' &&
            'version_id' in (payload as Record<string, unknown>)
          ) {
            const v = (payload as { version_id: unknown }).version_id;
            if (typeof v === 'string' && v.length > 0) versionId = v;
          }
        } catch {
          /* fall back to is_active row */
        }

        // ───── Phase 3: load the onboarding_flows row ──────────────────────
        const base = supabase.from('onboarding_flows').select('id, config, version');
        const { data: flowRow, error: flowErr } = versionId
          ? await base.eq('id', versionId).maybeSingle()
          : await base.eq('is_active', true).maybeSingle();
        if (cancelled) return;

        const status: ConsumerOnboardingStatus = signedInUser ? 'consumer' : 'preview';

        if (flowErr || !flowRow) {
          setState({ status, flow: null });
          return;
        }

        const row = flowRow as { id: string; config: unknown; version: number };
        setState({
          status,
          flow: {
            id: row.id,
            config: Array.isArray(row.config) ? (row.config as OnboardingStepNode[]) : [],
            version: row.version,
            variant_id: versionId,
          },
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[useConsumerOnboardingFlow] fail-open:', err);
        setState({ status: signedInUser ? 'consumer' : 'preview', flow: null });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
    // localUser?.id included so post-signup transitions re-evaluate the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUser?.id, localUser?.id]);

  return state;
}
