/**
 * normalize.ts — OpenFDA → rag_chunks insert payload normalizer.
 *
 * Phase 60 Plan 60-07. Task 3.
 *
 * T-60-07-03 PII guard (CRITICAL):
 *   normalizeOpenFDADrugEvent uses an EXPLICIT FIELD ALLOWLIST (not denylist):
 *   Only these patient.drug fields are included in the excerpt:
 *     - patient.drug[].medicinalproduct
 *     - patient.drug[].drugindication
 *     - patient.reaction[].reactionmeddrapt
 *     - receivedate
 *     - safetyreportid
 *
 *   Fields NEVER included (even though in FDA data):
 *     patient.patientonsetage, patient.patientweight,
 *     patient.patientsex, patient.patientonsetagegroup
 *
 *   This is an allowlist-based approach: we explicitly declare what IS included
 *   rather than blocking specific fields. This prevents future FDA schema additions
 *   from inadvertently leaking new PII fields.
 *
 * AI-SPEC §1b regulatory: boxed warnings from drug labels MUST be preserved.
 *
 * Schema adaptation: uses rag_chunks actual schema (canonical_url, source_tier, etc.)
 * NOT the plan's kb_chunks_queue.
 *
 * [[T-60-07-03]] [[T-60-07-04]] PHARMA-02
 */

import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

export const SYSTEM_FEDERATED_UUID = '00000000-0000-0000-0000-000000000060';

// ──────────────────────────────────────────────────────────────────────────────
// rag_chunks insert payload type
// ──────────────────────────────────────────────────────────────────────────────

export interface RagChunkInsert {
  topic_id: string;
  source_id: string;
  canonical_url: string;
  source_text_excerpt: string;
  summary: string;
  content_hash: string;
  topic_tag: string;
  source_tier: 'A' | 'B' | 'C';
  status: 'queued';
  created_by: string;
  scraped_at: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Hash helper
// ──────────────────────────────────────────────────────────────────────────────

export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// Date parser for FDA effective_time (YYYYMMDD → Date)
// ──────────────────────────────────────────────────────────────────────────────

export function parseFdaEffectiveTime(s: string): string {
  // FDA uses YYYYMMDD format
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // Fallback: try ISO parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return s;
}

// ──────────────────────────────────────────────────────────────────────────────
// Drug Label (FDA SPL) Schema
// ──────────────────────────────────────────────────────────────────────────────

/**
 * OpenFDADrugLabelSchema — zod schema for FDA drug/label result.
 *
 * AI-SPEC §1b: missing effective_time would indicate stale-label drift — REQUIRED.
 * Boxed warning section preserved per regulatory mandate.
 */
export const OpenFDADrugLabelSchema = z.object({
  set_id: z.string().min(1),
  version: z.string().optional().default('1'),
  effective_time: z.string().min(8, 'effective_time required for stale-label drift detection'),
  openfda: z.object({
    brand_name: z.array(z.string()).optional().default([]),
    generic_name: z.array(z.string()).optional().default([]),
  }).optional().default({ brand_name: [], generic_name: [] }),
  // Boxed warning — AI-SPEC §1b regulatory: MUST preserve at chunk granularity
  boxed_warning: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  indications_and_usage: z.array(z.string()).optional(),
  dosage_and_administration: z.array(z.string()).optional(),
});

export type OpenFDADrugLabel = z.infer<typeof OpenFDADrugLabelSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Drug Event Schema
// ──────────────────────────────────────────────────────────────────────────────

/**
 * OpenFDADrugEventSchema — zod schema for FDA drug/event adverse event report.
 *
 * T-60-07-03: PII guard. patient-level demographics NOT in schema.
 * Only reaction terms, drug names, and administrative identifiers are included.
 */
export const OpenFDADrugEventSchema = z.object({
  safetyreportid: z.string().min(1),
  receivedate: z.string().min(8, 'receivedate required'),
  // Minimal drug records — NO patient demographic fields
  patient: z.object({
    drug: z.array(z.object({
      medicinalproduct: z.string().optional(),
      drugindication: z.string().optional(),
      // Explicitly NOT including: drugdosagetext, any weight/age/sex fields
    })).optional().default([]),
    reaction: z.array(z.object({
      reactionmeddrapt: z.string().optional(),
    })).optional().default([]),
    // Explicitly NOT validating/including: patientonsetage, patientweight,
    // patientsex, patientonsetagegroup — T-60-07-03 PII guard
  }),
});

export type OpenFDADrugEvent = z.infer<typeof OpenFDADrugEventSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Drug Label normalizer
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Map a validated OpenFDA drug/label record to a rag_chunks INSERT payload.
 *
 * source_text_excerpt = sections in order: Boxed Warning > Warnings > Indications > Dosage
 * Each section is labeled with '## <name>\n' heading; missing sections omitted.
 *
 * Per AI-SPEC §1b regulatory: boxed warning MUST be preserved.
 */
export async function normalizeOpenFDADrugLabel(
  label: OpenFDADrugLabel,
  topicTag: string,
  topicId: string,
  sourceId: string,
): Promise<RagChunkInsert> {
  // Build excerpt with section headings (missing sections omitted)
  const sections: string[] = [];
  if (label.boxed_warning && label.boxed_warning.length > 0) {
    sections.push(`## BOXED WARNING\n${label.boxed_warning.join('\n')}`);
  }
  if (label.warnings && label.warnings.length > 0) {
    sections.push(`## WARNINGS\n${label.warnings.join('\n')}`);
  }
  if (label.indications_and_usage && label.indications_and_usage.length > 0) {
    sections.push(`## INDICATIONS AND USAGE\n${label.indications_and_usage.join('\n')}`);
  }
  if (label.dosage_and_administration && label.dosage_and_administration.length > 0) {
    sections.push(`## DOSAGE AND ADMINISTRATION\n${label.dosage_and_administration.join('\n')}`);
  }

  const sourceTextExcerpt = sections.join('\n\n') || `FDA Drug Label: ${label.openfda?.generic_name?.[0] ?? label.set_id}`;
  const contentHash = await sha256Hex(sourceTextExcerpt);
  const evidenceDate = parseFdaEffectiveTime(label.effective_time);

  const genericName = label.openfda?.generic_name?.[0] ?? '';
  const brandName = label.openfda?.brand_name?.[0] ?? '';

  return {
    topic_id: topicId,
    source_id: sourceId,
    // FDA label URL pattern (set_id identifies the label document)
    canonical_url: `https://nctr-crs.fda.gov/fdalabel/services/spl/set-ids/${label.set_id}/spl-doc`,
    source_text_excerpt: sourceTextExcerpt,
    summary: `FDA Drug Label (${evidenceDate}): ${brandName || genericName || label.set_id}`.slice(0, 300),
    content_hash: contentHash,
    topic_tag: topicTag,
    source_tier: 'A',
    status: 'queued',
    created_by: SYSTEM_FEDERATED_UUID,
    scraped_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Drug Event normalizer
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Map a validated OpenFDA drug/event adverse event report to a rag_chunks INSERT payload.
 *
 * T-60-07-03 PII guard:
 *   EXPLICIT FIELD ALLOWLIST — only these fields make it into the excerpt:
 *     - patient.drug[].medicinalproduct
 *     - patient.drug[].drugindication
 *     - patient.reaction[].reactionmeddrapt
 *
 *   patient.patientonsetage, patient.patientweight, patient.patientsex,
 *   patient.patientonsetagegroup are NEVER accessed here. Even if the zod schema
 *   schema passthrough allowed them through, this normalizer only plucks the above
 *   fields explicitly. This is allowlist-based (not denylist-based) per AI-SPEC §6 G2.
 */
export async function normalizeOpenFDADrugEvent(
  event: OpenFDADrugEvent,
  topicTag: string,
  topicId: string,
  sourceId: string,
): Promise<RagChunkInsert> {
  // PII GUARD: EXPLICIT ALLOWLIST — only these fields from patient record
  // NEVER include: patientonsetage, patientweight, patientsex, patientonsetagegroup
  const drugLines = (event.patient.drug ?? [])
    .map((d) => {
      const parts: string[] = [];
      // Explicitly pluck ONLY medicinalproduct and drugindication
      if (d.medicinalproduct) parts.push(`Drug: ${d.medicinalproduct}`);
      if (d.drugindication) parts.push(`Indication: ${d.drugindication}`);
      return parts.join(', ');
    })
    .filter(Boolean);

  const reactionLines = (event.patient.reaction ?? [])
    .map((r) => r.reactionmeddrapt)
    .filter(Boolean) as string[];

  // Assemble excerpt from allowlisted fields only
  const excerptParts: string[] = [`Safety Report ID: ${event.safetyreportid}`];
  if (reactionLines.length > 0) {
    excerptParts.push(`Reactions: ${reactionLines.join('; ')}`);
  }
  if (drugLines.length > 0) {
    excerptParts.push(drugLines.join('\n'));
  }

  const sourceTextExcerpt = excerptParts.join('\n');
  const contentHash = await sha256Hex(sourceTextExcerpt);
  const evidenceDate = parseFdaEffectiveTime(event.receivedate);

  return {
    topic_id: topicId,
    source_id: sourceId,
    canonical_url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=`,
    source_text_excerpt: sourceTextExcerpt,
    summary: `FDA Adverse Event Report ${event.safetyreportid} (${evidenceDate}): ${reactionLines.slice(0, 3).join(', ')}`.slice(0, 300),
    content_hash: contentHash,
    topic_tag: topicTag,
    source_tier: 'A',
    status: 'queued',
    created_by: SYSTEM_FEDERATED_UUID,
    scraped_at: new Date().toISOString(),
  };
}
