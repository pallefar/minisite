/**
 * Phase 51 Plan 51-06 (TRAFFIC-09, TRAFFIC-12) — Channels tab full implementation.
 *
 * Replaces the Plan 51-05 stub. Renders the channel rollup table backed by
 * `get_traffic_channel_rollup(p_org_id, p_start_date, p_end_date, p_touch_mode)`.
 *
 * Behavior contract:
 *   - Date-range pill toggle (Today / 7d / 30d, default 7d) → re-fetches.
 *   - First-touch / Last-touch pill toggle (default Last-touch per D-02).
 *     touchMode is passed as `p_touch_mode` ('first'|'last') to the SECDEF
 *     accessor; the accessor branches between `traffic_channel_rollup_first`
 *     and `traffic_channel_rollup` (last) — toggle changes the row set,
 *     NOT a UI-only no-op (per B4 revision iter-1).
 *   - Row click opens a Sheet drawer with retention sparkline + paid-channel
 *     CAC deep-link.
 *   - Permission-denied (42501) → "Permission denied — admin role required".
 *
 * Slot contract (DO NOT BREAK — Plan 51-05 shell imports this NAMED export
 * via lazy unwrap of `m.TrafficChannelsTab`):
 *   - `export const TrafficChannelsTab: React.FC` (zero-prop signature)
 *   - Module path: `@/components/admin/growth/TrafficChannelsTab`
 *
 * Typography ceiling: 11/13/18/28 only (per UI-SPEC §Typography).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sparkline } from '@/components/ui/Sparkline';
import { supabase } from '@/lib/supabase';
import { useOrgScope } from './useOrgScope';

// ─── Types ───────────────────────────────────────────────────────────────────

type ChannelRow = {
  channel_group: string;
  audience: string;
  day: string;
  org_id: string | null;
  visits: number;
  signups: number;
  activations: number;
  paids: number;
  ad_spend_usd: number | null;
  d1_retained_count: number;
  d7_retained_count: number;
  d14_retained_count: number;
  d30_retained_count: number;
  d60_retained_count: number;
  cac_to_activation: number | null;
  cac_to_paid: number | null;
};

type DateRange = 'today' | '7d' | '30d';
type TouchMode = 'first' | 'last';

// Paid-channel set (matches Phase 33 D-15 fixed mapping). Members get the
// CAC deep-link CTA in the drill-in drawer.
const PAID_CHANNELS = new Set(['Paid Search', 'Paid Social']);

// Aggregated row per channel_group (sums of per-day rows in the window).
type AggregatedRow = {
  channel_group: string;
  visits: number;
  signups: number;
  activations: number;
  paids: number;
  ad_spend_usd: number;
  d1_retained_count: number;
  d7_retained_count: number;
  d14_retained_count: number;
  d30_retained_count: number;
  d60_retained_count: number;
  // CAC is computed once over the aggregated window (sum(spend) / sum(activations)).
  cac_to_activation: number | null;
};

function n(value: number | null | undefined): number {
  return value == null || Number.isNaN(Number(value)) ? 0 : Number(value);
}

export const TrafficChannelsTab: React.FC = () => {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [touchMode, setTouchMode] = useState<TouchMode>('last');
  const [drawerChannel, setDrawerChannel] = useState<string | null>(null);

  // REVIEW WR-04: org scoping via useOrgScope() (single source — JWT
  // app_metadata.org_id). Previously inlined; extracted so all four Traffic
  // tabs read the same source. Admin sees all orgs (p_org_id = null);
  // clinic_owner is scoped to their JWT-anchored org.
  const orgFilter = useOrgScope();

  const dateBounds = useMemo(() => {
    const end = new Date();
    const start = new Date();
    if (dateRange === 'today') {
      // start == end (today's date)
    } else if (dateRange === '7d') {
      start.setDate(end.getDate() - 7);
    } else {
      start.setDate(end.getDate() - 30);
    }
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }, [dateRange]);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('get_traffic_channel_rollup', {
      p_org_id: orgFilter,
      p_start_date: dateBounds.start,
      p_end_date: dateBounds.end,
      p_touch_mode: touchMode,
    });
    if (rpcErr) {
      const msg = (rpcErr.message ?? '').toLowerCase();
      if (rpcErr.code === '42501' || msg.includes('permission') || msg.includes('forbidden')) {
        setError('Permission denied — admin role required');
      } else {
        setError(`Failed to load channels — ${rpcErr.message ?? 'unknown error'}`);
      }
      setRows(null);
    } else {
      setRows(((data ?? []) as ChannelRow[]));
    }
    setLoading(false);
  }, [orgFilter, dateBounds.start, dateBounds.end, touchMode]);

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  // Aggregate per channel_group across all days in the selected window.
  const tableRows = useMemo<AggregatedRow[] | null>(() => {
    if (!rows) return null;
    const m = new Map<string, AggregatedRow>();
    for (const r of rows) {
      const key = r.channel_group;
      const prev = m.get(key);
      if (prev) {
        prev.visits += n(r.visits);
        prev.signups += n(r.signups);
        prev.activations += n(r.activations);
        prev.paids += n(r.paids);
        prev.ad_spend_usd += n(r.ad_spend_usd);
        prev.d1_retained_count += n(r.d1_retained_count);
        prev.d7_retained_count += n(r.d7_retained_count);
        prev.d14_retained_count += n(r.d14_retained_count);
        prev.d30_retained_count += n(r.d30_retained_count);
        prev.d60_retained_count += n(r.d60_retained_count);
      } else {
        m.set(key, {
          channel_group: r.channel_group,
          visits: n(r.visits),
          signups: n(r.signups),
          activations: n(r.activations),
          paids: n(r.paids),
          ad_spend_usd: n(r.ad_spend_usd),
          d1_retained_count: n(r.d1_retained_count),
          d7_retained_count: n(r.d7_retained_count),
          d14_retained_count: n(r.d14_retained_count),
          d30_retained_count: n(r.d30_retained_count),
          d60_retained_count: n(r.d60_retained_count),
          cac_to_activation: null,
        });
      }
    }
    // Compute aggregated CAC = sum(ad_spend_usd) / sum(activations) per channel.
    const result = Array.from(m.values()).map((agg) => ({
      ...agg,
      cac_to_activation: agg.activations > 0 && agg.ad_spend_usd > 0
        ? agg.ad_spend_usd / agg.activations
        : null,
    }));
    return result.sort((a, b) => b.visits - a.visits);
  }, [rows]);

  const drawerRow = useMemo(
    () => tableRows?.find((r) => r.channel_group === drawerChannel) ?? null,
    [tableRows, drawerChannel],
  );

  const sectionTitle =
    dateRange === 'today'
      ? 'Channel Rollup (Today)'
      : dateRange === '7d'
        ? 'Channel Rollup (Last 7 Days)'
        : 'Channel Rollup (Last 30 Days)';

  return (
    <section>
      {/* ── Section header + toggles ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
          {sectionTitle}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <PillGroup segmented aria-label="Date range">
            <Pill
              size="sm"
              active={dateRange === 'today'}
              onClick={() => setDateRange('today')}
            >
              Today
            </Pill>
            <Pill
              size="sm"
              active={dateRange === '7d'}
              onClick={() => setDateRange('7d')}
            >
              7d
            </Pill>
            <Pill
              size="sm"
              active={dateRange === '30d'}
              onClick={() => setDateRange('30d')}
            >
              30d
            </Pill>
          </PillGroup>
          <PillGroup segmented aria-label="Touch attribution mode">
            <Pill
              size="sm"
              active={touchMode === 'first'}
              onClick={() => setTouchMode('first')}
            >
              First-touch
            </Pill>
            <Pill
              size="sm"
              active={touchMode === 'last'}
              onClick={() => setTouchMode('last')}
            >
              Last-touch
            </Pill>
          </PillGroup>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RefreshCw size={12} aria-hidden />}
            onClick={() => void fetchChannels()}
            aria-label="Refresh channel rollup"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Body states (loading / error / empty / table) ─────────────── */}
      {loading && <Skeleton className="h-64 w-full rounded-card" />}

      {!loading && error && (
        <Card variant="flat" padding="md">
          <p className="text-[13px] text-[var(--color-danger)] mb-3">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchChannels()}
            aria-label="Retry channel rollup"
          >
            Retry
          </Button>
        </Card>
      )}

      {!loading && !error && tableRows && tableRows.length === 0 && (
        <Card variant="flat" padding="md">
          <EmptyState
            inline
            title="No channel data yet"
            body="Channel rollup populates after the first matview refresh. Check back in ~15 minutes after first traffic lands."
          />
        </Card>
      )}

      {!loading && !error && tableRows && tableRows.length > 0 && (
        <Card variant="flat" padding="md">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] border-b border-[var(--color-border)]">
                  <th className="text-start py-2 pe-3">Channel</th>
                  <th className="text-end py-2 pe-3">Visits</th>
                  <th className="text-end py-2 pe-3">Signups</th>
                  <th className="text-end py-2 pe-3">Activations</th>
                  <th className="text-end py-2 pe-3">Paid</th>
                  <th className="text-end py-2 pe-3">D7 Retained</th>
                  <th className="text-end py-2 pe-3">D30 Retained</th>
                  <th className="text-end py-2 pe-3">CAC</th>
                  <th className="text-end py-2" aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr
                    key={r.channel_group}
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${r.channel_group} retention curve`}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)] cursor-pointer"
                    onClick={() => setDrawerChannel(r.channel_group)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDrawerChannel(r.channel_group);
                      }
                    }}
                  >
                    <td className="py-2 pe-3 font-medium">{r.channel_group}</td>
                    <td className="py-2 pe-3 text-end numerals-tabular">
                      {r.visits.toLocaleString()}
                    </td>
                    <td className="py-2 pe-3 text-end numerals-tabular">
                      {r.signups.toLocaleString()}
                    </td>
                    <td className="py-2 pe-3 text-end numerals-tabular">
                      {r.activations.toLocaleString()}
                    </td>
                    <td className="py-2 pe-3 text-end numerals-tabular">
                      {r.paids.toLocaleString()}
                    </td>
                    <td className="py-2 pe-3 text-end numerals-tabular">
                      {r.d7_retained_count.toLocaleString()}
                    </td>
                    <td className="py-2 pe-3 text-end numerals-tabular">
                      {r.d30_retained_count.toLocaleString()}
                    </td>
                    <td className="py-2 pe-3 text-end numerals-tabular">
                      {r.cac_to_activation != null
                        ? `$${r.cac_to_activation.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="py-2 text-end">
                      <ChevronRight
                        size={14}
                        className="text-[var(--color-primary)] inline"
                        aria-hidden
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Drill-in drawer ───────────────────────────────────────────── */}
      <Sheet
        open={drawerChannel != null}
        onClose={() => setDrawerChannel(null)}
        title={drawerRow ? `${drawerRow.channel_group} — retention curve` : 'Channel detail'}
      >
        {drawerRow && (
          <div className="space-y-4">
            <button
              type="button"
              className="flex items-center gap-1 text-[13px] text-[var(--color-primary)] hover:underline"
              onClick={() => setDrawerChannel(null)}
              aria-label="Back to channels"
            >
              ← Back to channels
            </button>

            <div>
              <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-2">
                Retention curve
              </p>
              <Sparkline
                values={[
                  drawerRow.d1_retained_count,
                  drawerRow.d7_retained_count,
                  drawerRow.d14_retained_count,
                  drawerRow.d30_retained_count,
                  drawerRow.d60_retained_count,
                ]}
                width={280}
                height={64}
                label={`Retention curve for ${drawerRow.channel_group}`}
              />
              <p className="text-[11px] text-[var(--color-text-secondary)] mt-2 numerals-tabular">
                D1 {drawerRow.d1_retained_count.toLocaleString()} • D7{' '}
                {drawerRow.d7_retained_count.toLocaleString()} • D14{' '}
                {drawerRow.d14_retained_count.toLocaleString()} • D30{' '}
                {drawerRow.d30_retained_count.toLocaleString()} • D60{' '}
                {drawerRow.d60_retained_count.toLocaleString()}
              </p>
            </div>

            {PAID_CHANNELS.has(drawerRow.channel_group) && (
              <a
                href={`/admin/growth/cac?channel=${encodeURIComponent(drawerRow.channel_group)}`}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-primary)] hover:underline"
              >
                View ad-spend detail
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </div>
        )}
      </Sheet>
    </section>
  );
};

export default TrafficChannelsTab;
