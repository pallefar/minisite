/**
 * Phase 40 Plan 40-06 — PostHog Ship-Winner variant scaffold.
 *
 * Wires D-22 PostHog Experiments + Ship-Winner pattern from Phase 34/35.
 *
 * v1.3 COLD-START: returns null. No variants are active yet.
 * The cancellation_offers_log.posthog_variant_id column is persisted for
 * future-phase activation — per F-40-02 and RESEARCH Open Q5.
 *
 * v1.4 activation path (NOT implemented here):
 *   1. Admin creates PostHog experiment 'cancellation_save_flow_variant'.
 *   2. Replace the null-return body with a PostHog server-side flag fetch
 *      (MUST be server-side to prevent variant_id spoofing — see T-40-06-06).
 *   3. Pass the resolved variant_id in the DecideOfferRequest body to
 *      cancellation-decide-offer Fn, which stores it in posthog_variant_id.
 *   4. ROI dashboard automatically groups by variant_id once data accumulates.
 *
 * Spoofing mitigation (T-40-06-06): v1.4 MUST resolve the variant server-side
 * via the PostHog server API, NOT from the client's posthog.getFeatureFlag()
 * (per Phase 34 D-20 Ship-Winner pattern). Client-provided variant_id would
 * allow users to self-select into any variant, poisoning the experiment.
 */

export interface CancellationVariant {
  variant_id: string;
  variant_name: string;
}

/**
 * Returns the active cancellation save-flow experiment variant for the current
 * user session, or null if no experiment is active.
 *
 * v1.3 COLD-START: always returns null.
 * v1.4+: replace body with PostHog server-side flag resolution.
 */
export async function getActiveCancellationVariant(): Promise<CancellationVariant | null> {
  // v1.3 cold-start: no variants active.
  // The posthog_variant_id column on cancellation_offers_log is ready
  // for variant attribution once Ship-Winner experiments are configured.
  // Per F-40-02: variant attribution is future-work-ready, not v1.3-ship-blocking.
  return null;
}

/**
 * Extracts the variant_id string for use in cancellation API calls.
 * Returns null if no variant is active (v1.3 cold-start).
 */
export async function getCancellationVariantId(): Promise<string | null> {
  const variant = await getActiveCancellationVariant();
  return variant?.variant_id ?? null;
}
