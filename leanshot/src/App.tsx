import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { lazy, Suspense, useEffect, useState } from 'react';
// Phase 16 Plan 16-02 Task 5 — BiometricGate is intentionally a direct
// (non-lazy) import: it must render BEFORE first paint of dashboard content
// when biometric unlock is enabled, and the gate-active derivation lives at
// the top of App() so a Suspense boundary would otherwise flash app content.
// Component is small (<3 kB gz expected) and stays within the 50 kB index gz
// ceiling (verified post-build by Task 5 verify step).
import { BiometricGate } from '@/components/BiometricGate';
import { DisclaimerModal } from '@/components/dashboard/DisclaimerModal';
// Phase 42 Plan 42-08 (POLISH-05) — In-app notification toast renderer.
// Non-lazy: the component renders null and only registers a single Realtime
// channel inside useEffect; static-graph cost is ~1 kB (subscribeToUserNotifications
// + Realtime types already pulled by clinic-realtime). Lazy-loading would add
// a Suspense boundary that flashes between dashboard renders.
import { InAppNotificationToast } from '@/components/dashboard/notifications/InAppNotificationToast';
import { AppShell, TabSwitcher } from '@/components/layout/AppShell';
import { GreetingStrip } from '@/components/layout/GreetingStrip';
import { SoftDeleteCountdownBanner } from '@/components/soft-delete/SoftDeleteCountdownBanner';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { track } from '@/lib/analytics';
// Phase 24 Plan 04 D-13: identify + alias bridge to merge anon events under Supabase uid.
// aliasAnonymousToUid is idempotent (localStorage marker); posthog.reset() on sign-out
// ensures the next anon session is truly anonymous. Both imports are lightweight
// (posthog-js itself is already deferred via deferAnalyticsInit in main.tsx).
import { aliasAnonymousToUid, identify } from '@/lib/analytics/identify';
// Phase 16 Plan 16-02 Task 5 — Universal Link / App Link dispatcher install
// (MOBILE-06 client half). Idempotency guard inside installDeepLinkHandler
// protects against StrictMode double-mount.
import { installDeepLinkHandler } from '@/lib/native/deeplink';
// Phase 16 Plan 16-05 — platform fork for the `?upgrade=` deep link + the
// Realtime `subscriptions:user_id=eq.X` listener (D-25). detectPlatform()
// drives the ios/android branch; the iap.ts module is dynamic-imported in
// the handler body so the RC SDK stays off App.tsx's static graph.
import { detectPlatform } from '@/lib/native/platform';
import { removeUserNamespace, renameStorageNamespace, setActiveStorageUserId } from '@/lib/storage';
import { useStore } from '@/lib/store';
// Phase 19 Plan 19-09 (BL-4) — route registries from Plans 19-05 / 19-06b / 19-08.
// resolvePhase19Route() below matches the current pathname against these
// three registries (LANDING most-specific → PARTNER prefix → AFFILIATE_APPLY
// exact/prefix) and returns the matched component to render under Suspense.
// This is the ONLY Phase 19 plan that mutates App.tsx; the other plans
// contribute via the registry files instead.
// Phase 31 Plan 06 D-10/D-14: dashboard-entry gate for invited patients.
// useOrgOnboardingFlow() called unconditionally per React rules-of-hooks;
// the result is only acted upon when view === 'dashboard'. For consumer-path
// users (no primary_org_id / anonymous) the hook returns 'consumer' after a
// single DB round-trip; subsequent renders return cached state (mount-only fetch).
import { useOrgOnboardingFlow } from '@/lib/onboarding-builder/use-org-onboarding-flow';
// Phase 42 Plan 42-10 (POLISH-12 D-20/D-21) — Quarterly NPS in-app fallback.
// Eligibility wrapper + UNCONDITIONAL trigger (no-conditional-native-review.cjs
// from 42-07 enforces unconditional surfacing). The wrapper module is tiny
// (< 1 kB gz) so it stays on the static graph; the modal component itself is
// React.lazy below.
import { isUserEligibleForQuarterlyNPS } from '@/lib/nps/quarterly-eligibility';
import {
  QUARTERLY_NPS_SHOW_EVENT,
  isQuarterlyNPSShowDetail,
  showQuarterlyNpsModal,
} from '@/lib/nps/quarterly-modal';
import {
  autoMintAnonSessionIfMissing,
  deferFlush,
  deferOnSignedIn,
  deferOnSignedOut,
  deferSetLastWasAnon,
  subscribeAuthStateChanges,
} from '@/lib/sync-defer';
import { AFFILIATE_APPLY_ROUTES } from '@/routes/affiliate-apply-routes';
import { LANDING_ROUTES } from '@/routes/landing-routes';
import { PARTNER_ROUTES } from '@/routes/partner-routes';
// Phase 6 D-12 CI hardening: App.tsx no longer eagerly imports @/lib/sync,
// @/lib/auth-migration, or @/lib/supabase. All three (and transitively
// @supabase/supabase-js) move OFF the entry chunk static graph and load
// after first paint via sync-defer's idle-scheduled dynamic imports.

// Tab content modules — lazy-loaded so the initial bundle stays lean.
const HomeTab = lazy(() =>
  import('@/components/dashboard/tabs/HomeTab').then((m) => ({ default: m.HomeTab })),
);
const MedicationTab = lazy(() =>
  import('@/components/dashboard/tabs/MedicationTab').then((m) => ({ default: m.MedicationTab })),
);
const SymptomsTab = lazy(() =>
  import('@/components/dashboard/tabs/SymptomsTab').then((m) => ({ default: m.SymptomsTab })),
);
const BodyTab = lazy(() =>
  import('@/components/dashboard/tabs/BodyTab').then((m) => ({ default: m.BodyTab })),
);
const NutritionTab = lazy(() =>
  import('@/components/dashboard/tabs/NutritionTab').then((m) => ({ default: m.NutritionTab })),
);
const ActivityTab = lazy(() =>
  import('@/components/dashboard/tabs/ActivityTab').then((m) => ({ default: m.ActivityTab })),
);
const SupplementsTab = lazy(() =>
  import('@/components/dashboard/tabs/SupplementsTab').then((m) => ({ default: m.SupplementsTab })),
);
const MoodTab = lazy(() =>
  import('@/components/dashboard/tabs/MoodTab').then((m) => ({ default: m.MoodTab })),
);
const InsightsTab = lazy(() =>
  import('@/components/dashboard/tabs/InsightsTab').then((m) => ({ default: m.InsightsTab })),
);
// Phase 44 Plan 09 — Community tab shell (Zustand-driven navigation per CLAUDE.md no-router rule).
// DO NOT add react-router-dom Route or useNavigate here — consumer surface uses setTab + store.activeCommunitySpaceId.
const CommunityTabShell = lazy(() => import('@/components/community/CommunityTabShell'));
// Phase 46 Plan 08 — Classroom tab shell (Zustand-driven; new TabId 'classroom').
// EXCEPTION to the no-new-TabId rule per CONTEXT — courses are a distinct content
// surface, not a Community sub-view. The shell + sub-views all live under
// src/components/course/ so vite.config.ts routes them into the 'course-player'
// chunk (≤30 kB gz ceiling). DO NOT add a Route — consumer surface stays Zustand.
const ClassroomTabShell = lazy(() => import('@/components/course/ClassroomTabShell'));
// Phase 47 Plan 10 — Events tab shell (Zustand-driven; new TabId 'events').
// EXCEPTION to the no-new-TabId rule per CONTEXT D-13 — events warrant a
// distinct top-level surface (mirrors classroom). Two-level Zustand navigation
// (activeEventId) handled INSIDE EventsTab. NO <Route> — consumer surface
// stays router-free per memory reference_react_router_consumer_admin_split.
// The /src/components/events/ tree is routed into the 'events' manualChunks
// rule in vite.config.ts (target ≤25 kB gz per D-14 list-only no-Mux-player).
const EventsTab = lazy(() => import('@/components/events/EventsTab'));

const Onboarding = lazy(() =>
  import('@/components/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })),
);
const Marketing = lazy(() =>
  import('@/components/marketing/Landing').then((m) => ({ default: m.Landing })),
);
const AuthView = lazy(() => import('@/components/auth/AuthView'));
// Phase 34 Plan 34-04 (ONBOARD-02) — PKCE OAuth callback view. Mounted on
// the PATH route `/auth/callback?code=...` (NOT a #hash) because OAuth
// providers cannot redirect to fragments (34-RESEARCH Pitfall 1).
const AuthCallbackView = lazy(() => import('@/components/auth/AuthCallbackView'));
// Phase 34 Plan 34-06 (ONBOARD-01) — Anonymous preview view. Mounted on the
// `/onboard` PATH route; the lazy chunk keeps the preview body (hero + value-
// prop + CTA + cookie-bootstrap layer) OFF the index static graph.
const AnonymousPreviewView = lazy(() => import('@/components/onboarding/AnonymousPreviewView'));

// Phase 48 Plan 11 — AccountSuspended consumer-blocker (D-15 SPA blocker).
// Rendered by the view-selector branch below when userModerationStatus is
// 'banned' or 'temp_suspended'. Lazy-loaded so the blocker bytes never touch
// the index static graph (typical legitimate users never render it).
const AccountSuspended = lazy(() => import('@/components/AccountSuspended'));

// Phase 8 Plan 08-04 — Doctor read-share lazy chunk. Mounted on the
// `#/share/<token>` hash route via the top-priority branch in `selectView`
// below. The chunk is OFF the index static graph; bundle CI (Plan 08-06)
// asserts `share-*.js.gz` stays under the 18 kB budget (Task 2b verify).
const SharePage = lazy(() =>
  import('@/components/share/SharePage').then((m) => ({ default: m.SharePage })),
);

// Phase 42 Plan 42-09 (POLISH-11) — What's New drawer lazy chunk. Keeps
// react-markdown + dompurify + rehype-raw OFF the index static graph per
// Pitfall 9 + 42-CONTEXT D-11. The drawer is mounted globally below the
// AppShell Suspense block; the Topbar emits onOpenWhatsNew only.
const WhatsNewDrawerHost = lazy(() =>
  import('@/components/changelog/WhatsNewDrawer').then((m) => ({
    default: m.WhatsNewDrawerHost,
  })),
);

// Phase 49 Plan 09 — consumer cmd+k Spotlight modal. Lazy chunk keeps cmdk +
// search components off the index static graph; only fetched when the user
// hits cmd+k for the first time. Mounted under <Suspense> inside globalOverlays
// gated on the Zustand `searchOpen` flag.
const SearchModal = lazy(() => import('@/components/search/SearchModal'));

// Phase 42 Plan 42-10 (POLISH-12 D-21) — Quarterly NPS in-app fallback modal.
// Lazy-loaded; only fetched once eligibility resolves true. See
// src/lib/nps/quarterly-modal.ts for the UNCONDITIONAL trigger API + D-20
// rationale. The eslint rule `no-conditional-native-review` policed by 42-07
// gates conditional wrapping of showQuarterlyNpsModal().
const QuarterlyNPSModalLazy = lazy(() =>
  import('@/components/nps/QuarterlyNPSModal').then((m) => ({
    default: m.QuarterlyNPSModal,
  })),
);

// Phase 36 Plan 36-03 (W4 + REVIEW-01/04/05) — NPS prompt listener host.
// Lazy chunk subscribes to ANALYTICS_TRIGGER_EVENT (broadcast by track()
// inside src/lib/analytics.ts). On admissible event fire, the host renders
// the rating prompt → promoter CTA / detractor feedback swap. The host
// mounts unconditionally inside the dashboard branch (NOT marketing /
// onboarding) — server-side cooldown + cap gating keeps it inert when not
// admissible.
const NPSPromptListenerHostLazy = lazy(() =>
  import('@/hooks/useNPSPromptListener').then((m) => ({
    default: m.NPSPromptListenerHost,
  })),
);

// Phase 42 Plan 42-10 (POLISH-12 D-24) — Generic admin-shell route for
// manifest-driven admin modules (CAC, RAG, anomaly, compliance, i18n-overrides,
// clinic-orgs, nps-quarterly). Each module registers via ADMIN_MODULES in
// src/lib/admin/modules.ts and AdminShell handles the per-path dispatch.
// Earlier Wave-3 admin pages had explicit selectView branches; the manifest
// pattern moves that wiring to a single catch-all branch.
const AdminShellRoot = lazy(() =>
  import('@/components/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);

// Phase 40 Plan 40-04 (POLISH-01) — CancellationModal lazy chunk (single chunk
// per CONTEXT specifics + RESEARCH §Pitfall 8). ALL step sub-components are
// non-lazy imports from CancellationModal.tsx so Vite emits ONE 'cancellation'
// chunk. Plan 40-04 is the SINGLE writer to App.tsx for Phase 40 modal additions.
const CancellationModalLazy = lazy(() =>
  import('@/components/dashboard/settings/cancellation/CancellationModal').then((m) => ({
    default: m.CancellationModal,
  })),
);

// Phase 9 Plan 09-01 — Clinic B2B lazy chunks (B-2 ownership rule per
// plan-checker iter 1). All three lazy boundaries land here in Plan 09-01
// pointing at stub files; Plans 09-02 / 09-03 / 09-04 OVERWRITE the stubs
// in place without touching App.tsx. Bundle CI in
// `scripts/assert-clinic-bundle-budget.sh` enforces per-chunk ceilings
// (clinic ≤12kB, clinic-settings ≤14kB, clinic-invite ≤6kB gz) +
// preserves the 50 kB index ceiling.
// Phase 37 Plan 06 — helpdesk widget. Lazy-loaded into the `helpdesk-widget`
// chunk (manualChunks routes /src/helpdesk/* into this chunk, ≤25 kB gz ceiling
// enforced by scripts/assert-helpdesk-bundle-budget.sh).
//
// Mounted unconditionally at the App root (regardless of auth state) — the
// widget itself reads useStore(s.user) and renders a marketing/KB-only mode
// for anonymous visitors (D-15) and a PHI KB-only mode on PHI routes (D-17).
const HelpdeskWidget = lazy(() =>
  import(/* webpackChunkName: "helpdesk-widget" */ '@/helpdesk/HelpdeskWidget').then((m) => ({
    default: m.HelpdeskWidget,
  })),
);

const ClinicWorkspace = lazy(() =>
  import('@/components/clinic/ClinicWorkspace').then((m) => ({ default: m.ClinicWorkspace })),
);
const ClinicSettingsPage = lazy(() =>
  import('@/components/clinic/settings/ClinicSettingsPage').then((m) => ({
    default: m.ClinicSettingsPage,
  })),
);
const ClinicInvitePage = lazy(() =>
  import('@/components/clinic-invite/ClinicInvitePage').then((m) => ({
    default: m.ClinicInvitePage,
  })),
);
// Phase 10 Plan 10-05 — ClinicDrillInPage lazy chunk. Route is
// `/clinic/{slug}/patient/{user_id}`. Plan 10-07 overwrites the stub body.
// This is the ONLY Phase 10 plan that writes to App.tsx (per
// memory `feedback_planner_iter1_anti_patterns.md` single-writer rule).
const ClinicDrillInPage = lazy(() =>
  import('@/components/clinic/drill-in/ClinicDrillInPage').then((m) => ({
    default: m.ClinicDrillInPage,
  })),
);

// Phase 15 Plan 15-04 — Admin Pages (Page Builder, /admin/pages/*) lazy chunks.
// Both components land in the `admin-bundle` chunk per 15-02's vite.config.ts
// manualChunks rule (matches src/components/admin/*). The client route guard
// below only gates on `user` presence — server-side is_staff RLS + the
// page-save/page-publish Edge Functions are the real security boundary
// (T-15-04-01). A non-staff user reaching the editor would simply see empty
// lists and 403 responses on save.
const AdminSiteSettings = lazy(() =>
  import('@/components/admin/pages/SiteSettingsPanel').then((m) => ({
    default: m.SiteSettingsPanel,
  })),
);
const AdminPageList = lazy(() =>
  import('@/components/admin/pages/PageListView').then((m) => ({ default: m.PageListView })),
);
const AdminPageEditor = lazy(() =>
  import('@/components/admin/pages/PageEditorView').then((m) => ({
    default: m.PageEditorView,
  })),
);

// Phase 22 Plan 22-05 — /cancel-deletion landing page. Its own lazy chunk
// keeps it OFF the index static graph (50 kB gz ceiling preserved per
// Phase 6 Plan 06-01). Activated by the `cancel-deletion` branch in
// selectView() below when window.location.pathname === '/cancel-deletion'.
const CancelDeletionPage = lazy(() =>
  import('@/pages/cancel-deletion').then((m) => ({ default: m.CancelDeletionPage })),
);

// Phase 46 Plan 46-10 (COURSE-04) — public /verify/<cert_id> no-auth route.
// Mounted by an ultra-early pathname pre-check at the top of App() body
// (before the view-based render branches). Lazy chunk: the component sits
// at `src/components/course/` so it lands in the `course-player` chunk per
// vite.config.ts:227. Visitors of /verify/* only download this chunk; the
// rest of the dashboard graph stays cold.
const CertVerifyPage = lazy(() => import('@/components/course/CertVerifyPage'));

// Phase 29 Plan 06 — /accept-clinic-invite patient consent screen. Its own
// lazy chunk stays OFF the index static graph. Anonymous-OK route; must be
// checked BEFORE any auth gate in selectView() (T-29-06-01 anti-enumeration).
// Patient can reach this with no existing account.
const ConsentAcceptScreen = lazy(() =>
  import('@/components/auth/ConsentAcceptScreen'),
);

// Phase 22 Plan 22-12 (Wave 3 integration) — admin/DSAR/email-prefs lazy chunks.
//
// Five `/admin/*` surfaces + two `/settings/*` sub-pages. All ship as their
// own lazy chunks so the index static graph stays under the 50 kB gz ceiling
// (Phase 6 Plan 06-01 contract). Routing is path-based via the existing
// selectView() switch + popstate listener pattern (no router; CLAUDE.md
// "Routing: Intentionally none").
//
// Admin gate is defense-in-depth: AdminLayout (which each Admin*Page already
// wraps itself in) probes profiles.is_staff before rendering anything beyond
// the loading skeleton. The real security boundary is each admin RPC's
// `is_staff()` gate (Pattern S1 dual-layer per 22-PATTERNS Wave E) + RLS.
const AdminMembersPage = lazy(() =>
  import('@/components/admin/pages/AdminMembersPage').then((m) => ({
    default: m.AdminMembersPage,
  })),
);
const AdminMemberDetailPage = lazy(() =>
  import('@/components/admin/pages/AdminMemberDetailPage').then((m) => ({
    default: m.AdminMemberDetailPage,
  })),
);
const AdminMetricsPage = lazy(() =>
  import('@/components/admin/pages/AdminMetricsPage').then((m) => ({
    default: m.AdminMetricsPage,
  })),
);
const AdminCohortsPage = lazy(() =>
  import('@/components/admin/pages/AdminCohortsPage').then((m) => ({
    default: m.AdminCohortsPage,
  })),
);
const AdminAffiliatesPage = lazy(() =>
  import('@/components/admin/pages/AdminAffiliatesPage').then((m) => ({
    default: m.AdminAffiliatesPage,
  })),
);
const DsarPortalPage = lazy(() =>
  import('@/components/dsar/DsarPortalPage').then((m) => ({ default: m.DsarPortalPage })),
);
const EmailPreferencesPage = lazy(() =>
  import('@/components/dashboard/settings/EmailPreferencesPage').then((m) => ({
    default: m.EmailPreferencesPage,
  })),
);

// Phase 22 Plan 22-12 — three always-on overlay components (banners + cookie
// consent bootstrap). All three are EAGER imports because:
//   - ImpersonationBanner: returns null when !useImpersonation().active
//   - SoftDeleteCountdownBanner: returns null when !row || impersonating
//   - CookieConsentBootstrap: returns null + schedules dynamic-import of
//     vanilla-cookieconsent through the Pattern 4 gate (consent-defer.ts);
//     the heavy library itself stays off the index static graph by virtue of
//     the dynamic import inside scheduleConsentInit().
//
// Each component is tiny (< 200 LoC) and contributes < 1 kB gz to the index
// chunk. Verified post-build by the Task 4 bundle check.
import { CookieConsentBootstrap } from '@/components/consent/CookieConsentBootstrap';
import { ImpersonationBanner } from '@/components/impersonation/ImpersonationBanner';
// Phase 22 Plan 22-06 — D-08 per-user feature flag overrides. loadOverrides()
// is the post-auth hook consumer; clearOverrideCache() is the SIGNED_OUT
// hook consumer. Wiring lands in this plan; see useEffect blocks below.
import { clearOverrideCache, loadOverrides } from '@/lib/consent/feature-flag-overrides';
// Phase 25 Plan 25-07 HIPAA-17: session-replay PHI guard. Called as the first
// hook inside App() so the guard is active before any tab/modal renders.
// posthog-js stays dynamically imported (per project_phase5_bundle_regression).
import { useSessionReplayPhiGuard } from '@/lib/posthog-route-disable';
// Phase 39 Plan 39-04 (PAYWALL-07 / D-09 / OQ-5) — first-touch UTM cookie
// writer. Phase 39 OWNS the lt_utm_source cookie key; Phase 51 will adopt
// the same key when shipping its UTM map pipeline. Idempotent: post-React-
// mount call so jsdom tests that stub window.location after main.tsx init
// still see the value at App body invocation time (NOT in main.tsx).
import { captureFirstTouchUtm } from '@/lib/utm/capture-first-touch';

// Phase 7 Plan 07-02 — Legal pages live behind hash routes (`#/legal/*`),
// mirroring the Phase 5 D-01 `#/auth/*` precedent. Each page is its OWN lazy
// boundary so Rollup emits four separate small chunks (preserving the 50 kB
// index gz ceiling from Phase 6 Plan 06-01). The four legal pages render via
// the new `'legal'` branch in selectView below.
const PrivacyPolicyPage = lazy(() =>
  import('@/components/legal/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })),
);
const ConsumerHealthDataPage = lazy(() =>
  import('@/components/legal/ConsumerHealthData').then((m) => ({ default: m.ConsumerHealthData })),
);
const TermsOfServicePage = lazy(() =>
  import('@/components/legal/TermsOfService').then((m) => ({ default: m.TermsOfService })),
);
const MedicalDisclaimerPage = lazy(() =>
  import('@/components/legal/MedicalDisclaimer').then((m) => ({ default: m.MedicalDisclaimer })),
);
// Lazy-loaded 404 fallback so an unknown `#/legal/...` hash never blanks the
// screen. Reuses LegalLayout for visual consistency.
const LegalNotFound = lazy(() =>
  import('@/components/legal/LegalLayout').then((m) => ({
    default: () => (
      <m.LegalLayout title="Page not found">
        <h1 className="text-2xl font-semibold tracking-tight mb-4">Page not found</h1>
        <p className="text-[var(--color-text-secondary)]">
          That legal page does not exist.{' '}
          <a className="underline" href="/">
            Return to LeanShot.
          </a>
        </p>
      </m.LegalLayout>
    ),
  })),
);

// Phase 19 Plan 19-09 (BL-4) — pre-construct lazy components ONCE per registry
// entry. Building the lazy() wrapper inside resolveRoute() on every render
// would defeat React.lazy's component identity caching (each render would
// remount the resolved chunk's tree). Module-level lazy is the established
// pattern in this file (HomeTab / Marketing / SharePage / etc.).
const LANDING_LAZIES = LANDING_ROUTES.map((r) =>
  lazy(r.componentLoader as () => Promise<{ default: React.ComponentType<{ code: string }> }>),
);
const PARTNER_LAZIES = PARTNER_ROUTES.map((r) =>
  lazy(r.componentLoader as () => Promise<{ default: React.ComponentType }>),
);
const AFFILIATE_APPLY_LAZIES = AFFILIATE_APPLY_ROUTES.map((r) =>
  lazy(r.componentLoader as () => Promise<{ default: React.ComponentType }>),
);

interface ResolvedPhase19Route {
  /** Pre-constructed lazy component to render under Suspense. */
  Component: React.LazyExoticComponent<React.ComponentType<{ code?: string }>>;
  /** Capture (only set for landing routes — the affiliate referral code). */
  code?: string;
}

/**
 * Phase 19 Plan 19-09 (BL-4): match the current pathname against the three
 * Phase-19 route registries. Ordering matters — LANDING is the MOST SPECIFIC
 * (`/r/{code}/landing`) so it must run before any other `/r/*` match. PARTNER
 * is a prefix on `/partner` (includes `/partner` exact + `/partner/<anything>`).
 * AFFILIATE_APPLY contributes `/affiliate` exact + `/admin/affiliates` prefix.
 *
 * Returns `null` if no Phase-19 route matches — caller falls through to the
 * existing selectView() branches.
 */
function resolvePhase19Route(pathname: string): ResolvedPhase19Route | null {
  // LANDING first — `/r/{code}/landing` is the most specific shape.
  for (let i = 0; i < LANDING_ROUTES.length; i++) {
    const r = LANDING_ROUTES[i]!;
    if (r.pathRegex) {
      const re = new RegExp(r.pathRegex);
      const m = pathname.match(re);
      if (m) {
        return {
          Component: LANDING_LAZIES[i]! as React.LazyExoticComponent<
            React.ComponentType<{ code?: string }>
          >,
          code: m[1],
        };
      }
    }
  }
  // PARTNER — single prefix descriptor (`/partner`).
  for (let i = 0; i < PARTNER_ROUTES.length; i++) {
    const r = PARTNER_ROUTES[i]!;
    if (
      r.match === 'prefix' &&
      (pathname === r.path || pathname.startsWith(`${r.path}/`))
    ) {
      return {
        Component: PARTNER_LAZIES[i]! as React.LazyExoticComponent<
          React.ComponentType<{ code?: string }>
        >,
      };
    }
  }
  // AFFILIATE_APPLY — exact + prefix.
  for (let i = 0; i < AFFILIATE_APPLY_ROUTES.length; i++) {
    const r = AFFILIATE_APPLY_ROUTES[i]!;
    if (r.match === 'exact' && pathname === r.path) {
      return {
        Component: AFFILIATE_APPLY_LAZIES[i]! as React.LazyExoticComponent<
          React.ComponentType<{ code?: string }>
        >,
      };
    }
    if (
      r.match === 'prefix' &&
      (pathname === r.path || pathname.startsWith(`${r.path}/`))
    ) {
      return {
        Component: AFFILIATE_APPLY_LAZIES[i]! as React.LazyExoticComponent<
          React.ComponentType<{ code?: string }>
        >,
      };
    }
  }
  return null;
}

/**
 * Map a `#/legal/*` hash to the lazy component that renders the matching
 * placeholder page. Returns the 404 fallback for unknown legal hashes so the
 * Suspense boundary never receives `null` (T-07-02-02 mitigation — view
 * selector cannot inject user-controlled hash content into render).
 */
function selectLegalPage(hash: string): React.LazyExoticComponent<React.ComponentType> {
  switch (hash) {
    case '#/legal/privacy':
      return PrivacyPolicyPage;
    case '#/legal/consumer-health':
      return ConsumerHealthDataPage;
    case '#/legal/terms':
      return TermsOfServicePage;
    case '#/legal/disclaimer':
      return MedicalDisclaimerPage;
    default:
      return LegalNotFound;
  }
}

const AIChatPanel = lazy(() =>
  import('@/components/dashboard/ai/AIChatPanel').then((m) => ({ default: m.AIChatPanel })),
);
const SettingsPage = lazy(() =>
  import('@/components/dashboard/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const DoctorReport = lazy(() =>
  import('@/components/dashboard/modals/DoctorReport').then((m) => ({ default: m.DoctorReport })),
);
const GuidedTour = lazy(() =>
  import('@/components/dashboard/tour/GuidedTour').then((m) => ({ default: m.GuidedTour })),
);

// Phase 6 Plan 06-02 — MigrationModal is lazy-loaded AND its render below is
// gated on `migration_state != null || migrationError != null`, so net-new
// users never download the chunk. The chunk also pulls in @/lib/migration's
// runtime (state machine + per-entity loops), which is only relevant when
// there's actually v4 data to migrate.
const MigrationModal = lazy(() =>
  import('@/components/sync/MigrationModal').then((m) => ({ default: m.MigrationModal })),
);

// Phase 42 Plan 04 (POLISH-07) — PWA glue components. Both lazy-loaded so
// the workbox-window glue + branded prompt UI never reach the index chunk
// (Pitfall 9 mitigation; the index ceiling stays at 50 kB gz).
const OfflineBanner = lazy(() =>
  import('@/components/pwa/OfflineBanner').then((m) => ({ default: m.OfflineBanner })),
);
const InstallPromptCard = lazy(() =>
  import('@/components/pwa/InstallPromptCard').then((m) => ({ default: m.InstallPromptCard })),
);

type View =
  | 'marketing'
  | 'onboarding'
  // Phase 34 Plan 34-06 (ONBOARD-01) — Anonymous preview surface mounted on
  // the `/onboard` PATH route. AnonymousPreviewView wraps an
  // AnonymousPreviewLayer that issues `_ls_anon` cookie + smart defaults
  // (locale / units / timezone) before any signup happens.
  | 'onboard-preview'
  | 'auth'
  // Phase 34 Plan 34-04 (ONBOARD-02) — PKCE OAuth callback. PATH-routed
  // (`/auth/callback?code=...`); MUST be checked BEFORE the `#/auth/`
  // branch so the callback URL routes here regardless of any residual hash.
  | 'auth-callback'
  | 'dashboard'
  | 'legal'
  | 'share'
  // Phase 9 Plan 09-01 — clinic B2B view IDs. Path-based routing (NOT
  // hash) because operator dashboards need shareable URLs that survive
  // page refresh + bookmarks (D-09 first-paint requirement).
  | 'clinic'
  | 'clinic-settings'
  | 'clinic-invite'
  // Phase 10 Plan 10-05 — drill-in view for /clinic/{slug}/patient/{user_id}.
  // More-specific than '/clinic/{slug}' — must be ordered BEFORE the base clinic branch.
  | 'clinic-drill-in'
  // Phase 22 Plan 22-05 — /cancel-deletion landing for HMAC cancel links.
  // Anonymous-OK: the HMAC token IS the auth (per plan 22-01 File 14 grant
  // to anon+authenticated); user may be signed out across devices when the
  // email link is clicked.
  | 'cancel-deletion'
  // Phase 15 Plan 15-04 — Page Builder admin surfaces. Path-based routes
  // (NOT hash) so deep-linking + browser refresh land on the right view.
  // `admin-page-editor` matches `/admin/pages/{id}` (including `/admin/pages/new`).
  // `admin-page-list` matches `/admin/pages` exactly.
  | 'admin-page-list'
  | 'admin-page-editor'
  | 'admin-site-settings'
  // Phase 22 Plan 22-12 — Wave 3 admin surfaces. Paths:
  //   /admin/members              → admin-members
  //   /admin/members/{user_id}    → admin-member-detail (drill-in)
  //   /admin/metrics              → admin-metrics
  //   /admin/cohorts              → admin-cohorts
  //   /admin/affiliates           → admin-affiliates (review queue)
  //   /admin/affiliates/review    → admin-affiliates (alias kept in selectView)
  //   /settings/privacy/dsar      → dsar
  //   /settings/email-preferences → email-prefs
  // All gated on user presence; AdminLayout's is_staff probe + RPC gates
  // form the actual security boundary (Pattern S1 dual-layer).
  | 'admin-members'
  | 'admin-member-detail'
  | 'admin-metrics'
  | 'admin-cohorts'
  | 'admin-affiliates'
  // Phase 42 Plan 42-10 (POLISH-12 D-24) — Generic manifest-driven admin shell
  // route. Catches /admin/<route> where <route> is registered in ADMIN_MODULES
  // but not handled by an explicit branch above (e.g. /admin/nps/quarterly,
  // /admin/growth/cac, /admin/rag, /admin/anomaly, /admin/compliance,
  // /admin/i18n-overrides, /admin/clinic-orgs). AdminLayout Mode A → AdminShell
  // matches the manifest entry and renders the lazy component.
  | 'admin-shell'
  | 'dsar'
  | 'email-prefs'
  // Phase 29 Plan 06 — /accept-clinic-invite patient consent screen.
  // Anonymous-OK: the invite token IS the auth (T-29-06-01 anti-enumeration).
  // Must render BEFORE any auth gate so patients without an account can proceed.
  | 'consent-accept';

// Phase 7 debug seam — guarded so it ships only when VITE_E2E='true' (CI e2e
// builds, never Vercel production). Records every selectView invocation so
// Playwright specs can read `window.__leanshot_view_log__` to diagnose stuck
// post-signin transitions. See
// .planning/debug/phase7-e2e-post-signin-render.md.
interface ViewLogEntry {
  t: number;
  caller: 'init' | 'recompute';
  user: boolean;
  hash: string;
  result: View;
}
declare global {
  interface Window {
    __leanshot_view_log__?: ViewLogEntry[];
  }
}
const isE2E = (): boolean => {
  try {
    return import.meta.env.VITE_E2E === 'true';
  } catch {
    return false;
  }
};
function pushViewLog(entry: ViewLogEntry): void {
  if (!isE2E()) return;
  try {
    if (!window.__leanshot_view_log__) window.__leanshot_view_log__ = [];
    window.__leanshot_view_log__.push(entry);
  } catch {
    /* noop */
  }
}

/**
 * Phase 5 D-01 + Phase 9 Plan 09-01: view selector. Hash priority — any
 * `#/auth/*` route forces the auth view regardless of other state. Phase 9
 * adds PATH-based routing for `/clinic/*` and `/clinic-invite/*` (these
 * surfaces need shareable URLs that survive refresh + bookmarks).
 *
 * Branch ordering rationale:
 *   1. `#/share/` — Phase 8 absolute-top (anonymous + signed-in both land here)
 *   2. `#/legal/` — Phase 7 (signed-out + signed-in both render policy)
 *   3. `#/auth/`  — Phase 5 (forces auth view)
 *   4. `/clinic-invite/` — Phase 9 (anonymous OK; State A/B/C/D branch
 *      inside the lazy chunk; routing into 'auth' here would block the
 *      lookup-without-account flow)
 *   5. `/clinic/<slug>/settings*` — Phase 9 operator settings; gated on user
 *   6. `/clinic/<slug>` — Phase 9 operator workspace home; gated on user
 *   7. `user` → 'dashboard'; else 'marketing'
 *
 * Settings BEFORE base `/clinic/` so the more-specific path wins.
 */
function selectView(opts: { user: unknown; signedInUser: unknown; hash: string; pathname: string }): View {
  if (opts.hash.startsWith('#/share/')) return 'share';
  if (opts.hash.startsWith('#/legal/')) return 'legal';
  // Phase 34 Plan 34-04 (ONBOARD-02) — PKCE OAuth callback. MUST be matched
  // BEFORE the `#/auth/` hash branch below: the callback URL is
  // `${origin}/auth/callback?code=...` and matching the PATH first avoids
  // any interaction with a residual hash. PKCE = path-routing, NOT hash
  // (OAuth providers cannot redirect to # fragments — 34-RESEARCH Pitfall 1).
  if (opts.pathname === '/auth/callback' || opts.pathname === '/auth/callback/') {
    return 'auth-callback';
  }
  if (opts.hash.startsWith('#/auth/')) return 'auth';
  // Phase 29 Plan 06 — /accept-clinic-invite patient consent screen.
  // Anonymous-OK: invite token in query string IS the auth. Must be ordered
  // BEFORE any user-gated branch (T-29-06-01 anti-enumeration invariant).
  if (opts.pathname === '/accept-clinic-invite' || opts.pathname === '/accept-clinic-invite/') {
    return 'consent-accept';
  }
  // Phase 9 Plan 09-01 — path-based routing. clinic-invite is anonymous OK
  // (the lookup endpoint accepts the token-hash without a JWT).
  if (opts.pathname.startsWith('/clinic-invite/')) return 'clinic-invite';
  // Phase 10 Plan 10-05 — drill-in route: /clinic/{slug}/patient/{user_id}.
  // Must be ordered BEFORE the generic /clinic/{slug} branch (more-specific first).
  if (opts.pathname.match(/^\/clinic\/[^/]+\/patient\/[^/]+$/)) {
    return opts.user ? 'clinic-drill-in' : 'auth';
  }
  if (
    opts.pathname.startsWith('/clinic/') &&
    opts.pathname.includes('/settings')
  ) {
    return opts.user ? 'clinic-settings' : 'auth';
  }
  if (opts.pathname.startsWith('/clinic/')) {
    return opts.user ? 'clinic' : 'auth';
  }
  // Phase 15 Plan 15-04 — admin/pages route branches. More-specific
  // `/admin/pages/{id}` MUST be tested before `/admin/pages` exact match.
  // The client route guard is defense-in-depth ONLY (not the security
  // boundary): RLS + page-save/page-publish is_staff gate enforce auth on
  // every read/write. A non-staff user reaching the editor sees empty
  // lists + 403s on save.
  if (opts.pathname.startsWith('/admin/pages/')) {
    return opts.user ? 'admin-page-editor' : 'auth';
  }
  if (opts.pathname === '/admin/pages') {
    return opts.user ? 'admin-page-list' : 'auth';
  }
  if (opts.pathname === '/admin' || opts.pathname === '/admin/') {
    return opts.user ? 'admin-site-settings' : 'auth';
  }
  // Phase 22 Plan 22-12 — Wave 3 admin paths. Order: more-specific drill-in
  // (`/admin/members/{user_id}`) before the bare `/admin/members` list, and
  // both AFTER the Phase 15 `/admin/pages*` branches above so page-builder
  // routes still win on their own paths.
  if (opts.pathname.match(/^\/admin\/members\/[^/]+$/)) {
    return opts.user ? 'admin-member-detail' : 'auth';
  }
  if (opts.pathname === '/admin/members' || opts.pathname === '/admin/members/') {
    return opts.user ? 'admin-members' : 'auth';
  }
  if (opts.pathname === '/admin/metrics' || opts.pathname === '/admin/metrics/') {
    return opts.user ? 'admin-metrics' : 'auth';
  }
  if (opts.pathname === '/admin/cohorts' || opts.pathname === '/admin/cohorts/') {
    return opts.user ? 'admin-cohorts' : 'auth';
  }
  // `/admin/affiliates` covers both the bare path and the `/review` sub-route
  // — AdminAffiliatesPage internally shows the review queue.
  if (opts.pathname.startsWith('/admin/affiliates')) {
    return opts.user ? 'admin-affiliates' : 'auth';
  }
  // Phase 42 Plan 42-10 (POLISH-12 D-24) — Generic manifest-driven admin
  // catch-all. After all explicit /admin/* branches above. Routes any
  // remaining /admin/<route> (e.g. /admin/nps/quarterly, /admin/growth/cac,
  // /admin/rag, /admin/anomaly, /admin/compliance, /admin/i18n-overrides,
  // /admin/clinic-orgs) into AdminLayout, which probes auth/totp/aal2 and
  // delegates to AdminShell's manifest matcher.
  if (opts.pathname.startsWith('/admin/')) {
    return opts.user ? 'admin-shell' : 'auth';
  }
  // Phase 22 Plan 22-11 — DSAR portal sub-page. Gated on user presence (the
  // RPC requires auth.uid()); selectView routes anon to auth so the user can
  // sign in first, then is bounced back via the existing `?` hash flow.
  if (
    opts.pathname === '/settings/privacy/dsar' ||
    opts.pathname === '/settings/privacy/dsar/'
  ) {
    return opts.user ? 'dsar' : 'auth';
  }
  if (
    opts.pathname === '/settings/email-preferences' ||
    opts.pathname === '/settings/email-preferences/'
  ) {
    return opts.user ? 'email-prefs' : 'auth';
  }
  // Phase 22 Plan 22-05 — /cancel-deletion is anonymous-OK (HMAC token
  // is the auth). Match exact path; trailing-slash tolerated.
  if (opts.pathname === '/cancel-deletion' || opts.pathname === '/cancel-deletion/') {
    return 'cancel-deletion';
  }
  // Phase 34 Plan 34-06 (ONBOARD-01) — anonymous preview path. AnonymousPreviewLayer
  // creates the `_ls_anon` cookie on cold start; signed-in users hitting /onboard
  // should fall through to dashboard (or onboarding if their profile isn't
  // completed yet) instead of seeing the anonymous preview shell.
  if ((opts.pathname === '/onboard' || opts.pathname === '/onboard/') && !opts.user) {
    return 'onboard-preview';
  }
  if (opts.user) return 'dashboard';
  // Phase 31 Plan 06 D-10: invited patients have a Supabase session but no LeanShot user.
  // Route them to 'dashboard' so the orgFlow gate can show the org onboarding flow.
  // For anonymous users (is_anonymous=true) and unverified users, fall through to marketing
  // (they should go through the normal consumer onboarding path first).
  const supabaseUser = opts.signedInUser as { is_anonymous?: boolean; email_confirmed_at?: string | null } | null;
  if (supabaseUser && !supabaseUser.is_anonymous && supabaseUser.email_confirmed_at) {
    return 'dashboard';
  }
  return 'marketing';
}
function selectViewLogged(
  caller: 'init' | 'recompute',
  user: unknown,
  hash: string,
  signedInUser?: unknown,
): View {
  const result = selectView({ user, signedInUser: signedInUser ?? null, hash, pathname: window.location.pathname });
  pushViewLog({ t: Date.now(), caller, user: Boolean(user), hash, result });
  return result;
}

export function App() {
  // Phase 25 HIPAA-17 — PHI route gate for PostHog session replay.
  // Must be the FIRST hook call so the guard is active before any view renders.
  useSessionReplayPhiGuard();

  // Phase 39 Plan 39-04 (PAYWALL-07) — first-touch UTM capture. Idempotent
  // helper; safe under StrictMode double-invoke. Mounted from App body (not
  // main.tsx) so jsdom tests that stub window.location after main.tsx init
  // observe the captured cookie when assertions run.
  useEffect(() => {
    captureFirstTouchUtm();
  }, []);

  const user = useStore((s) => s.user);
  const acknowledgedDisclaimer = useStore((s) => s.acknowledgedDisclaimer);
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  // Phase 6 Plan 06-02 — migration_state slice + ephemeral error flag. Both
  // null on net-new users so the MigrationModal lazy chunk never loads.
  const migrationState = useStore((s) => s.migration_state);
  const migrationError = useStore((s) => s.migrationError);
  // Phase 31 Plan 06 D-10: signed-in slice for the invited-patient dashboard-entry gate.
  // Invited patients have signedIn.user (Supabase session) but user=null (no LeanShot profile yet).
  // selectView uses signedInUser so these patients route to 'dashboard' (where orgFlow gate applies).
  const signedInUser = useStore((s) => s.signedIn?.user ?? null);

  // Phase 48 Plan 11 — consumer moderation status (D-15 SPA blocker).
  // Server-driven slice fetched on hydrate + every auth-state change from
  // main.tsx; NOT persisted (excluded from partialize per T-48-28). Drives
  // the AccountSuspended view-selector branch BEFORE the dashboard branch.
  const userModerationStatus = useStore((s) => s.userModerationStatus);

  // Phase 31 Plan 06 D-10/D-14: org onboarding flow state for the dashboard-entry gate.
  // Called unconditionally (React rules-of-hooks); only used when view==='dashboard'.
  // Fail-open: returns 'consumer' on any error, preserving local-first invariant.
  const orgFlow = useOrgOnboardingFlow();

  // D-11: dashboard-render fallback gate. True whenever a logged-in user lands
  // on the dashboard without the current disclaimer version acknowledged
  // (covers returning users from before disclaimers existed AND v3→v5 migrants
  // whose acknowledgedDisclaimer defaults to undefined per src/lib/storage.ts).
  const needsDisclaimer = !!user && acknowledgedDisclaimer !== 'v1';

  // Synchronously decide initial view based on hydrated user state + hash.
  // Phase 31 Plan 06: also pass signedInUser so invited-patient dashboard routing works.
  const [view, setView] = useState<View>(() =>
    selectViewLogged('init', user, window.location.hash, signedInUser),
  );
  const [aiOpen, setAIOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // Phase 42 Plan 42-09 (POLISH-11) — What's New drawer open state. The
  // module itself is React.lazy + Suspense below; the boolean lives in the
  // index chunk but the markdown stack does not.
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  // Phase 40 Plan 40-04 (POLISH-01) — CancellationModal open state.
  // The lazy chunk only loads when this flag is true. Plan 40-04 is single
  // writer; SettingsPage receives setCancellationOpen via prop.
  const [cancellationOpen, setCancellationOpen] = useState(false);

  // Phase 42 Plan 42-10 (POLISH-12 D-21) — Quarterly NPS in-app fallback
  // modal state. Populated by the QUARTERLY_NPS_SHOW_EVENT custom-event
  // listener below; cleared on Submit/Skip/dismiss. Once-per-session guard
  // prevents duplicate fire even if the eligibility effect re-runs.
  const [quarterlyNpsState, setQuarterlyNpsState] = useState<{
    open: boolean;
    nonce: string;
    quarter: string;
  } | null>(null);
  const [quarterlyNpsFiredThisSession, setQuarterlyNpsFiredThisSession] = useState(false);

  // Phase 16 Plan 16-02 Task 5 — biometric session-unlock state. Initialized
  // false; set true on successful biometric (or password fallback) auth. The
  // `leanshot_biometric_enabled` localStorage flag is a TEMPORARY hook until
  // a downstream plan migrates it to a Zustand slice on signedIn.user (see
  // 16-02-SUMMARY follow-up note).
  const [biometricUnlocked, setBiometricUnlocked] = useState(false);

  // Phase 16 Plan 16-02 Task 5 — install Universal Link / App Link dispatcher
  // (MOBILE-06 client half). Idempotency guard inside installDeepLinkHandler
  // protects against StrictMode double-mount.
  useEffect(() => {
    installDeepLinkHandler();
  }, []);

  // Phase 49 Plan 09 — global cmd+k (mac) / ctrl+k (win/linux) listener.
  // Mirrors the AdminCommandPalette wiring at
  // src/components/admin/palette/AdminCommandPalette.tsx; toggles the
  // ephemeral `searchOpen` Zustand flag which the SearchModal lazy chunk
  // (rendered below in globalOverlays) reads.
  const searchOpen = useStore((s) => s.searchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [searchOpen, setSearchOpen]);

  // Keep view aligned to user state + hash + pathname. Phase 9 added
  // path-based routes (/clinic/*, /clinic-invite/*); listen to popstate
  // alongside hashchange so back/forward navigation between clinic and
  // dashboard surfaces refreshes the view.
  // Phase 31 Plan 06: also depends on signedInUser so invited patients get 'dashboard'.
  useEffect(() => {
    const recompute = (): void =>
      setView(selectViewLogged('recompute', user, window.location.hash, signedInUser));
    recompute();
    window.addEventListener('hashchange', recompute);
    window.addEventListener('popstate', recompute);
    return () => {
      window.removeEventListener('hashchange', recompute);
      window.removeEventListener('popstate', recompute);
    };
  }, [user, signedInUser]);

  // Phase 5 D-01/D-13: top-level onAuthStateChange subscription. ONE for the
  // whole app — components consume `signedIn` via the Zustand slice rather
  // than holding their own subscriptions.
  //
  // Phase 6 D-12: subscribeAuthStateChanges dynamically imports @/lib/supabase
  // so the supabase-js client stays off App.tsx's static graph. The subscribe
  // call is async; the cleanup function awaits the subscription handle before
  // unsubscribing (Critical Gotcha #9 — StrictMode double-mount in dev).
  //
  // Critical Gotcha #1 (RESEARCH §Pattern 3): the supabase-js docs forbid
  // calling supabase.* from a synchronous onAuthStateChange callback (lock
  // deadlock). Defer every dispatch via `setTimeout(fn, 0)`.
  useEffect(() => {
    const handleAuthEvent = async (
      event: AuthChangeEvent,
      session: Session | null,
    ): Promise<void> => {
      // Phase 6 hotfix companion: restore the post-auth route stashed by
      // main.tsx's double-`#` rewrite. supabase-js clears the URL fragment
      // after parsing the implicit-grant token, which would drop our
      // intended `#/auth/verify` route. Restore it on the FIRST event that
      // carries a real session (INITIAL_SESSION fires on every cold load;
      // SIGNED_IN fires after a fresh email-link verify). Idempotent: the
      // sessionStorage key is removed after one restoration so a subsequent
      // navigation isn't hijacked.
      try {
        const stashed = sessionStorage.getItem('leanshot_post_auth_route');
        if (stashed && session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
          sessionStorage.removeItem('leanshot_post_auth_route');
          if (window.location.hash !== stashed) {
            window.location.hash = stashed;
          }
        }
      } catch {
        /* sessionStorage unavailable; skip restoration (Safari private mode). */
      }

      switch (event) {
        case 'INITIAL_SESSION': {
          useStore.getState().setSession(session);
          // Phase 6 D-12: setLastWasAnon now goes through sync-defer so the
          // auth-migration module stays out of App.tsx's static graph. push()
          // buffers if the heavy modules haven't loaded yet (extremely
          // common on INITIAL_SESSION which fires very early).
          deferSetLastWasAnon(Boolean(session?.user?.is_anonymous));
          if (session?.user && !session.user.is_anonymous && session.user.email_confirmed_at) {
            // Phase 5 G2 (Plan 05-05): route all subsequent persist writes to
            // this user's namespaced key. MUST precede renameStorageNamespace
            // so the post-migration hydrate-rewrite lands in the namespace,
            // not the universal key. M4 in store.test.ts locks this contract.
            await setActiveStorageUserId(session.user.id);
            await renameStorageNamespace(session.user.id);
            // Phase 6 D-12: the rest of the verified-signed-in triplet
            // (anon-promotion + enqueue-local + pull + subscribe + flush)
            // now lives in sync-defer's onSignedIn drain branch. The dispatch
            // order inside dispatch() mirrors the original Phase 5 sequence.
            deferOnSignedIn(session.user.id, session);
            // Phase 14 Plan 14-09 CR-01: sync billing tier from subscriptions
            // table into Zustand store. Dynamic import keeps billing-sync.ts
            // off App.tsx's static graph (same Phase 6 D-12 discipline as
            // deferOnSignedIn). fire-and-forget — auth handler must not block.
            void import('@/lib/billing-sync').then(({ syncBillingTier }) =>
              syncBillingTier(session.user.id),
            );
            // Phase 22 Plan 22-12 — D-08 per-user feature-flag overrides.
            // Populate the overrides cache once per session (idempotent +
            // best-effort; logs + swallows errors so a Supabase outage
            // degrades to "PostHog default" rather than blocking sign-in).
            void loadOverrides(session.user.id);
          }
          break;
        }
        case 'SIGNED_IN': {
          useStore.getState().setSession(session);
          if (session?.user && !session.user.is_anonymous && session.user.email_confirmed_at) {
            // Phase 5 G2 (Plan 05-05): see INITIAL_SESSION above — same
            // ordering contract: setActiveStorageUserId BEFORE
            // renameStorageNamespace. M4 in store.test.ts locks this contract.
            await setActiveStorageUserId(session.user.id);
            await renameStorageNamespace(session.user.id);
            // Phase 6 D-12: deferred sync init covers the
            // anon-promotion + enqueue-local + pull + subscribe + flush triplet.
            deferOnSignedIn(session.user.id, session);
            // Phase 14 Plan 14-09 CR-01: sync billing tier on sign-in (same
            // pattern as INITIAL_SESSION above).
            void import('@/lib/billing-sync').then(({ syncBillingTier }) =>
              syncBillingTier(session.user.id),
            );
            // Phase 22 Plan 22-12 — D-08 per-user feature-flag overrides
            // (same rationale as INITIAL_SESSION above).
            void loadOverrides(session.user.id);
            // Phase 24 Plan 04 D-13: merge pre-auth anonymous PostHog events
            // under the Supabase uid. identify() maps the current session;
            // aliasAnonymousToUid() fires posthog.alias() once per uid per device
            // (idempotent — localStorage marker prevents duplicate alias calls).
            // Best-effort: dynamic-import posthog-js to read the current anon
            // distinct_id without adding posthog to App.tsx's static graph.
            void import('posthog-js').then(({ default: ph }) => {
              try {
                const anonId = ph.get_distinct_id?.() ?? null;
                identify(session.user.id);
                if (anonId && anonId !== session.user.id) {
                  aliasAnonymousToUid(anonId, session.user.id);
                }
              } catch {
                // posthog-js may not be initialized yet (analytics disabled or
                // key missing). Identify bridge is best-effort; Supabase session
                // is already set above.
              }
            });
          }
          break;
        }
        case 'SIGNED_OUT': {
          // Phase 5 G2 (Plan 05-05): capture prior user id BEFORE setSession /
          // clearUserDataSlices null-out the signedIn slice. Used below to
          // wipe the per-user namespaced localStorage residue.
          const prevUserId = useStore.getState().signedIn?.user?.id ?? null;
          // Phase 5 D-09 — tear down Realtime BEFORE clearing user data
          // slices so a late-arriving channel event cannot repopulate state
          // that we are about to wipe.
          //
          // Phase 6 D-12: deferOnSignedOut dispatches unsubscribeInjections
          // immediately if loadedApi is non-null (the common case — by the
          // time SIGNED_OUT fires, scheduleSyncInit() has long since
          // resolved). supabase.removeChannel detaches the local listener
          // synchronously, so a Realtime payload cannot re-enter the store
          // between this call and the clearUserDataSlices that follows.
          deferOnSignedOut(prevUserId);
          useStore.getState().clearUserDataSlices();
          // Phase 22 Plan 22-12 — D-08: drop the per-user feature-flag
          // override cache so the next signed-in user starts from PostHog
          // defaults until their own loadOverrides() resolves. Mirrors the
          // namespaced-localStorage wipe in spirit.
          clearOverrideCache();
          // Phase 24 Plan 04 D-13: reset PostHog identity so the next anon
          // session is truly anonymous (distinct_id returns to a fresh anon id).
          // posthog.reset() must run AFTER sign-out so the current uid's event
          // queue is flushed before the identity is cleared.
          void import('posthog-js').then(({ default: ph }) => {
            try { ph.reset(); } catch { /* ignore — posthog may not be initialized */ }
          });
          // Phase 5 G2 (05-UAT.md gap #2 missing item #2): wipe the prior
          // user's namespaced localStorage residue + revert the adapter to
          // the universal key so any subsequent anon activity lands there.
          await setActiveStorageUserId(null);
          if (prevUserId) {
            await removeUserNamespace(prevUserId);
          }
          // CONF-2: clear any auth-related hash so selectView returns 'marketing'.
          if (window.location.hash.startsWith('#/auth/')) {
            history.replaceState(null, '', window.location.pathname);
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }
          break;
        }
        case 'PASSWORD_RECOVERY': {
          window.location.hash = '#/auth/set-new-password';
          break;
        }
        case 'USER_UPDATED': {
          useStore.getState().setSession(session);
          break;
        }
        default:
          break;
      }
    };

    // Phase 6 D-12: subscribeAuthStateChanges is async (dyn-imports
    // @/lib/supabase). The subscription handle is captured in a closure-local
    // ref so the cleanup function can call .unsubscribe() once it resolves.
    // Tracks the StrictMode double-mount edge: if the effect cleans up before
    // the subscription resolves, the `cancelled` flag short-circuits the
    // dispatch and immediately tears the freshly-resolved subscription down.
    let cancelled = false;
    let activeSubscription: { unsubscribe: () => void } | null = null;
    void subscribeAuthStateChanges((event, session) => {
      setTimeout(() => {
        void handleAuthEvent(event, session);
      }, 0);
    }).then(({ data }) => {
      if (cancelled) {
        data.subscription.unsubscribe();
        return;
      }
      activeSubscription = data.subscription;
    });

    return () => {
      cancelled = true;
      activeSubscription?.unsubscribe();
    };
  }, []);

  // Phase 5 D-10 / RESEARCH §6 line 887 — when the browser reports the
  // network is back, drain `pendingOps`. Phase 6 D-12: deferFlush buffers
  // until sync-defer's dynamic import has resolved, then drains. The
  // post-load fast path dispatches `flushSyncQueue()` immediately.
  // `flushSyncQueue` is idempotent and re-checks `isSyncEnabled()` (D-13)
  // so this listener is safe to fire while signed-out or unverified.
  useEffect(() => {
    const onOnline = (): void => {
      deferFlush();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // Phase 14 Plan 14-09 CR-01 / CONTEXT D-09: when the browser tab regains focus
  // after a Customer Portal round-trip, re-sync the billing tier so any
  // subscription change is reflected within the 10-second budget. Dynamic import
  // keeps billing-sync.ts off App.tsx's static graph (Phase 6 D-12 discipline).
  // Guard: only fire for a verified non-anon signed-in user.
  useEffect(() => {
    const handleFocus = (): void => {
      const signedIn = useStore.getState().signedIn;
      const userId = signedIn?.user?.id;
      const isAnon = signedIn?.user?.is_anonymous;
      const isVerified = signedIn?.verified;
      if (!userId || isAnon || !isVerified) return;
      void import('@/lib/billing-sync').then(({ syncBillingTier }) =>
        syncBillingTier(userId),
      );
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Phase 16 Plan 16-05 — Realtime tier-flip listener (D-25).
  //
  // Subscribes to `subscriptions:user_id=eq.{userId}` postgres_changes so
  // any RC webhook write (Plan 16-06) — or any Stripe-webhook write (Phase
  // 14) — re-derives `tier` in the running native app within ~5s. Mirrors
  // the Phase 9/10 `clinic-realtime.ts` channel + cleanup pattern and the
  // RLS posture: the user can only subscribe to their own `user_id` row.
  //
  // The handler dynamic-imports `@/lib/billing-sync` and calls the existing
  // `syncBillingTier(userId)` re-read of the subscriptions row → store tier
  // (same path as the focus-handler effect above). Dynamic-import keeps
  // supabase + billing-sync off App.tsx's static graph.
  //
  // Gate: dashboard-only AND verified non-anon user (same gate as focus).
  // Cleanup: `await channel.unsubscribe()` so signedIn → signedOut → signedIn
  // cycles don't leak channels.
  useEffect(() => {
    if (view !== 'dashboard') return;
    const signedIn = useStore.getState().signedIn;
    const userId = signedIn?.user?.id;
    const isAnon = signedIn?.user?.is_anonymous;
    const isVerified = signedIn?.verified;
    if (!userId || isAnon || !isVerified) return;
    type ChannelHandle = { unsubscribe(): Promise<unknown> };
    let channel: ChannelHandle | null = null;
    void (async () => {
      const { supabase } = await import('@/lib/supabase');
      const c = supabase.channel(`subscriptions:user_id=eq.${userId}`);
      const onChange = (): void => {
        void import('@/lib/billing-sync').then(({ syncBillingTier }) =>
          syncBillingTier(userId),
        );
      };
      c.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'subscriptions',
          filter: `user_id=eq.${userId}`,
        },
        onChange,
      ).on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'subscriptions',
          filter: `user_id=eq.${userId}`,
        },
        onChange,
      );
      await c.subscribe();
      channel = c as unknown as ChannelHandle;
    })();
    return () => {
      if (channel) {
        void channel.unsubscribe();
      }
    };
  }, [view]);

  // Phase 15 Plan 15-10 — `?upgrade=` deep-link handler.
  //
  // The published /pricing page renders Checkout buttons as zero-JS
  // <a href> links into the SPA: `/#/settings?upgrade={plus_monthly|plus_yearly}`.
  // The visitor lands in the SPA on the settings hash route; this effect
  // parses the `upgrade` param out of the hash query, validates it against
  // the exact two-value enum, and (only for a verified non-anon signed-in
  // user) opens Settings + invokes the SAME stripe-checkout/session path
  // UpgradeCTA.tsx already uses (Phase 14 D-09).
  //
  // Safety:
  //   - T-15-10-03: ignore any value not in the enum (no fall-through to a
  //     default plan, no string passthrough).
  //   - T-15-10-02: the SPA only ever sends the validated enum tag; the
  //     server-side stripe-checkout/session re-validates against its own
  //     allowlist (`validPlans`) and resolves the price from Function secrets.
  //   - Strip `?upgrade=` after firing so a refresh does not re-trigger.
  //   - Dynamic-import `@/lib/supabase` to keep it off the static graph
  //     (Phase 6 D-12 discipline mirroring the billing-sync effect above).
  //   - If there is no verified signed-in user, fall through to the existing
  //     auth view (`#/auth/*` already routes there); the hash param survives
  //     the auth round-trip and the effect re-fires after sign-in.
  useEffect(() => {
    const VALID_PLANS = ['plus_monthly', 'plus_yearly'] as const;
    type ValidPlan = (typeof VALID_PLANS)[number];

    const handleUpgradeParam = (): void => {
      const hash = window.location.hash;
      // Hash shape we accept: `#/settings?upgrade=plus_monthly` (or yearly).
      const qIndex = hash.indexOf('?');
      if (qIndex < 0) return;
      const queryString = hash.slice(qIndex + 1);
      const params = new URLSearchParams(queryString);
      const raw = params.get('upgrade');
      if (raw === null) return;
      if (!(VALID_PLANS as readonly string[]).includes(raw)) {
        // Out-of-enum value — silently strip so a crafted URL cannot replay.
        params.delete('upgrade');
        const remainder = params.toString();
        const baseHash = hash.slice(0, qIndex);
        const newHash = remainder === '' ? baseHash : `${baseHash}?${remainder}`;
        try {
          history.replaceState(null, '', window.location.pathname + newHash);
        } catch {
          /* noop */
        }
        return;
      }
      const plan = raw as ValidPlan;

      // Strip `?upgrade=` from the URL immediately so a refresh does not
      // re-trigger and so multiple effect runs do not double-fire the invoke.
      params.delete('upgrade');
      const remainder = params.toString();
      const baseHash = hash.slice(0, qIndex);
      const newHash = remainder === '' ? baseHash : `${baseHash}?${remainder}`;
      try {
        history.replaceState(null, '', window.location.pathname + newHash);
      } catch {
        /* sessionStorage / replaceState unavailable; skip — non-fatal. */
      }

      // Gate: only fire for a verified non-anon signed-in user. If absent,
      // selectView's hash `#/auth/*` branch will route the user through
      // sign-in; on SIGNED_IN the effect re-fires (the user can re-trigger
      // the deep-link from /pricing). For first-time visitors that path is
      // intentional — checkout requires a real account.
      const signedIn = useStore.getState().signedIn;
      const userId = signedIn?.user?.id;
      const isAnon = signedIn?.user?.is_anonymous;
      const isVerified = signedIn?.verified;
      if (!userId || isAnon || !isVerified) {
        // Stash the route so the post-sign-in restoration in handleAuthEvent
        // (above) can return the user to the upgrade flow. Reuses the same
        // sessionStorage key as the Phase 6 double-`#` hotfix.
        try {
          sessionStorage.setItem('leanshot_post_auth_route', `#/settings?upgrade=${plan}`);
        } catch {
          /* private mode — noop */
        }
        // Force the auth view if not already on an auth hash.
        if (!window.location.hash.startsWith('#/auth/')) {
          window.location.hash = '#/auth/signin';
        }
        return;
      }

      // Open Settings so the user has visual context for the redirect.
      setSettingsOpen(true);

      // Phase 16 Plan 16-05 — platform fork for native shells. Apple §3.1.1
      // and Google Play §3.1.1 forbid serving Stripe Checkout for digital
      // subscriptions on iOS / Android — route through RevenueCat instead.
      // Dynamic-imports iap.ts so the RC SDK stays off App.tsx's static
      // graph (Phase 6 D-12 discipline mirroring billing-sync above). The
      // success path is silent: the Realtime listener installed below will
      // flip `tier` within ~5s when the RC webhook (Plan 16-06) writes the
      // subscriptions row. CRITICAL: early `return` so we do NOT fall through
      // to the web stripe-checkout invoke — Apple review would fail.
      const platform = detectPlatform();
      if (platform === 'ios' || platform === 'android') {
        const productId =
          plan === 'plus_monthly'
            ? 'app.leanshot.plus.monthly'
            : 'app.leanshot.plus.yearly';
        void (async (): Promise<void> => {
          try {
            const { configureRC, purchaseSubscription } = await import(
              '@/lib/native/iap'
            );
            await configureRC(userId);
            const result = await purchaseSubscription(productId);
            if (result.cancelled) return; // sheet dismissed — silent, no toast.
            // success path: Realtime channel propagates the tier flip; no
            // local mutation here.
          } catch {
            try {
              useStore
                .getState()
                .showToast("Couldn't complete purchase. Try again.", 'error');
            } catch {
              /* toast unavailable — noop */
            }
          }
        })();
        return;
      }

      // ─── Web branch (Phase 15 Plan 15-10 byte-stable invariant) ─────────
      // Invoke stripe-checkout/session via the SAME path UpgradeCTA.tsx uses.
      // Dynamic-import to keep @/lib/supabase off App.tsx's static graph.
      void import('@/lib/supabase').then(async ({ supabase }) => {
        try {
          const { data, error } = await supabase.functions.invoke(
            'stripe-checkout/session',
            { body: { plan } },
          );
          if (error || !data?.url) {
            // Match UpgradeCTA's Pitfall 8 discipline — do NOT echo upstream
            // error. Toast (best-effort) so the user knows something failed.
            try {
              useStore.getState().showToast("Couldn't open Stripe. Try again.", 'error');
            } catch {
              /* toast unavailable — noop */
            }
            return;
          }
          window.location.href = data.url;
        } catch {
          try {
            useStore.getState().showToast("Couldn't open Stripe. Try again.", 'error');
          } catch {
            /* noop */
          }
        }
      });
    };

    // Run on mount AND on every hashchange (the rendered /pricing button's
    // <a href> mutates the hash, which fires hashchange even within the same
    // origin/path).
    handleUpgradeParam();
    window.addEventListener('hashchange', handleUpgradeParam);
    return () => window.removeEventListener('hashchange', handleUpgradeParam);
  }, []);

  // Auto-mint anonymous session when the user lands on the dashboard without
  // any session (RESEARCH §12 Q5). This ensures AvatarMenu always has a user
  // to render and Phase 4's AI Coach `signInAnonymously` first-call gating
  // (which is still inside AIChatPanel) does not race the auth subscriber.
  //
  // Phase 6 D-12: autoMintAnonSessionIfMissing is the dyn-import wrapper that
  // keeps `@/lib/supabase` (and transitively `@supabase/supabase-js`) off
  // App.tsx's static graph. It also enqueues a setLastWasAnon(true) via
  // deferSetLastWasAnon so the hint survives the deferred-init window.
  useEffect(() => {
    if (view !== 'dashboard') return;
    const current = useStore.getState().signedIn;
    if (current?.user) return;
    // Best-effort; ignore errors — AI Coach will retry on its own.
    void autoMintAnonSessionIfMissing();
  }, [view]);

  // First visit to dashboard → auto-launch tour after a beat.
  //
  // Phase 7 07-02 fix: skip auto-launch when VITE_E2E='true'. e2e specs
  // pre-seed `leanshot_v4` localStorage blobs to bypass onboarding, but the
  // seed does NOT include the `leanshot_tour_seen_v4` flag (it's a separate
  // localStorage key managed by GuidedTour itself). Result: shouldShowTour()
  // returns true, tour auto-opens 900ms post-dashboard, and its
  // `pointer-events-auto` backdrop intercepts every subsequent click
  // (Migration "Continue to dashboard", Sidebar tabs, etc.) — blocking 6 of
  // 7 deferred specs in CI. Settings → "Replay tour" still works locally,
  // and the Vercel production build does NOT set VITE_E2E so real users
  // continue to see the tour on first dashboard load.
  useEffect(() => {
    if (view !== 'dashboard') return;
    if (isE2E()) return;
    let cancelled = false;
    void import('@/components/dashboard/tour/GuidedTour').then(({ shouldShowTour }) => {
      if (cancelled || !shouldShowTour()) return;
      window.setTimeout(() => {
        if (!cancelled) setTourOpen(true);
      }, 900);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Listen for the global "replay-tour" event the Settings page dispatches.
  useEffect(() => {
    const onReplay = (): void => setTourOpen(true);
    window.addEventListener('leanshot:replay-tour', onReplay);
    return () => window.removeEventListener('leanshot:replay-tour', onReplay);
  }, []);

  // Phase 35 Plan 35-08 (GAME-04): open-settings event dispatched by the
  // GamificationCard's onOpenLeaderboardSettings handler (level-5 nudge CTA).
  // Mirrors the leanshot:replay-tour pattern above.
  useEffect(() => {
    const onOpenSettings = (): void => setSettingsOpen(true);
    window.addEventListener('leanshot:open-settings', onOpenSettings);
    return () => window.removeEventListener('leanshot:open-settings', onOpenSettings);
  }, []);

  // Phase 40 Plan 40-04 (POLISH-01) — cancellation modal trigger. SettingsPage
  // dispatches `leanshot:open-cancellation` when the "Cancel subscription" button
  // is clicked. Mirrors the leanshot:replay-tour pattern (no prop threading needed,
  // avoids touching SettingsPage's prop signature which 40-04 is not a writer of).
  useEffect(() => {
    const onOpenCancellation = (): void => setCancellationOpen(true);
    window.addEventListener('leanshot:open-cancellation', onOpenCancellation);
    return () => window.removeEventListener('leanshot:open-cancellation', onOpenCancellation);
  }, []);

  // Phase 42 Plan 04 (POLISH-07) — bootstrap PWA service worker registration +
  // install-prompt + offline store AFTER first paint.
  //
  // Pitfall 9: dynamic import keeps workbox-window glue OFF the index chunk.
  // D-17: onUpdate fires a persistent toast with a Reload button; clicking
  //       reload triggers window.location.reload() which picks up the new
  //       bundle (src/sw.ts handles SKIP_WAITING on the same client tick).
  // D-18: initializePWA early-returns inside Capacitor (capacitor-shim).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      import('@/lib/pwa/register'),
      import('@/lib/pwa/install-prompt'),
      import('@/lib/pwa/offline-store'),
    ]).then(([reg, installPrompt, offlineStore]) => {
      if (cancelled) return;
      installPrompt.initializeInstallPromptModule();
      offlineStore.initializeOfflineStore();
      reg.initializePWA(() => {
        useStore
          .getState()
          .showToast('New version available — tap to reload.', 'info', 60_000);
        // The toast is a passive notification; the user reloads via the
        // browser refresh button (or the Settings drawer's update CTA in a
        // future polish). This avoids coupling Toast to a button-action API
        // which the current DS does not expose.
      });
      // TEST HOOK — leanshot e2e/pwa-*.spec.ts: ready flag tested before
      // context.setOffline() so the e2e knows the offline-store has
      // installed its 'online'/'offline' listeners. NOT used by app code.
      try {
        (window as unknown as { __leanshot_pwa_ready?: boolean }).__leanshot_pwa_ready = true;
        window.dispatchEvent(new Event('leanshot:pwa-ready'));
      } catch {
        // jsdom or older browser — ignore.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // D-11: fire `disclaimer_required` when the dashboard-render fallback first
  // appears. Fires once per false→true transition; if the user dismisses then
  // re-triggers (e.g. a hypothetical 'v1' → 'v2' version bump), it fires again
  // — desired. Trade-off: a refs + once-flag would avoid the eventual second
  // fire, but the version-bump signal is itself useful for analytics.
  useEffect(() => {
    if (needsDisclaimer) {
      track('disclaimer_required', { surface: 'dashboard' });
    }
  }, [needsDisclaimer]);

  // Phase 42 Plan 42-10 (POLISH-12 D-20/D-21) — Quarterly NPS in-app fallback
  // bootstrap. UNCONDITIONAL trigger gated by the SECDEF RPC (the eligibility
  // resolver is the gate; the modal trigger itself must NOT be wrapped in a
  // feature-flag conditional — eslint-rules/no-conditional-native-review.cjs
  // blocks that. See P36 V13-3 BLOCKER + P42 D-20).
  //
  // Two-layer wiring:
  //   1. Effect resolves eligibility once per sign-in session. If eligible,
  //      calls showQuarterlyNpsModal(detail) which dispatches a CustomEvent.
  //   2. Window listener (this same effect) catches the event and flips
  //      quarterlyNpsState to open=true. The lazy modal mounts below.
  //
  // The "once per session" guard (quarterlyNpsFiredThisSession) lives in React
  // state because StrictMode double-mount in dev would otherwise double-fire
  // the eligibility check (server-side single-use ledger would still de-dupe
  // but it'd burn one extra RPC call).
  useEffect(() => {
    if (!signedInUser) return;
    if (quarterlyNpsFiredThisSession) return;

    // Subscribe FIRST so the dispatch can find a listener.
    const onShow = (e: Event): void => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (isQuarterlyNPSShowDetail(detail)) {
        setQuarterlyNpsState({ open: true, nonce: detail.nonce, quarter: detail.quarter });
      }
    };
    window.addEventListener(QUARTERLY_NPS_SHOW_EVENT, onShow);

    let cancelled = false;
    // D-20 UNCONDITIONAL: the modal-trigger call site lives inside its OWN
    // function body so the no-conditional-native-review ancestor walk stops
    // at this function's root (per the rule's FUNCTION_BOUNDARY_TYPES set in
    // eslint-rules/no-conditional-native-review.cjs). The early-return guard
    // is the eligibility gate; the show call below is the unconditional
    // surface invocation per V13-3 BLOCKER + P42 D-20.
    const fireIfEligible = (eligibility: {
      eligible: boolean;
      nonce: string | null;
      quarter: string | null;
    }): void => {
      if (!eligibility.eligible) return;
      if (!eligibility.nonce) return;
      if (!eligibility.quarter) return;
      setQuarterlyNpsFiredThisSession(true);
      showQuarterlyNpsModal({ nonce: eligibility.nonce, quarter: eligibility.quarter });
    };

    void isUserEligibleForQuarterlyNPS().then((eligibility) => {
      if (cancelled) return;
      fireIfEligible(eligibility);
    });

    return () => {
      cancelled = true;
      window.removeEventListener(QUARTERLY_NPS_SHOW_EVENT, onShow);
    };
  }, [signedInUser, quarterlyNpsFiredThisSession]);

  // Phase 16 Plan 16-02 Task 5 — BiometricGate early-return wrap. When the
  // user has biometric unlock enabled (TEMPORARY localStorage flag — see
  // 16-02-SUMMARY for the Zustand-slice migration follow-up) AND they have
  // not yet unlocked this JS session, render ONLY the BiometricGate. The
  // gate-active boolean is computed inline so the localStorage read happens
  // every render (cheap; bypasses sessionStorage staleness on cold boots).
  //
  // On successful unlock, `setBiometricUnlocked(true)` flips the flag and the
  // next render falls through to the normal view branches.
  //
  // `onPasswordSubmit` is a stub that throws — the real Supabase
  // signInWithPassword wiring lands in a downstream plan (likely 16-05 or a
  // deferred follow-up). See 16-02-SUMMARY §"Carry-over follow-ups".
  const biometricGateActive =
    !biometricUnlocked &&
    typeof window !== 'undefined' &&
    (() => {
      try {
        return window.localStorage.getItem('leanshot_biometric_enabled') === '1';
      } catch {
        return false;
      }
    })();
  if (biometricGateActive) {
    return (
      <BiometricGate
        onUnlock={() => setBiometricUnlocked(true)}
        onPasswordSubmit={async (_pw) => {
          throw new Error('password fallback not yet wired — see Phase 16 follow-up');
        }}
      />
    );
  }

  // Phase 22 Plan 22-12 — Wave 3 always-on overlays. Mounted as siblings of
  // every view branch via the `globalOverlays` const below so the cookie
  // banner shows on marketing (anonymous visitor path) AND the impersonation
  // / soft-delete banners show on every signed-in surface. Each component
  // self-gates to null when its condition isn't met, so unconditional mount
  // is safe + the only correct way to honor UI-SPEC line 317 (banner priority
  // is encoded inside SoftDeleteCountdownBanner via its `impersonating` ref).
  //
  // CookieConsentBootstrap returns null; mounting it once on any view is
  // sufficient — the side-effect (scheduleConsentInit) is idempotent at the
  // module level.
  const globalOverlays = (
    <>
      <ImpersonationBanner />
      <SoftDeleteCountdownBanner />
      <CookieConsentBootstrap />
      {/* Phase 42 Plan 04 (D-13, D-16) — OfflineBanner is a global signal
          (every view). InstallPromptCard self-gates internally on
          visits>=3 + captured beforeinstallprompt + state not
          installed/dismissed + snooze expired; mounting it globally is
          safe and lets the prompt surface from any view once the
          engagement signal trips. */}
      <Suspense fallback={null}>
        <OfflineBanner />
        <InstallPromptCard />
      </Suspense>
      {/* Phase 49 Plan 09 — consumer cmd+k Spotlight. Lazy chunk only
          fetched once searchOpen flips true; null fallback so no
          flash. Closing via Esc / outside click flips searchOpen back to
          false but does not unmount (cmdk handles its own dialog state). */}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchModal onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </>
  );

  // Phase 19 Plan 19-09 (BL-4) — Phase-19 route registries take priority over
  // the marketing/dashboard branches. Each entry is its own lazy chunk; the
  // resolver returns null for non-Phase-19 paths so the existing view-selector
  // continues to drive marketing/onboarding/dashboard/clinic/etc.
  const phase19Match = resolvePhase19Route(window.location.pathname);
  if (phase19Match) {
    const { Component: Phase19Component, code } = phase19Match;
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <Phase19Component code={code} />
        </Suspense>
      </>
    );
  }

  // Phase 46 Plan 46-10 (COURSE-04) — public no-auth /verify/<cert_id> route.
  // Pathname pre-check runs BEFORE the TabId / marketing / onboarding /
  // dashboard view branches: the verify page is anonymous-OK and must render
  // even when a persisted user is hydrated (otherwise the Zustand-persisted
  // user would route a /verify/<id> visitor straight into their dashboard —
  // see project memory `reference_zustand_persisted_user_blocks_marketing_uat`
  // for the analog UAT trap). Pathname is read once per App mount; back-button
  // navigation from /verify/ → / requires a full reload (intentional: verify
  // is a leaf surface like /share, /legal). globalOverlays intentionally
  // omitted — the verify surface renders no Sidebar/Topbar/MobileNav.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/verify/')) {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <CertVerifyPage />
      </Suspense>
    );
  }

  if (view === 'marketing') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <Marketing onStart={() => setView('onboarding')} />
        </Suspense>
      </>
    );
  }
  if (view === 'onboarding') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <Onboarding onCancel={() => setView('marketing')} onComplete={() => setView('dashboard')} />
        </Suspense>
      </>
    );
  }
  // Phase 34 Plan 34-06 (ONBOARD-01) — anonymous preview view. Renders the
  // hero + CTA wrapped in AnonymousPreviewLayer (cookie bootstrap + smart
  // defaults). Lazy-loaded so the layer + preview body never touch the
  // index static graph.
  if (view === 'onboard-preview') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AnonymousPreviewView />
        </Suspense>
      </>
    );
  }
  if (view === 'auth') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AuthView />
        </Suspense>
      </>
    );
  }
  // Phase 34 Plan 34-04 (ONBOARD-02) — PKCE OAuth callback view. Renders
  // alongside 'auth' but is keyed on the `/auth/callback` PATH branch in
  // selectView (above) so it never collides with the magic-link `#/auth/`
  // hash flow.
  if (view === 'auth-callback') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AuthCallbackView />
        </Suspense>
      </>
    );
  }
  if (view === 'share') {
    // Phase 8 Plan 08-04 — SharePage reads the token from window.location.hash
    // itself; keeps the parser inside the lazy chunk to spare the index budget.
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <SharePage />
        </Suspense>
      </>
    );
  }
  if (view === 'legal') {
    const LegalPage = selectLegalPage(window.location.hash);
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <LegalPage />
        </Suspense>
      </>
    );
  }
  // Phase 9 Plan 09-01 — 3 clinic surfaces. Each is its own lazy chunk;
  // Plan 09-02 / 03 / 04 OVERWRITE the stub bodies in place. Routing
  // selection is owned by selectView() above.
  if (view === 'clinic-invite') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <ClinicInvitePage />
        </Suspense>
      </>
    );
  }
  if (view === 'clinic-settings') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <ClinicSettingsPage />
        </Suspense>
      </>
    );
  }
  if (view === 'clinic') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <ClinicWorkspace />
        </Suspense>
      </>
    );
  }
  // Phase 10 Plan 10-05 — drill-in route: /clinic/{slug}/patient/{user_id}.
  // Stub file; Plan 10-07 overwrites ClinicDrillInPage with the real implementation.
  if (view === 'clinic-drill-in') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <ClinicDrillInPage />
        </Suspense>
      </>
    );
  }
  // Phase 15 Plan 15-04 — Page Builder admin surfaces.
  if (view === 'admin-page-list') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminPageList />
        </Suspense>
      </>
    );
  }
  if (view === 'admin-page-editor') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminPageEditor />
        </Suspense>
      </>
    );
  }
  if (view === 'admin-site-settings') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminSiteSettings />
        </Suspense>
      </>
    );
  }
  // Phase 22 Plan 22-12 — Wave 3 admin surfaces (ADMIN-01/02/05/06/08).
  if (view === 'admin-members') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminMembersPage />
        </Suspense>
      </>
    );
  }
  if (view === 'admin-member-detail') {
    // Extract userId from `/admin/members/{user_id}` for the drill-in.
    const userIdMatch = window.location.pathname.match(/^\/admin\/members\/([^/]+)$/);
    const userId = userIdMatch?.[1];
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminMemberDetailPage userId={userId} />
        </Suspense>
      </>
    );
  }
  if (view === 'admin-metrics') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminMetricsPage />
        </Suspense>
      </>
    );
  }
  if (view === 'admin-cohorts') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminCohortsPage />
        </Suspense>
      </>
    );
  }
  if (view === 'admin-affiliates') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminAffiliatesPage />
        </Suspense>
      </>
    );
  }
  // Phase 42 Plan 42-10 (POLISH-12 D-24) — Generic manifest-driven admin
  // shell. AdminLayout (Mode A, no children) probes is_staff + has_totp +
  // aal2; on success, renders AdminShell which dispatches to the manifest
  // entry matching window.location.pathname (/admin/<route>). Includes
  // /admin/nps/quarterly registered in this plan plus pre-existing manifest
  // entries that were previously unreachable (growth/cac, rag, anomaly,
  // compliance, i18n-overrides, clinic-orgs).
  if (view === 'admin-shell') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AdminShellRoot />
        </Suspense>
      </>
    );
  }
  // Phase 22 Plan 22-11 — DSAR portal (GDPR-03).
  if (view === 'dsar') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <DsarPortalPage />
        </Suspense>
      </>
    );
  }
  // Phase 22 Plan 22-11 — Email preference center (ON-03).
  if (view === 'email-prefs') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <EmailPreferencesPage />
        </Suspense>
      </>
    );
  }
  // Phase 22 Plan 22-05 — /cancel-deletion landing for HMAC cancel-link
  // verification. Anonymous-OK; no auth gate. The page itself handles
  // RPC outcomes (success / invalid / expired / vault_missing / no_token).
  if (view === 'cancel-deletion') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <CancelDeletionPage />
        </Suspense>
      </>
    );
  }
  // Phase 29 Plan 06 — /accept-clinic-invite patient consent screen.
  // Anonymous-OK: token in query string is the auth. Anti-enumeration UX
  // renders identical "Invite not found" for invalid AND expired tokens
  // (T-29-06-01 mitigation). No auth gate here — ConsentAcceptScreen handles
  // its own loading + error states.
  if (view === 'consent-accept') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <ConsentAcceptScreen />
        </Suspense>
      </>
    );
  }

  // Phase 48 Plan 11 — consumer ban/temp_suspend full-page blocker (D-15).
  // Placed BEFORE the dashboard branches so a banned/temp_suspended user is
  // intercepted regardless of orgFlow state. main.tsx re-fetches the slice
  // on every supabase auth state change so server-side moderation actions
  // surface within the residual JWT window (~1h before ban-enforcement Fn's
  // session DELETE forces a fresh JWT). Renders nothing on marketing /
  // onboarding / clinic / admin / auth surfaces — those branches return
  // earlier above.
  if (
    userModerationStatus === 'banned' ||
    userModerationStatus === 'temp_suspended'
  ) {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <AccountSuspended />
        </Suspense>
      </>
    );
  }

  // Phase 31 Plan 06 D-10/D-14: dashboard-entry gate for invited patients.
  // When orgFlow.status === 'org', the patient has a primary_org_id with an
  // active flow AND has not yet completed onboarding (completed_onboarding_at IS NULL).
  // Show the org-customized OnboardingFlow INSTEAD of the AppShell.
  // onComplete is a no-op view change: the hook returns 'completed' on the next
  // mount (mark_onboarding_complete wrote the timestamp) and the gate no longer fires.
  if (view === 'dashboard' && orgFlow.status === 'org') {
    return (
      <>
        {globalOverlays}
        <Suspense fallback={<FullPageLoader />}>
          <Onboarding
            onCancel={() => {
              /* invited patients cannot cancel — keep them in the flow */
            }}
            onComplete={() => {
              /* hook re-reads DB on next mount; no view change needed here */
            }}
          />
        </Suspense>
      </>
    );
  }

  return (
    <>
      {globalOverlays}
      {/* Phase 42 Plan 42-08 (POLISH-05) — In-app notification toast renderer.
          Subscribes to Supabase Realtime on user_notifications scoped by
          signedInUser.id and pipes incoming rows into the global useToast
          slice (D-07 realtime pipeline). Mounted ONLY inside the authenticated
          dashboard branch — subscribing before the session resolves would
          race the supabase-js INITIAL_SESSION. Returns null (renders nothing);
          the existing global <Toast/> in AppShell renders the message. */}
      <InAppNotificationToast userId={signedInUser?.id ?? null} />
      <AppShell
        onLogDose={() => setTab('medication')}
        onOpenReport={() => setReportOpen(true)}
        onOpenAI={() => setAIOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenWhatsNew={() => setWhatsNewOpen(true)}
      >
        {currentTab === 'home' && <GreetingStrip />}
        <Suspense fallback={<TabLoader />}>
          <TabSwitcher tabKey={currentTab}>
            {currentTab === 'home' && <HomeTab onOpenAI={() => setAIOpen(true)} />}
            {currentTab === 'medication' && <MedicationTab />}
            {currentTab === 'symptoms' && <SymptomsTab />}
            {currentTab === 'body' && <BodyTab />}
            {currentTab === 'nutrition' && <NutritionTab />}
            {currentTab === 'activity' && <ActivityTab />}
            {currentTab === 'supplements' && <SupplementsTab />}
            {currentTab === 'mood' && <MoodTab />}
            {currentTab === 'insights' && <InsightsTab />}
            {/* Phase 45 Plan 45-07b — sub-view dispatch (directory / dm / feed)
                is handled INSIDE CommunityTabShell by reading activeCommunityView
                from the Zustand store. NO new TabId, NO <Route> per memory
                reference_react_router_consumer_admin_split. */}
            {currentTab === 'community' && <CommunityTabShell />}
            {/* Phase 46 Plan 08 — Classroom surface. Two-level Zustand
                navigation (activeCourseId / activeLessonId) handled INSIDE
                ClassroomTabShell. NO new <Route>; consumer stays router-free. */}
            {currentTab === 'classroom' && <ClassroomTabShell />}
            {/* Phase 47 Plan 10 — Events surface. List-vs-detail Zustand
                navigation (activeEventId) handled INSIDE EventsTab. NO new
                <Route>; consumer stays router-free. EVENT-01 / 02 / 03.
                Equivalent to a `case 'events':` arm in the App-tab switch
                idiom; expressed as a ternary-render guard to match the
                surrounding pattern. */}
            {currentTab === 'events' && <EventsTab />}
          </TabSwitcher>
        </Suspense>
      </AppShell>

      <Suspense fallback={null}>
        {aiOpen && <AIChatPanel open={aiOpen} onClose={() => setAIOpen(false)} />}
        {settingsOpen && (
          <SettingsPage open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        )}
        {reportOpen && <DoctorReport open={reportOpen} onClose={() => setReportOpen(false)} />}
        {tourOpen && <GuidedTour open={tourOpen} onClose={() => setTourOpen(false)} />}
        {/* Phase 42 Plan 42-09 (POLISH-11) — What's New drawer. Only mounted
            when the user clicks the Sparkles button in the Topbar, so the
            react-markdown + dompurify chunk is fetched on-demand. The drawer
            consumes useChangelog inside its own host component so the hook
            stays out of App.tsx (App.tsx's render is the hottest path). */}
        {whatsNewOpen && <WhatsNewDrawerHost onClose={() => setWhatsNewOpen(false)} />}
        {/* Phase 40 Plan 40-04 (POLISH-01) — CancellationModal lazy chunk.
            Loaded only when cancellationOpen=true; chunk includes all step
            sub-components (single Vite chunk per CONTEXT specifics + Pitfall 8).
            onClose clears state so the chunk can be GC'd between sessions. */}
        {cancellationOpen && (
          <CancellationModalLazy onClose={() => setCancellationOpen(false)} />
        )}
        {/* Phase 42 Plan 42-10 (POLISH-12 D-21) — Quarterly NPS in-app fallback
            modal. Mounted ONLY when the eligibility resolver fires the
            QUARTERLY_NPS_SHOW_EVENT (UNCONDITIONAL trigger gated on the SECDEF
            RPC — see useEffect bootstrap above). On close, the state is set
            null so the lazy chunk can be GC'd. */}
        {quarterlyNpsState?.open && (
          <QuarterlyNPSModalLazy
            open
            onClose={() => setQuarterlyNpsState(null)}
            nonce={quarterlyNpsState.nonce}
            quarter={quarterlyNpsState.quarter}
          />
        )}
        {/* Phase 36 Plan 36-03 — NPS prompt listener host. Renders the rating
            prompt (Surface A) + promoter CTA (Surface B) + detractor feedback
            (Surface C) lazily. Host body returns null until decision.fire is
            true (server-cooldown gate), so the lazy chunk is fetched once on
            dashboard mount but contributes zero rendered DOM until admissible.
            Mounted INSIDE the dashboard branch only — marketing / onboarding
            users never load the chunk. */}
        <NPSPromptListenerHostLazy />
      </Suspense>

      {/* Phase 6 Plan 06-02 — MigrationModal is rendered ONLY when there is a
          migration in progress (D-02 resume), just completed (D-01 success),
          or surfaced a corruption error (D-02 retry). Net-new users have
          both slices null so the lazy chunk never loads. */}
      {(migrationState != null || migrationError != null) && (
        <Suspense fallback={null}>
          <MigrationModal
            onContinue={() => {
              const m = useStore.getState().migration_state;
              if (m?.complete) {
                // Post-complete acknowledgement — clear the slice so the modal
                // unmounts and the chunk can be GC'd. The persisted slice's
                // `complete: true` flag prevents `maybeStartMigration` from
                // re-entering on next sign-in.
                useStore.getState().setMigrationState(null);
                return;
              }
              // Mid-flight escape — leave the slice in place so a subsequent
              // sign-in resumes the modal, but inform the user that sync
              // continues in the background.
              useStore.getState().showToast('Migration continuing in the background.', 'info');
              useStore.getState().setMigrationState(null);
            }}
            onRetry={() => {
              // Clear corruption flag + slice, then re-trigger maybeStartMigration
              // via a direct dynamic import (the heavy module is already loaded
              // by sync-defer, so this is a cache hit).
              const userId = useStore.getState().signedIn?.user?.id;
              useStore.getState().setMigrationError(null);
              useStore.getState().setMigrationState(null);
              if (userId) {
                void import('@/lib/migration').then((m) => m.maybeStartMigration(userId));
              }
            }}
          />
        </Suspense>
      )}

      {/* D-11 dashboard-render fallback (Phase 2). Mounted AFTER the lazy
          Suspense block so it visually layers above any concurrent overlay.
          DisclaimerModal is eager-loaded (small, no chart/animation deps); its
          Modal primitive sets z-[100] which already stacks above AppShell. */}
      {needsDisclaimer && (
        <DisclaimerModal
          open
          onAcknowledge={() => useStore.getState().acknowledgeDisclaimer('v1')}
        />
      )}

      {/* Phase 37 Plan 06 — helpdesk widget. Mounted at App root regardless of
          auth state (D-13: widget visible on every screen). The widget reads
          store.user + isPhiRoutePath() internally to render the correct surface:
          marketing (anon) / phi (auth+PHI route) / auth (auth+non-PHI route).
          Lazy boundary keeps the helpdesk-widget chunk (≤25 kB gz) off the
          index static graph — fallback={null} preserves zero perceived cost
          on first paint. */}
      <Suspense fallback={null}>
        <HelpdeskWidget />
      </Suspense>

    </>
  );
}

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <Skeleton className="w-32 h-2" shape="pill" />
    </div>
  );
}

function TabLoader() {
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card span={7} className="min-h-[340px]">
        <Skeleton className="w-full h-full" />
      </Card>
      <Card span={5} className="min-h-[340px]">
        <Skeleton className="w-full h-full" />
      </Card>
      <Card span={4} className="min-h-[180px]">
        <Skeleton className="w-full h-full" />
      </Card>
      <Card span={4} className="min-h-[180px]">
        <Skeleton className="w-full h-full" />
      </Card>
      <Card span={4} className="min-h-[180px]">
        <Skeleton className="w-full h-full" />
      </Card>
    </div>
  );
}
