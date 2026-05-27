/**
 * Phase 45 Plan 07a — LeaderboardChip.
 *
 * Small inline component mounted inside a community space view. Fetches the
 * top-10 + ±5 neighborhood from `get_community_space_leaderboard(p_space_id)`
 * (matview shipped in 45-06). Shows top-3 by default; "View full leaderboard"
 * expands to the full window.
 *
 * Props:
 *   - spaceId: the community space id (passed to the RPC)
 *   - leaderboardEnabled: per-space toggle from community_spaces.leaderboard_enabled;
 *     when false, the chip renders nothing
 *   - currentTier: the caller's effective TierLabel (from tier_effective)
 *   - spaceMinTier: the space's required min_tier — when currentTier < spaceMinTier,
 *     render the Phase 44 locked-card UX with a /pricing CTA (D-15)
 *
 * Tier gating: reuses canAccessSpace from @/lib/community/tier-gate.
 *
 * Analog: leanshot/src/components/community/ReactionBar.tsx (small inline pill).
 */
import { Trophy, Lock } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { canAccessSpace, type TierLabel } from '@/lib/community/tier-gate';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaderboardChipProps {
  spaceId: string;
  leaderboardEnabled: boolean;
  currentTier: TierLabel;
  /** Space.min_tier — drives the tier-locked card path per D-15. */
  spaceMinTier: 'free' | 'pro' | 'lifetime';
}

interface LeaderboardRow {
  handle: string;
  score: number;
  rank_in_space: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LeaderboardChip({
  spaceId,
  leaderboardEnabled,
  currentTier,
  spaceMinTier,
}: LeaderboardChipProps): JSX.Element | null {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const tierAllowed = canAccessSpace(spaceMinTier, currentTier);

  useEffect(() => {
    if (!leaderboardEnabled || !spaceId || !tierAllowed) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('get_community_space_leaderboard', {
        p_space_id: spaceId,
      });
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        setRows([]);
      } else {
        setRows(data as LeaderboardRow[]);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [spaceId, leaderboardEnabled, tierAllowed]);

  // D-15 / leaderboard_enabled=false: render nothing.
  if (!leaderboardEnabled) return null;

  // Phase 44 locked-card UX — tier below space.min_tier.
  if (!tierAllowed) {
    return (
      <Card variant="flat" padding="sm">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-[var(--color-text-secondary)]" aria-hidden />
          <span className="text-sm text-[var(--color-text-secondary)] flex-1">
            Leaderboard available on {spaceMinTier === 'pro' ? 'Pro' : 'Lifetime'}.
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              window.location.assign('/pricing');
            }}
            aria-label="Upgrade to see leaderboard"
          >
            Upgrade
          </Button>
        </div>
      </Card>
    );
  }

  if (loading || rows === null) {
    return (
      <Card variant="flat" padding="sm">
        <div role="status" aria-live="polite" aria-label="Loading leaderboard">
          <Skeleton className="h-12 w-full rounded" />
        </div>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card variant="flat" padding="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">
          No leaderboard data yet.
        </p>
      </Card>
    );
  }

  const visibleRows = expanded ? rows : rows.slice(0, 3);

  return (
    <Card variant="flat" padding="sm">
      <div className="flex items-center gap-2 mb-2">
        <Trophy className="size-4 text-[var(--color-primary)]" aria-hidden />
        <span className="text-sm font-semibold text-[var(--color-text)]">Leaderboard</span>
      </div>
      <ol
        className="space-y-1 text-sm tabular-nums"
        aria-label="Top community members"
      >
        {visibleRows.map((row) => (
          <li
            key={`${row.rank_in_space}-${row.handle}`}
            className="flex items-center gap-2"
          >
            <span className="text-[var(--color-text-secondary)] w-6 text-right">
              {row.rank_in_space}
            </span>
            <span className="text-[var(--color-text)] flex-1 truncate">@{row.handle}</span>
            <span className="text-[var(--color-text-secondary)]">{row.score}</span>
          </li>
        ))}
      </ol>
      {rows.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 text-xs text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
        >
          {expanded ? 'Show top 3' : 'View full leaderboard'}
        </button>
      )}
    </Card>
  );
}

export default LeaderboardChip;
