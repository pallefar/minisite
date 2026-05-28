/**
 * Phase 51 Plan 51-07 (TRAFFIC-06 / TRAFFIC-11 / TRAFFIC-12) — Funnels tab.
 *
 * Replaces the Plan 51-05 stub. Implements the per-audience funnel rollup
 * surface for the growth/traffic admin module:
 *
 *   - 3-pill audience switcher (Consumer / Clinic-org / Affiliate, default
 *     Consumer). aria-pressed semantics drive the active state — same
 *     contract as the dashboard shell's PillGroup tabs.
 *   - Server-authoritative funnel-stage rollup via SECDEF RPC
 *     `get_traffic_funnel_rollup(p_org_id, p_start_date, p_end_date,
 *     p_audience)` (Plan 51-03 migration 20271102000012). Org scope is
 *     auto-derived from `useStore` — clinic_owner accounts forward their
 *     `org_id` so the RPC org-gate (`_is_org_clinician`) returns that
 *     org's rows; admin accounts pass `null` for cross-org visibility.
 *   - BaseChart (chart.js) bar chart with two datasets per stage_pair
 *     (Entered vs Advanced). Plus a parallel `<ul>` list with rate %, raw
 *     count, and an anomaly Badge when the stage has a matching
 *     `admin_notifications` row (kind = 'traffic_funnel_drop', written by
 *     the Plan 51-04 funnel-anomaly-cron Edge Fn). Click a stage row to
 *     open a drill-in Sheet with the top-5 channel-origin breakdown
 *     re-aggregated from the same RPC rows.
 *   - Anomaly badge tone="warning"; copy "Below 7-day baseline by Xσ"
 *     (matches UI-SPEC §Color row "Warning"). Visual surface ONLY — no
 *     client-side recomputation; admin_notifications is the source of
 *     truth (T-51-33 mitigation).
 *
 * Slot contract (must match TrafficDashboardPage.tsx lazy import):
 *   - Named export `TrafficFunnelsTab: React.FC` (zero props)
 *   - Module path `@/components/admin/growth/TrafficFunnelsTab`
 *   - Default export retained for debugger ergonomics; lazy unwrap pulls
 *     the named export explicitly.
 *
 * Typography ceiling (UI-SPEC §Type): 11 / 13 / 18 / 28 px only.
 * No TanStack-Query import (UI-SPEC Hard Constraint 5 inherited from
 * Phase 39 — native useEffect-driven fetch only).
 *
 * Threat mitigations referenced inline:
 *   T-51-31 — SECDEF RPC + `orgFilter` forced for clinic_owner role.
 *   T-51-32 — admin_notifications read is admin-only per P27 RLS.
 *   T-51-33 — client `(out / in) * 100` is presentation-only; rates from
 *             matview are authoritative.
 */
import type { ChartConfiguration } from 'chart.js';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import { useOrgScope } from './useOrgScope';

// ─── Audience taxonomy (CONTEXT.md D-05) ─────────────────────────────────────
//
// Three parallel funnels keyed by audience. Stage strings MUST match the
// `stage_pairs` VALUES list inside migration 20271102000009 (the matview's
// CTE; see file comment line 30+). Renaming a stage here without an
// accompanying migration silently empties the funnel — sequence-coupled.

export type Audience = 'consumer' | 'clinic-org' | 'affiliate';

type StagePair = {
  stage_in: string;
  stage_out: string;
  label_in: string;
  label_out: string;
};

const STAGE_LABELS: Record<Audience, StagePair[]> = {
  consumer: [
    { stage_in: 'visit', stage_out: 'signup', label_in: 'Visit', label_out: 'Signup' },
    {
      stage_in: 'signup',
      stage_out: 'activation',
      label_in: 'Signup',
      label_out: 'Activation',
    },
    {
      stage_in: 'activation',
      stage_out: 'paid',
      label_in: 'Activation',
      label_out: 'Paid',
    },
  ],
  'clinic-org': [
    {
      stage_in: 'visit',
      stage_out: 'clinic_signup',
      label_in: 'Visit',
      label_out: 'Clinic Signup',
    },
    {
      stage_in: 'clinic_signup',
      stage_out: 'first_patient_added',
      label_in: 'Clinic Signup',
      label_out: 'First Patient',
    },
    {
      stage_in: 'first_patient_added',
      stage_out: 'first_paid_seat',
      label_in: 'First Patient',
      label_out: 'First Paid Seat',
    },
  ],
  affiliate: [
    {
      stage_in: 'visit',
      stage_out: 'affiliate_signup',
      label_in: 'Visit',
      label_out: 'Affiliate Signup',
    },
    {
      stage_in: 'affiliate_signup',
      stage_out: 'first_referral_conversion',
      label_in: 'Affiliate Signup',
      label_out: 'First Referral',
    },
  ],
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  consumer: 'Consumer',
  'clinic-org': 'Clinic-org',
  affiliate: 'Affiliate',
};

// ─── Row types ───────────────────────────────────────────────────────────────

/**
 * Matches `public.traffic_funnel_rollup` columns returned by the SECDEF
 * accessor (`get_traffic_funnel_rollup`). Only the columns this surface
 * consumes are typed; the matview also carries `audience`, `day`,
 * `org_id`, `funnel`, `rate` which we ignore (we re-aggregate client-side
 * because rates roll up by sum-of-counts, not avg-of-rates).
 */
type FunnelRow = {
  channel_group: string;
  stage_in: string;
  stage_out: string;
  in_count: number;
  out_count: number;
  rate: number;
};

/**
 * Shape of the `payload` jsonb column on `admin_notifications` rows written
 * by the Plan 51-04 funnel-anomaly-cron. Only the fields we surface in the
 * badge are typed; cron writes additional metadata (baseline_rate,
 * observed_rate) which is informational only.
 */
type AnomalyPayload = {
  channel_group: string;
  audience: string;
  stage_in: string;
  stage_out: string;
  sigmas: number;
};

type StageDisplayRow = StagePair & {
  in_count: number;
  out_count: number;
  rate: number;
  has_anomaly: boolean;
  max_sigma: number;
};

// ─── Date helpers ────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Component ───────────────────────────────────────────────────────────────

export const TrafficFunnelsTab: React.FC = () => {
  const [audience, setAudience] = useState<Audience>('consumer');
  const [rows, setRows] = useState<FunnelRow[] | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [drillStage, setDrillStage] = useState<StagePair | null>(null);

  // Role-aware org scope. clinic_owner forwards their org_id so the SECDEF
  // RPC's `_is_org_clinician` gate matches; admin/superadmin pass null for
  // cross-org visibility (T-51-31 mitigation). Reading defensively so an
  // unauthenticated state doesn't crash; the SECDEF RPC will 28000 unauth
  // and we surface that as an error.
  // REVIEW WR-04: org scoping via useOrgScope() (single source of truth).
  const orgFilter = useOrgScope();

  // 7-day rolling window (matches Plan 51-04 baseline window so anomaly
  // badges line up with the data the operator sees in the chart).
  const today = useMemo(() => isoDate(new Date()), []);
  const sevenAgo = useMemo(() => isoDate(new Date(Date.now() - 7 * 86_400_000)), []);

  // 24h window for anomaly notifications — cron fires hourly so a 24h
  // window captures multiple ticks; dedup_key in cron prevents duplicate
  // payloads for the same (channel_group, audience, stage_pair, date).
  const anomalySince = useMemo(() => new Date(Date.now() - 24 * 3_600_000).toISOString(), []);

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data: funnelData, error: rpcErr }, { data: anomalyData, error: notifErr }] =
      await Promise.all([
        supabase.rpc('get_traffic_funnel_rollup', {
          p_org_id: orgFilter,
          p_start_date: sevenAgo,
          p_end_date: today,
          p_audience: audience,
        }),
        // admin_notifications is admin-only per P27 RLS (T-51-32). When
        // clinic_owner role reads, the SELECT returns 0 rows under RLS and
        // we silently treat that as "no anomalies" — the badge surface
        // simply doesn't appear, which is the intended behavior since
        // anomaly internals shouldn't leak across orgs.
        supabase
          .from('admin_notifications')
          .select('payload')
          .eq('kind', 'traffic_funnel_drop')
          .gte('created_at', anomalySince),
      ]);

    if (rpcErr) {
      if (rpcErr.code === '42501') {
        setError('Permission denied — admin role required');
      } else if (rpcErr.code === '28000') {
        setError('Not signed in — sign in to view traffic funnels');
      } else {
        setError(`Failed to load funnel — ${rpcErr.message}`);
      }
      setRows(null);
      setAnomalies([]);
    } else {
      setRows((funnelData as FunnelRow[]) ?? []);
      if (!notifErr && anomalyData) {
        setAnomalies(
          (anomalyData as Array<{ payload: AnomalyPayload }>)
            .map((r) => r.payload)
            .filter(
              (p): p is AnomalyPayload =>
                p != null &&
                typeof p === 'object' &&
                typeof (p as AnomalyPayload).channel_group === 'string',
            ),
        );
      } else {
        // Failed admin_notifications read (e.g. clinic_owner RLS deny) is
        // non-fatal — the funnel chart still renders, just without the
        // anomaly badges.
        setAnomalies([]);
      }
    }
    setLoading(false);
  }, [orgFilter, audience, sevenAgo, today, anomalySince]);

  useEffect(() => {
    void fetchFunnel();
  }, [fetchFunnel]);

  // ─── Aggregate rows per stage_pair (sum across channel_groups + days) ───
  //
  // The matview is stored at the (audience, channel_group, day, org_id,
  // stage_in, stage_out) grain. The top-of-page chart needs the
  // aggregated stage rollup; the drill-in Sheet re-uses the un-aggregated
  // rows to surface per-channel_group breakdowns.

  const stageRows = useMemo<StageDisplayRow[] | null>(() => {
    if (!rows) return null;
    return STAGE_LABELS[audience].map((sp) => {
      const matching = rows.filter(
        (r) => r.stage_in === sp.stage_in && r.stage_out === sp.stage_out,
      );
      const in_count = matching.reduce((acc, r) => acc + (r.in_count ?? 0), 0);
      const out_count = matching.reduce((acc, r) => acc + (r.out_count ?? 0), 0);
      const rate = in_count > 0 ? out_count / in_count : 0;
      const stageAnomalies = anomalies.filter(
        (a) =>
          a.audience === audience && a.stage_in === sp.stage_in && a.stage_out === sp.stage_out,
      );
      const has_anomaly = stageAnomalies.length > 0;
      const max_sigma = stageAnomalies.reduce((m, a) => Math.max(m, Math.abs(a.sigmas ?? 0)), 0);
      return { ...sp, in_count, out_count, rate, has_anomaly, max_sigma };
    });
  }, [rows, anomalies, audience]);

  // ─── Chart config (chart.js bar) ─────────────────────────────────────────

  const chartConfig = useMemo<ChartConfiguration | null>(() => {
    if (!stageRows) return null;
    return {
      type: 'bar',
      data: {
        labels: stageRows.map((s) => `${s.label_in} → ${s.label_out}`),
        datasets: [
          {
            label: 'Entered',
            data: stageRows.map((s) => s.in_count),
            backgroundColor: 'rgba(120, 120, 120, 0.55)',
          },
          {
            label: 'Advanced',
            data: stageRows.map((s) => s.out_count),
            backgroundColor: 'rgba(74, 144, 226, 0.85)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'bottom' },
        },
        scales: {
          y: { beginAtZero: true },
        },
      },
    };
  }, [stageRows]);

  // ─── Drill-in: top-5 channels for the selected stage pair ────────────────

  const drillRows = useMemo(() => {
    if (!drillStage || !rows) return [] as Array<[string, { in: number; out: number }]>;
    const acc: Record<string, { in: number; out: number }> = {};
    for (const r of rows) {
      if (r.stage_in !== drillStage.stage_in || r.stage_out !== drillStage.stage_out) {
        continue;
      }
      const cg = r.channel_group ?? '(unknown)';
      acc[cg] = acc[cg] ?? { in: 0, out: 0 };
      acc[cg].in += r.in_count ?? 0;
      acc[cg].out += r.out_count ?? 0;
    }
    return Object.entries(acc)
      .sort(([, a], [, b]) => b.in - a.in)
      .slice(0, 5);
  }, [drillStage, rows]);

  const allZero = stageRows != null && stageRows.every((s) => s.in_count === 0);

  return (
    <section aria-label="Conversion funnels">
      {/* ── Header row ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
          Conversion Funnels
        </h2>
        <div className="flex items-center gap-2">
          <PillGroup aria-label="Audience">
            {(['consumer', 'clinic-org', 'affiliate'] as Audience[]).map((a) => (
              <Pill
                key={a}
                size="sm"
                active={audience === a}
                onClick={() => setAudience(a)}
                aria-label={`${AUDIENCE_LABEL[a]} audience`}
              >
                {AUDIENCE_LABEL[a]}
              </Pill>
            ))}
          </PillGroup>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RefreshCw size={12} aria-hidden />}
            onClick={() => void fetchFunnel()}
            aria-label="Refresh funnel data"
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Loading / error / empty / data ───────────────────────────── */}

      {loading && <Skeleton className="h-64 w-full rounded-card" data-testid="funnel-skeleton" />}

      {error && !loading && (
        <Card variant="flat" padding="md">
          <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
        </Card>
      )}

      {!loading && !error && allZero && (
        <Card variant="flat" padding="md">
          <EmptyState
            inline
            title={`No funnel data for ${AUDIENCE_LABEL[audience]}`}
            body={`No ${AUDIENCE_LABEL[audience]} cohort recorded in the selected window. Switch audience or widen the range.`}
          />
        </Card>
      )}

      {!loading && !error && stageRows && !allZero && chartConfig && (
        <Card padding="md">
          {/* Bar chart — Entered vs Advanced per stage_pair */}
          <BaseChart
            config={chartConfig}
            ariaLabel={`${AUDIENCE_LABEL[audience]} funnel — entered and advanced counts per stage`}
            height={280}
          />

          {/* Per-stage list with rate + drill-in tap + anomaly badge */}
          <ul className="mt-4 space-y-2" aria-live="polite" aria-label="Funnel stage breakdown">
            {stageRows.map((s) => (
              <li
                key={`${s.stage_in}_${s.stage_out}`}
                className="flex items-center justify-between gap-3"
              >
                <button
                  className="text-[13px] text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-sm"
                  type="button"
                  onClick={() =>
                    setDrillStage({
                      stage_in: s.stage_in,
                      stage_out: s.stage_out,
                      label_in: s.label_in,
                      label_out: s.label_out,
                    })
                  }
                  aria-label={`Drill into ${s.label_in} to ${s.label_out} stage`}
                >
                  {s.label_in} {'→'} {s.label_out}:{' '}
                  <span className="numerals-tabular">{(s.rate * 100).toFixed(1)}%</span> {'•'}{' '}
                  <span className="numerals-tabular">{s.in_count.toLocaleString()}</span> entered
                </button>
                {s.has_anomaly && (
                  <Badge
                    tone="warning"
                    leadingIcon={<AlertTriangle size={12} aria-hidden />}
                    aria-label={`Anomaly: below 7-day baseline by ${s.max_sigma.toFixed(1)} sigma`}
                  >
                    Below 7-day baseline by {s.max_sigma.toFixed(1)}σ
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Drill-in Sheet ─────────────────────────────────────────────── */}

      <Sheet
        open={drillStage != null}
        onClose={() => setDrillStage(null)}
        title={
          drillStage
            ? `Channel origin — ${drillStage.label_in} → ${drillStage.label_out}`
            : undefined
        }
      >
        {drillStage && (
          <div className="pt-2">
            <p className="text-[11px] text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-3">
              Top 5 channels — {AUDIENCE_LABEL[audience]} cohort
            </p>
            {drillRows.length === 0 ? (
              <EmptyState
                inline
                title="No channel data"
                body="No channel_group rows recorded for this stage in the selected window."
              />
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] text-start border-b border-[var(--color-border)]">
                    <th className="py-2 pe-3">Channel</th>
                    <th className="py-2 pe-3 text-end">Entered</th>
                    <th className="py-2 pe-3 text-end">Advanced</th>
                    <th className="py-2 text-end">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {drillRows.map(([cg, vals]) => (
                    <tr key={cg} className="border-b border-[var(--color-border)]">
                      <td className="py-2 pe-3 font-medium">{cg}</td>
                      <td className="py-2 pe-3 text-end numerals-tabular">
                        {vals.in.toLocaleString()}
                      </td>
                      <td className="py-2 pe-3 text-end numerals-tabular">
                        {vals.out.toLocaleString()}
                      </td>
                      <td className="py-2 text-end numerals-tabular">
                        {vals.in > 0 ? `${((vals.out / vals.in) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Sheet>
    </section>
  );
};

export default TrafficFunnelsTab;
