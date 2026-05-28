/**
 * Phase 60 Plan 60-10 Task 2 — RAG retrieve client (browser-side).
 *
 * Wraps supabase.functions.invoke('rag-retrieve') for:
 *   - ragChunkById(chunkId): lookup mode (called by CitationPopover on open)
 *   - ragRetrieve(args): query mode (called by ai-chat streaming response handler)
 *
 * Zod-validates the server response against RagChunkResultSchema (browser-side
 * mirror of AI-SPEC §4 CitedAnswerSchema field types).
 *
 * On schema drift (validation failure), returns null + fires schema_violation
 * telemetry via captureRagEventBrowser so the discrepancy surfaces in PostHog
 * without crashing the popover or blocking the UI.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';

// ─── Zod Schema (browser-side mirror of AI-SPEC §4 RagChunkResult) ─────────────

export const RagChunkResultSchema = z.object({
  chunk_id: z.string().uuid(),
  source_name: z.string(),
  source_type: z.enum([
    'fda_label',
    'peer_reviewed',
    'clinical_guideline',
    'leanshot_curated',
    'leanshot_research',
    'community',
  ]),
  source_tier: z.enum(['A', 'B', 'C']),
  canonical_url: z.string().url(),
  topic_tag: z.string(),
  summary: z.string(),
  verbatim_quote: z.string(),
  scraped_at: z.string(),
  last_reviewed_at: z.string().nullable(),
  stale: z.boolean(),
  public_visibility: z.boolean(),
});

export type RagChunkResult = z.infer<typeof RagChunkResultSchema>;

// ─── ragChunkById ──────────────────────────────────────────────────────────────

/**
 * Fetch a single RAG chunk by chunk_id (UUID).
 *
 * Returns null when:
 *   - The chunk doesn't exist (404 / not found response)
 *   - The response fails zod validation (fires schema_violation telemetry)
 *   - Any unexpected error occurs
 *
 * Never throws — callers render the error state from CitationPopover.
 */
export async function ragChunkById(chunkId: string): Promise<RagChunkResult | null> {
  let data: unknown;
  let error: unknown;

  try {
    const result = await supabase.functions.invoke('rag-retrieve', {
      body: { mode: 'lookup', chunk_id: chunkId },
    });
    data = result.data;
    error = result.error;
  } catch (e) {
    console.warn('[rag-retrieve] invoke error', e);
    return null;
  }

  // Treat any invoke-level error as a not-found / unavailable
  if (error) {
    return null;
  }

  // null/undefined data means chunk not found (soft-deleted, retracted, or 404)
  if (data == null) {
    return null;
  }

  // Zod-validate the response shape
  const parsed = RagChunkResultSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[rag-retrieve] schema validation failed for chunk_id:', chunkId, parsed.error);
    // Fire telemetry (fire-and-forget — never await this; it MUST NOT block the
    // caller). Import lazily to avoid circular dependency with retrieve-client.
    void import('./server-rag-events-relay').then(({ captureRagEventBrowser }) => {
      void captureRagEventBrowser('rag_chunk_schema_violation', { chunk_id: chunkId });
    });
    return null;
  }

  return parsed.data;
}

// ─── ragRetrieve ──────────────────────────────────────────────────────────────

const RagRetrieveResponseSchema = z.object({
  results: z.array(RagChunkResultSchema),
  count: z.number().int().nonnegative(),
});

export interface RagRetrieveArgs {
  query: string;
  k?: number;
  filters?: {
    topic_tag?: string;
    source_tier?: ('A' | 'B' | 'C')[];
  };
}

/**
 * Semantic query against the RAG index.
 * Returns validated array of chunks; returns empty results on any failure.
 */
export async function ragRetrieve(
  args: RagRetrieveArgs,
): Promise<{ results: RagChunkResult[]; count: number }> {
  try {
    const { data, error } = await supabase.functions.invoke('rag-retrieve', {
      body: { mode: 'query', ...args },
    });

    if (error || data == null) {
      return { results: [], count: 0 };
    }

    const parsed = RagRetrieveResponseSchema.safeParse(data);
    if (!parsed.success) {
      console.warn('[rag-retrieve] query response schema validation failed', parsed.error);
      return { results: [], count: 0 };
    }

    return parsed.data;
  } catch (e) {
    console.warn('[rag-retrieve] ragRetrieve error', e);
    return { results: [], count: 0 };
  }
}
