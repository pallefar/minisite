/**
 * Phase 50 Plan 50-02 — Typed wrappers for RAG admin RPCs.
 *
 * Wraps the 8 SECURITY DEFINER RPCs + telemetry function shipped in
 * 20260519000010_rag_admin_rpcs.sql. Each function returns the project's
 * canonical `{ data, error }` shape consistent with other admin-api.ts modules.
 *
 * SECURITY contract: client-side calls are UX-only; the RPCs themselves
 * enforce the super-admin gate via _rag_is_super() (Pattern S1 dual-layer).
 *
 * D-10 invariant: NO function name in this module matches /bulk|csv|import/i —
 * single-row CRUD only. The topic-crud.test.ts suite asserts this constraint.
 */
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// ─── Result shape ──────────────────────────────────────────────────────────

export interface RagApiResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

// ─── Topic CRUD ────────────────────────────────────────────────────────────

export interface RagTopicCreateArgs {
  query: string;
  tag: string;
  posture?: 'curated' | 'open-web';
  cadence?: 'daily' | 'weekly' | 'monthly' | 'manual';
}

export async function ragTopicCreate(args: RagTopicCreateArgs): Promise<RagApiResult<string>> {
  const { data, error } = await supabase.rpc('rag_topic_create', {
    p_query: args.query,
    p_tag: args.tag,
    p_posture: args.posture ?? 'curated',
    p_cadence: args.cadence ?? 'weekly',
  });
  return { data: (data as string | null) ?? null, error };
}

export interface RagTopicUpdateArgs {
  topicId: string;
  query: string;
  tag: string;
  posture: 'curated' | 'open-web';
  cadence: 'daily' | 'weekly' | 'monthly' | 'manual';
}

export async function ragTopicUpdate(args: RagTopicUpdateArgs): Promise<RagApiResult<null>> {
  const { error } = await supabase.rpc('rag_topic_update', {
    p_topic_id: args.topicId,
    p_query: args.query,
    p_tag: args.tag,
    p_posture: args.posture,
    p_cadence: args.cadence,
  });
  return { data: null, error };
}

export async function ragTopicSoftDelete(topicId: string): Promise<RagApiResult<null>> {
  const { error } = await supabase.rpc('rag_topic_soft_delete', { p_topic_id: topicId });
  return { data: null, error };
}

export async function ragTopicRestore(topicId: string): Promise<RagApiResult<null>> {
  const { error } = await supabase.rpc('rag_topic_restore', { p_topic_id: topicId });
  return { data: null, error };
}

// ─── Source CRUD ───────────────────────────────────────────────────────────

export interface RagSourceCreateArgs {
  name: string;
  domain: string;
  tier: 'A' | 'B' | 'C';
  freshnessWindowDays: number;
}

export async function ragSourceCreate(args: RagSourceCreateArgs): Promise<RagApiResult<string>> {
  const { data, error } = await supabase.rpc('rag_source_create', {
    p_name: args.name,
    p_domain: args.domain,
    p_tier: args.tier,
    p_freshness_window_days: args.freshnessWindowDays,
  });
  return { data: (data as string | null) ?? null, error };
}

export async function ragSourceUpdateTier(
  sourceId: string,
  newTier: 'A' | 'B' | 'C',
): Promise<RagApiResult<null>> {
  const { error } = await supabase.rpc('rag_source_update_tier', {
    p_source_id: sourceId,
    p_new_tier: newTier,
  });
  return { data: null, error };
}

export async function ragSourcePause(
  sourceId: string,
  reason: string,
): Promise<RagApiResult<null>> {
  const { error } = await supabase.rpc('rag_source_pause', {
    p_source_id: sourceId,
    p_reason: reason,
  });
  return { data: null, error };
}

export async function ragSourceResume(sourceId: string): Promise<RagApiResult<null>> {
  const { error } = await supabase.rpc('rag_source_resume', { p_source_id: sourceId });
  return { data: null, error };
}

// ─── Telemetry ─────────────────────────────────────────────────────────────

export interface RagTopicTelemetry7d {
  topic_id: string;
  tag: string;
  docs_ingested: number;
  rag_hits_7d: number;
  tip_impressions_7d: number;
  tip_clicks_7d: number;
  newsletter_inclusions_7d: number;
  tier_a_count: number;
  tier_b_count: number;
  tier_c_count: number;
}

export async function ragTopicTelemetry7d(): Promise<RagApiResult<RagTopicTelemetry7d[]>> {
  const { data, error } = await supabase.rpc('rag_topic_telemetry_7d');
  return { data: (data as RagTopicTelemetry7d[] | null) ?? null, error };
}
