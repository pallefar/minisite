/**
 * Phase 60 Plan 60-13 — Browser-side typed PostgREST queries for the public
 * /knowledge/* SEO hub.
 *
 * All user-supplied inputs (topic, slug, tier, q) are zod-validated BEFORE
 * reaching PostgREST (T-60-13-SQLI-1 mitigation). The PostgREST client is
 * also parameterized — this is a defense-in-depth layer.
 *
 * Security invariants:
 *  - T-60-13-SQLI-1: tierSchema enum + topicSchema regex + searchQuerySchema
 *    strip/reject applied at the API boundary.
 *  - T-60-13-INFO-3: isReservedSlug refine rejects reserved slugs.
 *  - Anon queries only filter status='published' AND retracted_at IS NULL AND
 *    public_visibility=true (enforced by RLS + mirrored here for clarity).
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { TOPIC_DISPLAY_NAMES, isReservedSlug } from './topics';

// ─── Error type ───────────────────────────────────────────────────────────────

export class KnowledgeApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'KnowledgeApiError';
  }
}

// ─── Zod schemas (T-60-13-SQLI-1) ────────────────────────────────────────────

/**
 * Tier filter: A, B, or C — anything else is rejected at the boundary.
 */
export const tierSchema = z.enum(['A', 'B', 'C']).optional();

/**
 * Topic slug: lowercase alphanumeric + hyphens only, 1-64 chars.
 * Rejects reserved slugs.
 */
export const topicSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Topic slug must be lowercase alphanumeric and hyphens only')
  .refine((s) => !isReservedSlug(s), { message: 'Reserved topic slug' });

/**
 * Chunk slug: same shape as topic but for individual article slugs.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric and hyphens only')
  .refine((s) => !isReservedSlug(s), { message: 'Reserved slug' });

/** Strip control characters from a string */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]/g, '');
}

/** SQL meta-characters that could indicate injection attempts */
const SQL_META_PATTERN = /;|--|\/\*/;

/**
 * Search query: max 120 chars, control chars stripped, SQL meta-chars rejected.
 * T-60-13-SQLI-1: defense-in-depth before PostgREST's own parameterization.
 */
export const searchQuerySchema = z
  .string()
  .max(120, 'Search query too long')
  .transform(stripControlChars)
  .refine((s) => !SQL_META_PATTERN.test(s), {
    message: 'Search query contains disallowed characters',
  });

// ─── Row types ────────────────────────────────────────────────────────────────

export interface RagSource {
  id: string;
  name: string;
  source_type: string;
}

export interface RagChunkRow {
  id: string;
  topic_tag: string;
  slug: string | null;
  title: string | null;
  summary: string;
  canonical_url: string;
  source_id: string;
  source_tier: 'A' | 'B' | 'C';
  scraped_at: string;
  published_at: string | null;
  reviewed_at: string | null;
  quote_blocks: unknown[];
  public_visibility: boolean;
  source?: RagSource;
}

export interface RagChunkDetail extends RagChunkRow {
  source: RagSource;
  retracted_at: string | null;
}

export interface TopicSummary {
  slug: string;
  display_name: string;
  chunk_count: number;
}

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Returns topics with at least 1 published, visible chunk.
 * Joins with TOPIC_DISPLAY_NAMES for human-readable names.
 */
export async function listTopics(): Promise<TopicSummary[]> {
  const { data, error } = await supabase
    .from('rag_chunks')
    .select('topic_tag')
    .eq('status', 'published')
    .is('retracted_at', null)
    .eq('public_visibility', true);

  if (error) {
    throw new KnowledgeApiError(`Failed to list topics: ${error.message}`, error.code);
  }

  // Count chunks per topic_tag
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const tag = row.topic_tag as string;
    counts[tag] = (counts[tag] ?? 0) + 1;
  }

  // Build result — filter to known topics only
  return Object.entries(counts)
    .filter(([slug]) => slug in TOPIC_DISPLAY_NAMES)
    .map(([slug, chunk_count]) => ({
      slug,
      display_name: TOPIC_DISPLAY_NAMES[slug] ?? slug,
      chunk_count,
    }))
    .sort((a, b) => b.chunk_count - a.chunk_count);
}

/**
 * Lists published+visible chunks for a specific topic.
 * Optionally filters by tier and client-side search query.
 * T-60-13-SQLI-1: all params zod-validated before query.
 */
export async function listPublishedChunksByTopic({
  topic,
  tier,
  q,
  limit = 50,
}: {
  topic: string;
  tier?: string;
  q?: string;
  limit?: number;
}): Promise<RagChunkRow[]> {
  // Validate inputs (T-60-13-SQLI-1)
  const parsedTopic = topicSchema.safeParse(topic);
  if (!parsedTopic.success) {
    throw new KnowledgeApiError(`Invalid topic: ${parsedTopic.error.message}`, 'INVALID_TOPIC');
  }

  const parsedTier = tier ? tierSchema.safeParse(tier) : { success: true, data: undefined };
  if (!parsedTier.success) {
    throw new KnowledgeApiError(`Invalid tier: ${tier}`, 'INVALID_TIER');
  }

  if (q !== undefined) {
    const parsedQ = searchQuerySchema.safeParse(q);
    if (!parsedQ.success) {
      throw new KnowledgeApiError(
        `Invalid search query: ${parsedQ.error.message}`,
        'INVALID_QUERY',
      );
    }
  }

  let query = supabase
    .from('rag_chunks')
    .select(
      'id, topic_tag, slug, title, summary, canonical_url, source_id, source_tier, scraped_at, published_at, reviewed_at, quote_blocks, public_visibility, source:rag_sources(id, name, source_type)',
    )
    .eq('status', 'published')
    .is('retracted_at', null)
    .eq('public_visibility', true)
    .eq('topic_tag', parsedTopic.data)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (parsedTier.success && parsedTier.data !== undefined) {
    query = query.eq('source_tier', parsedTier.data);
  }

  const { data, error } = await query;

  if (error) {
    throw new KnowledgeApiError(
      `Failed to list chunks for topic ${topic}: ${error.message}`,
      error.code,
    );
  }

  return (data ?? []) as unknown as RagChunkRow[];
}

/**
 * Fetches a single chunk by topic_tag + slug.
 * Does NOT filter by public_visibility — caller decides noindex vs 404.
 * Returns null if no matching published, non-retracted chunk.
 */
export async function getChunkBySlug({
  topic,
  slug,
}: {
  topic: string;
  slug: string;
}): Promise<RagChunkDetail | null> {
  // Validate inputs
  const parsedTopic = topicSchema.safeParse(topic);
  if (!parsedTopic.success) return null;

  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const { data, error } = await supabase
    .from('rag_chunks')
    .select(
      'id, topic_tag, slug, title, summary, canonical_url, source_id, source_tier, scraped_at, published_at, reviewed_at, retracted_at, quote_blocks, public_visibility, source:rag_sources(id, name, source_type)',
    )
    .eq('topic_tag', parsedTopic.data)
    .eq('slug', parsedSlug.data)
    .eq('status', 'published')
    .is('retracted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // No rows
    throw new KnowledgeApiError(
      `Failed to fetch chunk ${topic}/${slug}: ${error.message}`,
      error.code,
    );
  }

  return data as unknown as RagChunkDetail;
}

/**
 * Lists chunks for a topic (used by build-time sitemap script).
 * Re-export of listPublishedChunksByTopic with a narrower interface.
 */
export async function listChunksByTopic({
  topic,
  limit = 50,
}: {
  topic: string;
  limit?: number;
}): Promise<RagChunkRow[]> {
  return listPublishedChunksByTopic({ topic, limit });
}

/**
 * Returns the highest-published_at Tier-A chunk with a non-null summary.
 * Used for the featured chunk on the Knowledge root page.
 */
export async function getFeaturedChunk(): Promise<RagChunkRow | null> {
  const { data, error } = await supabase
    .from('rag_chunks')
    .select(
      'id, topic_tag, slug, title, summary, canonical_url, source_id, source_tier, scraped_at, published_at, reviewed_at, quote_blocks, public_visibility, source:rag_sources(id, name, source_type)',
    )
    .eq('status', 'published')
    .is('retracted_at', null)
    .eq('public_visibility', true)
    .eq('source_tier', 'A')
    .not('summary', 'is', null)
    .order('published_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new KnowledgeApiError(`Failed to fetch featured chunk: ${error.message}`, error.code);
  }

  return data as unknown as RagChunkRow;
}

/**
 * Returns related chunks for the same topic, excluding the current chunk.
 * Used for the "Related" sidebar on article detail pages.
 */
export async function listRelatedChunks({
  topic,
  excludeId,
  limit = 5,
}: {
  topic: string;
  excludeId: string;
  limit?: number;
}): Promise<RagChunkRow[]> {
  const parsedTopic = topicSchema.safeParse(topic);
  if (!parsedTopic.success) return [];

  const { data, error } = await supabase
    .from('rag_chunks')
    .select(
      'id, topic_tag, slug, title, summary, canonical_url, source_id, source_tier, scraped_at, published_at, reviewed_at, quote_blocks, public_visibility, source:rag_sources(id, name, source_type)',
    )
    .eq('status', 'published')
    .is('retracted_at', null)
    .eq('public_visibility', true)
    .eq('topic_tag', parsedTopic.data)
    .neq('id', excludeId)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data ?? []) as unknown as RagChunkRow[];
}
