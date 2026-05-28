/**
 * Phase 30 Plan 04 — useClinicMetrics query hook.
 *
 * Fetches aggregate clinic metrics from two SECDEF RPCs (NOT direct matview reads
 * — direct mv_* reads are revoked at the DB level per Plan 30-00 Wave 0 deviation):
 *   - supabase.rpc('get_clinic_alert_metrics', { p_org_id })
 *   - supabase.rpc('get_clinic_dose_trend_population', { p_org_id })
 *   - supabase.from('clinic_matview_refresh_log').select(...)  (table open to authenticated)
 *
 * Returns a discriminated-union-friendly shape:
 *   { pendingThisWeek, ackRatePct, belowDosingRange, alertTypeBreakdown,
 *     lastRefreshedAt, isLoading, error }
 *
 * Matview deviation note: mv_clinic_alert_metrics and mv_clinic_dose_trend_population
 * RLS DDL is unsupported in Postgres; Plan 30-00 shipped SECDEF accessor functions
 * instead. Direct supabase.from('mv_*') calls will fail with permission denied.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertMetricsRow {
  alert_type: string;
  pending_count: number;
  acknowledged_count: number;
  ack_rate_pct: number | null;
  avg_time_to_ack_minutes: number | null;
}

export interface DoseTrendPopulationRow {
  name: string;
  dosing_range_status: string;
  patient_count: number;
}

export interface ClinicMetrics {
  pendingThisWeek: number;
  ackRatePct: number | null;
  belowDosingRange: number;
  alertTypeBreakdown: { dose_adherence: number; dose_variance: number };
  lastRefreshedAt: Date | null;
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useClinicMetrics(orgId: string | null): ClinicMetrics {
  const [metrics, setMetrics] = useState<ClinicMetrics>({
    pendingThisWeek: 0,
    ackRatePct: null,
    belowDosingRange: 0,
    alertTypeBreakdown: { dose_adherence: 0, dose_variance: 0 },
    lastRefreshedAt: null,
    isLoading: true,
    error: null,
  });

  const fetch = useCallback(async () => {
    if (!orgId) {
      setMetrics((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    setMetrics((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Parallel fetch: alert metrics + dose trend population + refresh log
      const [alertResult, doseResult, refreshResult] = await Promise.all([
        supabase.rpc('get_clinic_alert_metrics', { p_org_id: orgId }),
        supabase.rpc('get_clinic_dose_trend_population', { p_org_id: orgId }),
        supabase
          .from('clinic_matview_refresh_log')
          .select('view_name, refreshed_at')
          .in('view_name', ['mv_clinic_alert_metrics', 'mv_clinic_dose_trend_population']),
      ]);

      if (alertResult.error) {
        setMetrics((prev) => ({
          ...prev,
          isLoading: false,
          error: alertResult.error?.message ?? 'Failed to load alert metrics',
        }));
        return;
      }
      if (doseResult.error) {
        setMetrics((prev) => ({
          ...prev,
          isLoading: false,
          error: doseResult.error?.message ?? 'Failed to load dose metrics',
        }));
        return;
      }

      // Aggregate alert metrics
      const alertRows = (alertResult.data ?? []) as AlertMetricsRow[];
      const pendingThisWeek = alertRows.reduce((sum, r) => sum + (r.pending_count ?? 0), 0);

      // Aggregate ack rate — use the row-level ack_rate_pct for overall
      // (simple mean across alert types as an approximation)
      const ackRates = alertRows
        .map((r) => r.ack_rate_pct)
        .filter((v): v is number => v !== null && v !== undefined);
      const ackRatePct: number | null =
        ackRates.length > 0
          ? Math.round(ackRates.reduce((s, v) => s + v, 0) / ackRates.length)
          : null;

      // Alert type breakdown
      const dose_adherence = alertRows
        .filter((r) => r.alert_type === 'dose_adherence')
        .reduce((s, r) => s + (r.pending_count ?? 0), 0);
      const dose_variance = alertRows
        .filter((r) => r.alert_type === 'dose_variance')
        .reduce((s, r) => s + (r.pending_count ?? 0), 0);

      // Dose trend: count patients below dosing range
      const doseRows = (doseResult.data ?? []) as DoseTrendPopulationRow[];
      const belowDosingRange = doseRows
        .filter((r) => r.dosing_range_status === 'below')
        .reduce((s, r) => s + (r.patient_count ?? 0), 0);

      // Refresh log: max(refreshed_at)
      const refreshRows = (refreshResult.data ?? []) as {
        view_name: string;
        refreshed_at: string | null;
      }[];
      const refreshTimes = refreshRows
        .map((r) => (r.refreshed_at ? new Date(r.refreshed_at) : null))
        .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
      const lastRefreshedAt =
        refreshTimes.length > 0
          ? refreshTimes.reduce((max, d) => (d > max ? d : max), refreshTimes[0])
          : null;

      setMetrics({
        pendingThisWeek,
        ackRatePct,
        belowDosingRange,
        alertTypeBreakdown: { dose_adherence, dose_variance },
        lastRefreshedAt,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setMetrics((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load metrics',
      }));
    }
  }, [orgId]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return metrics;
}
