/**
 * Phase 56 Plan 01 — canShowAds surface+tier guard (AD-03, AD-10).
 *
 * MUST-NEVER trust boundary: every ad render path flows through this function
 * first. Ad sub-components MUST NOT re-read tier.
 *
 * EXCLUDED_SURFACES is hardcoded (NOT config-driven) per RESEARCH anti-pattern
 * note. It is the compliance invariant — a future edit that removes a surface
 * will fail CI (the test asserts exact membership).
 *
 * T-56-01: Elevation of Privilege mitigation — frozen hardcoded Set.
 * T-56-02: Spoofing mitigation — paid tier checked first, before surface logic.
 */
import type { Tier } from '@/types';

// ─── AdSurface union ─────────────────────────────────────────────────────────

/**
 * All surfaces in the app that may (or must not) show ads.
 * Excluded surfaces: clinic, clinic-settings, clinic-drill-in, share, admin,
 * dose-log, patient.
 * Allowed (free/past_due) surfaces: home, body, nutrition, activity,
 * supplements, mood, insights, community, classroom, events, marketing,
 * onboarding.
 * Note: 'medication' is PHI context (dose-log-equivalent) and is NOT included.
 */
export type AdSurface =
  // MUST-NEVER surfaces
  | 'clinic'
  | 'clinic-settings'
  | 'clinic-drill-in'
  | 'share'
  | 'admin'
  | 'dose-log'
  | 'patient'
  // Allowed consumer/marketing surfaces
  | 'home'
  | 'body'
  | 'nutrition'
  | 'activity'
  | 'supplements'
  | 'mood'
  | 'insights'
  | 'community'
  | 'classroom'
  | 'events'
  | 'marketing'
  | 'onboarding';

// ─── EXCLUDED_SURFACES ───────────────────────────────────────────────────────

/**
 * Hardcoded frozen set of surfaces where ads MUST NEVER appear, regardless of
 * tier. Do NOT make this config-driven — it is a compliance invariant.
 * The unit test asserts exact membership so any future edit fails CI.
 */
export const EXCLUDED_SURFACES: ReadonlySet<AdSurface> = Object.freeze(
  new Set<AdSurface>([
    'clinic',
    'clinic-settings',
    'clinic-drill-in',
    'share',
    'admin',
    'dose-log',
    'patient',
  ]),
);

// ─── canShowAds ──────────────────────────────────────────────────────────────

/**
 * Pure guard — determines whether an ad may be shown on a given surface for a
 * given subscription tier.
 *
 * Logic (T-56-02 tier check FIRST):
 *   1. tier not in AD_TIERS  → false (only free/past_due see ads; new tiers default to NO ads)
 *   2. surface in EXCLUDED_SURFACES → false (MUST-NEVER compliance surfaces)
 *   3. Otherwise → true (allowed consumer/marketing surface at free/past_due)
 *
 * AD_TIERS is an explicit allowlist — a future tier value (e.g. 'trial') will
 * default to false (no ads) rather than silently showing ads.
 *
 * @param surface  The current app surface string.
 * @param tier     The user's resolved subscription tier (from Zustand store).
 * @returns        true only if ads are permitted on this surface for this tier.
 */

/**
 * Explicit set of tiers that MAY see ads.
 * Extend this list (and add a unit test) when a new ad-eligible tier is added.
 * Do NOT use a negation check (e.g. !== 'paid') — new tiers must default to NO ads.
 */
const AD_TIERS: ReadonlySet<Tier> = new Set<Tier>(['free', 'past_due']);

export function canShowAds(surface: AdSurface, tier: Tier): boolean {
  if (!AD_TIERS.has(tier)) return false;
  return !EXCLUDED_SURFACES.has(surface);
}
