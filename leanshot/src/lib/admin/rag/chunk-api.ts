/**
 * Phase 60 Plan 60-08 — Typed wrappers over 5 SECDEF RPCs from 60-01.
 *
 * RPCs shipped in 60-01:
 *   approve_rag_chunk, reject_rag_chunk, retract_rag_chunk,
 *   queue_rag_chunk, list_rag_review_queue
 *
 * All RPCs are SECURITY DEFINER + gated by public.is_staff(). The wrappers
 * return the project-canonical { data, error } shape and never throw on RPC
 * errors (per RagSourcesPage.tsx convention).
 *
 * Per D-AdminQueue-14: every successful call emits a PostHog event
 * 'rag_chunk_reviewed' before returning.
 */
import type { PostgrestError } from '@supabase/supabase-js';
import posthog from 'posthog-js';
import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

/** 6-value reject-reason enum validated server-side by reject_rag_chunk RPC. */
export type RejectReason =
  | 'off-topic'
  | 'factually-wrong'
  | 'off-label'
  | 'low-quality'
  | 'duplicate'
  | 'safety-concern';

/** Shape of a quote block within a chunk's quote_blocks JSONB column. */
export interface QuoteBlock {
  text: string;
  kind: 'dose' | 'indication' | 'contraindication' | 'adverse-event';
  gloss?: string;
}

/**
 * Row returned by list_rag_review_queue() SECDEF RPC.
 * Field names mirror the SQL RETURNS TABLE columns (snake_case → camelCase
 * mapping handled at the call site; raw SQL names used here for direct binding).
 */
export interface ReviewQueueRow {
  id: string;
  source_id: string;
  source_name: string;
  source_tier: 'A' | 'B' | 'C';
  topic_tag: string;
  summary: string;
  quote_blocks: QuoteBlock[];
  source_markdown: string;
  created_by: string;
  queued_at: string;
  queue_age_hours: number;
  canonical_url: string;
}

interface RpcResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

// ─── Context type (telemetry) ─────────────────────────────────────────────

interface ActionCtx {
  sourceTier: ReviewQueueRow['source_tier'];
  queueAgeHours: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emitReviewed(
  chunkId: string,
  action: string,
  ctx: ActionCtx,
  rejectReason?: RejectReason,
): void {
  const props: Record<string, unknown> = {
    chunk_id: chunkId,
    source_tier: ctx.sourceTier,
    action,
    queue_age_hours: ctx.queueAgeHours,
  };
  if (rejectReason !== undefined) {
    props.reject_reason = rejectReason;
  }
  posthog.capture('rag_chunk_reviewed', props);
}

// ─── Wrappers ─────────────────────────────────────────────────────────────────

/**
 * List the review queue. Optionally filter by tier, topicTag, or sourceId.
 * Maps camelCase opts to snake_case RPC params.
 */
export async function ragListReviewQueue(opts: {
  tier?: 'A' | 'B' | 'C';
  topicTag?: string;
  sourceId?: string;
  limit?: number;
  offset?: number;
}): Promise<RpcResult<ReviewQueueRow[]>> {
  const { data, error } = await supabase.rpc('list_rag_review_queue', {
    p_tier: opts.tier ?? null,
    p_topic_tag: opts.topicTag ?? null,
    p_source_id: opts.sourceId ?? null,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  });
  return { data: (data as ReviewQueueRow[] | null) ?? null, error: error ?? null };
}

/**
 * Approve a queued chunk. Enforces 2-person rule at DB layer (SECDEF RAISES
 * when auth.uid() === created_by). UI layer also disables the button.
 */
export async function ragApproveChunk(
  chunkId: string,
  ctx: ActionCtx,
): Promise<RpcResult<null>> {
  const result = await supabase.rpc('approve_rag_chunk', { p_chunk_id: chunkId });
  const error = result.error;
  if (!error) {
    emitReviewed(chunkId, 'approve', ctx);
  }
  return { data: null, error: error ?? null };
}

/**
 * Reject a queued chunk. Hard-deletes from rag_chunks + inserts to
 * rag_chunk_rejections. Server validates reason is in the 6-value enum.
 */
export async function ragRejectChunk(
  chunkId: string,
  reason: RejectReason,
  ctx: ActionCtx,
): Promise<RpcResult<null>> {
  const result = await supabase.rpc('reject_rag_chunk', { p_chunk_id: chunkId, p_reason: reason });
  const error = result.error;
  if (!error) {
    emitReviewed(chunkId, 'reject', ctx, reason);
  }
  return { data: null, error: error ?? null };
}

/**
 * Retract a previously-approved chunk. Sets status='retracted'.
 * Reason text is required (≥1 non-whitespace char — enforced at call site).
 */
export async function ragRetractChunk(
  chunkId: string,
  reason: string,
  ctx: ActionCtx,
): Promise<RpcResult<null>> {
  const result = await supabase.rpc('retract_rag_chunk', { p_chunk_id: chunkId, p_reason: reason });
  const error = result.error;
  if (!error) {
    emitReviewed(chunkId, 'retract', ctx);
  }
  return { data: null, error: error ?? null };
}

/**
 * Edit-and-re-queue a chunk (updates summary, quote_blocks, tier, topic_tag).
 * Resets reviewed_by so a second reviewer must approve — matches 2-person rule.
 */
export async function ragQueueChunk(
  chunkId: string,
  fields: {
    summary: string;
    quoteBlocks: QuoteBlock[];
    tier: 'A' | 'B' | 'C';
    topicTag: string;
  },
  ctx: ActionCtx,
): Promise<RpcResult<null>> {
  const result = await supabase.rpc('queue_rag_chunk', {
    p_chunk_id: chunkId,
    p_summary: fields.summary,
    p_quote_blocks: fields.quoteBlocks,
    p_tier: fields.tier,
    p_topic_tag: fields.topicTag,
  });
  const error = result.error;
  if (!error) {
    emitReviewed(chunkId, 'edit', ctx);
  }
  return { data: null, error: error ?? null };
}
