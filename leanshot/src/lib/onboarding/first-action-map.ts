/**
 * Phase 34 Plan 34-07 (ONBOARD-13) — goal → first-action lookup table (D-13).
 *
 * Maps each of the 8 primary_goal catalog values to a recommended first action
 * type plus 2 fallback cards. The FirstActionSurface consumes this module to
 * render the 3-card hybrid surface at the end of consumer onboarding.
 *
 * Pure data + a deterministic selector — no React, no async, no side effects.
 */

import {
  ScaleIcon,
  SyringeIcon,
  DumbbellIcon,
  HeartIcon,
  ShareIcon,
  BeakerIcon,
  BellIcon,
  ClockIcon,
  type LucideIcon,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/**
 * D-11 primary_goal catalog — kept in sync with the GOAL_OPTIONS array in
 * ConsumerOnboardingRenderer.tsx and the `profiles.primary_goal` enum landed
 * in Plan 34-01. New values MUST be added in all three places.
 */
export type PrimaryGoal =
  | 'lose-weight'
  | 'build-muscle'
  | 'new-prescription'
  | 'build-habit'
  | 'doctor-monitored'
  | 'family-supporter'
  | 'manage-symptoms'
  | 'track-with-vial-supply';

/**
 * D-13 first-action catalog. `waitlist_join` is the family-supporter stub
 * (v1.3 deferred); `any_qualifying_d2` is the build-habit proxy that lets the
 * user opt into a daily reminder when no concrete first action fits.
 */
export type ActionType =
  | 'first_weight_log'
  | 'first_injection_log'
  | 'first_workout_log'
  | 'first_symptom_log'
  | 'first_share_link'
  | 'first_vial_config'
  | 'any_qualifying_d2'
  | 'waitlist_join';

export interface ActionCatalogEntry {
  label: string;
  icon: LucideIcon;
  /** Navigation hint — emitted as the `surface` field on `leanshot:open-surface`. */
  surface: string;
  description: string;
}

export interface FirstActionCard {
  action_type: ActionType;
  recommended: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// ACTION_CATALOG — UI metadata for each action_type
// ──────────────────────────────────────────────────────────────────────────

export const ACTION_CATALOG: Record<ActionType, ActionCatalogEntry> = {
  first_weight_log: {
    label: 'Log your first weight',
    icon: ScaleIcon,
    surface: 'modal:weight-log',
    description: 'Set your starting point so the chart can begin.',
  },
  first_injection_log: {
    label: 'Log your first injection',
    icon: SyringeIcon,
    surface: 'modal:injection-log',
    description: "Anchor the curve to today's dose.",
  },
  first_workout_log: {
    label: 'Log your first workout',
    icon: DumbbellIcon,
    surface: 'modal:workout-log',
    description: 'Pair training data with treatment data.',
  },
  first_symptom_log: {
    label: 'Log a symptom',
    icon: HeartIcon,
    surface: 'modal:symptom-log',
    description: 'Track side effects from day one.',
  },
  first_share_link: {
    label: 'Create a doctor share link',
    icon: ShareIcon,
    surface: 'modal:share-link',
    description: 'Show your doctor your data so far.',
  },
  first_vial_config: {
    label: 'Configure your first vial',
    icon: BeakerIcon,
    surface: 'modal:vial-config',
    description: 'Track concentration + supply.',
  },
  any_qualifying_d2: {
    label: 'Set a daily reminder',
    icon: BellIcon,
    surface: 'modal:reminder',
    description: "We'll nudge you tomorrow to keep the streak alive.",
  },
  waitlist_join: {
    label: 'Join the waitlist',
    icon: ClockIcon,
    surface: 'modal:family-waitlist',
    description: "Caregiver mode is coming — we'll email you when it lands.",
  },
};

// ──────────────────────────────────────────────────────────────────────────
// GOAL_ACTION_MAP (D-13)
// ──────────────────────────────────────────────────────────────────────────

const RECOMMENDED: Record<PrimaryGoal, ActionType> = {
  'lose-weight': 'first_weight_log',
  'build-muscle': 'first_workout_log',
  'new-prescription': 'first_injection_log',
  'build-habit': 'any_qualifying_d2',
  'doctor-monitored': 'first_share_link',
  'family-supporter': 'waitlist_join',
  'manage-symptoms': 'first_symptom_log',
  'track-with-vial-supply': 'first_vial_config',
};

/** Public alias for the recommended-only map (consumers that only need lookup). */
export const GOAL_ACTION_MAP = RECOMMENDED;

/**
 * D-13 deterministic fallback set: universal candidates probed in this order.
 * When the goal's recommended action is one of these, that slot is skipped
 * and the next candidate is picked so the surface always emits 2 fallbacks.
 */
const UNIVERSAL_FALLBACKS: readonly ActionType[] = [
  'first_weight_log',
  'first_injection_log',
  'first_workout_log',
] as const;

// ──────────────────────────────────────────────────────────────────────────
// getCardsForGoal — selector returning [recommended, fallbackA, fallbackB]
// ──────────────────────────────────────────────────────────────────────────

/**
 * Deterministic 3-card output for a given primary_goal.
 *
 * Card 0 is always the recommended action. Cards 1 and 2 are the next 2
 * universal fallbacks (weight → injection → workout), skipping whichever
 * slot collides with the recommended.
 *
 * The output is stable across calls — no randomization, no cohort-specific
 * branching. Plan 34-08 may layer experiment-driven re-ordering on top.
 */
export function getCardsForGoal(
  goal: PrimaryGoal,
): [FirstActionCard, FirstActionCard, FirstActionCard] {
  const recommended = RECOMMENDED[goal];
  const fallbacks: ActionType[] = [];

  for (const candidate of UNIVERSAL_FALLBACKS) {
    if (candidate === recommended) continue;
    if (fallbacks.includes(candidate)) continue;
    fallbacks.push(candidate);
    if (fallbacks.length === 2) break;
  }

  // Defensive: if the universal set ever shrinks below 2 unique non-collision
  // entries (shouldn't happen with the current 3-item list) keep typing
  // happy by re-using the first available action. The above loop already
  // guarantees 2 entries given the current data.
  if (fallbacks.length < 2) {
    throw new Error(
      `[first-action-map] getCardsForGoal: insufficient fallbacks for goal=${goal} (expected 2, got ${fallbacks.length})`,
    );
  }

  return [
    { action_type: recommended, recommended: true },
    { action_type: fallbacks[0], recommended: false },
    { action_type: fallbacks[1], recommended: false },
  ];
}
