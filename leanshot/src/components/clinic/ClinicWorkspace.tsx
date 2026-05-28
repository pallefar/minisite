/**
 * Phase 9 Plan 09-02 / Phase 10 Plan 10-06 — ClinicWorkspace.
 *
 * Operator workspace home at `/clinic/{slug}`. Composition:
 *
 *   ClinicContextBar (sticky top)
 *   Page eyebrow + heading + subhead
 *   RosterTable (Phase 10 Plan 10-06 — replaces Phase 9 empty-roster shell)
 *   InvitePatientModal (controlled, opens via local state)
 *
 * Data lifecycle:
 *   - Read slug from window.location.pathname (path-based routing — App.tsx).
 *   - Query `orgs` row via supabase-js (RLS gates to owner/member).
 *   - On 401/404 / no row → route back to `/`.
 *   - When `?invite=1` query param is set (OrgCreateFlow success-state
 *     handoff), auto-open InvitePatientModal once on first hydrate.
 *
 * Phase 10 plan 10-06 update: replaces the empty EmptyState roster shell
 * with the full RosterTable that calls rank_org_patients RPC + subscribes
 * to Realtime broadcasts. permissionMap is derived from operator role
 * using the owner-all-true default (role-specific permissions wired in
 * Plan 10-07 via clinic-snapshot's permission_map response).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lazy, Suspense } from 'react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { CLINIC_EVENTS } from '@/lib/clinic-events';
import { supabase } from '@/lib/supabase';
import type { Org } from '@/types/clinic';
import type { ReadOnlyPermissionMap } from '@/types/snapshot';
import { ClinicContextBar } from './ClinicContextBar';
import { InvitePatientModal } from './InvitePatientModal';
import { RosterTable } from './roster/RosterTable';

// P30 Plan 30-04 — ClinicDashboardOverview lazy-loaded to keep clinic chunk under bundle ceiling.
// Mount above the Roster on the workspace home so SC#5 (CLIN-05) + CLIN-08 surface population-level
// metrics without a router change. Wired here per verifier orphan-fix 2026-05-18.
const ClinicDashboardOverview = lazy(() =>
  import('./dashboard/ClinicDashboardOverview').then((m) => ({
    default: m.ClinicDashboardOverview,
  })),
);

// Phase 61 Plan 61-06 — ClinicProtocolsPage lazy-loaded (keeps clinic chunk under ceiling).
// Clinician protocol adoption flow: browse published protocols + adopt for patient.
const ClinicProtocolsPage = lazy(() =>
  import('./protocols/ClinicProtocolsPage').then((m) => ({ default: m.ClinicProtocolsPage })),
);

type ClinicTab = 'roster' | 'protocols';

/**
 * Default permission map for the org owner. Role-specific permissions are
 * resolved by Plan 10-07's clinic-snapshot Edge Function; this default
 * allows all sections + breakdown for the owner context in Phase 10 Plan 10-06.
 */
const OWNER_PERMISSION_MAP: ReadOnlyPermissionMap = {
  canViewInjections: true,
  canViewWeights: true,
  canViewSymptoms: true,
  canViewPhotos: true,
  canViewDoctorReport: true,
  canViewMeals: true,
  canViewWorkouts: true,
  canViewSupplements: true,
  canViewMood: true,
  canViewSleep: true,
  canViewBreakdown: true,
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'hydrated'; org: Org };

function slugFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^\/clinic\/([^/]+)/);
  return m ? m[1] : null;
}

function shouldOpenInviteFromQuery(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('invite') === '1';
  } catch {
    return false;
  }
}

function navigateHome(): void {
  if (typeof window === 'undefined') return;
  try {
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    /* jsdom no-op */
  }
}

export function ClinicWorkspace() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [inviteOpen, setInviteOpen] = useState<boolean>(() => shouldOpenInviteFromQuery());
  const [currentTab, setCurrentTab] = useState<ClinicTab>('roster');

  const slug = useMemo(() => slugFromLocation(), []);

  const loadOrg = useCallback(async () => {
    if (!slug) {
      navigateHome();
      return;
    }
    setLoad({ kind: 'loading' });
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select(
          'id, slug, name, description, website_url, logo_storage_path, created_by, created_at',
        )
        .eq('slug', slug)
        .maybeSingle();
      if (error) {
        // 401 or general DB error → bounce home or surface retry.
        // RLS denial for a non-member surfaces as `data:null,error:null`
        // (`maybeSingle` returns no row when filter doesn't match RLS).
        setLoad({
          kind: 'error',
          message: "Couldn't load workspace. Check your connection and try again.",
        });
        return;
      }
      if (!data) {
        // No row visible (either doesn't exist or RLS blocked) → home.
        navigateHome();
        return;
      }
      setLoad({ kind: 'hydrated', org: data as Org });
      try {
        (
          window as unknown as {
            posthog?: { capture: (e: string, p: Record<string, unknown>) => void };
          }
        ).posthog?.capture(CLINIC_EVENTS.WORKSPACE_LOADED, { org_id: data.id });
      } catch {
        /* PostHog optional — never block hydration */
      }
    } catch {
      setLoad({
        kind: 'error',
        message: "Couldn't load workspace. Check your connection and try again.",
      });
    }
  }, [slug]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  // ----- Loading state -----------------------------------------------
  if (load.kind === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--color-bg)]" data-testid="clinic-workspace-loading">
        <header className="sticky top-0 z-20 flex items-center gap-3 px-4 md:px-6 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-4 w-40" />
        </header>
        <main className="max-w-5xl mx-auto p-6 space-y-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-5 w-56" />
          <div className="pt-8">
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        </main>
      </div>
    );
  }

  // ----- Error state -------------------------------------------------
  if (load.kind === 'error') {
    return (
      <div
        role="alert"
        className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6"
        data-testid="clinic-workspace-error"
      >
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-[18px] font-bold text-[var(--color-text)]">
            Couldn&apos;t load workspace
          </h2>
          <p className="text-[14px] text-[var(--color-text-secondary)]">{load.message}</p>
          <Button variant="primary" onClick={() => void loadOrg()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ----- Hydrated state ---------------------------------------------
  const { org } = load;
  return (
    <div className="min-h-screen bg-[var(--color-bg)]" data-testid="clinic-workspace">
      <ClinicContextBar org={org} />

      {/* Phase 61 Plan 61-06 — Tab navigation bar (Roster | Protocols) */}
      <nav
        className="sticky top-14 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 md:px-6"
        aria-label="Workspace tabs"
      >
        <div className="max-w-5xl mx-auto flex gap-0">
          {(
            [
              { key: 'roster' as ClinicTab, label: 'Roster' },
              { key: 'protocols' as ClinicTab, label: 'Protocols' },
            ] as const
          ).map((tab) => {
            const isActive = currentTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.key}`}
                onClick={() => setCurrentTab(tab.key)}
                className={`px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset ${
                  isActive
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-6 md:p-8">
        {/* Roster tab panel */}
        <div
          id="tabpanel-roster"
          role="tabpanel"
          aria-label="Roster"
          hidden={currentTab !== 'roster'}
          className={currentTab === 'roster' ? 'space-y-6' : ''}
        >
          <header className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
              Workspace
            </p>
            <h1 className="text-[24px] md:text-[32px] font-bold text-[var(--color-text)]">
              {org.name}
            </h1>
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              Your patients will appear here.
            </p>
          </header>

          {/* P30 — Dashboard overview (CLIN-05 / CLIN-08). Lazy-loaded; falls back to a small Skeleton. */}
          <Suspense
            fallback={
              <div
                className="h-32 rounded-card bg-[var(--color-surface-elevated)]"
                aria-hidden="true"
              />
            }
          >
            <ClinicDashboardOverview orgId={org.id} />
          </Suspense>

          <section
            className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-6"
            aria-label="Patient roster"
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Roster</h2>
              <Button variant="secondary" size="sm" onClick={() => setInviteOpen(true)}>
                Invite patient
              </Button>
            </div>
            <RosterTable orgId={org.id} slug={org.slug} permissionMap={OWNER_PERMISSION_MAP} />
          </section>
        </div>

        {/* Protocols tab panel — Phase 61 Plan 61-06 */}
        <div
          id="tabpanel-protocols"
          role="tabpanel"
          aria-label="Protocols"
          hidden={currentTab !== 'protocols'}
          className={currentTab === 'protocols' ? '' : ''}
        >
          {currentTab === 'protocols' && (
            <Suspense fallback={<Skeleton className="h-40 w-full rounded-card" />}>
              <ClinicProtocolsPage orgId={org.id} />
            </Suspense>
          )}
        </div>
      </main>

      <InvitePatientModal open={inviteOpen} orgId={org.id} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

export default ClinicWorkspace;
