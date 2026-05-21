/**
 * LevelProgressCard — displays user's current level + XP progress ring.
 *
 * Phase 35 Plan 35-06 — GAME-06 (progress rings on dashboard).
 * Reuses v1.2 DS-9 ProgressRing component per 35-PATTERNS.md.
 */
import { Trophy } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { ProgressRing } from '@/components/ui/ProgressRing';
import type { GamificationDashboardData } from '@/lib/gamification/dashboard-data';

export interface LevelProgressCardProps {
  data: GamificationDashboardData;
}

export function LevelProgressCard({ data }: LevelProgressCardProps) {
  // D-02 quadratic curve: range within current level = (level+1)² × 100 - level² × 100
  // Simplified: (2 * level + 1) * 100
  const levelRange = (2 * data.level + 1) * 100;
  const displayLevel = Math.min(100, data.level);
  const prestigeLabel = data.prestige > 0 ? ` · P${data.prestige}` : '';

  return (
    <Card span={4} variant="elevated">
      <CardHeader title="Level" icon={<Trophy className="size-4" aria-hidden />} />
      <div className="flex flex-col items-center">
        <ProgressRing
          value={data.xpInLevel}
          max={levelRange}
          label={`Level ${displayLevel}${prestigeLabel}`}
          size={88}
        >
          <span className="text-[22px] font-bold text-[var(--color-text)]" aria-hidden>
            {displayLevel}
            {data.prestige > 0 && (
              <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                {' '}P{data.prestige}
              </span>
            )}
          </span>
        </ProgressRing>
        <div className="mt-2 text-sm text-[var(--color-text-secondary)] text-center">
          {data.xpToNext.toLocaleString()} XP to level {data.level + 1}
        </div>
      </div>
    </Card>
  );
}
