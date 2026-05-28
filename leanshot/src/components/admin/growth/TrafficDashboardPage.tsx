/**
 * Phase 51 Plan 51-05 (TRAFFIC-12) — TrafficDashboardPage shell.
 *
 * Route: /admin/growth/traffic (+ /channels, /funnels, /landing, /realtime, /taxonomy)
 *
 * This is the *shell* for the growth/traffic admin module. It renders:
 *   1. Page header (Activity icon-pill + H1 "Traffic & Conversion" + subtitle)
 *   2. 5-pill segmented PillGroup (Channels / Funnels / Landing / Real-time / Taxonomy)
 *   3. URL-driven active-tab state (popstate listener + history.pushState — no router)
 *   4. Lazy-loaded sub-tab body inside <Suspense>
 *
 * Wave-4 plans 51-06..09 fill in the sub-tab content by *overwriting the stub
 * sub-tab files* (TrafficChannelsTab.tsx, TrafficFunnelsTab.tsx, etc.). This
 * file's slot contract MUST stay stable across that wave — see "Slot contract"
 * notes inline below + the 51-05-SUMMARY.md "Forward effects" section.
 *
 * Pattern S1 (dual-layer security):
 *   - UX: ADMIN_MODULES entry has `minRole: 'admin'` → AdminShell role-filter
 *     hides nav + serves NotAuthorizedCard for non-admins.
 *   - DB: SECDEF RPCs added by 51-06..09 re-check admin role server-side.
 *
 * Routing: pathname-based, no react-router (CLAUDE.md constraint). AdminShell
 * URL-prefix branching (`pathname.startsWith('/admin/growth/traffic/')`) routes
 * every sub-route into this component automatically — no switch edit needed
 * (per project memory `feedback_admin_module_manifest_vs_router_branch_drift`).
 */
import { Activity, Filter, LayoutList, Map as MapIcon, Settings2 } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useStore } from '@/lib/store';

// ─── Slot contract: lazy sub-tab loaders ─────────────────────────────────────
//
// Each lazy import below points at the per-tab module file. Plans 51-06..09
// SHALL preserve these module paths AND the named exports (`TrafficChannelsTab`,
// etc.). Overwriting the stub file body is fine; renaming the export breaks
// this shell — do NOT do that. Default exports on the stub files exist for
// debugger ergonomics but are NOT load-bearing — the lazy unwrap below pulls
// the named export explicitly.
//
// TRAFFIC-CHANNEL-ROLLUP slot — Plan 51-06 (TrafficChannelsTab)
const TrafficChannelsTab = lazy(() =>
  import('./TrafficChannelsTab').then((m) => ({ default: m.TrafficChannelsTab })),
);
// TRAFFIC-FUNNEL slot — Plan 51-07 (TrafficFunnelsTab)
const TrafficFunnelsTab = lazy(() =>
  import('./TrafficFunnelsTab').then((m) => ({ default: m.TrafficFunnelsTab })),
);
// TRAFFIC-LANDING slot — Plan 51-08 (TrafficLandingPagesTab)
const TrafficLandingPagesTab = lazy(() =>
  import('./TrafficLandingPagesTab').then((m) => ({
    default: m.TrafficLandingPagesTab,
  })),
);
// TRAFFIC-REALTIME slot — Plan 51-09 (TrafficRealtimeTab)
const TrafficRealtimeTab = lazy(() =>
  import('./TrafficRealtimeTab').then((m) => ({ default: m.TrafficRealtimeTab })),
);
// TRAFFIC-TAXONOMY slot — Plan 51-09 (TrafficTaxonomyPage)
const TrafficTaxonomyPage = lazy(() =>
  import('./TrafficTaxonomyPage').then((m) => ({ default: m.TrafficTaxonomyPage })),
);

// ─── Tab routing ─────────────────────────────────────────────────────────────

export type TrafficTabKey = 'channels' | 'funnels' | 'landing' | 'realtime' | 'taxonomy';

const TAB_FROM_PATH: Record<string, TrafficTabKey> = {
  '/admin/growth/traffic/channels': 'channels',
  '/admin/growth/traffic/funnels': 'funnels',
  '/admin/growth/traffic/landing': 'landing',
  '/admin/growth/traffic/realtime': 'realtime',
  '/admin/growth/traffic/taxonomy': 'taxonomy',
};

function deriveTabFromPath(pathname: string): TrafficTabKey {
  const trimmed = pathname.replace(/\/$/, '');
  return TAB_FROM_PATH[trimmed] ?? 'channels';
}

// ─── Page ────────────────────────────────────────────────────────────────────

export const TrafficDashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TrafficTabKey>(() =>
    deriveTabFromPath(window.location.pathname),
  );

  // URL-driven tab state. No react-router in the consumer surface (per
  // CLAUDE.md). popstate handles back/forward navigation; goTab() drives
  // forward navigation via history.pushState.
  useEffect(() => {
    const onPop = () => setActiveTab(deriveTabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goTab = useCallback((tab: TrafficTabKey) => {
    const target = `/admin/growth/traffic/${tab}`;
    if (window.location.pathname !== target) {
      window.history.pushState(null, '', target);
    }
    setActiveTab(tab);
  }, []);

  // Role-aware subtitle (UI-SPEC §Per-clinic-org Scope). The real role lives
  // on auth.users app_metadata via the SignedInSlice; reading defensively so
  // unauthenticated/loading states render the admin-default subtitle.
  const role = useStore(
    (s) => (s.signedIn?.user?.app_metadata as { role?: string } | undefined)?.role ?? null,
  );
  const orgName = useStore(
    (s) => (s.signedIn?.user?.app_metadata as { org_name?: string } | undefined)?.org_name ?? null,
  );

  const subtitle =
    role === 'clinic_owner' && orgName
      ? `Traffic & Conversion — ${orgName}`
      : 'Multi-channel acquisition + funnel intelligence';

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="size-9 rounded-xl bg-[var(--color-surface-elevated)] text-[var(--color-primary)] inline-flex items-center justify-center">
            <Activity size={18} aria-hidden />
          </span>
          <div>
            <h1 className="text-[18px] font-bold">Traffic &amp; Conversion</h1>
            <p className="text-[11px] text-[var(--color-text-secondary)]">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* ── Tabs (5-pill segmented control) ──────────────────────────── */}
      <PillGroup segmented aria-label="Traffic dashboard tabs">
        <Pill
          active={activeTab === 'channels'}
          onClick={() => goTab('channels')}
          leadingIcon={<LayoutList size={12} aria-hidden />}
          aria-label="Channel rollup tab"
        >
          Channels
        </Pill>
        <Pill
          active={activeTab === 'funnels'}
          onClick={() => goTab('funnels')}
          leadingIcon={<Filter size={12} aria-hidden />}
          aria-label="Conversion funnels tab"
        >
          Funnels
        </Pill>
        <Pill
          active={activeTab === 'landing'}
          onClick={() => goTab('landing')}
          leadingIcon={<MapIcon size={12} aria-hidden />}
          aria-label="Landing pages tab"
        >
          Landing Pages
        </Pill>
        <Pill
          active={activeTab === 'realtime'}
          onClick={() => goTab('realtime')}
          leadingIcon={<Activity size={12} aria-hidden />}
          aria-label="Real-time activity tab"
        >
          Real-time
        </Pill>
        <Pill
          active={activeTab === 'taxonomy'}
          onClick={() => goTab('taxonomy')}
          leadingIcon={<Settings2 size={12} aria-hidden />}
          aria-label="Channel taxonomy tab"
        >
          Taxonomy
        </Pill>
      </PillGroup>

      {/* ── Tab content slot ─────────────────────────────────────────── */}
      <div className="pt-8" role="tabpanel" aria-label={`${activeTab} content`}>
        <Suspense
          fallback={<Skeleton className="h-64 w-full" data-testid="traffic-tab-skeleton" />}
        >
          {/* TRAFFIC-CHANNEL-ROLLUP slot — Plan 51-06 */}
          {activeTab === 'channels' && <TrafficChannelsTab />}
          {/* TRAFFIC-FUNNEL slot — Plan 51-07 */}
          {activeTab === 'funnels' && <TrafficFunnelsTab />}
          {/* TRAFFIC-LANDING slot — Plan 51-08 */}
          {activeTab === 'landing' && <TrafficLandingPagesTab />}
          {/* TRAFFIC-REALTIME slot — Plan 51-09 */}
          {activeTab === 'realtime' && <TrafficRealtimeTab />}
          {/* TRAFFIC-TAXONOMY slot — Plan 51-09 */}
          {activeTab === 'taxonomy' && <TrafficTaxonomyPage />}
        </Suspense>
      </div>
    </main>
  );
};

export default TrafficDashboardPage;
