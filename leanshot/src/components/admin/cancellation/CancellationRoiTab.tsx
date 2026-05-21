/**
 * Phase 40 Plan 40-06 — CancellationRoiTab.
 *
 * Admin ROI dashboard for Phase 40 save-offers flow (POLISH-02).
 * Replaces the Plan 40-05 stub entirely.
 *
 * Layout per UI-SPEC Surface 3:
 *   - Header + sub-label + Export CSV button (top-right)
 *   - Filter bar: date range PillGroup + Offer type PillGroup
 *   - Hero KPI row (4 tiles)
 *   - Stacked bar chart per offer_type
 *   - Cohort breakdown table
 *   - Empty state when no data in range
 *
 * PostHog variant attribution: posthog_variant_id column persisted per F-40-02.
 * v1.3 cold-start: all rows have posthog_variant_id=null; grouping is a no-op.
 */
import { BarChart3, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { supabase } from '@/lib/supabase';
import { CancellationCohortTable } from './CancellationCohortTable';
import { CancellationRoiChart } from './CancellationRoiChart';
import { CancellationRoiKpiTiles, useRoiData } from './CancellationRoiKpiTiles';

// ── Date range helpers ────────────────────────────────────────────────────────

type DateRangeKey = '7d' | '30d' | '90d' | 'all';

interface DateRange {
  label: string;
  from: string;
  to: string;
}

const DATE_RANGES: Record<DateRangeKey, { label: string; days: number | null }> = {
  '7d': { label: 'Last 7 d', days: 7 },
  '30d': { label: 'Last 30 d', days: 30 },
  '90d': { label: 'Last 90 d', days: 90 },
  all: { label: 'All time', days: null },
};

const OFFER_TYPES_ALL = ['pause', 'discount', 'extended_trial', 'downgrade'] as const;
const OFFER_TYPE_LABELS: Record<string, string> = {
  pause: 'Pause',
  discount: 'Discount',
  extended_trial: 'Extended trial',
  downgrade: 'Downgrade',
};

function computeDateRange(key: DateRangeKey): DateRange {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const { days, label } = DATE_RANGES[key];
  if (days === null) {
    return { label, from: '2020-01-01', to };
  }
  const from = new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { label, from, to };
}

// ── CSV export ────────────────────────────────────────────────────────────────

async function downloadRoiCsv(from: string, to: string, offerTypes: string[]): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const params = new URLSearchParams({ range_from: from, range_to: to });
  if (offerTypes.length > 0 && offerTypes.length < OFFER_TYPES_ALL.length) {
    params.set('offers', offerTypes.join(','));
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/download-cancellation-roi-csv?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.download = `cancellation-roi-${yyyymmdd}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CancellationRoiTab() {
  const [rangeKey, setRangeKey] = useState<DateRangeKey>('30d');
  const [selectedOfferTypes, setSelectedOfferTypes] = useState<string[]>([
    ...OFFER_TYPES_ALL,
  ]);
  const [exporting, setExporting] = useState(false);

  const dateRange = useMemo(() => computeDateRange(rangeKey), [rangeKey]);
  const { rows, priorRows, loading } = useRoiData(
    dateRange.from,
    dateRange.to,
    [], // cohort filter — no multi-select in v1.3 (UI-SPEC notes cohort multi-select future)
    selectedOfferTypes,
  );

  const isEmpty = !loading && rows.length === 0;

  function toggleOfferType(ot: string) {
    setSelectedOfferTypes((prev) =>
      prev.includes(ot) ? prev.filter((x) => x !== ot) : [...prev, ot],
    );
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadRoiCsv(dateRange.from, dateRange.to, selectedOfferTypes);
    } catch (e) {
      console.error('[leanshot] ROI CSV export failed:', e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6 py-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[18px] font-semibold text-[var(--color-text)] leading-[1.4]">
            Save-offer ROI
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
            Retention lift and revenue recovered by offer type.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Download size={14} aria-hidden />}
          onClick={() => void handleExport()}
          loading={exporting}
          aria-label="Export ROI data as CSV"
        >
          Export CSV
        </Button>
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-wrap gap-3 items-center"
        role="group"
        aria-label="ROI dashboard filters"
      >
        {/* Date range */}
        <div className="flex items-center gap-1" role="group" aria-label="Date range filter">
          {(Object.keys(DATE_RANGES) as DateRangeKey[]).map((key) => (
            <Pill
              key={key}
              size="sm"
              active={rangeKey === key}
              onClick={() => setRangeKey(key)}
              aria-label={`Filter by ${DATE_RANGES[key].label}`}
            >
              {DATE_RANGES[key].label}
            </Pill>
          ))}
        </div>

        {/* Offer type filter */}
        <div className="flex items-center gap-1" role="group" aria-label="Offer type filter">
          {OFFER_TYPES_ALL.map((ot) => (
            <Pill
              key={ot}
              size="sm"
              active={selectedOfferTypes.includes(ot)}
              onClick={() => toggleOfferType(ot)}
              aria-label={`Toggle ${OFFER_TYPE_LABELS[ot]} offer type`}
              aria-pressed={selectedOfferTypes.includes(ot)}
            >
              {OFFER_TYPE_LABELS[ot]}
            </Pill>
          ))}
        </div>
      </div>

      {isEmpty ? (
        /* Empty state per UI-SPEC line 333-335 */
        <Card variant="elevated" className="py-12">
          <EmptyState
            illustration={<BarChart3 size={40} aria-hidden />}
            title="No cancellation data yet"
            body="Once patients see save-offers, results appear here. Check back after some users have cancelled."
            inline
          />
        </Card>
      ) : (
        <>
          {/* KPI tiles */}
          <CancellationRoiKpiTiles rows={rows} priorRows={priorRows} loading={loading} />

          {/* Chart */}
          <Card variant="elevated" className="p-6">
            <h3 className="text-[18px] font-semibold text-[var(--color-text)] leading-[1.4] mb-1">
              By offer type
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
              Hover bars to see counts.
            </p>
            <CancellationRoiChart rows={rows} loading={loading} />
          </Card>

          {/* Cohort table */}
          <Card variant="flat" className="p-6">
            <h3 className="text-[18px] font-semibold text-[var(--color-text)] leading-[1.4] mb-1">
              Cohort breakdown
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
              Acceptance rate per cohort × offer type.
            </p>
            <CancellationCohortTable rows={rows} loading={loading} />
          </Card>
        </>
      )}
    </div>
  );
}
