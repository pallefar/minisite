/**
 * Phase 27 plan 27-04 — useAnomalyAlerts Realtime hook.
 *
 * Subscribes to the broadcast-mode channel that funnel-anomaly-cron writes
 * to on each fired alert. NOT postgres_changes — see migration 20260601000032
 * header for the broadcast-vs-postgres_changes decision (latency + non-PHI).
 *
 * Channel: 'funnel_anomaly_alerts'
 * Event:   'anomaly_fired'
 * Payload shape: must match the broadcast payload constructed in
 *   supabase/functions/funnel-anomaly-cron/index.ts.
 *
 * Pattern: copied verbatim from leanshot/src/components/clinic/roster/use-roster-realtime.ts
 * per CONTEXT D-17 + 27-PATTERNS D7. Cleanup via removeChannel on unmount.
 */
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface AnomalyAlertPayload {
  funnel_id: string;
  alert_id: string;
  fired_at: string;
  observed_count: number;
  expected_mean: number;
  expected_stddev: number;
  z_score: number;
  funnel_name?: string;
}

export interface UseAnomalyAlertsOptions {
  onAlert: (payload: AnomalyAlertPayload) => void;
}

export function useAnomalyAlerts({ onAlert }: UseAnomalyAlertsOptions): void {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (broadcastPayload: any) => {
      const inner = broadcastPayload?.payload as AnomalyAlertPayload | undefined;
      if (
        inner?.funnel_id &&
        typeof inner.alert_id === 'string' &&
        typeof inner.z_score === 'number'
      ) {
        onAlert(inner);
      }
    };

    const channel = supabase
      .channel('funnel_anomaly_alerts')
      .on('broadcast', { event: 'anomaly_fired' }, handler)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // onAlert excluded from deps — callers should memoize. Re-subscribing
    // every render would be wasteful (use-roster-realtime applies the same
    // pattern).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
