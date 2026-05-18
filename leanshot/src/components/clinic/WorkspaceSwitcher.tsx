/**
 * Phase 28 Plan 03 Task 3 — Clinic WorkspaceSwitcher with JWT propagation UX.
 *
 * Wraps the layout WorkspaceSwitcher with a JWT claim propagation hook that
 * shows a spinner while app_metadata.org_ids reflects the newly-switched org
 * and surfaces a Retry affordance if propagation stalls past 600ms + probe fail
 * (per CONTEXT D-10, Pitfall 5 / T-28-03-05).
 *
 * Propagation flow (per D-10):
 *   1. Optimistically update target org state.
 *   2. Call supabase.auth.refreshSession() to mint a new token (hook runs).
 *   3. Poll supabase.auth.getSession() every 100ms; check org_ids.includes(targetOrgId).
 *   4. If org_id found before 600ms → propagated=true → hide spinner.
 *   5. If 600ms elapses without hit → fallback freshness probe:
 *      supabase.from('org_members').select('org_id').eq('org_id', targetOrgId).limit(1)
 *      - Row exists → propagated=true (claim eventually consistent; hide spinner)
 *      - No row    → needsRetry=true (render explicit Retry button; no silent forever-loading)
 *
 * Security note: JWT claim is a client-side UX hint only. RLS USING clauses on
 * org_members query org_members directly at request-time (per Plan 01) — JWT is
 * never the security gate. Hook + propagation window = UX defense-in-depth only.
 */

import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// useWorkspaceJwtPropagation hook
// ---------------------------------------------------------------------------

export interface WorkspaceJwtPropagationResult {
  /** True when app_metadata.org_ids includes targetOrgId (or probe confirmed membership). */
  propagated: boolean;
  /** True when 600ms elapsed AND freshness probe returned no row. Shows Retry button. */
  needsRetry: boolean;
}

const POLL_INTERVAL_MS = 100;
const PROPAGATION_CEILING_MS = 600;

/**
 * Polls supabase.auth.getSession() every 100ms up to 600ms for targetOrgId to
 * appear in app_metadata.org_ids. Falls back to a direct org_members probe.
 * Returns { propagated, needsRetry }.
 *
 * When targetOrgId is null, immediately returns { propagated: true, needsRetry: false }.
 */
export function useWorkspaceJwtPropagation(
  targetOrgId: string | null,
): WorkspaceJwtPropagationResult {
  const [propagated, setPropagated] = useState<boolean>(true);
  const [needsRetry, setNeedsRetry] = useState<boolean>(false);
  // Increment key forces effect re-run on manual retry.
  const [retryKey, setRetryKey] = useState<number>(0);

  useEffect(() => {
    if (!targetOrgId) {
      setPropagated(true);
      setNeedsRetry(false);
      return;
    }

    // Reset on new targetOrgId or manual retry.
    setPropagated(false);
    setNeedsRetry(false);

    let cancelled = false;
    const start = Date.now();

    const tick = async (): Promise<void> => {
      if (cancelled) return;

      // Check if claim already reflects targetOrgId.
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      const orgIds =
        (
          session?.user.app_metadata as
            | { org_ids?: string[] }
            | undefined
        )?.org_ids ?? [];

      if (orgIds.includes(targetOrgId)) {
        if (!cancelled) setPropagated(true);
        return;
      }

      // Check ceiling.
      if (Date.now() - start >= PROPAGATION_CEILING_MS) {
        // Fallback freshness probe: query org_members directly.
        const { data: probeData } = await supabase
          .from('org_members')
          .select('org_id')
          .eq('org_id', targetOrgId)
          .limit(1);

        if (!cancelled) {
          if (probeData && probeData.length > 0) {
            // Member row exists → claim eventually consistent; consider propagated.
            setPropagated(true);
          } else {
            // Probe returned no row → membership may have been revoked mid-flight.
            setNeedsRetry(true);
          }
        }
        return;
      }

      // Schedule next poll.
      setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
    };
   
  }, [targetOrgId, retryKey]);

  const retry = useCallback(() => {
    setNeedsRetry(false);
    setPropagated(false);
    setRetryKey((k) => k + 1);
  }, []);

  return { propagated, needsRetry, ...(needsRetry ? { _retry: retry } : {}) } as WorkspaceJwtPropagationResult & { _retry?: () => void };
}

// ---------------------------------------------------------------------------
// ClinicWorkspaceSwitcherJwtOverlay — renders spinner or retry on top of the
// workspace switcher chip while JWT propagation is in-flight.
// ---------------------------------------------------------------------------

export interface ClinicWorkspaceSwitcherJwtOverlayProps {
  /** The org_id to wait for in app_metadata.org_ids. Null means no propagation needed. */
  targetOrgId: string | null;
  className?: string;
}

/**
 * Overlay component that displays a JWT propagation spinner (or Retry button)
 * adjacent to the workspace switcher. Renders nothing when targetOrgId is null
 * or when propagation has completed.
 */
export function ClinicWorkspaceSwitcherJwtOverlay({
  targetOrgId,
  className,
}: ClinicWorkspaceSwitcherJwtOverlayProps) {
  const result = useWorkspaceJwtPropagation(targetOrgId) as WorkspaceJwtPropagationResult & {
    _retry?: () => void;
  };
  const { propagated, needsRetry } = result;
  const retry = result._retry;

  // Nothing to show when propagated or no targetOrgId.
  if (!targetOrgId || propagated) return null;

  if (needsRetry) {
    return (
      <button
        type="button"
        data-testid="ws-retry"
        onClick={retry}
        className={cn(
          'inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-danger)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1',
          className,
        )}
      >
        Retry
      </button>
    );
  }

  return (
    <Spinner
      size="xs"
      data-testid="ws-jwt-spinner"
      label="Waiting for workspace JWT claim"
      className={cn('ms-1', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// useWorkspaceSwitchWithRefresh — convenience hook for triggering a session
// refresh (hook re-run) on workspace switch.
// ---------------------------------------------------------------------------

/**
 * Triggers supabase.auth.refreshSession() to force the Custom Access Token
 * Hook to re-run and mint a new JWT with the updated app_metadata.org_ids.
 *
 * Call this after navigating to a new workspace so the propagation hook
 * picks up the freshly-minted claim.
 */
export async function triggerWorkspaceSessionRefresh(): Promise<void> {
  try {
    await supabase.auth.refreshSession();
  } catch {
    // Session refresh failure is non-fatal for UX — the propagation hook
    // will fall back to the freshness probe after 600ms.
  }
}
