import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { lazy, Suspense, useEffect, useState } from 'react';
import { DisclaimerModal } from '@/components/dashboard/DisclaimerModal';
import { AppShell, TabSwitcher } from '@/components/layout/AppShell';
import { GreetingStrip } from '@/components/layout/GreetingStrip';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { track } from '@/lib/analytics';
import { removeUserNamespace, renameStorageNamespace, setActiveStorageUserId } from '@/lib/storage';
import { useStore } from '@/lib/store';
// Phase 6 D-12 CI hardening: App.tsx no longer eagerly imports @/lib/sync,
// @/lib/auth-migration, or @/lib/supabase. All three (and transitively
// @supabase/supabase-js) move OFF the entry chunk static graph and load
// after first paint via sync-defer's idle-scheduled dynamic imports.
import {
  autoMintAnonSessionIfMissing,
  deferFlush,
  deferOnSignedIn,
  deferOnSignedOut,
  deferSetLastWasAnon,
  subscribeAuthStateChanges,
} from '@/lib/sync-defer';

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

const Onboarding = lazy(() =>
  import('@/components/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })),
);
const Marketing = lazy(() =>
  import('@/components/marketing/Landing').then((m) => ({ default: m.Landing })),
);
const AuthView = lazy(() => import('@/components/auth/AuthView'));

// Phase 8 Plan 08-04 — Doctor read-share lazy chunk. Mounted on the
// `#/share/<token>` hash route via the top-priority branch in `selectView`
// below. The chunk is OFF the index static graph; bundle CI (Plan 08-06)
// asserts `share-*.js.gz` stays under the 18 kB budget (Task 2b verify).
const SharePage = lazy(() =>
  import('@/components/share/SharePage').then((m) => ({ default: m.SharePage })),
);

// Phase 9 Plan 09-01 — Clinic B2B lazy chunks (B-2 ownership rule per
// plan-checker iter 1). All three lazy boundaries land here in Plan 09-01
// pointing at stub files; Plans 09-02 / 09-03 / 09-04 OVERWRITE the stubs
// in place without touching App.tsx. Bundle CI in
// `scripts/assert-clinic-bundle-budget.sh` enforces per-chunk ceilings
// (clinic ≤12kB, clinic-settings ≤14kB, clinic-invite ≤6kB gz) +
// preserves the 50 kB index ceiling.
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

type View =
  | 'marketing'
  | 'onboarding'
  | 'auth'
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
  | 'clinic-drill-in';

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
function selectView(opts: { user: unknown; hash: string; pathname: string }): View {
  if (opts.hash.startsWith('#/share/')) return 'share';
  if (opts.hash.startsWith('#/legal/')) return 'legal';
  if (opts.hash.startsWith('#/auth/')) return 'auth';
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
  if (opts.user) return 'dashboard';
  return 'marketing';
}
function selectViewLogged(caller: 'init' | 'recompute', user: unknown, hash: string): View {
  const result = selectView({ user, hash, pathname: window.location.pathname });
  pushViewLog({ t: Date.now(), caller, user: Boolean(user), hash, result });
  return result;
}

export function App() {
  const user = useStore((s) => s.user);
  const acknowledgedDisclaimer = useStore((s) => s.acknowledgedDisclaimer);
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  // Phase 6 Plan 06-02 — migration_state slice + ephemeral error flag. Both
  // null on net-new users so the MigrationModal lazy chunk never loads.
  const migrationState = useStore((s) => s.migration_state);
  const migrationError = useStore((s) => s.migrationError);

  // D-11: dashboard-render fallback gate. True whenever a logged-in user lands
  // on the dashboard without the current disclaimer version acknowledged
  // (covers returning users from before disclaimers existed AND v3→v5 migrants
  // whose acknowledgedDisclaimer defaults to undefined per src/lib/storage.ts).
  const needsDisclaimer = !!user && acknowledgedDisclaimer !== 'v1';

  // Synchronously decide initial view based on hydrated user state + hash.
  const [view, setView] = useState<View>(() =>
    selectViewLogged('init', user, window.location.hash),
  );
  const [aiOpen, setAIOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Keep view aligned to user state + hash + pathname. Phase 9 added
  // path-based routes (/clinic/*, /clinic-invite/*); listen to popstate
  // alongside hashchange so back/forward navigation between clinic and
  // dashboard surfaces refreshes the view.
  useEffect(() => {
    const recompute = (): void =>
      setView(selectViewLogged('recompute', user, window.location.hash));
    recompute();
    window.addEventListener('hashchange', recompute);
    window.addEventListener('popstate', recompute);
    return () => {
      window.removeEventListener('hashchange', recompute);
      window.removeEventListener('popstate', recompute);
    };
  }, [user]);

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

  if (view === 'marketing') {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <Marketing onStart={() => setView('onboarding')} />
      </Suspense>
    );
  }
  if (view === 'onboarding') {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <Onboarding onCancel={() => setView('marketing')} onComplete={() => setView('dashboard')} />
      </Suspense>
    );
  }
  if (view === 'auth') {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <AuthView />
      </Suspense>
    );
  }
  if (view === 'share') {
    // Phase 8 Plan 08-04 — SharePage reads the token from window.location.hash
    // itself; keeps the parser inside the lazy chunk to spare the index budget.
    return (
      <Suspense fallback={<FullPageLoader />}>
        <SharePage />
      </Suspense>
    );
  }
  if (view === 'legal') {
    const LegalPage = selectLegalPage(window.location.hash);
    return (
      <Suspense fallback={<FullPageLoader />}>
        <LegalPage />
      </Suspense>
    );
  }
  // Phase 9 Plan 09-01 — 3 clinic surfaces. Each is its own lazy chunk;
  // Plan 09-02 / 03 / 04 OVERWRITE the stub bodies in place. Routing
  // selection is owned by selectView() above.
  if (view === 'clinic-invite') {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <ClinicInvitePage />
      </Suspense>
    );
  }
  if (view === 'clinic-settings') {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <ClinicSettingsPage />
      </Suspense>
    );
  }
  if (view === 'clinic') {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <ClinicWorkspace />
      </Suspense>
    );
  }
  // Phase 10 Plan 10-05 — drill-in route: /clinic/{slug}/patient/{user_id}.
  // Stub file; Plan 10-07 overwrites ClinicDrillInPage with the real implementation.
  if (view === 'clinic-drill-in') {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <ClinicDrillInPage />
      </Suspense>
    );
  }

  return (
    <>
      <AppShell
        onLogDose={() => setTab('medication')}
        onOpenReport={() => setReportOpen(true)}
        onOpenAI={() => setAIOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
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
