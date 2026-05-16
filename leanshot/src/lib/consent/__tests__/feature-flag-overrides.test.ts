/**
 * Phase 22 plan 22-01 Wave 0 scaffold — feature-flag-overrides PostHog wrapper (ADMIN-05).
 * Owner of impl: plan 22-09 (PostHog override wiring).
 *
 * Behaviors deferred:
 *   - Overrides-first check: row in feature_flag_overrides AND expires_at > now() → use override.value
 *   - Fall through to posthog.isFeatureEnabled when no override or expired
 */
import { describe, it } from 'vitest';

import { isFeatureEnabledWithOverride } from '@/lib/consent/feature-flag-overrides';

describe('feature-flag-overrides (Phase 22 ADMIN-05)', () => {
  it.skip('returns override value when row exists and not expired [DEFERRED — Wave 0 scaffold; impl in plan 22-09]', () => {
    void isFeatureEnabledWithOverride;
  });
  it.skip('falls through to PostHog when override expired [DEFERRED — Wave 0 scaffold; impl in plan 22-09]', () => {
    void isFeatureEnabledWithOverride;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-09
