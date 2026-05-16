/**
 * Phase 10 Plan 10-07 — ClinicDrillInPage.
 *
 * Composition root for the operator's drill-in view at
 * `/clinic/{slug}/patient/{user_id}`.
 *
 * Architecture:
 *   ClinicContextBar (Phase 9, unchanged)
 *   ClinicDrillInSubBar (Plan 10-07: back / patient name / refresh / view-activity)
 *   ReadOnlyPatientView (Plan 10-05: snapshot body with viewerMode='clinic')
 *
 * Data flow:
 *   1. Parse slug + user_id from window.location.pathname.
 *   2. Load org row from `orgs` table (same pattern as ClinicWorkspace — no dedicated hook).
 *   3. Call useClinicSnapshot({ orgId, patientId }) for patient data.
 *   4. Forward onSectionMount to ReadOnlyPatientView → fires log_clinic_view RPC
 *      + PostHog clinic_drill_section_expanded ONCE per section per page instance
 *      (useRef-guarded Map to prevent re-fires on re-render).
 *
 * Error handling:
 *   - 401: toast "X revoked access. Returning to roster." + setTimeout → /clinic/{slug}
 *   - 403: toast "X updated what they share…" + unmount blocked section (local permissionMap override)
 *
 * Back navigation: reads sessionStorage[`clinic_roster_state_{org_id}`] for prior sort + offset.
 *
 * T-10-07-04 (401 redirect loop): redirected=useRef prevents repeat toasts/redirects
 * if the Edge Function flaps with multiple 401s during the same drill-in session.
 *
 * View activity button: opens PatientActivityModal (Plan 10-09). That component does
 * not yet exist at Plan 10-07 execution time — the callback emits a console.warn
 * until Plan 10-09 wires the modal.
 *
 * Policy: no Zustand store reads (this is a clinic surface; all auth is via supabase JWT).
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClinicContextBar } from '@/components/clinic/ClinicContextBar';
import { ReadOnlyPatientView } from '@/components/shared/ReadOnlyPatientView';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { CLINIC_EVENTS } from '@/lib/clinic-events';
import { supabase } from '@/lib/supabase';
import type { Org } from '@/types/clinic';
import type { ReadOnlyPermissionMap } from '@/types/snapshot';
import { useToast } from '@/hooks/useToast';
import { ClinicDrillInSubBar } from './ClinicDrillInSubBar';
import { useClinicSnapshot } from './use-clinic-snapshot';

// ---------------------------------------------------------------------------
// PatientActivityModal — lazy-loaded to keep the drill-in entry chunk lean.
// Dynamic import creates a code-split boundary; the modal is only downloaded
// when the operator first opens it (not on initial page load).
// ---------------------------------------------------------------------------

const PatientActivityModal = lazy(() =>
  import('./PatientActivityModal').then((m) => ({ default: m.PatientActivityModal })),
);

// ---------------------------------------------------------------------------
// URL parsing helpers
// ---------------------------------------------------------------------------

function parseDrillInPath(): { slug: string | null; patientId: string | null } {
  if (typeof window === 'undefined') return { slug: null, patientId: null };
  const m = window.location.pathname.match(/^\/clinic\/([^/]+)\/patient\/([^/]+)$/);
  if (!m) return { slug: null, patientId: null };
  return { slug: m[1], patientId: m[2] };
}

function navigateToRoster(slug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.history.pushState({}, '', `/clinic/${slug}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    /* jsdom no-op */
  }
}

// ---------------------------------------------------------------------------
// Session-storage roster state key (Plan 10-06 round-trip)
// ---------------------------------------------------------------------------

function getRosterStateKey(orgId: string): string {
  return `clinic_roster_state_${orgId}`;
}

// ---------------------------------------------------------------------------
// Scope summary helper
// ---------------------------------------------------------------------------

function buildScopeSummary(
  consentScope: Record<string, boolean> | undefined,
): string {
  if (!consentScope) return 'Sharing data';
  const total = 10; // canonical data type count per D-03
  const active = Object.values(consentScope).filter(Boolean).length;
  return `Sharing ${active} of ${total} data types`;
}

// ---------------------------------------------------------------------------
// Name formatting: "First L." from full display name
// ---------------------------------------------------------------------------

function formatPatientName(displayName: string): string {
  const trimmed = displayName?.trim() ?? '';
  if (!trimmed) return 'Patient';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

function getFirstName(displayName: string): string {
  const trimmed = displayName?.trim() ?? '';
  if (!trimmed) return 'Patient';
  return trimmed.split(/\s+/)[0];
}

// ---------------------------------------------------------------------------
// Org loader (mirrors ClinicWorkspace pattern)
// ---------------------------------------------------------------------------

type OrgLoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'hydrated'; org: Org };

function useOrgBySlug(slug: string | null): {
  orgState: OrgLoadState;
  reloadOrg: () => Promise<void>;
} {
  const [orgState, setOrgState] = useState<OrgLoadState>({ kind: 'loading' });

  const reloadOrg = useCallback(async () => {
    if (!slug) {
      setOrgState({ kind: 'error', message: 'No org slug.' });
      return;
    }
    setOrgState({ kind: 'loading' });
    try {
      const { data, error } = await supabase
        .from('orgs')
        .select('id, slug, name, description, website_url, logo_storage_path, owner_user_id, created_at')
        .eq('slug', slug)
        .maybeSingle();
      if (error) {
        setOrgState({ kind: 'error', message: "Couldn't load workspace." });
        return;
      }
      if (!data) {
        setOrgState({ kind: 'error', message: 'Workspace not found.' });
        return;
      }
      setOrgState({ kind: 'hydrated', org: data as Org });
    } catch {
      setOrgState({ kind: 'error', message: "Couldn't load workspace." });
    }
  }, [slug]);

  useEffect(() => {
    void reloadOrg();
  }, [reloadOrg]);

  return { orgState, reloadOrg };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ClinicDrillInPage() {
  const toast = useToast();

  const { slug, patientId } = useMemo(() => parseDrillInPath(), []);
  const { orgState } = useOrgBySlug(slug);

  const orgId = orgState.kind === 'hydrated' ? orgState.org.id : null;

  const { snapshot, loading: snapshotLoading, error, refresh, lastFetchedAt } = useClinicSnapshot({
    orgId,
    patientId,
  });

  // Local permissionMap starts from snapshot.permission_map but can be
  // overridden on 403 to unmount the blocked section in-place (T-10-07-01).
  const [localPermissionMap, setLocalPermissionMap] = useState<ReadOnlyPermissionMap | null>(null);

  // PatientActivityModal open flag (Plan 23-03 DEBT-01 closeout).
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);

  // Update local permissionMap whenever a new snapshot loads.
  useEffect(() => {
    if (snapshot?.permission_map) {
      setLocalPermissionMap(snapshot.permission_map);
    }
  }, [snapshot]);

  // One-shot redirect guard — prevents re-fire on subsequent 401s (T-10-07-04).
  const redirectedRef = useRef(false);

  // Handle 401/403 errors from useClinicSnapshot.
  useEffect(() => {
    if (!error) return;
    const firstName = snapshot?.display_name
      ? getFirstName(snapshot.display_name)
      : 'Patient';

    if (error.status === 401 && !redirectedRef.current) {
      redirectedRef.current = true;
      toast(`${firstName} revoked access. Returning to roster.`, 'error');
      setTimeout(() => {
        if (slug) navigateToRoster(slug);
      }, 1000);
    } else if (error.status === 403 && error.blockedSection) {
      toast(`${firstName} updated what they share. This data is no longer available.`, 'info');
      // Unmount the blocked section by overriding the local permission map.
      const blockedKey = error.blockedSection;
      setLocalPermissionMap((prev) => {
        if (!prev) return prev;
        const sectionToPermKey: Record<string, keyof ReadOnlyPermissionMap> = {
          injections: 'canViewInjections',
          weights: 'canViewWeights',
          symptoms: 'canViewSymptoms',
          photos: 'canViewPhotos',
          doctor_report: 'canViewDoctorReport',
          meals: 'canViewMeals',
          workouts: 'canViewWorkouts',
          supplements: 'canViewSupplements',
          mood: 'canViewMood',
          sleep: 'canViewSleep',
        };
        const permKey = sectionToPermKey[blockedKey];
        if (!permKey) return prev;
        return { ...prev, [permKey]: false };
      });
    }
    // 500 errors: render the inline error state (no special side effects).
  }, [error, snapshot, slug, toast]);

  // Per-section audit fire guard. Map<sectionName, true> — each entry means the
  // section has fired its audit row + PostHog event during this page instance.
  // useRef so the Map survives re-renders without resetting.
  const firedSectionsRef = useRef<Map<string, true>>(new Map());

  const handleSectionMount = useCallback(
    async (sectionName: string) => {
      // Prevent duplicate fires on re-render.
      if (firedSectionsRef.current.has(sectionName)) return;
      firedSectionsRef.current.set(sectionName, true);

      // 1. Write audit row via log_clinic_view RPC (Plan 10-04 SECURITY DEFINER).
      if (orgId && patientId) {
        try {
          await supabase.rpc('log_clinic_view', {
            p_org_id: orgId,
            p_target_user_id: patientId,
            p_section_name: sectionName,
          });
        } catch {
          // T-10-07-02: missed audit row preferable to crashed UI.
        }
      }

      // 2. Fire PHI-safe PostHog event (no patient IDs — only section_name per D-24).
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).posthog?.capture(CLINIC_EVENTS.DRILL_SECTION_EXPANDED, {
          section_name: sectionName,
        });
      } catch {
        // PostHog unavailable — ignore
      }
    },
    [orgId, patientId],
  );

  // Back-to-roster navigation: restore prior sort + offset from session storage.
  const handleBack = useCallback(() => {
    if (!slug) return;
    // The session storage key preserves roster sort + offset state from ClinicWorkspace.
    // Plan 10-06 writes this key when the operator clicks a row; we read it here on back.
    if (orgId) {
      try {
        const key = getRosterStateKey(orgId);
        const stored = sessionStorage.getItem(key);
        if (stored) {
          // State is preserved; ClinicWorkspace's useRankRoster will re-read it.
          // No action needed here — the key survives navigation.
          void stored;
        }
      } catch {
        // sessionStorage unavailable (private mode) — navigate without state.
      }
    }
    navigateToRoster(slug);
  }, [slug, orgId]);

  // View activity callback — Plan 23-03 DEBT-01 closeout.
  // Opens PatientActivityModal for the currently drill-in patient.
  const handleViewActivity = useCallback(() => {
    setIsActivityModalOpen(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Loading state (org + snapshot both loading)
  // ---------------------------------------------------------------------------

  if (orgState.kind === 'loading' || (snapshotLoading && !snapshot)) {
    return (
      <div
        className="min-h-screen bg-[var(--color-bg)]"
        data-testid="drill-in-loading"
      >
        <header className="sticky top-0 z-20 flex items-center gap-3 px-4 md:px-6 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-4 w-40" />
        </header>
        <div className="flex items-center gap-3 px-4 md:px-6 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <Skeleton className="h-8 w-24 rounded-pill" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <main className="max-w-3xl mx-auto p-6 space-y-6">
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Org error state
  // ---------------------------------------------------------------------------

  if (orgState.kind === 'error') {
    return (
      <div
        role="alert"
        className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6"
        data-testid="drill-in-error"
      >
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-[18px] font-bold text-[var(--color-text)]">
            Couldn&apos;t load workspace
          </h2>
          <p className="text-[14px] text-[var(--color-text-secondary)]">{orgState.message}</p>
          <Button variant="primary" onClick={() => slug && navigateToRoster(slug)}>
            Back to roster
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Snapshot 500 / network error
  // ---------------------------------------------------------------------------

  if (error?.status === 500) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)]" data-testid="drill-in-snapshot-error">
        <ClinicContextBar org={orgState.org} />
        <div className="flex items-center gap-3 px-4 md:px-6 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            aria-label="Back to roster"
          >
            ← Roster
          </Button>
        </div>
        <div
          role="alert"
          className="max-w-3xl mx-auto p-6 text-center space-y-4"
        >
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Couldn&apos;t load this patient&apos;s data. Check your connection and try again.
          </p>
          <Button variant="primary" onClick={refresh}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Hydrated state
  // ---------------------------------------------------------------------------

  const { org } = orgState;

  const patientDisplayName = snapshot?.display_name
    ? formatPatientName(snapshot.display_name)
    : 'Patient';

  const scopeSummary = buildScopeSummary(
    snapshot?.consent_scope as Record<string, boolean> | undefined,
  );

  // Derive joined-at from snapshot metadata if available.
  // The clinic-snapshot Edge Function does not currently surface a joined_at field
  // in SnapshotData; fall back to null (sub-bar renders without the "Joined X" line).
  const joinedAt: string | null = null;

  const permissionMap = localPermissionMap ?? snapshot?.permission_map ?? null;

  return (
    <div className="min-h-screen bg-[var(--color-bg)]" data-testid="drill-in-page">
      <ClinicContextBar org={org} />
      <ClinicDrillInSubBar
        patientName={patientDisplayName}
        joinedAt={joinedAt}
        scopeSummary={scopeSummary}
        lastFetchedAt={lastFetchedAt}
        onBack={handleBack}
        onRefresh={refresh}
        onViewActivity={handleViewActivity}
      />

      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        {snapshot && permissionMap ? (
          <ReadOnlyPatientView
            snapshot={snapshot}
            viewerMode="clinic"
            permissionMap={permissionMap}
            onSectionMount={handleSectionMount}
          />
        ) : (
          // Snapshot fetched but permissionMap absent — edge case (snapshot returned
          // without permission_map). Render without gating (all sections visible).
          snapshot && (
            <ReadOnlyPatientView
              snapshot={snapshot}
              viewerMode="clinic"
              onSectionMount={handleSectionMount}
            />
          )
        )}
      </main>

      {/* PatientActivityModal — lazy-loaded, only mounted when open (DEBT-01 closeout). */}
      {patientId && (
        <Suspense fallback={null}>
          {isActivityModalOpen && (
            <PatientActivityModal
              patientId={patientId}
              open={isActivityModalOpen}
              onClose={() => setIsActivityModalOpen(false)}
            />
          )}
        </Suspense>
      )}
    </div>
  );
}

export default ClinicDrillInPage;
