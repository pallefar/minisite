/**
 * Phase 30 Plan 03 — useClinicianAlertsRealtime hook.
 *
 * Subscribes to the org-scoped HMAC realtime channel for clinician alert
 * broadcasts. Mirrors use-roster-realtime.ts pattern but uses the Phase 28
 * HMAC channelNameFor helper for the 'alerts' suffix.
 *
 * Channel name: `org-{hmac8}-alerts` (computed by channelNameFor(orgId, 'alerts'))
 * Broadcast event: 'new_alert' with payload { alert_id, alert_type }
 *
 * Subscription failure (CHANNEL_ERROR) sets isSubscribed=false so the
 * consumer can render an inline warning — it does NOT throw.
 *
 * Per Plan 30-01: the deliver-cron broadcasts to this channel when it
 * successfully delivers an alert realtime notification.
 */

import { useEffect, useState } from 'react';
import { channelNameFor } from '@/lib/org-realtime';
import { supabase } from '@/lib/supabase';

export interface NewAlertPayload {
  alert_id: string;
  alert_type: string;
}

export interface UseClinicianAlertsRealtimeOptions {
  orgId: string;
  onNewAlert: (payload: NewAlertPayload) => void;
}

export interface UseClinicianAlertsRealtimeResult {
  isSubscribed: boolean;
}

export function useClinicianAlertsRealtime({
  orgId,
  onNewAlert,
}: UseClinicianAlertsRealtimeOptions): UseClinicianAlertsRealtimeResult {
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!orgId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    async function subscribe() {
      let topic: string;
      try {
        topic = await channelNameFor(orgId, 'alerts');
      } catch (err) {
        // channelNameFor failure (e.g. Vault secret unavailable) → treat as
        // subscription failure; set isSubscribed=false, do not throw.
        console.warn('[alerts-realtime] channelNameFor failed:', err);
        if (!cancelled) setIsSubscribed(false);
        return;
      }

      if (cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (broadcastPayload: any) => {
        const payload = broadcastPayload?.payload as NewAlertPayload | undefined;
        if (payload?.alert_id && payload.alert_type) {
          onNewAlert(payload);
        }
      };

      channel = supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'new_alert' }, handler)
        .subscribe((status: string) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            setIsSubscribed(true);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`[alerts-realtime] channel status: ${status} — live updates paused`);
            setIsSubscribed(false);
          }
        });
    }

    void subscribe();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
    // onNewAlert intentionally excluded — callers should memoize; re-subscribe on every render is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return { isSubscribed };
}
