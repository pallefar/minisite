/**
 * Phase 65 Plan 65-09 — useSubscription hook.
 * Phase 65.1 fix (2026-05-27): the original implementation read `user.id` from the
 * Zustand `User` (a local-first profile shape with no `id` field). RLS still gates
 * SELECT to `user_id = auth.uid()`, so the hook now derives the auth user id from
 * `supabase.auth` and lets RLS apply the per-user filter implicitly.
 *
 * Fetches the current user's most-recent subscription row from Supabase and
 * keeps it fresh via window-focus + 60s polling. Returns `{ subscription: null,
 * loading: false }` when no auth user is signed in (matches the local-first
 * invariant — anonymous users never have a subscription row).
 *
 * Consumers:
 *   - PaymentFailedBanner — reads subscription.dunning_state to drive copy.
 *   - RefundRequestForm — reads subscription.id for the refund POST.
 *
 * Design notes:
 *   - SELECT is RLS-gated to user_id = auth.uid() (Phase 65-01 migration).
 *   - No explicit `.eq('user_id', ...)` filter — RLS handles per-user scoping.
 *   - Returns the most-recent row (.order('created_at', desc).limit(1)) so a
 *     canceled-then-resumed flow shows the new row, not the old.
 *   - `refresh()` is exposed so the banner can re-pull after the user updates
 *     their payment method via the Stripe Customer Portal.
 *   - 60s poll interval cleared on unmount; window-focus + auth-state listeners
 *     removed too.
 *   - Reacts to onAuthStateChange — sign-out clears the cached subscription;
 *     sign-in refetches.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Subscription } from '@/types';

const POLL_INTERVAL_MS = 60_000;

export interface UseSubscriptionResult {
  subscription: Subscription | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Resolve current auth user once on mount + react to auth state changes.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setAuthUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const fetchSubscription = useCallback(async (): Promise<void> => {
    if (!authUserId) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    try {
      // RLS gates SELECT to user_id = auth.uid(); no explicit .eq needed.
      const { data, error } = await supabase
        .from('subscriptions')
        .select(
          'id, status, trial_end_at, dunning_state, last_dunning_email_at, current_period_end, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Silent — leave existing subscription cached.
        return;
      }
      setSubscription((data ?? null) as Subscription | null);
    } finally {
      setLoading(false);
    }
  }, [authUserId]);

  useEffect(() => {
    void fetchSubscription();
    if (!authUserId) return;
    const interval = window.setInterval(() => {
      void fetchSubscription();
    }, POLL_INTERVAL_MS);
    const onFocus = (): void => {
      void fetchSubscription();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchSubscription, authUserId]);

  return { subscription, loading, refresh: fetchSubscription };
}
