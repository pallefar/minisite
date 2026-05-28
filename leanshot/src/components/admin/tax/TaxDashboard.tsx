/**
 * Phase 65 Plan 65-09 — TaxDashboard (PAY-08 UI half).
 *
 * Staff-scoped /admin/tax route. Renders per-state nexus monitoring:
 *   - Joins tax_nexus_thresholds × tax_nexus_state_revenue (matview) client-side
 *   - Computes proximity % = revenue / threshold * 100 (clamped to display 100)
 *   - Status tiers: <60 safe | 60-79 monitoring | 80-99 at_risk | ≥100 nexus_established
 *   - Refresh button invokes nexus-monitor Edge Fn (Phase 65-08) to recompute the
 *     matview server-side; subsequent re-fetch picks up the new values
 *
 * Patterns:
 *   D — Tokens only; --color-text / --color-text-secondary / --color-warning /
 *       --color-danger / --color-primary
 *   Typography ceiling: 11 / 13 / 18 / text-heading + 400 / 600 weights only
 *   Spacing: standard 1 / 2 / 3 / 4 / 6 / 8 / 12 scale
 *   RLS: SELECT on tax_nexus_thresholds + matview is staff-scoped; the browser
 *   never sees service-role data, only what RLS allows.
 */
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { supabase } from '@/lib/supabase';

type Tier = 'safe' | 'monitoring' | 'at_risk' | 'nexus_established';

interface ThresholdRow {
  state: string;
  state_name: string;
  threshold_amount_cents: number;
  transaction_count_threshold: number | null;
}

interface RevenueRow {
  state: string;
  revenue_cents: number;
  last_transaction_at: string | null;
}

interface JoinedRow {
  state: string;
  state_name: string;
  threshold_amount_cents: number;
  revenue_cents: number;
  proximity_percent: number;
  tier: Tier;
  last_transaction_at: string | null;
}

const TIER_LABEL: Record<Tier, string> = {
  safe: 'Safe',
  monitoring: 'Monitoring',
  at_risk: 'At risk',
  nexus_established: 'Registration required',
};

const TIER_TONE: Record<Tier, BadgeTone> = {
  safe: 'neutral',
  monitoring: 'warning',
  at_risk: 'danger',
  nexus_established: 'info',
};

const TIER_BAR_TOKEN: Record<Tier, string> = {
  safe: 'var(--color-text-tertiary)',
  monitoring: 'var(--color-warning)',
  at_risk: 'var(--color-danger)',
  nexus_established: 'var(--color-primary)',
};

function classify(proximity: number): Tier {
  if (proximity >= 100) return 'nexus_established';
  if (proximity >= 80) return 'at_risk';
  if (proximity >= 60) return 'monitoring';
  return 'safe';
}

const formatUsd = (cents: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return 'never';
  }
}

export function TaxDashboard() {
  const [rows, setRows] = useState<JoinedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const thresholdsResp = await supabase
        .from('tax_nexus_thresholds')
        .select('state, state_name, threshold_amount_cents, transaction_count_threshold');
      if (thresholdsResp.error) {
        setError('Failed to load tax data — try refresh.');
        return;
      }
      const revenueResp = await supabase
        .from('tax_nexus_state_revenue')
        .select('state, revenue_cents, last_transaction_at');
      if (revenueResp.error) {
        setError('Failed to load tax data — try refresh.');
        return;
      }
      const thresholds = (thresholdsResp.data ?? []) as ThresholdRow[];
      const revenue = (revenueResp.data ?? []) as RevenueRow[];
      const revenueByState = new Map(revenue.map((r) => [r.state, r]));

      const joined: JoinedRow[] = thresholds.map((t) => {
        const rev = revenueByState.get(t.state);
        const revenueCents = rev?.revenue_cents ?? 0;
        const proximityPercent =
          t.threshold_amount_cents > 0 ? (revenueCents / t.threshold_amount_cents) * 100 : 0;
        return {
          state: t.state,
          state_name: t.state_name,
          threshold_amount_cents: t.threshold_amount_cents,
          revenue_cents: revenueCents,
          proximity_percent: proximityPercent,
          tier: classify(proximityPercent),
          last_transaction_at: rev?.last_transaction_at ?? null,
        };
      });

      // Sort by proximity desc — highest risk first.
      joined.sort((a, b) => b.proximity_percent - a.proximity_percent);
      setRows(joined);

      // Last refreshed = max last_transaction_at across all rows.
      const maxTimestamp = revenue
        .map((r) => r.last_transaction_at)
        .filter((t): t is string => t !== null)
        .sort()
        .at(-1);
      setLastRefreshed(maxTimestamp ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRefresh = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await supabase.functions.invoke('nexus-monitor', { body: {} });
      await fetchData();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[18px] font-semibold text-[var(--color-text)]">
            Tax Nexus Monitoring
          </h1>
          <p className="text-[13px] font-normal text-[var(--color-text-secondary)]">
            Last refreshed: {formatTimestamp(lastRefreshed)}
          </p>
        </div>
        <Button
          variant="tonal"
          onClick={() => {
            void handleRefresh();
          }}
          loading={refreshing}
          disabled={refreshing || loading}
          leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
        >
          Refresh
        </Button>
      </header>

      {error ? (
        <Card className="p-6 flex flex-col gap-3">
          <p className="text-[13px] font-normal text-[var(--color-text)]">{error}</p>
          <div>
            <Button
              variant="tonal"
              onClick={() => {
                void fetchData();
              }}
            >
              Retry
            </Button>
          </div>
        </Card>
      ) : loading ? (
        <Card className="p-6">
          <div className="flex flex-col gap-3 animate-pulse">
            <div className="h-4 w-1/3 bg-[var(--color-skeleton)] rounded" />
            <div className="h-3 w-2/3 bg-[var(--color-skeleton)] rounded" />
            <div className="h-3 w-2/3 bg-[var(--color-skeleton)] rounded" />
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No tax data yet"
            body="Tax data populates after the first paid checkout session with automatic_tax enabled."
            inline
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Grid header */}
          <div
            className="hidden md:grid gap-3 px-4 py-3 border-b border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide"
            style={{ gridTemplateColumns: '60px 1.5fr 1fr 1fr 1.5fr 1fr' }}
          >
            <div>State</div>
            <div>Name</div>
            <div>YTD revenue</div>
            <div>Threshold</div>
            <div>Proximity</div>
            <div>Status</div>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {rows.map((r) => {
              const clamped = Math.min(100, Math.max(0, r.proximity_percent));
              const fillColor = TIER_BAR_TOKEN[r.tier];
              return (
                <li
                  key={r.state}
                  className="grid md:grid-cols-[60px_1.5fr_1fr_1fr_1.5fr_1fr] grid-cols-2 gap-3 px-4 py-3 items-center"
                >
                  <div className="text-[13px] font-semibold text-[var(--color-text)]">
                    {r.state}
                  </div>
                  <div className="text-[13px] font-normal text-[var(--color-text)]">
                    {r.state_name}
                  </div>
                  <div className="text-[13px] font-normal text-[var(--color-text)]">
                    {formatUsd(r.revenue_cents)}
                  </div>
                  <div className="text-[13px] font-normal text-[var(--color-text-secondary)]">
                    {formatUsd(r.threshold_amount_cents)}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 flex-1 rounded-pill bg-[var(--color-surface-soft)] overflow-hidden"
                      role="progressbar"
                      aria-valuenow={Math.round(clamped)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        data-testid={`proximity-bar-fill-${r.state}`}
                        className="h-full rounded-pill"
                        style={{
                          width: `${clamped}%`,
                          backgroundColor: fillColor,
                        }}
                      />
                    </div>
                    <span className="text-[11px] font-normal text-[var(--color-text-tertiary)] w-10 text-end">
                      {Math.round(r.proximity_percent)}%
                    </span>
                  </div>
                  <div>
                    <Badge tone={TIER_TONE[r.tier]}>{TIER_LABEL[r.tier]}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
