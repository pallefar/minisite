/**
 * Phase 22 Plan 22-08 — Typed wrapper for admin_compute_mrr_arr RPC (ADMIN-02).
 *
 * Snake_case → camelCase domain shape mapping so React components consume
 * idiomatic TS. The Postgres RPC owns the auth gate (is_staff → 42501);
 * this wrapper surfaces RPC errors as Error so call sites can switch on
 * error message text.
 *
 * Cross-phase contract: the RPC reads public.tier_effective (Phase 19 D-04),
 * NOT raw subscriptions.tier — see migration 20270601000020 header.
 */
import { supabase } from '@/lib/supabase';

export type AdminMetricsPeriod = '7d' | '30d' | '90d' | '12m';

export interface ChurnSeriesBin {
  bucket: string;
  free: number;
  paid: number;
  churnPct: number;
}

export interface ClinicSeatRow {
  clinicId: string;
  clinicName: string;
  used: number;
  total: number;
  series: number[];
}

export interface AdminMetrics {
  period: AdminMetricsPeriod;
  mrrCents: number;
  arrCents: number;
  churnPct30d: number;
  paidCount: number;
  freeCount: number;
  pastDueCount: number;
  clinicSeatCount: number;
  churnSeries: ChurnSeriesBin[];
  clinicSeatUtilization: ClinicSeatRow[];
  computedAt: string;
}

interface RpcChurnSeries {
  bucket: string;
  free: number;
  paid: number;
  churn_pct: number;
}

interface RpcClinicSeat {
  clinic_id: string;
  clinic_name: string;
  used: number;
  total: number;
  series?: number[];
}

interface RpcShape {
  period: AdminMetricsPeriod;
  mrr_cents: number;
  arr_cents: number;
  churn_pct_30d: number;
  paid_count: number;
  free_count: number;
  past_due_count: number;
  clinic_seat_count: number;
  churn_series: RpcChurnSeries[];
  clinic_seat_utilization: RpcClinicSeat[];
  computed_at: string;
}

export async function fetchMetrics(opts?: {
  period?: AdminMetricsPeriod;
}): Promise<AdminMetrics> {
  const period = opts?.period ?? '30d';
  const { data, error } = await supabase.rpc('admin_compute_mrr_arr', {
    p_period: period,
  });
  if (error) {
    throw new Error(error.message ?? 'admin_compute_mrr_arr failed');
  }
  const raw = data as RpcShape;
  return {
    period: raw.period,
    mrrCents: raw.mrr_cents,
    arrCents: raw.arr_cents,
    churnPct30d: raw.churn_pct_30d,
    paidCount: raw.paid_count,
    freeCount: raw.free_count,
    pastDueCount: raw.past_due_count,
    clinicSeatCount: raw.clinic_seat_count,
    churnSeries: (raw.churn_series ?? []).map((b) => ({
      bucket: b.bucket,
      free: b.free,
      paid: b.paid,
      churnPct: b.churn_pct,
    })),
    clinicSeatUtilization: (raw.clinic_seat_utilization ?? []).map((c) => ({
      clinicId: c.clinic_id,
      clinicName: c.clinic_name,
      used: c.used,
      total: c.total,
      series: c.series ?? [],
    })),
    computedAt: raw.computed_at,
  };
}
