/**
 * Phase 65 Plan 65-09 — useSubscription hook.
 *
 * Fetches the current user's most-recent subscription row from Supabase and
 * keeps it fresh via window-focus + 60s polling. Reads user from the Zustand
 * store; returns { subscription: null, loading: false } when no user is signed
 * in (matches the local-first invariant — anonymous users never have a
 * subscription row).
 *
 * Consumers:
 *   - PaymentFailedBanner — reads subscription.dunning_state to drive copy.
 *   - RefundRequestForm — reads subscription.id for the refund POST.
 *
 * Design notes:
 *   - SELECT is RLS-gated to user_id = auth.uid() (Phase 65-01 migration).
 *   - Returns the most-recent row (.order('created_at', desc).limit(1)) so a
 *     canceled-then-resumed flow shows the new row, not the old.
 *   - `refresh()` is exposed so the banner can re-pull after the user updates
 *     their payment method via the Stripe Customer Portal.
 *   - 60s poll interval cleared on unmount; window-focus listener removed too.
 */
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { Subscription } from '@/types';

const POLL_INTERVAL_MS = 60_000;

export interface UseSubscriptionResult {
  subscription: Subscription | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const user = useStore((s) => s.user);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user?.id));

  const fetchSubscription = useCallback(async (): Promise<void> => {
    if (!user?.id) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select(
          'id, status, trial_end_at, dunning_state, last_dunning_email_at, current_period_end, created_at',
        )
        .eq('user_id', user.id)
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
  }, [user?.id]);

  useEffect(() => {
    void fetchSubscription();
    if (!user?.id) return;
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
  }, [fetchSubscription, user?.id]);

  return { subscription, loading, refresh: fetchSubscription };
}
