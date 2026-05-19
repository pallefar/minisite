/**
 * Phase 42 Plan 42-08 — In-app notification renderer.
 *
 * Mounts the Supabase Realtime subscription to user_notifications and pipes
 * each incoming INSERT into the global useToast slice (D-07 realtime pipeline).
 * Only mounted inside the authenticated wrapper in App.tsx — subscribing
 * before the session resolves would race the supabase-js INITIAL_SESSION.
 *
 * The component renders nothing visually (returns null); the existing global
 * <Toast/> in AppShell renders the message. We deliberately use the existing
 * toast surface to avoid stacking a competing notification UI.
 */

import { useEffect } from 'react';
import { useToast } from '@/hooks/useToast';
import { subscribeToUserNotifications } from '@/lib/notifications/realtime';

/**
 * Phase 42 Plan 42-08 — In-app notification renderer.
 *
 * `notification_sent` is server_only:true (events.ts) — fired by
 * notification-send Edge Fn via _shared/posthog-server.ts (D-34 ITP/uBlock
 * resilience pattern). Do NOT call capture('notification_sent', ...) here:
 * capture() would throw in DEV because the EVENTS entry has server_only:true
 * + capture-side guards (see analytics/capture.ts).
 */
export function InAppNotificationToast({ userId }: { userId: string | null }) {
  const toast = useToast();

  useEffect(() => {
    if (!userId) return;

    const unsubscribe = subscribeToUserNotifications(userId, (row) => {
      if (row.channel !== 'in-app') return;
      const subject = row.payload?.subject;
      if (!subject) return;
      toast(subject, 'info');
    });

    return () => {
      unsubscribe();
    };
  }, [userId, toast]);

  return null;
}
