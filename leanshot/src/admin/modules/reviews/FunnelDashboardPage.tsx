/**
 * Phase 36 Plan 36-04 Task 3 — FunnelDashboardPage (Surface E).
 *
 * Calls SECDEF RPC review_funnel_aggregate (Task 1) and renders:
 *  - 3-bar horizontal funnel (Prompts shown → Rated internally → Clicked external CTA)
 *  - Per-variant grid via VariantGrid (Ship-Winner reuse — Pattern K)
 *  - Time-window selector (7/30/90/All) → re-issues RPC
 *
 * BaseChart is mocked in tests; chart.js runs only in real DOM.
 */
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import VariantGrid, { type VariantStats } from './VariantGrid';

interface FunnelRow {
  prompts_shown: number;
  rated_internal: number;
  external_clicked: number;
  by_variant: Record<string, VariantStats> | null;
}

const WINDOW_OPTIONS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 3650 },
];

export default function FunnelDashboardPage(): React.JSX.Element {
  const toast = useToast();
  const reduced = useReducedMotion();
  const [windowDays, setWindowDays] = useState(30);
  const [data, setData] = useState<FunnelRow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAggregate = useCallback(async (days: number): Promise<void> => {
    setLoading(true);
    const { data: rpcData, error } = await supabase.rpc('review_funnel_aggregate', {
      p_window_days: days,
    });
    setLoading(false);
    if (error) {
      toast(`Could not load funnel: ${error.message}`, 'error');
      setData(null);
      return;
    }
    const rows = (rpcData ?? []) as FunnelRow[];
    setData(rows[0] ?? null);
  }, [toast]);

  useEffect(() => {
    void fetchAggregate(windowDays);
  }, [fetchAggregate, windowDays]);

  const chartConfig = useMemo(() => {
    if (!data) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: ['Prompts shown', 'Rated internally', 'Clicked external CTA'],
        datasets: [
          {
            data: [data.prompts_shown, data.rated_internal, data.external_clicked],
            backgroundColor: [
              'rgba(45, 156, 219, 0.25)',
              'rgba(27, 72, 66, 0.85)',
              'rgba(69, 176, 119, 0.85)',
            ],
            borderWidth: 0,
          },
        ],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        maintainAspectRatio: false,
        animation: (reduced ? false : undefined) as false | undefined,
        plugins: { legend: { display: false } },
      },
    };
  }, [data, reduced]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Review Funnel</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            prompt-shown → internal-rating → external-review-posted, per variant.
          </p>
        </div>
        <div
          role="group"
          aria-label="Funnel time window"
          className="inline-flex border border-[var(--color-border)] rounded-pill overflow-hidden"
        >
          {WINDOW_OPTIONS.map((opt) => {
            const isActive = opt.days === windowDays;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setWindowDays(opt.days)}
                aria-pressed={isActive}
                className={
                  isActive
                    ? 'h-8 px-3 text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'h-8 px-3 text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </header>

      {loading && !data ? (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] motion-safe:animate-pulse"
            />
          ))}
        </div>
      ) : !data || data.prompts_shown === 0 ? (
        <EmptyState
          title="No experiments running"
          body="Create a PostHog experiment on nps_prompt_copy to start A/B testing."
          cta={
            <a
              href="https://us.posthog.com/experiments"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary)] hover:underline"
            >
              Open PostHog Experiments <ExternalLink size={14} aria-hidden />
            </a>
          }
        />
      ) : (
        <>
          <Card variant="elevated" padding="md">
            <header className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold">Funnel</h2>
              <ul className="flex flex-wrap gap-4 text-[13px] text-[var(--color-text-secondary)]">
                <li>
                  <span className="font-mono font-semibold">{data.prompts_shown}</span>{' '}
                  Prompts shown
                </li>
                <li>
                  <span className="font-mono font-semibold">{data.rated_internal}</span>{' '}
                  Rated internally
                </li>
                <li>
                  <span className="font-mono font-semibold">{data.external_clicked}</span>{' '}
                  Clicked external CTA
                </li>
              </ul>
            </header>
            {chartConfig && (
              <BaseChart
                config={chartConfig}
                ariaLabel="Review prompt funnel: prompts shown, rated internally, clicked external CTA"
                height={180}
              />
            )}
          </Card>

          <VariantGrid byVariant={data.by_variant ?? {}} flagId="nps_prompt_copy" />
        </>
      )}
    </div>
  );
}
