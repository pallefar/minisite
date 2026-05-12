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

type View = 'marketing' | 'onboarding' | 'auth' | 'dashboard';

/**
 * Phase 5 D-01: view selector. Hash priority — any `#/auth/*` route forces
 * the auth view regardless of other state. Otherwise the existing
 * `user`-presence rule decides marketing vs dashboard.
 */
function selectView(opts: { user: unknown; hash: string }): View {
  if (opts.hash.startsWith('#/auth/')) return 'auth';
  if (opts.user) return 'dashboard';
  return 'marketing';
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
  const [view, setView] = useState<View>(() => selectView({ user, hash: window.location.hash }));
  const [aiOpen, setAIOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Keep view aligned to user state + hash.
  useEffect(() => {
    const recompute = (): void => setView(selectView({ user, hash: window.location.hash }));
    recompute();
    window.addEventListener('hashchange', recompute);
    return () => window.removeEventListener('hashchange', recompute);
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
  useEffect(() => {
    if (view !== 'dashboard') return;
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
