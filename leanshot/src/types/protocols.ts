/**
 * Phase 61 — Protocol types shared across admin authoring + patient consumer surfaces.
 *
 * These types mirror the DB schema from 61-01 migrations:
 *   protocols, protocol_steps, protocol_evidence, patient_protocol_assignment
 */

export type ProtocolStatus = 'draft' | 'in_review' | 'published' | 'archived';
export type ProtocolAudience = 'b2c' | 'clinic' | 'both';

export interface Protocol {
  id: string;
  version: number;
  name: string;
  compound: string;
  /** Audiences this protocol is intended for */
  audience: string[];
  /** URL-friendly slug derived from name + version */
  slug: string;
  /** Base slug (without version suffix) used for /protocols/<base_slug> routing */
  base_slug: string;
  review_state: ProtocolStatus;
  created_by: string | null;
  reviewed_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProtocolStep {
  id: string;
  protocol_id: string;
  protocol_version: number;
  /** 1-based week number */
  week: number;
  /** Expected dose in milligrams */
  dose_mg: number;
  frequency: 'daily' | 'weekly' | 'bi-weekly' | string;
  /** Monitoring items required this week */
  monitoring: string[];
  notes: string | null;
}

export interface ProtocolEvidence {
  id: string;
  protocol_id: string;
  step_id: string;
  citation_text: string;
  rag_source_id: string | null;
  verbatim_quote: string | null;
}

export interface PatientProtocolAssignment {
  id: string;
  patient_id: string;
  protocol_id: string;
  /** Protocol version at time of assignment */
  version: number;
  /** ISO datetime when the protocol started for this patient */
  started_at: string;
  created_at: string;
}
