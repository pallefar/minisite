/**
 * WeeklyChallengeCard — active weekly challenges with PostHog A/B variant resolution.
 *
 * Phase 35 Plan 35-06 — GAME-05 (weekly challenges display) + GAME-08 (A/B variant).
 *
 * D-18: Max 2 active challenges per user (1 global + 1 cohort-specific).
 * D-20: PostHog variant framing resolved via posthog.getFeatureFlagPayload(flag_id).
 * Renders null if no active challenges.
 */
import { Target } from 'lucide-react';
import posthog from 'posthog-js';
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import {
  fetchActiveChallenges,
  type WeeklyChallenge,
} from '@/lib/gamification/challenges';

export function WeeklyChallengeCard() {
  const [challenges, setChallenges] = useState<WeeklyChallenge[]>([]);

  useEffect(() => {
    fetchActiveChallenges()
      .then(setChallenges)
      .catch(() => {
        // Fail silently — challenges are non-critical
      });
  }, []);

  if (challenges.length === 0) return null;

  return (
    <Card span={12} variant="elevated">
      <CardHeader title="This Week's Challenges" icon={<Target className="size-4" aria-hidden />} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {challenges.map((c) => {
          // D-20 variant resolution: posthog.getFeatureFlagPayload returns { variant_key, framing }
          const variant = c.posthog_flag_id
            ? (posthog.getFeatureFlagPayload(c.posthog_flag_id) as
                | { variant_key?: 'A' | 'B'; framing?: string }
                | undefined)
            : undefined;
          const framing = variant?.framing ?? c.framing;

          const rewardParts = [
            c.reward_xp ? `+${c.reward_xp.toLocaleString()} XP` : null,
            c.reward_badge_id ? 'Badge' : null,
            c.reward_freeze_tokens ? `+${c.reward_freeze_tokens} Freeze` : null,
          ].filter(Boolean);

          return (
            <div
              key={c.id}
              className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
            >
              <div className="text-sm font-semibold text-[var(--color-text)]">{c.title}</div>
              <div className="text-sm text-[var(--color-text-secondary)] mt-1 leading-snug">
                {framing}
              </div>
              {rewardParts.length > 0 && (
                <div className="text-xs text-[var(--color-text-secondary)] mt-2">
                  Reward: {rewardParts.join(' · ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
