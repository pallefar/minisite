/**
 * Phase 34 Plan 34-09 ONBOARD-09 — Per-step funnel analytics tab.
 *
 * Polls the onboarding-funnel-query Edge Fn every 30s for the active flow's
 * step-level metrics:
 *   { step_id, views, completions, drop_off_pct, avg_time_ms }
 *
 * Renders a KPI summary strip + a bar chart (via BaseChart) + a per-step
 * table. When `flowId` is null we show a "save first" message — the active
 * flow id flows down from OnboardingBuilderModule.
 *
 * Polling discipline (T-34-09-04 DoS budget):
 *  - 30s interval.
 *  - `document.visibilityState === 'visible'` gate: hidden tabs skip the
 *    fetch but the interval keeps running so we resume promptly on focus.
 *  - PostHog Edge Fn itself caches HogQL results 60s — so the worst-case
 *    quota burn for a single open admin tab is 2 HogQL calls/minute.
 *
 * Per [[vendor-gated-send-via-health-check]]: 503 vendor_unconfigured
 * renders a soft banner rather than a crash.
 */
import { useEffect, useState } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { supabase } from '@/lib/supabase';

interface StepRow {
  step_id: string;
  views: number;
  completions: number;
  drop_off_pct: number;
  avg_time_ms: number;
}

interface FunnelTabProps {
  flowId: string | null;
}

interface InvokeError {
  error?: string;
}

export default function OnboardingFunnelTab({ flowId }: FunnelTabProps) {
  const [steps, setSteps] = useState<StepRow[] | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    if (!flowId) return;
    let cancelled = false;

    async function tick(): Promise<void> {
      const { data, error } = await supabase.functions.invoke('onboarding-funnel-query', {
        body: { kind: 'step_funnel', flow_id: flowId, time_range_days: 14 },
      });
      if (cancelled) return;
      if (error) {
        // Network error — leave previous data on screen rather than wiping it.
        return;
      }
      const payload = data as ({ steps?: StepRow[] } & InvokeError) | null;
      if (payload?.error === 'vendor_unconfigured') {
        setUnconfigured(true);
        return;
      }
      setSteps(Array.isArray(payload?.steps) ? payload.steps : []);
    }

    // Initial fetch fires immediately regardless of visibilityState so the
    // operator sees data on tab-open. Subsequent ticks gate on visibility.
    void tick();

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void tick();
      }
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [flowId]);

  if (unconfigured) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-[var(--color-warning,#a67b00)] bg-[var(--color-surface-elevated)] p-4"
      >
        <p className="font-medium">PostHog Insights not yet configured.</p>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
          Funnel analytics ship once Plan 34-10&apos;s vendor checkpoint completes (sets{' '}
          <code>POSTHOG_PERSONAL_API_KEY</code> + <code>POSTHOG_PROJECT_ID</code>).
        </p>
      </div>
    );
  }

  if (!flowId) {
    return (
      <p className="text-[var(--color-text-tertiary)] p-4">
        Save a flow to enable funnel tracking.
      </p>
    );
  }

  if (steps === null) {
    return (
      <p role="status" aria-live="polite" className="text-[var(--color-text-tertiary)] p-4">
        Loading funnel…
      </p>
    );
  }

  if (steps.length === 0) {
    return (
      <p className="text-[var(--color-text-tertiary)] p-4">
        No step events captured yet (14-day window).
      </p>
    );
  }

  const totalViews = steps[0]?.views ?? 0;
  const finalCompletions = steps[steps.length - 1]?.completions ?? 0;
  const completionRate = totalViews > 0 ? Math.round((finalCompletions / totalViews) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiTile label="Total views (14d)" value={totalViews.toLocaleString()} />
        <KpiTile label="End-to-end completion" value={`${completionRate}%`} />
        <KpiTile label="Steps" value={steps.length.toString()} />
      </div>
      <BaseChart
        ariaLabel="Onboarding funnel — views vs completions per step"
        height={240}
        config={{
          type: 'bar',
          data: {
            labels: steps.map((s) => s.step_id.slice(0, 12)),
            datasets: [
              { label: 'Views', data: steps.map((s) => s.views) },
              { label: 'Completions', data: steps.map((s) => s.completions) },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false },
        }}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-[var(--color-text-tertiary)]">
              <th className="py-2">Step</th>
              <th className="py-2">Views</th>
              <th className="py-2">Completions</th>
              <th className="py-2">Drop-off</th>
              <th className="py-2">Avg time</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.step_id} className="border-t border-[var(--color-border)]">
                <td className="py-2 font-mono">{s.step_id}</td>
                <td className="py-2">{s.views}</td>
                <td className="py-2">{s.completions}</td>
                <td className="py-2">{s.drop_off_pct}%</td>
                <td className="py-2">{(s.avg_time_ms / 1000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
}

function KpiTile({ label, value }: KpiTileProps) {
  return (
    <div className="bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-2xl p-3">
      <div className="text-xs text-[var(--color-text-tertiary)]">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
