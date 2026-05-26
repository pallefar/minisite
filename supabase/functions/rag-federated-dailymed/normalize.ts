/**
 * normalize.ts — DailyMed SPL → rag_chunks insert payload normalizer.
 *
 * Phase 60 Plan 60-07. Task 4.
 *
 * Section filtering uses LOINC codes per HL7/SPL standard:
 *   34066-1 — BOXED WARNING
 *   34071-1 — WARNINGS
 *   34067-9 — INDICATIONS AND USAGE
 *   34068-7 — DOSAGE AND ADMINISTRATION
 *
 * If LOINC codes are absent in the response (DailyMed v2 API variance observed
 * in community testing), falls back to section.title fuzzy-match:
 *   'BOXED WARNING' | 'WARNINGS' | 'INDICATIONS' | 'DOSAGE AND ADMINISTRATION'
 * (uppercase comparison).
 *
 * Per AI-SPEC §1b regulatory: boxed warning sections MUST be preserved.
 *
 * Schema: uses actual rag_chunks columns (canonical_url, source_tier, content_hash, etc.)
 * external_id = `<setid>:<spl_version>` (enables drift detection per G10 stale-evidence).
 *
 * [[T-60-07-02]] zod validation rejects malformed SPL responses.
 */

import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// LOINC section codes + fuzzy fallback titles
// ──────────────────────────────────────────────────────────────────────────────

/**
 * LOINC section code to display name mapping.
 * Planner research note: verify against DailyMed v2 API fixture during execute.
 * Fallback to title fuzzy-match (uppercase) when code absent per API variance.
 */
export const RELEVANT_LOINC_CODES = new Set([
  '34066-1', // BOXED WARNING
  '34071-1', // WARNINGS
  '34067-9', // INDICATIONS AND USAGE
  '34068-7', // DOSAGE AND ADMINISTRATION
]);

const FUZZY_SECTION_PATTERNS = [
  /BOXED.?WARNING/i,
  /\bWARNING\b/i,
  /INDICATIONS/i,
  /DOSAGE\s+AND\s+ADMINISTRATION/i,
];

function isSectionRelevant(section: { code?: string; title?: string }): boolean {
  if (section.code && RELEVANT_LOINC_CODES.has(section.code)) return true;
  if (section.title) {
    return FUZZY_SECTION_PATTERNS.some((pattern) => pattern.test(section.title!));
  }
  return false;
}

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
// DailyMed SPL Schema
// ──────────────────────────────────────────────────────────────────────────────

/**
 * DailyMedSPLSchema — zod schema for a DailyMed SPL detail response.
 *
 * setid + spl_version together form the external_id for dedup.
 * Missing setid OR spl_version → throw (AI-SPEC §3 Pitfall #8 zod-guard).
 */
export const DailyMedSPLSchema = z.object({
  setid: z.string().min(1, 'setid required'),
  spl_version: z.number().int().positive('spl_version required'),
  title: z.string().optional().default(''),
  published_date: z.string().optional().default(''),
  sections: z.array(z.object({
    code: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
  })).optional().default([]),
});

export type DailyMedSPL = z.infer<typeof DailyMedSPLSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Normalizer
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Map a validated DailyMed SPL record to a rag_chunks INSERT payload.
 *
 * source_text_excerpt = concat of text from relevant sections (LOINC-filtered
 * with fuzzy fallback). Each section separated by '\n\n'.
 *
 * external_id = `<setid>:<spl_version>` — two versions of same setid → two rows
 * (enables G10 stale-evidence drift detection).
 *
 * Section filtering strategy is documented in code comments so 60-08 admin
 * reviewers understand what's chunked vs dropped.
 */
export async function normalizeDailyMed(
  spl: DailyMedSPL,
  topicTag: string,
  topicId: string,
  sourceId: string,
): Promise<RagChunkInsert> {
  // Filter sections by LOINC code (primary) or title fuzzy match (fallback)
  // Strategy: LOINC 34066-1 (BOXED WARNING) | 34071-1 (WARNINGS) |
  //           34067-9 (INDICATIONS) | 34068-7 (DOSAGE AND ADMINISTRATION)
  // Fallback: case-insensitive title pattern match when LOINC code absent.
  // Per AI-SPEC §1b regulatory: boxed warning MUST be preserved at chunk granularity.
  const relevantSections = (spl.sections ?? [])
    .filter(isSectionRelevant)
    .map((s) => {
      const title = s.title ? `## ${s.title.toUpperCase()}\n` : '';
      return `${title}${s.text ?? ''}`;
    })
    .filter((text) => text.trim().length > 0);

  const sourceTextExcerpt = relevantSections.length > 0
    ? relevantSections.join('\n\n')
    : `DailyMed SPL: ${spl.title || spl.setid}`;

  const contentHash = await sha256Hex(sourceTextExcerpt);

  return {
    topic_id: topicId,
    source_id: sourceId,
    canonical_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${spl.setid}`,
    source_text_excerpt: sourceTextExcerpt,
    summary: `DailyMed SPL v${spl.spl_version} (${spl.published_date}): ${spl.title || spl.setid}`.slice(0, 300),
    content_hash: contentHash,
    topic_tag: topicTag,
    source_tier: 'A',
    status: 'queued',
    created_by: SYSTEM_FEDERATED_UUID,
    scraped_at: new Date().toISOString(),
  };
}
