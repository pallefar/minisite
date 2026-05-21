/**
 * Phase 35 Plan 35-05 GAME-05/08 — ChallengeList admin component.
 *
 * Lists weekly challenges with filter by status.
 * Active challenges with 2 variants show a "Ship Winner" dropdown button
 * that calls both:
 *   1. ship_winner_challenge_variant SECDEF RPC (DB-side: archive old + write new active)
 *   2. ship-winner-flag Edge Fn (PostHog-side: flip feature flag per D-20)
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import { shipWinnerChallengeVariant, ChallengeApiError } from '@/lib/gamification/admin-api';
import type { WeeklyChallenge, ChallengeStatus, ChallengeVariantKey } from '@/lib/gamification/challenges';

interface ChallengeWithVariantCount extends WeeklyChallenge {
  variant_count: number;
}

const STATUS_FILTERS: Array<{ value: ChallengeStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_COLORS: Record<ChallengeStatus, string> = {
  draft: 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  archived: 'bg-[var(--color-border)] text-[var(--color-text-secondary)]',
};

export default function ChallengeList() {
  const toast = useToast();
  const [challenges, setChallenges] = useState<ChallengeWithVariantCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ChallengeStatus | 'all'>('all');
  const [shippingId, setShippingId] = useState<string | null>(null);

  useEffect(() => {
    void loadChallenges();
  }, []);

  async function loadChallenges() {
    setLoading(true);
    const { data, error } = await supabase
      .from('weekly_challenges')
      .select(`
        *,
        challenge_variants(count)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      toast('Could not load challenges', 'error');
    } else {
      const rows = (data ?? []).map((row: WeeklyChallenge & { challenge_variants: Array<{ count: number }> }) => ({
        ...row,
        variant_count: row.challenge_variants?.[0]?.count ?? 0,
      }));
      setChallenges(rows as ChallengeWithVariantCount[]);
    }
    setLoading(false);
  }

  async function handleShipWinner(
    challenge: ChallengeWithVariantCount,
    winningVariant: ChallengeVariantKey,
  ) {
    setShippingId(challenge.id);
    try {
      await shipWinnerChallengeVariant(
        challenge.id,
        winningVariant,
        challenge.posthog_flag_id,
      );
      toast(`Shipped winner: Variant ${winningVariant} for "${challenge.title}"`, 'success');
      await loadChallenges();
    } catch (err) {
      if (err instanceof ChallengeApiError) {
        if (err.code === 'not_admin') {
          toast('You need support_lead or superadmin access to ship winners', 'error');
        } else if (err.code === 'variant_not_found') {
          toast('Variant not found — ensure both A and B variants exist', 'error');
        } else {
          toast(`Ship winner failed (${err.code})`, 'error');
        }
      } else {
        toast('Could not ship winner — try again', 'error');
      }
    } finally {
      setShippingId(null);
    }
  }

  const filtered = statusFilter === 'all'
    ? challenges
    : challenges.filter((c: ChallengeWithVariantCount) => c.status === statusFilter);

  return (
    <div className="space-y-4">
      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            aria-pressed={statusFilter === value}
            className={[
              'px-3 py-1 rounded-full text-xs font-medium transition-colors',
              statusFilter === value
                ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading challenges…</p>
      ) : filtered.length === 0 ? (
        <Card variant="flat" padding="lg">
          <p className="text-sm text-[var(--color-text-secondary)]">
            No challenges found.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((challenge: ChallengeWithVariantCount) => (
            <Card key={challenge.id} variant="elevated" padding="lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold truncate">{challenge.title}</h4>
                    <span
                      className={[
                        'inline-flex px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                        STATUS_COLORS[challenge.status],
                      ].join(' ')}
                    >
                      {challenge.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] mb-2 line-clamp-2">
                    {challenge.framing}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-secondary)]">
                    <span>Type: {challenge.challenge_type.replace('_', ' ')}</span>
                    <span>Threshold: {challenge.threshold}</span>
                    <span>Duration: {challenge.duration}</span>
                    {challenge.variant_count > 0 && (
                      <span>Variants: {challenge.variant_count}</span>
                    )}
                    {challenge.reward_xp > 0 && <span>XP: +{challenge.reward_xp}</span>}
                    {challenge.reward_freeze_tokens > 0 && (
                      <span>Freeze: +{challenge.reward_freeze_tokens}</span>
                    )}
                  </div>
                </div>

                {/* Ship Winner button — only for active challenges with 2 variants */}
                {challenge.status === 'active' && challenge.variant_count >= 2 && (
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <p className="text-xs text-[var(--color-text-secondary)] font-medium">Ship winner</p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        disabled={shippingId === challenge.id}
                        aria-busy={shippingId === challenge.id}
                        onClick={() => void handleShipWinner(challenge, 'A')}
                        className="text-xs px-2 py-1"
                      >
                        {shippingId === challenge.id ? '…' : 'Ship A'}
                      </Button>
                      <Button
                        type="button"
                        disabled={shippingId === challenge.id}
                        aria-busy={shippingId === challenge.id}
                        onClick={() => void handleShipWinner(challenge, 'B')}
                        className="text-xs px-2 py-1"
                      >
                        {shippingId === challenge.id ? '…' : 'Ship B'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
