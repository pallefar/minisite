/**
 * Phase 44 Plan 03 — Community Feed Foundation: Shared TypeScript domain types.
 *
 * These types are LOCKED for all downstream community components (44-06 through 44-09).
 * All interfaces and types in this file are consumed by CommunityPost, CommunityFeed,
 * CommunityPostComposer, tier-gate, community-storage, mention-parse, etc.
 *
 * Pure types, no runtime code, no imports.
 */

// ─── Reaction ─────────────────────────────────────────────────────────────────

export type ReactionEmoji = 'like' | 'heart' | 'target' | 'fire' | 'clap';

// ─── Space ────────────────────────────────────────────────────────────────────

export interface CommunitySpace {
  id: string;
  name: string;
  description: string | null;
  org_id: string | null;
  min_tier: 'free' | 'pro' | 'lifetime';
  created_at: string;
  updated_at: string;
}

// ─── Post ─────────────────────────────────────────────────────────────────────

export interface CommunityPost {
  id: string;
  space_id: string;
  author_id: string | null;
  body: string;
  mux_upload_id: string | null;
  mux_playback_id: string | null;
  video_status: 'uploading' | 'processing' | 'ready' | 'rejected' | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

// ─── Comment ──────────────────────────────────────────────────────────────────

export interface CommunityComment {
  id: string;
  post_id: string;
  space_id: string; // denormalized per Pitfall 5 (enables space-scoped Realtime filter)
  parent_comment_id: string | null; // nullable per D-01 forward-compat (Phase 45+ can lift depth cap)
  author_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

// ─── Reaction ─────────────────────────────────────────────────────────────────

export interface CommunityReaction {
  id: string;
  user_id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  emoji: ReactionEmoji;
  created_at: string;
}

// ─── Post media ───────────────────────────────────────────────────────────────

export interface CommunityPostMedia {
  id: string;
  post_id: string;
  path: string;
  display_order: number;
}

// ─── Tier gate ────────────────────────────────────────────────────────────────

/**
 * TierLabel maps to tier_effective.tier_label values from Phase 43.
 * Trial users gain Pro features for evaluation per Phase 44 planning context
 * Claude's Discretion — matches Phase 43 trial-period precedent.
 */
export type TierLabel = 'free' | 'trial' | 'pro' | 'lifetime';
