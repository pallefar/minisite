import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { lazy, Suspense, useEffect, useState } from 'react';
import { DisclaimerModal } from '@/components/dashboard/DisclaimerModal';
import { AppShell, TabSwitcher } from '@/components/layout/AppShell';
import { GreetingStrip } from '@/components/layout/GreetingStrip';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { track } from '@/lib/analytics';
import {
  enqueueLocalInjectionsForSync,
  runAnonPromotionMigrationIfNeeded,
  setLastWasAnon,
} from '@/lib/auth-migration';
import {
  removeUserNamespace,
  renameStorageNamespace,
  setActiveStorageUserId,
} from '@/lib/storage';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import {
  flushSyncQueue,
  pullInitialInjections,
  subscribeInjections,
  unsubscribeInjections,
} from '@/lib/sync';

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

  // D-11: dashboard-render fallback gate. True whenever a logged-in user lands
  // on the dashboard without the current disclaimer version acknowledged
  // (covers returning users from before disclaimers existed AND v3→v5 migrants
  // whose acknowledgedDisclaimer defaults to undefined per src/lib/storage.ts).
  const needsDisclaimer = !!user && acknowledgedDisclaimer !== 'v1';

  // Synchronously decide initial view based on hydrated user state + hash.
  const [view, setView] = useState<View>(() =>
    selectView({ user, hash: window.location.hash }),
  );
  const [aiOpen, setAIOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Keep view aligned to user state + hash.
  useEffect(() => {
    const recompute = (): void =>
      setView(selectView({ user, hash: window.location.hash }));
    recompute();
    window.addEventListener('hashchange', recompute);
    return () => window.removeEventListener('hashchange', recompute);
  }, [user]);

  // Phase 5 D-01/D-13: top-level onAuthStateChange subscription. ONE for the
  // whole app — components consume `signedIn` via the Zustand slice rather
  // than holding their own subscriptions.
  //
  // Critical Gotcha #1 (RESEARCH §Pattern 3): the supabase-js docs forbid
  // calling supabase.* from a synchronous onAuthStateChange callback (lock
  // deadlock). Defer every dispatch via `setTimeout(fn, 0)`.
  //
  // Critical Gotcha #9 (StrictMode): cleanup function MUST call
  // `data.subscription.unsubscribe()`. StrictMode double-mounts the effect
  // in dev → without cleanup, two live subscriptions remain and every event
  // dispatches twice.
  useEffect(() => {
    const handleAuthEvent = async (
      event: AuthChangeEvent,
      session: Session | null,
    ): Promise<void> => {
      switch (event) {
        case 'INITIAL_SESSION': {
          useStore.getState().setSession(session);
          setLastWasAnon(Boolean(session?.user?.is_anonymous));
          if (
            session?.user &&
            !session.user.is_anonymous &&
            session.user.email_confirmed_at
          ) {
            // Phase 5 G2 (Plan 05-05): route all subsequent persist writes to
            // this user's namespaced key. MUST precede renameStorageNamespace
            // so the post-migration hydrate-rewrite lands in the namespace,
            // not the universal key. M4 in store.test.ts locks this contract.
            await setActiveStorageUserId(session.user.id);
            await renameStorageNamespace(session.user.id);
            await runAnonPromotionMigrationIfNeeded(session.user.id);
            enqueueLocalInjectionsForSync();
            // Phase 5 D-09/D-13: explicit initial pull BEFORE subscribe (Pitfall #5
            // — postgres_changes does NOT replay history); then subscribe; then
            // drain any pendingOps that accumulated while offline.
            await pullInitialInjections(session.user.id);
            subscribeInjections(session.user.id);
            await flushSyncQueue();
          }
          break;
        }
        case 'SIGNED_IN': {
          useStore.getState().setSession(session);
          if (
            session?.user &&
            !session.user.is_anonymous &&
            session.user.email_confirmed_at
          ) {
            // Phase 5 G2 (Plan 05-05): see INITIAL_SESSION above — same
            // ordering contract: setActiveStorageUserId BEFORE
            // renameStorageNamespace. M4 in store.test.ts locks this contract.
            await setActiveStorageUserId(session.user.id);
            await renameStorageNamespace(session.user.id);
            await runAnonPromotionMigrationIfNeeded(session.user.id);
            enqueueLocalInjectionsForSync();
            // See INITIAL_SESSION above — same triplet (pull → subscribe → flush).
            await pullInitialInjections(session.user.id);
            subscribeInjections(session.user.id);
            await flushSyncQueue();
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
          await unsubscribeInjections();
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

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        void handleAuthEvent(event, session);
      }, 0);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // Phase 5 D-10 / RESEARCH §6 line 887 — when the browser reports the
  // network is back, drain `pendingOps`. `flushSyncQueue` is idempotent and
  // re-checks `isSyncEnabled()` (D-13) so this listener is safe to fire while
  // signed-out or unverified.
  useEffect(() => {
    const onOnline = (): void => {
      void flushSyncQueue();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // Auto-mint anonymous session when the user lands on the dashboard without
  // any session (RESEARCH §12 Q5). This ensures AvatarMenu always has a user
  // to render and Phase 4's AI Coach `signInAnonymously` first-call gating
  // (which is still inside AIChatPanel) does not race the auth subscriber.
  useEffect(() => {
    if (view !== 'dashboard') return;
    const current = useStore.getState().signedIn;
    if (current?.user) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) return;
      // Best-effort; ignore errors — AI Coach will retry on its own.
      void supabase.auth.signInAnonymously().then(() => setLastWasAnon(true));
    });
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
