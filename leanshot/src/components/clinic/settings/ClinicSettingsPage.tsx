/**
 * Phase 9 Plan 09-03 — ClinicSettingsPage.
 *
 * Lazy-chunk root for the `clinic-settings` bundle. OVERWRITES the Wave-1
 * stub from Plan 09-01. App.tsx already wires the lazy import + the
 * `/clinic/{slug}/settings*` selectView branch — this plan does NOT touch
 * App.tsx (B-2 ownership rule per plan-checker iter 1).
 *
 * Renders a sidebar tab nav (Workspace / Members / Roles) + the active
 * tab's component lazy-loaded. Tab switching uses `window.history.pushState`
 * so URLs like `/clinic/{slug}/settings/roles` are bookmarkable + survive
 * refresh, but switching within the page does not remount (preserves form
 * dirty state).
 *
 * Active-org resolution: parses the slug from `window.location.pathname`,
 * then queries the `orgs` table (RLS-gated to members). The page renders
 * a skeleton while the org loads. When the org is missing or the user
 * lacks `org.read`, we route back to `/` rather than rendering an empty
 * shell (defensive UX; the auth gate at App.tsx ensures the user is at
 * least signed-in to reach this surface).
 *
 * Parallel-executor isolation: Plan 09-02 owns the typed `clinic.ts`
 * wrappers + ClinicContextBar. Until they merge, this page renders a
 * minimal context header inline (workspace name + the standard tab nav).
 */
import {
  Building2,
  History,
  ListOrdered,
  Loader2,
  Palette,
  Shield,
  Stethoscope,
  Users,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHasPermission } from '@/lib/clinic-permissions';
import { cn } from '@/lib/helpers';
import { surfaceCheck } from '@/lib/org';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { Org, Role } from '@/types/clinic';
import { AuditTab } from './AuditTab';
import { ClinicDoseTrendThresholdsForm } from './ClinicDoseTrendThresholdsForm';
import { ClinicRankingWeightsForm } from './ClinicRankingWeightsForm';
import { MembersTab } from './MembersTab';
import { RolesTab } from './RolesTab';
import { WorkspaceTab } from './WorkspaceTab';

// Phase 31 Plan 31-05 — lazy-mount BrandingTab + OnboardingTab to keep
// clinic-settings chunk under the 50 kB gz ceiling.
const BrandingTab = lazy(() => import('./BrandingTab').then((m) => ({ default: m.BrandingTab })));
const OnboardingTab = lazy(() =>
  import('./OnboardingTab').then((m) => ({ default: m.OnboardingTab })),
);

type TabId = 'workspace' | 'members' | 'roles' | 'audit' | 'clinical' | 'branding' | 'onboarding';

interface NavEntry {
  id: TabId;
  label: string;
  Icon: typeof Building2;
  /** When provided, the tab is only shown when this predicate returns true. */
  visibleWhen?: (perms: Record<string, boolean | null>) => boolean;
}

const NAV: NavEntry[] = [
  { id: 'workspace', label: 'Workspace', Icon: Building2 },
  { id: 'members', label: 'Members', Icon: Users },
  { id: 'roles', label: 'Roles', Icon: Shield },
  {
    id: 'audit',
    label: 'Audit',
    Icon: History,
    visibleWhen: (perms) => perms['audit_log.read'] === true,
  },
  {
    id: 'clinical',
    label: 'Clinical',
    Icon: Stethoscope,
    visibleWhen: (perms) => perms['org_role.admin'] === true,
  },
  // Phase 31 Plan 31-05 — Branding + Onboarding tabs
  {
    id: 'branding',
    label: 'Branding',
    Icon: Palette,
    visibleWhen: (perms) => perms['branding.edit'] === true,
  },
  {
    // Onboarding is always visible — clinician sees read-only view inside the tab.
    id: 'onboarding',
    label: 'Onboarding',
    Icon: ListOrdered,
  },
];

/**
 * Match `/clinic/<slug>/settings[/<tab>]?`. Returns slug + optional tab.
 * Falls back to 'workspace' tab when missing or unknown so the landing
 * route `/clinic/{slug}/settings` works without a trailing path.
 */
function parseRoute(pathname: string): { slug: string | null; tab: TabId } {
  const m = pathname.match(/^\/clinic\/([^/]+)\/settings\/?([a-z-]+)?$/);
  if (!m) return { slug: null, tab: 'workspace' };
  const slug = m[1] ?? null;
  const raw = m[2];
  const tab: TabId =
    raw === 'members' ||
    raw === 'roles' ||
    raw === 'audit' ||
    raw === 'clinical' ||
    raw === 'branding' ||
    raw === 'onboarding'
      ? raw
      : 'workspace';
  return { slug, tab };
}

export function ClinicSettingsPage() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const [org, setOrg] = useState<Org | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [orgLoading, setOrgLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Permission map for NAV visibility gating. Uses cached session-scoped
  // values from useHasPermission (Phase 9 clinic-permissions.ts).
  const canReadAuditLog = useHasPermission(org?.id ?? null, 'audit_log.read');
  // Phase 30 Plan 02 / Phase 31 Plan 00: Owner role check for Clinical tab visibility.
  const currentOrgRole = useStore((s) => s.currentOrgRole);
  const isOwner = currentOrgRole === 'owner';
  const permMap: Record<string, boolean | null> = {
    'audit_log.read': canReadAuditLog,
    'org_role.admin': isOwner, // key 'org_role.admin' preserved — owned by Plan 31-05
    // Phase 31 Plan 31-05 — permission gates for new tabs (12-key matrix from 31-01)
    'branding.edit': surfaceCheck('branding.edit'),
    'onboarding.edit': surfaceCheck('onboarding.edit'),
  };

  // Sync route on popstate (back/forward) AND on internal pushState. We
  // dispatch a custom 'leanshot:clinic-settings-tab' event from the click
  // handler since pushState does NOT fire popstate.
  useEffect(() => {
    const recompute = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', recompute);
    window.addEventListener('leanshot:clinic-settings-tab', recompute);
    return () => {
      window.removeEventListener('popstate', recompute);
      window.removeEventListener('leanshot:clinic-settings-tab', recompute);
    };
  }, []);

  // Load active org + roles when slug changes.
  const fetchOrg = useCallback(async (slug: string): Promise<void> => {
    setOrgLoading(true);
    setNotFound(false);
    const { data, error } = await supabase
      .from('organizations')
      .select('id, slug, name, description, website_url, logo_storage_path, created_by, created_at')
      .eq('slug', slug)
      .limit(1);
    if (error || !data || data.length === 0) {
      setOrg(null);
      setNotFound(true);
      setOrgLoading(false);
      return;
    }
    const next = data[0] as Org;
    setOrg(next);
    setOrgLoading(false);

    // Roles for the Members tab dropdown.
    const { data: rolesData } = await supabase
      .from('roles')
      .select('id, org_id, name, description, is_system, created_at')
      .eq('org_id', next.id)
      .order('is_system', { ascending: false })
      .order('created_at', { ascending: true });
    setRoles(((rolesData ?? []) as Role[]) ?? []);
  }, []);

  useEffect(() => {
    if (!route.slug) {
      setOrg(null);
      setNotFound(true);
      setOrgLoading(false);
      return;
    }
    void fetchOrg(route.slug);
  }, [route.slug, fetchOrg]);

  const switchTab = (next: TabId): void => {
    if (!route.slug) return;
    const url = `/clinic/${route.slug}/settings/${next}`;
    if (window.location.pathname !== url) {
      window.history.pushState(null, '', url);
      window.dispatchEvent(new Event('leanshot:clinic-settings-tab'));
    }
  };

  if (orgLoading) {
    return (
      <main
        role="main"
        className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]"
      >
        <Skeleton className="w-32 h-2" shape="pill" />
      </main>
    );
  }

  if (notFound || !org) {
    return (
      <main
        role="main"
        className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4"
      >
        <Card variant="flat">
          <h1 className="text-[18px] font-bold mb-2">Workspace not found</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            The workspace you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main role="main" className="min-h-screen bg-[var(--color-bg)]">
      {/* Inline ClinicContextBar (Plan 09-02 ships the real one). Keeps the
          page's information architecture intact without depending on a
          file that's owned by a parallel plan in another worktree. */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 md:px-6 py-3 flex items-center gap-3">
        <div
          className="size-9 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center"
          aria-hidden
        >
          <Building2 className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold tracking-tight truncate">{org.name}</p>
          <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">
            leanshot.app/clinic/{org.slug}
          </p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 md:py-8 flex flex-col md:flex-row gap-5 md:gap-8">
        <nav className="md:w-52 shrink-0" aria-label="Settings sections">
          <ul className="flex md:flex-col gap-1 overflow-x-auto scrollbar-none -mx-2 md:mx-0 px-2">
            {NAV.filter(({ visibleWhen }) => !visibleWhen || visibleWhen(permMap)).map(
              ({ id, label, Icon }) => {
                const active = route.tab === id;
                return (
                  <li key={id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => switchTab(id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'inline-flex items-center gap-2.5 px-3 py-2.5 rounded-xl w-full text-start text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                        active
                          ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]',
                      )}
                    >
                      <Icon className="size-4" strokeWidth={active ? 2.2 : 1.8} />
                      {label}
                    </button>
                  </li>
                );
              },
            )}
          </ul>
        </nav>

        <div className="flex-1 min-w-0">
          {route.tab === 'workspace' && (
            <WorkspaceTab org={org} onOrgUpdated={(next) => setOrg(next)} />
          )}
          {route.tab === 'members' && <MembersTab orgId={org.id} roles={roles} />}
          {route.tab === 'roles' && <RolesTab orgId={org.id} />}
          {route.tab === 'audit' && canReadAuditLog && <AuditTab orgId={org.id} />}
          {route.tab === 'clinical' && isOwner && (
            <div className="space-y-6">
              <header>
                <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)]">
                  Clinical settings
                </h1>
                <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
                  Configure how patients are ranked and when dose-trend alerts fire for your clinic.
                </p>
              </header>
              <ClinicRankingWeightsForm orgId={org.id} />
              <ClinicDoseTrendThresholdsForm orgId={org.id} />
            </div>
          )}
          {/* Phase 31 Plan 31-05 — Branding tab (owner-only via surfaceCheck) */}
          {route.tab === 'branding' && surfaceCheck('branding.edit') && (
            <Suspense fallback={<ClinicSettingsLoader />}>
              <BrandingTab orgId={org.id} orgSlug={org.slug} />
            </Suspense>
          )}
          {/* Phase 31 Plan 31-05 — Onboarding tab (always visible; read-only for non-owners) */}
          {route.tab === 'onboarding' && (
            <Suspense fallback={<ClinicSettingsLoader />}>
              <OnboardingTab orgId={org.id} />
            </Suspense>
          )}
        </div>
      </div>
    </main>
  );
}

export default ClinicSettingsPage;

/** Loader rendered inside Suspense fallbacks if any consumer code-splits further. */
export function ClinicSettingsLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center text-[var(--color-text-secondary)]">
      <Loader2 className="size-5 animate-spin" aria-hidden />
    </div>
  );
}
