/**
 * posthog-rag-events.ts — Typed Phase 60 RAG event emitters for Supabase Edge Functions.
 *
 * Phase 60 Plan 60-02. AI-SPEC §7 event catalog.
 *
 * Wraps `_shared/posthog-server.ts` to provide typed emitter functions for
 * all 8 Phase 60 RAG PostHog events. Consumers MUST NOT hand-roll
 * `captureServer({ event: 'rag_...' })` — import from this file instead.
 *
 * CRITICAL: consumers MUST still call `await shutdownPostHog()` in a
 * try/finally before returning their Response — this file re-exports that
 * function for single-import convenience, but does NOT wrap it.
 *
 * Defense-in-depth PHI scrub: every emitter strips `user_id`, `patient_id`,
 * `email`, `phone` from properties BEFORE forwarding to posthog-server.ts.
 * `captureRagEvent` already strips `user_id`/`patient_id`; this layer extends
 * coverage to `email`/`phone` because Phase 60 federated adapters and
 * newsletter-subscriber rows may inadvertently carry those fields.
 *
 * D-13 user-attribution invariant: user-attributed events (`$ai_generation`,
 * `$ai_evaluation`, `rag_refusal_emitted`) REQUIRE a non-empty `userId`.
 * Passing an empty string throws `Error('userId required for user-attributed event …')`.
 * System-attributed events (all others) default to `distinctId: 'rag-system'`
 * via `captureRagEvent`.
 */

import { captureRagEvent, captureServer, shutdownPostHog } from './posthog-server.ts';

// Re-export so downstream Fns can import both emitters + shutdown from one line.
export { shutdownPostHog };

// ──────────────────────────────────────────────────────────────────────────────
// Phase 60 typed event catalog (AI-SPEC §7 lines 936-943)
// ──────────────────────────────────────────────────────────────────────────────

/** Discriminated-union of all 8 Phase 60 RAG event names (AI-SPEC §7). */
export type Phase60RagEvent =
  | '$ai_generation'
  | '$ai_evaluation'
  | 'rag_citation_validation_failed'
  | 'rag_refusal_emitted'
  | 'rag_cost_envelope_breach'
  | 'rag_kanon_floor_dropped'
  | 'rag_stale_evidence_flagged'
  | 'rag_ai04_fence_breach';

// ──────────────────────────────────────────────────────────────────────────────
// Per-event typed payload interfaces (AI-SPEC §6 + §7)
// ──────────────────────────────────────────────────────────────────────────────

export interface AiGenerationProperties {
  model: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  usage_total_cost?: number;
  latency_ms?: number;
  trace_id: string;
  surface?: 'coach' | 'tip_of_day' | 'newsletter' | 'public_knowledge_hub';
  reranker_provider?: 'cohere' | 'jina' | 'none';
  [key: string]: unknown;
}

export interface AiEvaluationProperties {
  dimension: string;
  score: number;
  trace_id: string;
  sample_id?: string;
  judge_model?: string;
  [key: string]: unknown;
}

export interface CitationValidationFailedProperties {
  reason: string;
  chunk_id?: string;
  trace_id: string;
  [key: string]: unknown;
}

export interface RefusalEmittedProperties {
  refusal_reason: 'out_of_corpus' | 'pharma_02_carveout' | 'safety';
  surface: 'coach' | 'tip_of_day' | 'newsletter';
  trace_id: string;
  [key: string]: unknown;
}

export interface CostEnvelopeBreachProperties {
  scope: 'per_request' | 'per_cron';
  cron_kind?: 'tip_of_day' | 'newsletter' | 'federated_sync';
  cost_usd: number;
  envelope_usd: number;
  trace_id: string;
  [key: string]: unknown;
}

export interface KanonFloorDroppedProperties {
  chunk_id?: string;
  source_type: 'leanshot_research' | 'community';
  cohort_n: number;
  surface: string;
  [key: string]: unknown;
}

export interface StaleEvidenceFlaggedProperties {
  chunk_id: string;
  evidence_date: string;
  source_type: string;
  trace_id?: string;
  [key: string]: unknown;
}

export interface Ai04FenceBreachProperties {
  trace_id: string;
  surface?: string;
  [key: string]: unknown;
}

// ──────────────────────────────────────────────────────────────────────────────
// PHI scrub + routing helpers (internal)
// ──────────────────────────────────────────────────────────────────────────────

const PHI_FIELDS = ['user_id', 'patient_id', 'email', 'phone'] as const;

/**
 * Defensively shallow-clone and strip PHI fields from properties.
 * Exported for test-seam use only — NOT a public API.
 * @internal
 */
export function _testScrubProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const scrubbed = { ...properties };
  for (const field of PHI_FIELDS) {
    delete scrubbed[field];
  }
  return scrubbed;
}

const USER_ATTRIBUTED_EVENTS: ReadonlySet<Phase60RagEvent> = new Set([
  '$ai_generation',
  '$ai_evaluation',
  'rag_refusal_emitted',
]);

function emitEvent(
  name: Phase60RagEvent,
  properties: Record<string, unknown>,
  userId?: string,
): void {
  const scrubbed = _testScrubProperties(properties);

  if (USER_ATTRIBUTED_EVENTS.has(name)) {
    if (!userId) {
      throw new Error(`[posthog-rag-events] userId required for user-attributed event ${name} (D-13)`);
    }
    captureServer({ userId, event: name, properties: scrubbed });
  } else if (userId) {
    // User-provided but not required: use captureServer for dual-write
    captureServer({ userId, event: name, properties: scrubbed });
  } else {
    captureRagEvent({ distinctId: 'rag-system', name, properties: scrubbed });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Typed emitter functions (AI-SPEC §7 — one per event)
// ──────────────────────────────────────────────────────────────────────────────

/** Emit `$ai_generation` — every Anthropic/OpenAI/Cohere call. userId REQUIRED (D-13). */
export function emitAiGeneration(args: {
  userId: string;
  properties: AiGenerationProperties;
}): void {
  emitEvent('$ai_generation', args.properties as Record<string, unknown>, args.userId);
}

/** Emit `$ai_evaluation` — every LLM-judge rubric score. userId REQUIRED (D-13). */
export function emitAiEvaluation(args: {
  userId: string;
  properties: AiEvaluationProperties;
}): void {
  emitEvent('$ai_evaluation', args.properties as Record<string, unknown>, args.userId);
}

/** Emit `rag_citation_validation_failed` — every G5 fail-closed refusal. */
export function emitCitationValidationFailed(args: {
  properties: CitationValidationFailedProperties;
  userId?: string;
}): void {
  emitEvent('rag_citation_validation_failed', args.properties as Record<string, unknown>, args.userId);
}

/** Emit `rag_refusal_emitted` — every G3/G4/G1/G9 refusal. userId REQUIRED (D-13). */
export function emitRefusalEmitted(args: {
  userId: string;
  properties: RefusalEmittedProperties;
}): void {
  emitEvent('rag_refusal_emitted', args.properties as Record<string, unknown>, args.userId);
}

/** Emit `rag_cost_envelope_breach` — every G6/G7 cost breach. System-attributed (no userId needed). */
export function emitCostEnvelopeBreach(args: {
  properties: CostEnvelopeBreachProperties;
  userId?: string;
}): void {
  emitEvent('rag_cost_envelope_breach', args.properties as Record<string, unknown>, args.userId);
}

/** Emit `rag_kanon_floor_dropped` — every G8 chunk drop. System-attributed. */
export function emitKanonFloorDropped(args: {
  properties: KanonFloorDroppedProperties;
  userId?: string;
}): void {
  emitEvent('rag_kanon_floor_dropped', args.properties as Record<string, unknown>, args.userId);
}

/** Emit `rag_stale_evidence_flagged` — every G10 stale-flag. System-attributed. */
export function emitStaleEvidenceFlagged(args: {
  properties: StaleEvidenceFlaggedProperties;
  userId?: string;
}): void {
  emitEvent('rag_stale_evidence_flagged', args.properties as Record<string, unknown>, args.userId);
}

/** Emit `rag_ai04_fence_breach` — every G2 PII-leak interception. System-attributed. */
export function emitAi04FenceBreach(args: {
  properties: Ai04FenceBreachProperties;
  userId?: string;
}): void {
  emitEvent('rag_ai04_fence_breach', args.properties as Record<string, unknown>, args.userId);
}
