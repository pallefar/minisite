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

/**
 * CommunityPost with the joined community_post_media relation.
 * Used by CommunityFeed when querying posts with SELECT community_post_media(...).
 * CommunityPost → CommunityPostMediaStrip → CommunityMediaUploader all consume this shape.
 */
export type CommunityPostWithMedia = CommunityPost & {
  community_post_media: CommunityPostMedia[];
};

// ─── Tier gate ────────────────────────────────────────────────────────────────

/**
 * TierLabel maps to tier_effective.tier_label values from Phase 43.
 * Trial users gain Pro features for evaluation per Phase 44 planning context
 * Claude's Discretion — matches Phase 43 trial-period precedent.
 */
export type TierLabel = 'free' | 'trial' | 'pro' | 'lifetime';

// ─── Phase 45 — DM + block + report + leaderboard ─────────────────────────────

/**
 * DM thread row from public.dm_threads.
 * Created by dm-create-thread Edge Fn (plan 45-04); INSERT gated by RLS:
 *   creator_user_id = auth.uid() AND recipient.dm_open = true AND NOT EXISTS user_block_list (B→A).
 */
export interface DmThread {
  id: string;
  creator_user_id: string;
  recipient_user_id: string;
  last_message_at: string | null;
  created_at: string;
}

/**
 * Direct message row from public.direct_messages.
 * Body ≤ 2000 chars (DB CHECK). Optional attachment via dm-attachments bucket
 * (path format: <thread_id>/<message_id>/<filename>; 60-min signed URL TTL).
 */
export interface DirectMessage {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  attachment_path: string | null;
  created_at: string;
}

/**
 * Block list entry from public.user_block_list.
 * Symmetric block: A blocking B prevents both A→B and B→A new DM threads.
 * Toggled by toggle_community_block SECDEF RPC (plan 45-01 / 20270727000003).
 */
export interface BlockEntry {
  blocker_user_id: string;
  blocked_user_id: string;
  created_at: string;
}

/**
 * Community report row from public.community_reports.
 * status='open' in Phase 45; Phase 48 widens CHECK to ('open','triaged','resolved','dismissed').
 * Write-only for consumers (RLS); staff read via daily digest Edge Fn.
 */
export interface CommunityReport {
  id: string;
  reporter_user_id: string;
  target_type: 'post' | 'comment' | 'dm_message' | 'profile';
  target_id: string;
  reason: string;
  status: 'open' | 'reviewing' | 'closed';
  created_at: string;
}

/**
 * Space leaderboard entry from get_community_space_leaderboard RPC.
 * handle = profiles.leaderboard_handle (anonymized). rank_in_space from matview.
 * Top-10 + ±5 neighborhood per RPC contract (mirrors Phase 35 leaderboard).
 */
export interface SpaceLeaderboardEntry {
  handle: string;
  score: number;
  rank_in_space: number;
}
