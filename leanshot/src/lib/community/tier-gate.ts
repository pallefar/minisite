/**
 * Phase 44 Plan 03 — Community Feed Foundation: Tier gate utilities.
 *
 * Trial users gain Pro features for evaluation per Phase 44 planning_context
 * Claude's Discretion — matches Phase 43 trial-period precedent.
 *
 * All tier checks in Phase 44 read from the `tier_effective` view (Phase 43),
 * NOT from raw subscription tables. The view normalizes Free/Pro/Lifetime/Trial.
 *
 * T-44-05 trust boundary: readTierLabel is read-only against tier_effective;
 * never used to write tier state.
 */
import { supabase } from '@/lib/supabase';

import type { TierLabel } from '@/lib/community/community-types';

export type { TierLabel };

// ─── Tier label reader ────────────────────────────────────────────────────────

/**
 * Read the effective tier label for a user from the `tier_effective` view.
 *
 * Defaults to 'free' when no row exists (unauthenticated or pre-subscription).
 *
 * @param userId — auth.uid() from the current session
 */
export async function readTierLabel(userId: string): Promise<TierLabel> {
  const { data } = await supabase
    .from('tier_effective')
    .select('tier_label')
    .eq('user_id', userId)
    .single();
  return (data?.tier_label as TierLabel | null) ?? 'free';
}

// ─── Video gate ───────────────────────────────────────────────────────────────

/**
 * Returns true when the user's tier grants access to video upload (D-06).
 *
 * Tiers with video access: 'pro' | 'lifetime' | 'trial'
 * Free tier: video uploader hidden; Edge Fn rejects with 403 if bypassed.
 *
 * Trial inclusion is Claude's Discretion per Phase 44 planning_context —
 * trial users get Pro-equivalent features during their evaluation period.
 */
export function isVideoAllowed(tier: TierLabel): boolean {
  return tier === 'pro' || tier === 'lifetime' || tier === 'trial';
}

// ─── Space access gate ────────────────────────────────────────────────────────

/**
 * Returns true when the user's tier grants access to a space with the given min_tier.
 *
 * Space access matrix (D-08):
 *   - free space: accessible by all tiers (free, trial, pro, lifetime)
 *   - pro space: accessible by pro, trial, lifetime
 *   - lifetime space: accessible by lifetime only
 *
 * Free users see locked cards with upgrade CTA for pro/lifetime spaces (D-08).
 * Clinic-private spaces with org_id are filtered by RLS before this check (D-09).
 *
 * @param spaceTier — the community_spaces.min_tier value
 * @param userTier  — the current user's effective tier label
 */
export function canAccessSpace(
  spaceTier: 'free' | 'pro' | 'lifetime',
  userTier: TierLabel,
): boolean {
  if (spaceTier === 'free') return true;
  if (spaceTier === 'pro') {
    return userTier === 'pro' || userTier === 'lifetime' || userTier === 'trial';
  }
  // spaceTier === 'lifetime'
  return userTier === 'lifetime';
}

// ─── Resource download gate (Phase 46 D-16 / COURSE-06) ───────────────────────

/**
 * Phase 46 lesson-resource download types. Storage RLS on the
 * `course-resources` bucket (Plan 46-02) is the enforcement boundary; this
 * function is the advisory UX gate (renders disabled/upgrade-CTA buttons).
 */
export type ResourceType = 'pdf' | 'video' | 'zip';

/**
 * Returns true when the user's tier grants access to download a lesson
 * resource. Trial inclusion matches isVideoAllowed semantics.
 *
 * Free tier: download button shows upgrade CTA; Storage signed-URL Fn rejects
 * on bypass. The `_resourceType` parameter is reserved for future per-type
 * differentiation (e.g. zip-only for Pro+, video-passthrough for Lifetime);
 * underscore prefix is the project convention to satisfy noUnusedParameters.
 */
export function isResourceAllowed(tier: TierLabel, _resourceType: ResourceType): boolean {
  return tier === 'pro' || tier === 'lifetime' || tier === 'trial';
}
