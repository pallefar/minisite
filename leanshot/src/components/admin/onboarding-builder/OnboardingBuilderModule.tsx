/**
 * Phase 34 Plan 34-08 ONBOARD-07 — Onboarding builder admin module.
 *
 * Top-level shell mounted by the AdminShell at `/admin/onboarding` (route
 * registered in `src/lib/admin/modules.ts`). Hosts three tabs:
 *
 *   - Builder  — SortableTreePanel + StepPalette + StepPropertyPanel.
 *   - A/B      — placeholder; Plan 34-09 ships the real OnboardingABPanel.
 *   - Funnel   — placeholder; Plan 34-09 ships the real OnboardingFunnelTab.
 *
 * Plan 34-09 (Wave 4) wired the real OnboardingABPanel + OnboardingFunnelTab
 * into the A/B and Funnel tab branches. Plan 34-08 originally owned only the
 * Builder tab + placeholder seams; that placeholder is now removed.
 *
 * Save flow: calls `save_consumer_onboarding_flow(p_steps)` SECDEF (Plan
 * 34-01). The SECDEF re-checks `admin_role='superadmin'` server-side
 * (Pattern S1 dual-layer); the Save button's `disabled` state here is the
 * UX hint layer.
 *
 * Bundle-budget invariant: this file (and every sibling under
 * `src/components/admin/onboarding-builder/`) is routed to the `admin-shell`
 * lazy chunk by the vite.config.ts `manualChunks` rule on
 * `src/components/admin/`. The chunk also pulls in `vendor-dnd-kit` via the
 * SortableTreePanel import. CI guard
 * `scripts/assert-clinic-bundle-budget.sh` fails the build if dnd-kit leaks
 * into the index chunk (see memory
 * [[admin-module-manifest-vs-router-branch-drift]]).
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SortableTreePanel } from '@/components/ui/SortableTreePanel';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import type { ConsumerOnboardingStepNode } from '@/types/onboarding-step';
import OnboardingABPanel from './OnboardingABPanel';
import OnboardingFunnelTab from './OnboardingFunnelTab';
import StepPalette, { createStepOfType } from './StepPalette';
import StepPropertyPanel from './StepPropertyPanel';
import StepRow from './StepRow';

type Tab = 'builder' | 'ab' | 'funnel';

const TABS: { id: Tab; label: string }[] = [
  { id: 'builder', label: 'Builder' },
  { id: 'ab', label: 'A/B Experiments' },
  { id: 'funnel', label: 'Funnel Analytics' },
];

export default function OnboardingBuilderModule() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('builder');
  const [steps, setSteps] = useState<ConsumerOnboardingStepNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Plan 34-09: active flow id (sourced from the same onboarding_flows row the
  // Builder tab loads). Passed to OnboardingFunnelTab so PostHog HogQL filters
  // by the deployed flow rather than the working draft.
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);

  const isSuperadmin = adminRole === 'superadmin';

  // -------------------------------------------------------------------------
  // Initial load — admin role + active flow.
  // Empty dep array: one fetch per mount; AdminShell remounts on route change.
  // Errors swallowed defensively so the page never hard-crashes for an admin.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('admin_role')
            .eq('id', user.id)
            .maybeSingle();
          if (!cancelled)
            setAdminRole((prof as { admin_role?: string } | null)?.admin_role ?? null);
        }

        const { data: flow } = await supabase
          .from('onboarding_flows')
          .select('id,config')
          .eq('is_active', true)
          .maybeSingle();
        if (!cancelled) {
          const flowRow = flow as { id?: string; config?: unknown } | null;
          const cfg = flowRow?.config;
          setSteps(Array.isArray(cfg) ? (cfg as ConsumerOnboardingStepNode[]) : []);
          setActiveFlowId(flowRow?.id ?? null);
          setLoading(false);
        }
      } catch (err) {
        // Fail-open: leave steps empty + Save disabled. Surface in toast so
        // the admin understands they are looking at a blank slate rather
        // than the real flow.
        if (!cancelled) {
          setLoading(false);
          toast(`Could not load active flow: ${(err as Error).message}`, 'error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Save handler
  // -------------------------------------------------------------------------
  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('save_consumer_onboarding_flow', {
        p_steps: steps,
      });
      if (error) {
        // Distinguish the EoP gate (42501) from generic failures so the admin
        // doesn't think their flow JSON is invalid when it's actually a role
        // problem. message-substring check covers cases where Supabase wraps
        // the code in the user-facing string.
        if (error.code === '42501' || /superadmin|forbidden/i.test(error.message)) {
          toast('Superadmin role required to save', 'error');
        } else {
          toast(`Save failed: ${error.message}`, 'error');
        }
        return;
      }
      toast('Saved as new version', 'success');
    } finally {
      setSaving(false);
    }
  }

  const selected = useMemo(
    () => steps.find((s) => s.id === selectedId) ?? null,
    [steps, selectedId],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Onboarding builder</h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Consumer onboarding flow — Plan 34-08. Save calls
            <code className="mx-1">save_consumer_onboarding_flow</code> SECDEF.
          </p>
        </div>
        <Button
          variant="primary"
          loading={saving}
          disabled={!isSuperadmin || loading}
          title={!isSuperadmin ? 'Superadmin only' : undefined}
          onClick={() => void handleSave()}
          data-action="save-flow"
        >
          Save flow
        </Button>
      </header>

      <div
        role="tablist"
        aria-label="Onboarding builder tabs"
        className="flex gap-1 border-b border-[var(--color-border)] mb-6"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`onboarding-builder-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={
              'px-4 py-2 min-h-[44px] text-sm transition-colors ' +
              (tab === t.id
                ? 'border-b-2 border-[var(--color-primary)] font-semibold text-[var(--color-text)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]')
            }
            data-tab={t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`onboarding-builder-tab-${tab}`}
        aria-labelledby={`onboarding-builder-tab-${tab}`}
      >
        {tab === 'builder' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4">
            <div className="space-y-3">
              <StepPalette
                onAddStep={(t) => {
                  const next = createStepOfType(t);
                  setSteps((prev) => [...prev, next]);
                  setSelectedId(next.id);
                }}
              />
              {loading ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="text-[var(--color-text-tertiary)] p-4"
                >
                  Loading flow…
                </div>
              ) : steps.length === 0 ? (
                <div className="text-[var(--color-text-tertiary)] p-4 border border-dashed border-[var(--color-border)] rounded-xl">
                  No steps yet. Click a chip above to add the first step.
                </div>
              ) : (
                <SortableTreePanel<ConsumerOnboardingStepNode>
                  items={steps}
                  getId={(s) => s.id}
                  onReorder={(next) => setSteps(next)}
                  renderItem={(s, i, dragging) => (
                    <StepRow
                      step={s}
                      index={i}
                      dragging={dragging}
                      onClick={() => setSelectedId(s.id)}
                    />
                  )}
                  announceItemLabel={(s) => `${s.type}: ${s.copy?.title || 'untitled'}`}
                />
              )}
            </div>
            <aside
              className="bg-[var(--color-surface-elevated)] p-4 rounded-2xl min-h-[400px] border border-[var(--color-border)]"
              aria-label="Step properties"
            >
              {selected ? (
                <StepPropertyPanel
                  step={selected}
                  onChange={(next) =>
                    setSteps((prev) => prev.map((s) => (s.id === selected.id ? next : s)))
                  }
                  onDelete={() => {
                    setSteps((prev) => prev.filter((s) => s.id !== selected.id));
                    setSelectedId(null);
                  }}
                />
              ) : (
                <p className="text-[var(--color-text-tertiary)] text-sm">
                  Select a step to edit its properties.
                </p>
              )}
            </aside>
          </div>
        )}
        {tab === 'ab' && <OnboardingABPanel />}
        {tab === 'funnel' && <OnboardingFunnelTab flowId={activeFlowId} />}
      </div>
    </div>
  );
}

// Plan 34-09 wired the real OnboardingABPanel + OnboardingFunnelTab here —
// the prior placeholder seam (`Plan34-09` marker) is removed. The
// OnboardingBuilderModule unit test now asserts the real tab markers instead.

// Type re-export removed — consumers should import directly from
// '@/types/onboarding-step'. Keeping this file as a pure component module
// satisfies react-refresh/only-export-components and keeps HMR boundaries
// clean for AdminShell -> OnboardingBuilderModule reload cycles.
