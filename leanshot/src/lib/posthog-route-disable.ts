/**
 * useSessionReplayPhiGuard — Phase 25 Plan 25-07 (HIPAA-06 + HIPAA-17).
 *
 * RESEARCH correction #1: posthog-js does NOT have a `disable_session_recording_on_url`
 * config option (CONTEXT D-16 was wrong). The actual mechanism is:
 *  1. `disable_session_recording: true` global default in posthog.init (src/lib/analytics.ts).
 *  2. This hook calls `posthog.startSessionRecording()` only on non-PHI routes;
 *     calls `posthog.stopSessionRecording()` when entering PHI routes.
 *
 * LeanShot-specific: this app uses Zustand currentTab + window.location for
 * routing (no router library). The hook checks BOTH the synthetic tab-route
 * AND window.location.pathname so it works for current consumer tabs +
 * future Phase 28 clinical URL surfaces.
 *
 * Per [[project_phase5_bundle_regression]] posthog-js is dynamically imported
 * so it stays out of the entry static graph and off the 50 kB gz index ceiling.
 */
import { useEffect } from 'react';

import { useStore } from '@/lib/store';
import type { TabId } from '@/types/index';

/**
 * PHI URL deny-list regex.
 *
 * Path-segment coverage:
 * - /clinic        — Phase 25 HIPAA-17 (clinic operator surface; per-patient PHI in DOM)
 * - /patient       — Phase 25 HIPAA-17 (patient detail views)
 * - /admin/users   — Phase 25 HIPAA-17 (admin user lookup includes email + auth events)
 * - /dose-log      — Phase 25 HIPAA-17 (medication dose history; pharmacology PHI)
 * - /share         — Phase 25 HIPAA-17 (read-share links can render PHI in URL token)
 * - /auth          — Phase 25 HIPAA-17 (auth flows include tokens in URL fragments)
 *
 * Boundary safety: `(\/|$)` ensures `/clinicians` does NOT match `/clinic`.
 * Case-insensitive (`i`) for server-side rewrite tolerance.
 *
 * HIPAA-17 traceability: edits to this regex MUST carry phase + decision ID
 * in the commit message so the audit log can reconstruct the deny-list lineage.
 */
export const PHI_URL_REGEX = /^\/(clinic|patient|admin\/users|dose-log|share|auth)(\/|$)/i;

/**
 * Map Zustand currentTab values to synthetic route prefixes the regex understands.
 *
 * EXTEND when new PHI-bearing tabs ship.
 * Verified against src/types/index.ts TabId enum
 * ('home'|'medication'|'symptoms'|'body'|'nutrition'|'activity'|'supplements'|'mood'|'insights').
 */
const TAB_TO_SYNTHETIC_ROUTE: Partial<Record<TabId, string>> = {
  medication: '/dose-log',
  // TODO Phase 28: 'share' and 'doctor-report' are modals (in-tab useState in App.tsx),
  // not TabId values. Wire via a Zustand currentSensitiveModal flag
  // ('share' | 'doctor-report' | null) when Phase 28 introduces real /share/* URL
  // surfaces. The PHI_URL_REGEX already matches /share/* on the URL side; this map
  // only needs an entry once the modal layer exposes a stable TabId/key.
};

/** Returns true when the current tab or pathname matches a PHI surface. */
function isPhiRoute(currentTab: string, pathname: string): boolean {
  // URL-based check (handles current auth callbacks + future Phase 28 clinical URLs)
  if (PHI_URL_REGEX.test(pathname)) return true;
  // Zustand tab → synthetic route check (handles current consumer tab PHI surfaces)
  const synthetic = TAB_TO_SYNTHETIC_ROUTE[currentTab as TabId];
  if (synthetic !== undefined && PHI_URL_REGEX.test(synthetic)) return true;
  return false;
}

// Module-level memoization to deduplicate redundant start/stop calls.
// Reset via __test.reset() between test cases.
let lastDecision: boolean | null = null;

/** Programmatically start/stop PostHog session recording based on PHI status. */
async function applyDecision(isPhi: boolean): Promise<void> {
  if (lastDecision === isPhi) return; // dedupe: same decision twice → no-op
  lastDecision = isPhi;
  try {
    // Dynamic import preserves bundle budget (per project_phase5_bundle_regression):
    // posthog-js stays in vendor-telemetry chunk, off the index static graph.
    const { default: posthog } = await import('posthog-js');
    if (isPhi) {
      posthog.stopSessionRecording();
    } else {
      posthog.startSessionRecording();
    }
  } catch {
    // Dynamic import failure (ad-blocker, network error) — silently no-op.
    // Fail-closed: if posthog-js never loads, recording never starts (D-04).
    // Reset lastDecision so next mount can retry.
    lastDecision = null;
  }
}

/**
 * Subscribes to Zustand currentTab changes + window popstate events,
 * calling posthog.stopSessionRecording() on PHI routes and
 * posthog.startSessionRecording() on non-PHI routes.
 *
 * Must be called at the TOP of the App() component (before any view renders)
 * so the guard is active for every user session including auth callbacks.
 */
export function useSessionReplayPhiGuard(): void {
  const currentTab = useStore((s) => s.currentTab);

  // Re-evaluate on every currentTab change (covers tab-navigation within dashboard)
  useEffect(() => {
    const decision = isPhiRoute(currentTab, window.location.pathname);
    void applyDecision(decision);
  }, [currentTab]);

  // Re-evaluate on browser history navigation (covers /auth/* callback URLs)
  useEffect(() => {
    function onLocationChange(): void {
      const decision = isPhiRoute(
        useStore.getState().currentTab,
        window.location.pathname,
      );
      void applyDecision(decision);
    }
    window.addEventListener('popstate', onLocationChange);
    return () => window.removeEventListener('popstate', onLocationChange);
  }, []);
}

/**
 * Test seam — exported ONLY for unit tests.
 * - `reset()`: clears the lastDecision memo so test cases don't bleed state.
 * - `isPhiRoute`: exposes the pure function for boundary testing without React.
 * - `applyDecision`: exposes the async posthog call for routing assertions.
 */
export const __test = {
  reset: () => {
    lastDecision = null;
  },
  isPhiRoute,
  applyDecision,
};

/**
 * Phase 37 Plan 06 D-17 — public PHI-route check for the helpdesk widget.
 *
 * Returns true when the given pathname is a PHI-bearing route. The widget
 * renders in KB-only mode on PHI routes — no ticket form, no realtime channel,
 * no AI suggestions — to keep PHI off any third-party telemetry path that
 * might attach to user inputs (Sentry replay, PostHog session recording).
 *
 * Single source of truth: this helper reads PHI_URL_REGEX (HIPAA-17). Do NOT
 * duplicate the regex inside the helpdesk module.
 */
export function isPhiRoutePath(
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : '/',
): boolean {
  return PHI_URL_REGEX.test(pathname);
}
