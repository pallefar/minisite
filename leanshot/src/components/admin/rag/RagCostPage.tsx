/**
 * Phase 60 Plan 60-14 — RagCostPage
 *
 * Full cost dashboard for /admin/rag/cost:
 *   - Section 1 "Ingestion + Synthesis": Firecrawl · OpenAI embeddings · Anthropic summarizer
 *   - Section 2 "Phase 60 Retrieval + Federation": Cohere rerank · Jina rerank · Federated source fetch
 *   - Section 3 "Phase 60 Synthesis": Coach synthesis/day · Tip-of-day cron/day · Newsletter cron/week
 *   - Auto-pause banner when any vendor MTD >= cap (T-60-14-TAMPER-1)
 *   - Acknowledge-and-resume CTA → rag_acknowledge_budget_cap SECDEF RPC
 *
 * Typography invariants (Phase 69 pre-compliance):
 *   - Only text-micro (11px) / text-sm (13px) / text-lg (18px) — NOT text-base, text-xl, text-2xl etc.
 *   - Only font-normal (400) or font-semibold (600) weights
 *   - Accent (text-primary / bg-primary) reserved for primary CTA only
 *
 * A11y: banner role="alert" + aria-live="assertive"; spend spans have aria-label;
 *       cards form labeled regions.
 *
 * Dark mode: all colors via CSS tokens (--color-*); no hardcoded hex.
 *
 * Security: data flows exclusively through fetchCostRollup + fetchBudgetCaps
 * (admin-gated Edge Fn + RLS). T-60-14-PII-1 enforced upstream.
 */

import { AlertOctagon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CostBar } from '@/components/admin/rag/CostBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sparkline } from '@/components/ui/Sparkline';
import { useToast } from '@/hooks/useToast';
import {
  CostApiError,
  acknowledgeBudgetCap,
  fetchBudgetCaps,
  fetchCostRollup,
} from '@/lib/admin/rag/cost-api';
import type { BudgetCapRow, CostRollupResponse, Vendor } from '@/lib/admin/rag/cost-api';

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

type RangeDays = 7 | 30 | 90;

const RANGE_OPTIONS: { label: string; value: RangeDays }[] = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

// Vendor/cron display config
interface VendorConfig {
  key: string;
  label: string;
  isTrace?: boolean;
}

const SECTION_1_VENDORS: VendorConfig[] = [
  { key: 'firecrawl', label: 'Firecrawl' },
  { key: 'openai_embed', label: 'OpenAI embeddings' },
  { key: 'anthropic_summary', label: 'Anthropic summarizer' },
];

const SECTION_2_VENDORS: VendorConfig[] = [
  { key: 'cohere_rerank', label: 'Cohere rerank' },
  { key: 'jina_rerank', label: 'Jina rerank' },
  { key: 'federated_fetch', label: 'Federated source fetch' },
];

const SECTION_3_VENDORS: VendorConfig[] = [
  { key: 'coach_synthesis_per_day', label: 'Coach synthesis / day', isTrace: true },
  { key: 'tip_of_day_per_day', label: 'Tip-of-day cron / day', isTrace: true },
  { key: 'newsletter_per_week', label: 'Newsletter cron / week', isTrace: true },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysToEndOfMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(0, lastDay.getDate() - now.getDate());
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function buildAriaLabel(label: string, mtdUsd: number): string {
  const dollars = Math.floor(mtdUsd);
  const cents = Math.round((mtdUsd - dollars) * 100);
  return `${label}: ${dollars} dollar${dollars !== 1 ? 's' : ''} ${cents} cent${cents !== 1 ? 's' : ''} month-to-date`;
}

// ---------------------------------------------------------------------------
// VendorCard
// ---------------------------------------------------------------------------

interface VendorCardProps {
  config: VendorConfig;
  rollup: CostRollupResponse | undefined;
  cap: BudgetCapRow | undefined;
}

function VendorCard({ config, rollup, cap }: VendorCardProps) {
  const isEmpty = !rollup || (rollup.mtd_usd === 0 && rollup.last_day_with_data === null);
  const mtdUsd = rollup?.mtd_usd ?? 0;
  const capUsd = cap?.cap_usd ?? 0;
  const pct = capUsd > 0 ? Math.min(100, Math.round((mtdUsd / capUsd) * 100)) : 0;
  const resetDays = daysToEndOfMonth();

  return (
    <Card variant="default" padding="md" span={4} aria-labelledby={`vendor-label-${config.key}`}>
      {/* Eyebrow row */}
      <p
        id={`vendor-label-${config.key}`}
        className="text-[11px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-tertiary)] mb-2"
      >
        {config.label}
      </p>

      {/* Spend */}
      {isEmpty ? (
        <p
          className="text-lg font-mono font-semibold tabular-nums text-[var(--color-text-secondary)] mb-1"
          aria-label={`${config.label}: no data yet month-to-date`}
        >
          —
        </p>
      ) : (
        <span
          className="text-lg font-mono font-semibold tabular-nums text-[var(--color-text)] block mb-1"
          aria-label={buildAriaLabel(config.label, mtdUsd)}
        >
          {formatUsd(mtdUsd)}
        </span>
      )}

      {/* Budget caption — only for vendors with caps */}
      {cap && !isEmpty && (
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">
          of {formatUsd(capUsd)} budget · {pct}% used
        </p>
      )}

      {/* CostBar */}
      {cap && !isEmpty && <CostBar mtdUsd={mtdUsd} capUsd={capUsd} />}

      {/* Sparkline */}
      <div className="mt-3">
        {isEmpty ? (
          <Sparkline
            values={[0, 0, 0, 0, 0, 0, 0]}
            width={120}
            height={36}
            color="var(--color-border)"
            label="no data yet"
          />
        ) : (
          <Sparkline
            values={rollup.sparkline_7d}
            width={120}
            height={36}
            color="var(--color-primary)"
            fill="gradient"
          />
        )}
      </div>

      {/* Reset countdown */}
      <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
        Resets in {resetDays} days
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SkeletonCard
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <Card variant="default" padding="md" span={4} aria-hidden>
      <Skeleton shape="text" className="w-20 h-2.5 mb-2" />
      <Skeleton shape="rect" className="w-16 h-6 mb-1" />
      <Skeleton shape="text" className="w-32 h-2.5 mb-2" />
      <Skeleton shape="rect" className="w-full h-1 mb-2" />
      <Skeleton shape="rect" className="w-full h-9 mt-3" />
      <Skeleton shape="text" className="w-20 h-2.5 mt-2" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RagCostPage
// ---------------------------------------------------------------------------

export default function RagCostPage() {
  const toast = useToast();

  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [rollups, setRollups] = useState<CostRollupResponse[] | null>(null);
  const [caps, setCaps] = useState<BudgetCapRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState(false);

  // Track whether component is mounted to avoid setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async (days: RangeDays) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rollupData, capData] = await Promise.all([
        fetchCostRollup({
          rangeDays: days,
          vendors: [
            'firecrawl',
            'openai_embed',
            'anthropic_summary',
            'cohere_rerank',
            'jina_rerank',
            'federated_fetch',
          ],
          traceRollups: ['coach_synthesis', 'tip_of_day', 'newsletter'],
        }),
        fetchBudgetCaps(),
      ]);
      if (!mountedRef.current) return;
      setRollups(rollupData);
      setCaps(capData);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg =
        err instanceof CostApiError
          ? err.kind === 'forbidden'
            ? 'Access denied. Staff role required.'
            : "Couldn't load cost data. Refresh to try again."
          : "Couldn't load cost data. Refresh to try again.";
      setLoadError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Initial load + focus-refetch
  useEffect(() => {
    void loadData(rangeDays);
    const onFocus = () => void loadData(rangeDays);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData, rangeDays]);

  const handleRangeChange = (days: RangeDays) => {
    setRangeDays(days);
    void loadData(days);
  };

  const handleAcknowledge = async (vendor: string) => {
    setAcknowledging(true);
    try {
      await acknowledgeBudgetCap(vendor as Vendor);
      if (!mountedRef.current) return;
      toast(`Resumed — ${vendor} scrapers active`, 'success');
      // Refresh caps to remove the banner
      const capData = await fetchBudgetCaps();
      if (!mountedRef.current) return;
      setCaps(capData);
    } catch {
      if (!mountedRef.current) return;
      toast('Failed to acknowledge. Try again.', 'error');
    } finally {
      if (mountedRef.current) setAcknowledging(false);
    }
  };

  // Determine which vendor (if any) is auto-paused
  const pausedVendor = caps?.find((c) => c.mtd_spend_usd >= c.cap_usd && c.source_pause_state);

  // Helpers to look up rollup/cap by vendor key
  const getRollup = (key: string) => rollups?.find((r) => r.vendor === key);
  const getCap = (key: string) => caps?.find((c) => c.vendor === key);

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (loadError) {
    return (
      <Card variant="flat" padding="lg" className="max-w-xl">
        <p role="status" className="text-sm text-[var(--color-danger)]">
          {loadError}
        </p>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <section className="space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-lg font-semibold tracking-tight">Cost Dashboard</h1>

        {/* Range selector */}
        <div role="group" aria-label="Date range" className="flex gap-1.5">
          {RANGE_OPTIONS.map(({ label, value }) => (
            <Pill
              key={value}
              size="sm"
              active={rangeDays === value}
              onClick={() => handleRangeChange(value)}
              aria-pressed={rangeDays === value}
            >
              {label}
            </Pill>
          ))}
        </div>
      </header>

      {/* Auto-pause banner */}
      {pausedVendor && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-[var(--color-danger-soft)] border-l-2 border-[var(--color-danger)] p-4 mb-2 flex items-center gap-3 rounded-r-md"
        >
          <AlertOctagon size={18} aria-hidden className="shrink-0 text-[var(--color-danger)]" />
          <p className="text-sm text-[var(--color-text)] flex-1">
            Scrapers auto-paused — {pausedVendor.vendor} budget exhausted. Acknowledge to resume.
          </p>
          <Button
            variant="primary"
            aria-busy={acknowledging}
            disabled={acknowledging}
            onClick={() => void handleAcknowledge(pausedVendor.vendor)}
          >
            Acknowledge and resume
          </Button>
        </div>
      )}

      {/* Section 1 — Ingestion + Synthesis */}
      <section aria-labelledby="section-heading-ingestion">
        <h2
          id="section-heading-ingestion"
          className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.05em] mb-3"
        >
          Ingestion + Synthesis
        </h2>
        <div className="grid grid-cols-12 gap-4">
          {loading
            ? SECTION_1_VENDORS.map((v) => <SkeletonCard key={v.key} />)
            : SECTION_1_VENDORS.map((config) => (
                <VendorCard
                  key={config.key}
                  config={config}
                  rollup={getRollup(config.key)}
                  cap={getCap(config.key)}
                />
              ))}
        </div>
      </section>

      {/* Section 2 — Phase 60 Retrieval + Federation */}
      <section aria-labelledby="section-heading-retrieval">
        <h2
          id="section-heading-retrieval"
          className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.05em] mb-3"
        >
          Phase 60 Retrieval + Federation
        </h2>
        <div className="grid grid-cols-12 gap-4">
          {loading
            ? SECTION_2_VENDORS.map((v) => <SkeletonCard key={v.key} />)
            : SECTION_2_VENDORS.map((config) => (
                <VendorCard
                  key={config.key}
                  config={config}
                  rollup={getRollup(config.key)}
                  cap={getCap(config.key)}
                />
              ))}
        </div>
      </section>

      {/* Section 3 — Phase 60 Synthesis */}
      <section aria-labelledby="section-heading-synthesis">
        <h2
          id="section-heading-synthesis"
          className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.05em] mb-3"
        >
          Phase 60 Synthesis
        </h2>
        <div className="grid grid-cols-12 gap-4">
          {loading
            ? SECTION_3_VENDORS.map((v) => <SkeletonCard key={v.key} />)
            : SECTION_3_VENDORS.map((config) => (
                <VendorCard
                  key={config.key}
                  config={config}
                  rollup={getRollup(config.key)}
                  cap={undefined} // cron rows: no cap_usd cap in rag_budget_caps
                />
              ))}
        </div>
      </section>

      {/* Footer */}
      <p className="text-[11px] text-[var(--color-text-tertiary)]">
        Source: PostHog $ai_generation events · refreshes on page focus
      </p>
    </section>
  );
}
