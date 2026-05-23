/**
 * Phase 44 Plan 09 — CommunitySpaceList.
 *
 * Tier-gated space directory:
 *   - Accessible spaces: interactive card → onSelectSpace(id)
 *   - Locked spaces (D-08): lock-icon card with "Upgrade" CTA → /pricing.
 *     Post bodies NOT rendered on locked cards.
 *   - Org-private spaces (org_id IS NOT NULL, caller not org_member): hidden
 *     entirely by RLS (D-09) — no client-side org check needed.
 *
 * RLS (44-01) filters org-private spaces the caller is not a member of before
 * the rows ever reach the client, so we never need to check org_id client-side.
 */
import { useEffect, useState } from 'react';

import { Lock } from 'lucide-react';

import { canAccessSpace } from '@/lib/community/tier-gate';
import type { TierLabel } from '@/lib/community/tier-gate';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpaceRow {
  id: string;
  name: string;
  description: string | null;
  org_id: string | null;
  min_tier: 'free' | 'pro' | 'lifetime';
}

export interface CommunitySpaceListProps {
  currentUserId: string;
  currentTier: TierLabel;
  onSelectSpace: (spaceId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunitySpaceList({
  currentTier,
  onSelectSpace,
}: CommunitySpaceListProps) {
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('community_spaces')
        .select('id, name, description, org_id, min_tier')
        .order('created_at', { ascending: false });

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setSpaces((data ?? []) as SpaceRow[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]" role="status" aria-live="polite">
        Loading spaces…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-[var(--color-danger)]" role="alert">
        Failed to load spaces: {error}
      </div>
    );
  }

  if (spaces.length === 0) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]">
        No community spaces available yet.
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Community spaces"
    >
      {spaces.map((space) => {
        const canAccess = canAccessSpace(space.min_tier, currentTier);

        if (!canAccess) {
          // D-08: locked card — show name + lock icon + upgrade CTA.
          // Do NOT render description body.
          const upgradeLabel =
            space.min_tier === 'lifetime' ? 'Lifetime' : 'Pro';

          return (
            <div
              key={space.id}
              className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 opacity-80"
              aria-label={`Locked space: ${space.name}, upgrade required`}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-elevated)]"
                  aria-hidden="true"
                >
                  <Lock className="size-4 text-[var(--color-text-secondary)]" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                    {space.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    Upgrade to {upgradeLabel} to join
                  </p>
                </div>
              </div>
              <a
                href="/pricing"
                className="mt-4 inline-flex h-8 items-center rounded-full bg-[var(--color-primary)] px-4 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                Upgrade
              </a>
            </div>
          );
        }

        // Accessible space — interactive card.
        return (
          <button
            key={space.id}
            onClick={() => onSelectSpace(space.id)}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label={`Open space: ${space.name}`}
          >
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {space.name}
            </p>
            {space.description && (
              <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-secondary)]">
                {space.description}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
              <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 capitalize">
                {space.min_tier}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
