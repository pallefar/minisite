/**
 * Protocol domain types for Phase 61 admin protocol creator.
 *
 * These interfaces mirror the DB column shapes in:
 *   supabase/migrations/20260526000001_protocol_tables.sql
 *
 * Consumed by: Plans 04 (admin core UI), 05 (admin editor UI),
 *              06 (clinic adopt flow), 07 (patient KB), 03 (Edge Fn).
 *
 * IMPORTANT: Do not widen these interfaces without a corresponding
 * migration — they are the single source of truth for DB ↔ UI contracts.
 */

/** State machine for protocol review workflow (mirrors ENUM protocol_review_state). */
export type ProtocolReviewState = 'draft' | 'in_review' | 'published' | 'archived';

/** Dosing frequency options for a protocol step. */
export type ProtocolFrequency = 'daily' | 'weekly' | 'bi-weekly' | 'custom-cron';

/** Monitoring parameters tracked alongside each protocol step. */
export type ProtocolMonitoringKey = 'weight' | 'glucose' | 'bp' | 'mood' | 'gi-symptoms';

/**
 * A versioned dosing protocol.
 * Row-per-version: composite PK (id, version) means each edit creates a new row.
 * base_slug stores the slug WITHOUT '-vN'; slug is computed as base_slug + '-v' + version.
 */
export interface Protocol {
  id: string; // uuid
  version: number; // int, monotonic per id
  name: string;
  compound: string;
  audience: string[]; // ['B2C', 'clinic'] subset
  base_slug: string; // slug WITHOUT version suffix (for /protocols/<slug> public route)
  slug: string; // computed: base_slug + '-v' + version
  review_state: ProtocolReviewState;
  created_by: string | null;
  reviewed_by: string | null;
  published_at: string | null; // ISO timestamptz
  reviewed_at: string | null;
  created_at: string;
  updated_at: string; // ISO timestamptz; set by tg_set_updated_at trigger
}

/**
 * A per-week titration step within a protocol version.
 * monitoring is text[] storing ProtocolMonitoringKey values (MVP simplicity; no lookup table).
 */
export interface ProtocolStep {
  id: string;
  protocol_id: string;
  protocol_version: number;
  week: number;
  dose_mg: number;
  frequency: ProtocolFrequency;
  cron_string: string | null; // populated only when frequency='custom-cron'
  monitoring: ProtocolMonitoringKey[];
}

/**
 * RAG-cited evidence attached to a specific protocol step.
 * step_id is NOT NULL — protocol-level-only attach is disallowed by schema.
 * rag_source_id has no FK — RAG chunks may be retracted; audit trail preserved.
 */
export interface ProtocolEvidence {
  id: string;
  protocol_id: string;
  step_id: string; // NOT NULL — step-level granularity mandatory
  citation_text: string;
  rag_source_id: string; // references rag-curated chunk
  verbatim_quote: string;
  created_at: string;
}

/**
 * Append-only audit row written on every protocol state transition.
 * action mirrors the CHECK constraint on protocol_review_log.action.
 */
export interface ProtocolReviewLogRow {
  id: string;
  protocol_id: string;
  version: number;
  actor: string;
  action: 'submitted_for_review' | 'published' | 'archived' | 'rolled_back' | 'retracted';
  at: string;
}

/**
 * Clinician-to-patient protocol assignment.
 * Composite PK (patient_id, protocol_id) — idempotent on re-assign (upserts version on conflict).
 * NO `id` or `created_at` columns — schema is intentionally compact.
 */
export interface PatientProtocolAssignment {
  patient_id: string;
  protocol_id: string;
  version: number;
  started_at: string;
}

/**
 * Row in admin_ai_assist_log — rate-limit + audit for AI-assist calls.
 * Rate limit: 50 suggestions per UTC-day per admin (actor_id).
 */
export interface AdminAiAssistLogRow {
  id: string;
  actor_id: string;
  protocol_id: string | null;
  step_week: number | null;
  compound: string;
  refusal: boolean;
  cited_chunk_count: number;
  created_at: string;
}

/**
 * Request shape sent to the protocol-ai-assist Edge Fn.
 * protocol_id is null when suggesting for a brand-new draft (no DB row yet).
 */
export interface AiAssistRequest {
  protocol_id: string | null; // null = new draft, no row yet
  step_week: number;
  compound: string;
  prior_steps_context: string;
}

/**
 * Response shape from the protocol-ai-assist Edge Fn.
 * refusal=true means no qualifying RAG evidence found (PHARMA-02 guard).
 */
export interface AiAssistResponse {
  dose_mg: number;
  monitoring: ProtocolMonitoringKey[];
  cited_chunk_ids: string[];
  refusal: boolean;
  refusal_reason?: string;
}
