/**
 * Server-side RAG event capture helper (Phase 50 Plan 50-03 Task 3).
 *
 * Scope note: This module is a TYPED HELPER intended for consumption by Edge
 * Functions (Deno runtime under supabase/functions/_shared/). The orchestrator
 * for this plan explicitly directed `No supabase/ touches`, so the
 * implementation lives in src/lib/posthog/ and exports the same typed
 * `captureRagEvent` signature + PHI-scrub + shutdown-await semantics. A
 * follow-up plan (50-06 / 50-08) will inline this helper into a Deno-runtime
 * file under supabase/functions/_shared/posthog-server.ts at that time.
 *
 * Contract:
 * - Compile-time enforcement of registered event names via a union literal
 *   matched against src/lib/analytics/events.ts (server_only: true subset +
 *   the two admin-side events that are also captured server-side from cron:
 *   rag_scrape_run, rag_chunk_published).
 * - Defensive PHI scrub: user_id / patient_id are stripped from properties
 *   before capture, even though the event registry declares phi:false.
 * - `await ph.shutdown()` MANDATORY per Phase 24 D-13 — Edge Fns die
 *   immediately after the request; without an awaited flush, events are lost
 *   in transit.
 * - Throws on empty distinctId — server-side events MUST attach to a user.
 *
 * Posthog client injection: the factory is a parameter (rather than imported
 * statically) so that:
 *   1. Tests can inject a mock PostHogClientLike.
 *   2. The Deno-runtime port can swap in `import { PostHog } from
 *      'https://esm.sh/posthog-node'` without touching the call site.
 */

/** Minimal client surface this helper depends on. */
export interface PostHogClientLike {
  capture(payload: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void;
  shutdown(): Promise<void> | void;
}

/** Factory signature — returns a connected PostHog client. */
export type PostHogServerFactory = () => PostHogClientLike;

/**
 * Compile-time-enforced event names for server-side RAG capture.
 *
 * Subset rationale:
 * - server_only: true events from the registry (D-34 ITP/uBlock resilience):
 *   rag_tip_impression, rag_tip_clicked, rag_citation_clicked, rag_hub_pageview
 * - cron-emitted admin events (run from Edge Fn scheduler, not browser):
 *   rag_scrape_run, rag_chunk_published
 */
export type RagServerEventName =
  | 'rag_tip_impression'
  | 'rag_tip_clicked'
  | 'rag_citation_clicked'
  | 'rag_hub_pageview'
  | 'rag_scrape_run'
  | 'rag_chunk_published';

/**
 * PHI keys that must NEVER reach PostHog from the server-side helper.
 * Defensive scrub — the registry says phi:false but a caller may
 * accidentally pass a join row containing user_id/patient_id.
 */
const PHI_KEYS = ['user_id', 'patient_id'] as const;

/**
 * Strip PHI keys from a property bag (defensive layer atop the events.phi.ts
 * import-zone rule).
 */
export function scrubPhi(properties: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if ((PHI_KEYS as readonly string[]).includes(key)) continue;
    scrubbed[key] = value;
  }
  return scrubbed;
}

/**
 * Capture a server-only RAG event.
 *
 * @param distinctId  Stable user identifier (UUID). Throws if empty.
 * @param name        Registered RAG event name (compile-time-enforced).
 * @param properties  Event-specific properties; user_id / patient_id stripped.
 * @param factory     PostHog client factory. Defaults to the Edge-Fn factory
 *                    when ported; tests pass an injected mock.
 *
 * Invariants:
 * - `await ph.shutdown()` is always awaited (D-13).
 * - shutdown() runs even if capture() throws (try/finally).
 */
export async function captureRagEvent(
  distinctId: string,
  name: RagServerEventName,
  properties: Record<string, unknown>,
  factory: PostHogServerFactory,
): Promise<void> {
  if (!distinctId || distinctId.trim() === '') {
    throw new Error(
      'captureRagEvent: distinctId is required — server-side events MUST attach to a user',
    );
  }

  const cleaned = scrubPhi(properties);
  const ph = factory();
  try {
    ph.capture({ distinctId, event: name, properties: cleaned });
  } finally {
    // D-13 mandate — Edge Fn dies right after the request, flush MUST complete.
    await ph.shutdown();
  }
}
