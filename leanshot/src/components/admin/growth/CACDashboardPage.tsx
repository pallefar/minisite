/**
 * Phase 33 Plan 33-05 — CAC Dashboard admin module (ADETL-04, ADETL-05, ADETL-07, ADETL-08).
 *
 * Route: /admin/growth/cac
 *
 * Sections (top → bottom):
 *   1. Per-network health badges (ad_etl_health rows)
 *   2. Active gaps bar with Backfill button per gap
 *   3. CAC cards (per-network 7d rolling) + CSV export
 *   4. Drill-down drawer (per-source → per-campaign → per-creative)
 *
 * Security:
 *   - All reads gated by RLS (admin-only) + get_cac_summary() SECDEF RPC
 *   - Backfill routes through trigger_ad_etl_backfill SECDEF RPC (T-33-05-02 mitigation)
 *   - Zero new UI primitives — Card, Badge, Button, Sheet, Skeleton, EmptyState reused.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Download,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Inline types (no new types file per plan spec)
// ---------------------------------------------------------------------------

type CacSummaryRow = {
  network: string;
  ad_account_id: string;
  ad_id: string;
  campaign_id: string | null;
  spend_date: string;
  spend_usd_at_spend_date: number | null;
  clicks: number;
  impressions: number;
  attributed_conversions: number;
  cac_usd: number | null;
};

type AdEtlHealth = {
  network: string;
  credentials_present: boolean;
  last_success_at: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
};

type AdEtlGap = {
  id: string;
  network: string;
  gap_date: string;
  missing_rows: number;
  resolved_at: string | null;
};

type DrawerState = 'closed' | 'campaign' | 'creative';

type NetworkSummary = {
  network: string;
  totalSpend: number;
  totalConversions: number;
  cac: number | null;
};

type CampaignRow = {
  campaign_id: string;
  totalSpend: number;
  totalConversions: number;
  cac: number | null;
};

type CreativeRow = {
  ad_id: string;
  spend: number;
  conversions: number;
  cac: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'Unknown';
  const diffMs = Date.now() - ts;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return 'Less than 1 hour ago';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvDataUrl(rows: CacSummaryRow[]): string {
  const headers = [
    'network',
    'ad_account_id',
    'ad_id',
    'campaign_id',
    'spend_date',
    'spend_usd_at_spend_date',
    'clicks',
    'impressions',
    'attributed_conversions',
    'cac_usd',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        escapeCsvField(r.network),
        escapeCsvField(r.ad_account_id),
        escapeCsvField(r.ad_id),
        escapeCsvField(r.campaign_id),
        escapeCsvField(r.spend_date),
        escapeCsvField(r.spend_usd_at_spend_date),
        escapeCsvField(r.clicks),
        escapeCsvField(r.impressions),
        escapeCsvField(r.attributed_conversions),
        escapeCsvField(r.cac_usd),
      ].join(','),
    ),
  ];
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Health card (per network)
// ---------------------------------------------------------------------------

function HealthCard({ health, network }: { health: AdEtlHealth | undefined; network: string }) {
  if (!health) {
    return (
      <Card variant="flat" padding="md" className="flex-1 min-w-[200px]">
        <div className="text-[13px] font-semibold mb-2 capitalize">{network}</div>
        <Badge tone="neutral">Unknown</Badge>
      </Card>
    );
  }

  return (
    <Card variant="flat" padding="md" className="flex-1 min-w-[200px]">
      <div className="text-[13px] font-semibold mb-2 capitalize">{network}</div>
      <div className="flex flex-col gap-1.5">
        {health.credentials_present ? (
          <Badge tone="success" leadingIcon={<CheckCircle size={11} aria-hidden />}>
            Active
          </Badge>
        ) : (
          <Badge tone="danger" leadingIcon={<AlertTriangle size={11} aria-hidden />}>
            Credentials missing
          </Badge>
        )}
        <p className="text-[11px] text-[var(--color-text-secondary)]">
          Last sync: {formatRelativeTime(health.last_success_at)}
        </p>
        {health.last_error && (
          <p className="text-[11px] text-[var(--color-danger)] truncate" title={health.last_error}>
            {health.last_error}
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const NETWORKS = ['meta', 'google', 'tiktok'] as const;

export function CACDashboardPage() {
  // -- CAC summary state --
  const [cacRows, setCacRows] = useState<CacSummaryRow[] | null>(null);
  const [cacLoading, setCacLoading] = useState(true);
  const [cacError, setCacError] = useState<string | null>(null);

  // -- Health state --
  const [healthRows, setHealthRows] = useState<AdEtlHealth[] | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // -- Gaps state --
  const [gapRows, setGapRows] = useState<AdEtlGap[] | null>(null);
  const [gapLoading, setGapLoading] = useState(true);

  // -- Backfill state --
  const [backfillingGapId, setBackfillingGapId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // -- Drawer state --
  const [drawerState, setDrawerState] = useState<DrawerState>('closed');
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------------
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const sevenDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch: CAC summary via RPC
  // ---------------------------------------------------------------------------
  const fetchCac = useCallback(async () => {
    setCacLoading(true);
    setCacError(null);
    const { data, error } = await supabase.rpc('get_cac_summary', {
      p_source: null,
      p_start_date: sevenDaysAgo,
      p_end_date: today,
    });
    if (error) {
      setCacError(error.message);
      setCacRows([]);
    } else {
      setCacRows((data as CacSummaryRow[]) ?? []);
    }
    setCacLoading(false);
  }, [sevenDaysAgo, today]);

  // ---------------------------------------------------------------------------
  // Fetch: ETL health
  // ---------------------------------------------------------------------------
  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    const { data } = await supabase
      .from('ad_etl_health')
      .select('network, credentials_present, last_success_at, last_error, last_attempt_at');
    setHealthRows((data as AdEtlHealth[]) ?? []);
    setHealthLoading(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch: Active gaps
  // ---------------------------------------------------------------------------
  const fetchGaps = useCallback(async () => {
    setGapLoading(true);
    const { data } = await supabase
      .from('ad_etl_gaps')
      .select('*')
      .is('resolved_at', null)
      .order('gap_date', { ascending: false })
      .limit(20);
    setGapRows((data as AdEtlGap[]) ?? []);
    setGapLoading(false);
  }, []);

  useEffect(() => {
    void fetchCac();
    void fetchHealth();
    void fetchGaps();
  }, [fetchCac, fetchHealth, fetchGaps]);

  // ---------------------------------------------------------------------------
  // Toast helper (inline — no new primitive)
  // ---------------------------------------------------------------------------
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // ---------------------------------------------------------------------------
  // Backfill handler
  // ---------------------------------------------------------------------------
  const handleBackfill = useCallback(
    async (gap: AdEtlGap) => {
      setBackfillingGapId(gap.id);
      const { error } = await supabase.rpc('trigger_ad_etl_backfill', {
        p_network: gap.network,
        p_date: gap.gap_date,
      });
      setBackfillingGapId(null);
      if (error) {
        if (error.code === '42501' || error.message.toLowerCase().includes('permission')) {
          showToast('Permission denied — admin role required');
        } else {
          showToast(`Backfill error: ${error.message}`);
        }
      } else {
        showToast(`Backfill queued for ${gap.network} on ${gap.gap_date}`);
        void fetchGaps();
      }
    },
    [fetchGaps, showToast],
  );

  // ---------------------------------------------------------------------------
  // CSV export
  // ---------------------------------------------------------------------------
  const handleCsvExport = useCallback(() => {
    if (!cacRows || cacRows.length === 0) return;
    const url = buildCsvDataUrl(cacRows);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cac-export-${today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [cacRows, today]);

  // ---------------------------------------------------------------------------
  // Derived: per-network CAC aggregation
  // ---------------------------------------------------------------------------

  const networkSummaries = useMemo<NetworkSummary[]>(() => {
    if (!cacRows || cacRows.length === 0) return [];
    const map = new Map<string, { spend: number; conversions: number }>();
    for (const row of cacRows) {
      const net = row.network ?? 'unknown';
      const existing = map.get(net) ?? { spend: 0, conversions: 0 };
      map.set(net, {
        spend: existing.spend + (row.spend_usd_at_spend_date ?? 0),
        conversions: existing.conversions + (row.attributed_conversions ?? 0),
      });
    }
    const result: NetworkSummary[] = [];
    for (const [net, { spend, conversions }] of map) {
      result.push({
        network: net,
        totalSpend: spend,
        totalConversions: conversions,
        cac: conversions > 0 ? spend / conversions : null,
      });
    }
    return result.sort((a, b) => a.network.localeCompare(b.network));
  }, [cacRows]);

  // ---------------------------------------------------------------------------
  // Drawer: campaign rows for selected network
  // ---------------------------------------------------------------------------
  const campaignRows = useMemo<CampaignRow[]>(() => {
    if (!cacRows || !selectedNetwork) return [];
    const filtered = cacRows.filter((r) => r.network === selectedNetwork);
    const map = new Map<string, { spend: number; conversions: number }>();
    for (const row of filtered) {
      const cid = row.campaign_id ?? '(no campaign)';
      const existing = map.get(cid) ?? { spend: 0, conversions: 0 };
      map.set(cid, {
        spend: existing.spend + (row.spend_usd_at_spend_date ?? 0),
        conversions: existing.conversions + (row.attributed_conversions ?? 0),
      });
    }
    return Array.from(map.entries())
      .map(([campaign_id, { spend, conversions }]) => ({
        campaign_id,
        totalSpend: spend,
        totalConversions: conversions,
        cac: conversions > 0 ? spend / conversions : null,
      }))
      .sort((a, b) => (b.totalSpend ?? 0) - (a.totalSpend ?? 0));
  }, [cacRows, selectedNetwork]);

  // ---------------------------------------------------------------------------
  // Drawer: top-5 + bottom-5 creatives for selected campaign
  // ---------------------------------------------------------------------------
  const creativeRows = useMemo<{ top5: CreativeRow[]; bottom5: CreativeRow[] }>(() => {
    if (!cacRows || !selectedNetwork || !selectedCampaign) return { top5: [], bottom5: [] };
    const filtered = cacRows.filter(
      (r) => r.network === selectedNetwork && (r.campaign_id ?? '(no campaign)') === selectedCampaign,
    );
    const map = new Map<string, { spend: number; conversions: number }>();
    for (const row of filtered) {
      const aid = row.ad_id;
      const existing = map.get(aid) ?? { spend: 0, conversions: 0 };
      map.set(aid, {
        spend: existing.spend + (row.spend_usd_at_spend_date ?? 0),
        conversions: existing.conversions + (row.attributed_conversions ?? 0),
      });
    }
    const all: CreativeRow[] = Array.from(map.entries()).map(([ad_id, { spend, conversions }]) => ({
      ad_id,
      spend,
      conversions,
      cac: conversions > 0 ? spend / conversions : null,
    }));
    const withCac = all.filter((r) => r.cac !== null).sort((a, b) => (a.cac ?? 0) - (b.cac ?? 0));
    return {
      top5: withCac.slice(0, 5),
      bottom5: withCac.slice(-5).reverse(),
    };
  }, [cacRows, selectedNetwork, selectedCampaign]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openCampaignDrawer = useCallback((network: string) => {
    setSelectedNetwork(network);
    setSelectedCampaign(null);
    setDrawerState('campaign');
  }, []);

  const openCreativeDrawer = useCallback((campaignId: string) => {
    setSelectedCampaign(campaignId);
    setDrawerState('creative');
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerState('closed');
    setSelectedNetwork(null);
    setSelectedCampaign(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Health map for quick lookup
  // ---------------------------------------------------------------------------
  const healthMap = useMemo(() => {
    const m = new Map<string, AdEtlHealth>();
    for (const h of healthRows ?? []) m.set(h.network, h);
    return m;
  }, [healthRows]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      {/* Toast (inline — no new primitive) */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow)] rounded-card px-4 py-3 text-[13px] font-medium max-w-xs"
        >
          {toastMessage}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="size-9 rounded-xl bg-[var(--color-surface-elevated)] text-[var(--color-primary)] inline-flex items-center justify-center">
            <TrendingUp size={18} aria-hidden />
          </span>
          <div>
            <h1 className="text-[18px] font-bold">Ad Spend / CAC</h1>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              7-day rolling — {sevenDaysAgo} to {today}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Download size={14} aria-hidden />}
          onClick={handleCsvExport}
          disabled={!cacRows || cacRows.length === 0}
          aria-label="Export CAC data as CSV"
        >
          Export CSV
        </Button>
      </div>

      {/* Section 1: ETL health badges */}
      <section aria-label="ETL credential health" className="mb-6">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] mb-3 uppercase tracking-[0.06em]">
          Credential Health
        </h2>
        <div className="flex gap-3 flex-wrap">
          {healthLoading
            ? NETWORKS.map((n) => (
                <Skeleton key={n} className="h-20 flex-1 min-w-[200px] rounded-card" />
              ))
            : NETWORKS.map((n) => (
                <HealthCard key={n} network={n} health={healthMap.get(n)} />
              ))}
        </div>
      </section>

      {/* Section 2: Active gaps bar */}
      {!gapLoading && gapRows && gapRows.length > 0 && (
        <section aria-label="Active ETL gaps" className="mb-6">
          <Card variant="flat" padding="md">
            <CardHeader
              title="Gaps detected"
              icon={<AlertTriangle size={16} aria-hidden />}
              action={
                <Badge tone="warning">{gapRows.length} gap{gapRows.length === 1 ? '' : 's'}</Badge>
              }
            />
            <ul className="space-y-2">
              {gapRows.map((gap) => (
                <li
                  key={gap.id}
                  className="flex items-center justify-between gap-4 text-[13px] py-1"
                >
                  <span>
                    <span className="font-medium capitalize">{gap.network}</span>
                    {' — '}
                    <span className="text-[var(--color-text-secondary)]">
                      {gap.missing_rows} missing row{gap.missing_rows === 1 ? '' : 's'} on{' '}
                      {gap.gap_date}
                    </span>
                  </span>
                  <Button
                    variant="tonal"
                    size="sm"
                    loading={backfillingGapId === gap.id}
                    leadingIcon={<RefreshCw size={12} aria-hidden />}
                    onClick={() => void handleBackfill(gap)}
                    aria-label={`Backfill ${gap.network} on ${gap.gap_date}`}
                  >
                    Backfill
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Section 3: CAC cards per network */}
      <section aria-label="CAC per network (7d rolling)">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] mb-3 uppercase tracking-[0.06em]">
          7-Day Rolling CAC
        </h2>

        {cacError && (
          <Card variant="flat" padding="md" className="mb-4">
            <p className="text-[13px] text-[var(--color-danger)]">
              Failed to load CAC data: {cacError}
            </p>
          </Card>
        )}

        {cacLoading ? (
          <div className="grid grid-cols-12 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="lg:col-span-3 md:col-span-6 col-span-12">
                <Skeleton className="h-28 rounded-card w-full" />
              </div>
            ))}
          </div>
        ) : networkSummaries.length === 0 ? (
          <Card variant="flat" padding="md">
            <EmptyState
              inline
              title="No spend data"
              body="No ad spend records found for the selected date range."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-12 gap-4">
            {networkSummaries.map((ns) => (
              <Card
                key={ns.network}
                variant="clickable"
                padding="md"
                span={3}
                role="button"
                tabIndex={0}
                aria-label={`View ${ns.network} campaign breakdown`}
                onClick={() => openCampaignDrawer(ns.network)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') openCampaignDrawer(ns.network);
                }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mb-1 capitalize">
                  {ns.network}
                </div>
                <div className="text-[24px] font-bold numerals-tabular">
                  {formatUsd(ns.cac)}
                </div>
                <div className="text-[11px] font-medium text-[var(--color-text-secondary)] mt-1">
                  CAC (7d)
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1 text-[11px] text-[var(--color-text-secondary)]">
                  <span>Spend: {formatUsd(ns.totalSpend)}</span>
                  <span>Conv: {ns.totalConversions}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Section 4: Drill-down drawer */}
      <Sheet
        open={drawerState !== 'closed'}
        onClose={closeDrawer}
        title={
          drawerState === 'creative' && selectedCampaign
            ? `Creatives — ${selectedNetwork ?? ''} / ${selectedCampaign}`
            : `Campaign breakdown — ${selectedNetwork ?? ''}`
        }
      >
        {drawerState === 'campaign' && (
          <div className="p-4">
            {campaignRows.length === 0 ? (
              <EmptyState inline title="No campaigns" body="No campaign data for this network." />
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] border-b border-[var(--color-border)]">
                    <th className="text-left py-2 pr-3">Campaign</th>
                    <th className="text-right py-2 pr-3">Spend</th>
                    <th className="text-right py-2 pr-3">Conv.</th>
                    <th className="text-right py-2">CAC</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.map((cr) => (
                    <tr
                      key={cr.campaign_id}
                      className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)] cursor-pointer"
                      role="button"
                      tabIndex={0}
                      aria-label={`View creatives for campaign ${cr.campaign_id}`}
                      onClick={() => openCreativeDrawer(cr.campaign_id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ')
                          openCreativeDrawer(cr.campaign_id);
                      }}
                    >
                      <td className="py-2 pr-3 font-medium truncate max-w-[160px]">
                        {cr.campaign_id}
                      </td>
                      <td className="py-2 pr-3 text-right">{formatUsd(cr.totalSpend)}</td>
                      <td className="py-2 pr-3 text-right">{cr.totalConversions}</td>
                      <td className="py-2 text-right">{formatUsd(cr.cac)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {drawerState === 'creative' && (
          <div className="p-4">
            <button
              className="flex items-center gap-1 text-[12px] text-[var(--color-primary)] mb-4 hover:underline"
              onClick={() => {
                setDrawerState('campaign');
                setSelectedCampaign(null);
              }}
              type="button"
            >
              ← Back to campaigns
            </button>

            {creativeRows.top5.length === 0 && creativeRows.bottom5.length === 0 ? (
              <EmptyState inline title="No creative data" body="No ad-level data for this campaign." />
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-success)] mb-2">
                    Top 5 (lowest CAC)
                  </h3>
                  <CreativeTable rows={creativeRows.top5} />
                </div>
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-danger)] mb-2">
                    Bottom 5 (highest CAC)
                  </h3>
                  <CreativeTable rows={creativeRows.bottom5} />
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Creative table (sub-component, co-located)
// ---------------------------------------------------------------------------

function CreativeTable({ rows }: { rows: CreativeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] border-b border-[var(--color-border)]">
          <th className="text-left py-2 pr-3">Ad ID</th>
          <th className="text-right py-2 pr-3">Spend</th>
          <th className="text-right py-2 pr-3">Conv.</th>
          <th className="text-right py-2">CAC</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ad_id} className="border-b border-[var(--color-border)]">
            <td className="py-2 pr-3 font-mono text-[11px] truncate max-w-[140px]">{r.ad_id}</td>
            <td className="py-2 pr-3 text-right">{formatUsd(r.spend)}</td>
            <td className="py-2 pr-3 text-right">{r.conversions}</td>
            <td className="py-2 text-right">{formatUsd(r.cac)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default CACDashboardPage;
