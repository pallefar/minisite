/**
 * Phase 34 Plan 34-09 ONBOARD-08 — A/B experiments admin panel.
 *
 * Lists PostHog feature-flag experiments tagged "onboarding" (fetched via the
 * onboarding-funnel-query Edge Fn `kind:'list_experiments'` branch). Renders
 * a Ship Winner button per variant — clicking promotes that variant to 100%
 * rollout via the ship-winner-flag Edge Fn.
 *
 * Pattern S1 dual-layer (matches Plan 34-08 Save flow):
 *  - Client layer: button is `disabled` for non-superadmins with a
 *    "Superadmin only" title tooltip (UX hint).
 *  - Server layer: ship-winner-flag Edge Fn re-verifies admin_role server-side
 *    before any PostHog PATCH (T-34-09-01). A forged client can click but the
 *    Edge Fn returns 403 forbidden_not_superadmin which we surface as a toast.
 *
 * Per memory [[vendor-gated-send-via-health-check]]: when the Edge Fn returns
 * `{ error: 'vendor_unconfigured', service: 'posthog' }` (Plan 34-10 not yet
 * run) we render a soft banner pointing the operator at Plan 34-10 — never
 * a hard crash.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface Experiment {
  id: number;
  key: string;
  name: string;
  current_rollout: number;
  variants: string[];
}

interface InvokeError { error?: string }

export default function OnboardingABPanel() {
  const toast = useToast();
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const fetchExperiments = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase.functions.invoke('onboarding-funnel-query', {
      body: { kind: 'list_experiments' },
    });
    if (error) {
      // Network or Edge Fn unreachable — leave the loading state and surface a
      // toast. Keep behavior soft: no banner here so the operator can retry by
      // re-opening the tab.
      toast(`Could not load experiments: ${error.message}`, 'error');
      setExperiments([]);
      return;
    }
    const payload = data as { experiments?: Experiment[] } & InvokeError;
    if (payload?.error === 'vendor_unconfigured') {
      setUnconfigured(true);
      setExperiments([]);
      return;
    }
    setExperiments(Array.isArray(payload?.experiments) ? payload.experiments : []);
  }, [toast]);

  // Initial load: admin role for the gate hint + experiment list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (uid && !cancelled) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('admin_role')
            .eq('id', uid)
            .maybeSingle();
          if (!cancelled) {
            setAdminRole(((prof as { admin_role?: string } | null)?.admin_role) ?? null);
          }
        }
        if (!cancelled) await fetchExperiments();
      } catch (err) {
        if (!cancelled) {
          toast(`Could not load experiments: ${(err as Error).message}`, 'error');
          setExperiments([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // fetchExperiments + toast are stable refs (useCallback / hook returns
    // the same fn). Including them here would not loop, but the explicit
    // empty-dep + cancelled flag pattern matches OnboardingBuilderModule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleShip(flagId: number, variant: string): Promise<void> {
    const key = `${flagId}:${variant}`;
    setBusyKey(key);
    try {
      const { data, error } = await supabase.functions.invoke('ship-winner-flag', {
        body: { flag_id: String(flagId), variant },
      });
      const payload = data as ({ ok?: boolean } & InvokeError) | null;
      if (error || payload?.error) {
        const code = payload?.error;
        if (code === 'forbidden_not_superadmin') {
          toast('Superadmin role required', 'error');
        } else if (code === 'vendor_unconfigured') {
          setUnconfigured(true);
          toast('PostHog not yet configured', 'error');
        } else {
          toast(`Ship failed: ${error?.message ?? code ?? 'unknown'}`, 'error');
        }
        return;
      }
      toast(`Shipped variant ${variant} to 100%`, 'success');
      // Refresh the list so the new rollout % appears.
      await fetchExperiments();
    } finally {
      setBusyKey(null);
    }
  }

  if (unconfigured) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-[var(--color-warning,#a67b00)] bg-[var(--color-surface-elevated)] p-4"
      >
        <p className="font-medium">PostHog API key not yet configured.</p>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
          Plan 34-10 owns the human checkpoint that sets{' '}
          <code>POSTHOG_PERSONAL_API_KEY</code> and <code>POSTHOG_PROJECT_ID</code> as Supabase
          Function Secrets.
        </p>
      </div>
    );
  }

  if (experiments === null) {
    return (
      <div role="status" aria-live="polite" className="text-[var(--color-text-tertiary)] p-4">
        Loading experiments…
      </div>
    );
  }

  if (experiments.length === 0) {
    return (
      <p className="text-[var(--color-text-tertiary)] p-4">
        No onboarding experiments yet. Create one in PostHog → Experiments tagged
        <code className="mx-1">onboarding</code>.
      </p>
    );
  }

  const canShip = adminRole === 'superadmin';

  return (
    <ul className="space-y-3">
      {experiments.map((exp) => (
        <li
          key={exp.id}
          className="bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-2xl p-4"
        >
          <header className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold">{exp.name}</h3>
              <p className="text-sm text-[var(--color-text-tertiary)] font-mono">
                {exp.key} · rollout {exp.current_rollout}%
              </p>
            </div>
          </header>
          <div className="mt-3 flex flex-wrap gap-2">
            {exp.variants.map((v) => {
              const key = `${exp.id}:${v}`;
              return (
                <Button
                  key={v}
                  variant="primary"
                  disabled={!canShip || busyKey === key}
                  loading={busyKey === key}
                  title={!canShip ? 'Superadmin only' : undefined}
                  onClick={() => void handleShip(exp.id, v)}
                  data-action="ship-winner"
                  data-flag-id={exp.id}
                  data-variant={v}
                >
                  Ship &ldquo;{v}&rdquo; to 100%
                </Button>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}
