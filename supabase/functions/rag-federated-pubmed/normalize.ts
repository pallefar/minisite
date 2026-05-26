/**
 * normalize.ts — PubMed article → rag_chunks insert payload normalizer.
 *
 * Phase 60 Plan 60-07. Task 2.
 *
 * Provides:
 *   PubMedArticleSchema — zod schema for a PubMed article record
 *   normalizePubMedArticle — maps validated article to rag_chunks insert payload
 *
 * Schema adaptation (Rule 1 — actual rag_chunks vs plan's kb_chunks_queue):
 *   canonical_url   = https://pubmed.ncbi.nlm.nih.gov/<pmid>/
 *   source_tier     = 'A' (federated NLM = tier A per AI-SPEC)
 *   source_text_excerpt = title + '\n\n' + abstract (or just title if no abstract)
 *   content_hash    = sha256(source_text_excerpt) for dedup via rag_chunks_dedup_uq
 *   topic_tag       = passed as arg (mapped from federated_sources topic_tags request)
 *   created_by      = SYSTEM_FEDERATED_UUID constant
 *   topic_id + source_id = resolved by caller (index.ts) via rag_topics/rag_sources lookups
 *
 * [[T-60-07-02]] zod validation rejects silent rate-limit truncation.
 */

// Use 'zod' bare specifier — resolves via deno.json import map in Deno runtime
// ('zod' → 'npm:zod@^3') and via node_modules in Vitest/Node context.
import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Reserved system UUID for federated-adapter-authored chunks (2-person rule: created_by). */
export const SYSTEM_FEDERATED_UUID = '00000000-0000-0000-0000-000000000060';

// ──────────────────────────────────────────────────────────────────────────────
// Zod Schema
// ──────────────────────────────────────────────────────────────────────────────

/**
 * PubMedArticleSchema — validated shape for a single PubMed article.
 *
 * efetch returns XML; callers should convert to this object shape before passing.
 * Missing abstract is allowed (nullable) — title-only excerpt used in that case.
 * Missing title is NOT allowed (silences truncated/empty responses per T-60-07-02).
 */
export const PubMedArticleSchema = z.object({
  pmid: z.string().min(1, 'pmid required'),
  title: z.string().min(1, 'title required — empty title indicates truncated/malformed response'),
  abstract: z.string().nullable().optional(),
  authors: z.array(z.string()).optional().default([]),
  journal: z.string().optional().default(''),
  year: z.string().regex(/^\d{4}$/, 'year must be 4-digit YYYY').optional().default('2000'),
  doi: z.string().optional().nullable(),
  mesh_terms: z.array(z.string()).optional().default([]),
});

export type PubMedArticle = z.infer<typeof PubMedArticleSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// rag_chunks insert payload type (subset of columns we set)
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
// Hash helper (sync wrapper uses SubtleCrypto async — callers must await)
// ──────────────────────────────────────────────────────────────────────────────

export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// Normalizer
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Map a validated PubMedArticle to a rag_chunks INSERT payload.
 *
 * @param article - Validated via PubMedArticleSchema
 * @param topicTag - The topic tag for this chunk (from federated_sources topic_tags request)
 * @param topicId - UUID of the rag_topics row for this tag (resolved by caller)
 * @param sourceId - UUID of the rag_sources row for pubmed.ncbi.nlm.nih.gov (resolved by caller)
 * @returns RagChunkInsert ready for supabase.from('rag_chunks').insert()
 */
export async function normalizePubMedArticle(
  article: PubMedArticle,
  topicTag: string,
  topicId: string,
  sourceId: string,
): Promise<RagChunkInsert> {
  // Build source_text_excerpt: title + '\n\n' + abstract (or title only if no abstract)
  const abstract = article.abstract?.trim();
  const sourceTextExcerpt = abstract
    ? `${article.title}\n\n${abstract}`
    : article.title;

  const contentHash = await sha256Hex(sourceTextExcerpt);
  const evidenceYear = article.year ?? '2000';

  return {
    topic_id: topicId,
    source_id: sourceId,
    canonical_url: `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`,
    source_text_excerpt: sourceTextExcerpt,
    // summary: brief 1-sentence — use first 100 chars of title as fallback
    summary: `PubMed ${evidenceYear}: ${article.title.slice(0, 200)}`,
    content_hash: contentHash,
    topic_tag: topicTag,
    source_tier: 'A',
    status: 'queued',
    created_by: SYSTEM_FEDERATED_UUID,
    scraped_at: new Date().toISOString(),
  };
}
