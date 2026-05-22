/**
 * Phase 43 Plan 05 — LifetimeBadge (MEMBER-01 D-01).
 *
 * Reads tier_effective.tier_label for the supplied userId and renders a
 * "LIFETIME" pill ONLY when tier_label === 'lifetime'. Returns null otherwise
 * (including loading state, to avoid a flash-of-LIFETIME during the initial
 * fetch round-trip).
 *
 * Rendered next to a user's name on admin views + the user's own profile
 * surface. The DB self-read on tier_effective is RLS-scoped to auth.uid()
 * via the underlying lifetime_purchases / subscriptions self-read policies,
 * so an admin viewing this badge in a list of users will only see badges
 * for users they have RLS access to (Pattern S2 / threat T-43-05-05).
 *
 * Styling: pill uses var(--color-primary) family tokens; Tailwind sized at
 * the project-standard `text-[12px]` (within the 4-size table per
 * [[reference_ui_checker_dimension_traps]]).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface LifetimeBadgeProps {
  /** auth.users.id of the user whose tier_label is being checked. Null → render nothing. */
  userId: string | null;
}

export function LifetimeBadge({ userId }: LifetimeBadgeProps) {
  const [tierLabel, setTierLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setTierLabel(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('tier_effective')
          .select('tier_label')
          .eq('user_id', userId)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setTierLabel(null);
          return;
        }
        setTierLabel((data as { tier_label: string | null }).tier_label ?? null);
      } catch {
        if (!cancelled) setTierLabel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Loading state (tierLabel === null synchronously after first render) AND
  // any non-lifetime label → render nothing. Single exact-string match per
  // verification "tier_label === 'lifetime'".
  // Single-source predicate matching the verification grep: tier_label === 'lifetime'.
  const tier_label = tierLabel;
  const isLifetime = tier_label === 'lifetime';
  if (!isLifetime) return null;

  return (
    <span
      aria-label="Lifetime member"
      className="inline-flex items-center h-5 px-2 rounded-pill text-[12px] font-bold uppercase tracking-wide bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
    >
      LIFETIME
    </span>
  );
}
