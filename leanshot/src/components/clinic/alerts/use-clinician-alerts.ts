/**
 * Phase 30 Plan 03 — useClinicianAlerts query hook.
 *
 * Fetches pending + snoozed + recent (last 7 days) clinician alerts for
 * the given org, joined client-side with profile display_names.
 *
 * Pattern: useEffect + useState (matches existing clinic/roster pattern;
 * project does NOT use @tanstack/react-query).
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type AlertStatus = 'pending' | 'snoozed' | 'acknowledged' | 'auto_resolved' | 'delivery_failed';
export type AlertType = 'dose_adherence' | 'dose_variance';

export interface ClinicianAlert {
  id: string;
  org_id: string;
  patient_user_id: string;
  alert_type: AlertType;
  status: AlertStatus;
  threshold_snapshot: Record<string, unknown>;
  created_at: string;
  snooze_until: string | null;
  ack_at: string | null;
  ack_by: string | null;
  /** Joined from profiles.display_name — non-PHI per UI-SPEC §PHI discipline */
  display_name: string | null;
}

export interface UseClinicianAlertsResult {
  data: ClinicianAlert[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Seven days in milliseconds for the lookback window */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function useClinicianAlerts({ orgId }: { orgId: string }): UseClinicianAlertsResult {
  const [data, setData] = useState<ClinicianAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!orgId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

    async function load() {
      // 1. Fetch alerts
      const { data: alertRows, error: alertErr } = await supabase
        .from('clinician_alerts')
        .select('id, org_id, patient_user_id, alert_type, status, threshold_snapshot, created_at, snooze_until, ack_at, ack_by')
        .eq('org_id', orgId)
        .in('status', ['pending', 'snoozed', 'acknowledged', 'auto_resolved', 'delivery_failed'])
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      if (cancelled) return;

      if (alertErr) {
        setError(alertErr.message);
        setIsLoading(false);
        return;
      }

      const rows = alertRows ?? [];

      // 2. Join display_names from profiles (client-side; display_name is non-PHI)
      const patientIds = [...new Set(rows.map((r) => r.patient_user_id))];

      let displayNameMap: Record<string, string> = {};

      if (patientIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', patientIds);

        if (!cancelled && profiles) {
          displayNameMap = Object.fromEntries(
            profiles.map((p: { id: string; display_name: string | null }) => [p.id, p.display_name ?? '']),
          );
        }
      }

      if (!cancelled) {
        setData(
          rows.map((r) => ({
            ...r,
            display_name: displayNameMap[r.patient_user_id] ?? null,
          })) as ClinicianAlert[],
        );
        setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [orgId, tick]);

  return { data, isLoading, error, refetch };
}

/** Group alerts into pending / snoozed / resolved buckets */
export function groupByStatus(alerts: ClinicianAlert[]) {
  return {
    pending: alerts.filter((a) => a.status === 'pending'),
    snoozed: alerts.filter((a) => a.status === 'snoozed'),
    resolved: alerts.filter((a) =>
      a.status === 'acknowledged' || a.status === 'auto_resolved' || a.status === 'delivery_failed',
    ),
  };
}
