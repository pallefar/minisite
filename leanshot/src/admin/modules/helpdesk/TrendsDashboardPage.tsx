/**
 * Phase 37 Plan 37-08 Task 4 — TrendsDashboardPage (HELP-13).
 *
 * Queries helpdesk_tag_volume_view (created by this plan's migration) and
 * renders a stacked-bar chart of per-tag ticket volume over the last 7d/30d.
 *
 * Chart: Chart.js via BaseChart (Phase 33 wrapper). type: 'bar'; x and y
 * stacked; top 8 tags by total volume; remainder lumped into "other".
 *
 * Accessibility:
 *   - aria-label on canvas
 *   - hidden sr-only <table> mirrors the raw (date, tag, count) rows
 *   - Empty-state message when no data
 *
 * RLS: underlying tickets + ticket_tags RLS cascades through the view
 * (security_invoker=true on the view).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { supabase } from '@/lib/supabase';

interface VolumeRow {
  tag_name: string;
  bucket_day: string;
  ticket_count: number;
}

type RangeDays = 7 | 30;

const TOP_N = 8;

// Distinct hues for top-N tags. Deliberately limited to keep the legend
// readable; "other" gets a neutral grey.
const PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];
const OTHER_COLOR = '#9ca3af';

function isoSliceDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function TrendsDashboardPage(): React.JSX.Element {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [rows, setRows] = useState<VolumeRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const fromDate = isoSliceDate(new Date(Date.now() - rangeDays * 86_400_000));
    const { data, error } = (await supabase
      .from('helpdesk_tag_volume_view')
      .select('tag_name, bucket_day, ticket_count')
      .gte('bucket_day', fromDate)
      .order('bucket_day', { ascending: true })) as {
      data: VolumeRow[] | null;
      error: { message: string } | null;
    };
    setLoading(false);
    if (error) {
      setErr(error.message);
      setRows([]);
      return;
    }
    setRows(data ?? []);
  }, [rangeDays]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Aggregate rows into Chart.js shape + identify top tags + top-tag callout.
  const aggregated = useMemo(() => {
    if (rows.length === 0)
      return { labels: [], datasets: [], topTag: null as string | null, topCount: 0 };
    // Total per tag.
    const totalByTag = new Map<string, number>();
    for (const r of rows) {
      totalByTag.set(r.tag_name, (totalByTag.get(r.tag_name) ?? 0) + r.ticket_count);
    }
    const sortedTags = [...totalByTag.entries()].sort((a, b) => b[1] - a[1]);
    const topN = sortedTags.slice(0, TOP_N).map(([t]) => t);
    const topSet = new Set(topN);

    // Unique sorted dates.
    const dateSet = new Set<string>();
    for (const r of rows) dateSet.add(r.bucket_day);
    const labels = [...dateSet].sort();

    // dataset name -> (date -> count)
    const series = new Map<string, Map<string, number>>();
    for (const tag of topN) series.set(tag, new Map());
    series.set('other', new Map());
    for (const r of rows) {
      const bucket = topSet.has(r.tag_name) ? r.tag_name : 'other';
      const m = series.get(bucket);
      if (!m) continue;
      m.set(r.bucket_day, (m.get(r.bucket_day) ?? 0) + r.ticket_count);
    }
    const datasets = [
      ...topN.map((tag, i) => ({
        label: tag,
        data: labels.map((d) => series.get(tag)?.get(d) ?? 0),
        backgroundColor: PALETTE[i % PALETTE.length],
      })),
    ];
    // Only include "other" if it actually has any data.
    const otherMap = series.get('other');
    if (otherMap && [...otherMap.values()].some((v) => v > 0)) {
      datasets.push({
        label: 'other',
        data: labels.map((d) => otherMap.get(d) ?? 0),
        backgroundColor: OTHER_COLOR,
      });
    }
    const topTag = sortedTags[0]?.[0] ?? null;
    const topCount = sortedTags[0]?.[1] ?? 0;
    return { labels, datasets, topTag, topCount };
  }, [rows]);

  const chartConfig = useMemo(
    () => ({
      type: 'bar' as const,
      data: {
        labels: aggregated.labels,
        datasets: aggregated.datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' as const } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true },
        },
      },
    }),
    [aggregated],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Helpdesk trends</h2>
          <p className="text-[11px] text-[var(--color-text-secondary)]">
            Per-tag ticket volume over the last {rangeDays} days
          </p>
        </div>
        <div role="radiogroup" aria-label="Date range" className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={rangeDays === 7}
            onClick={() => setRangeDays(7)}
            className={
              rangeDays === 7
                ? 'px-2 py-1 text-xs rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'px-2 py-1 text-xs rounded border border-[var(--color-border)]'
            }
          >
            7d
          </button>
          <button
            type="button"
            aria-pressed={rangeDays === 30}
            onClick={() => setRangeDays(30)}
            className={
              rangeDays === 30
                ? 'px-2 py-1 text-xs rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'px-2 py-1 text-xs rounded border border-[var(--color-border)]'
            }
          >
            30d
          </button>
        </div>
      </div>

      {err && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {err}
        </p>
      )}

      {aggregated.topTag && (
        <div className="flex items-baseline gap-2 px-3 py-2 border border-[var(--color-border)] rounded">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Top tag
          </span>
          <span className="text-sm font-semibold">{aggregated.topTag}</span>
          <span className="text-xs text-[var(--color-text-secondary)]">
            ({aggregated.topCount} tickets)
          </span>
        </div>
      )}

      {!loading && rows.length === 0 ? (
        <div className="p-6 text-sm text-[var(--color-text-secondary)] border border-dashed border-[var(--color-border)] rounded text-center">
          No ticket activity in this range
        </div>
      ) : (
        <div className="relative">
          <BaseChart
            config={chartConfig}
            height={320}
            ariaLabel={`Stacked bar chart of ticket volume per tag over the last ${rangeDays} days`}
          />
          {/* sr-only fallback for assistive tech. */}
          <table className="sr-only">
            <caption>Helpdesk ticket volume by tag and day for the last {rangeDays} days</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Tag</th>
                <th scope="col">Ticket count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.bucket_day}:${r.tag_name}`}>
                  <td>{r.bucket_day}</td>
                  <td>{r.tag_name}</td>
                  <td>{r.ticket_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
