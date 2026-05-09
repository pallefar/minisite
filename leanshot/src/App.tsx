import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { AppShell, TabSwitcher } from '@/components/layout/AppShell';
import { GreetingStrip } from '@/components/layout/GreetingStrip';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card } from '@/components/ui/Card';

// Tab content modules — lazy-loaded so the initial bundle stays lean.
const HomeTab = lazy(() => import('@/components/dashboard/tabs/HomeTab').then((m) => ({ default: m.HomeTab })));
const MedicationTab = lazy(() => import('@/components/dashboard/tabs/MedicationTab').then((m) => ({ default: m.MedicationTab })));
const SymptomsTab = lazy(() => import('@/components/dashboard/tabs/SymptomsTab').then((m) => ({ default: m.SymptomsTab })));
const BodyTab = lazy(() => import('@/components/dashboard/tabs/BodyTab').then((m) => ({ default: m.BodyTab })));
const NutritionTab = lazy(() => import('@/components/dashboard/tabs/NutritionTab').then((m) => ({ default: m.NutritionTab })));
const ActivityTab = lazy(() => import('@/components/dashboard/tabs/ActivityTab').then((m) => ({ default: m.ActivityTab })));
const SupplementsTab = lazy(() => import('@/components/dashboard/tabs/SupplementsTab').then((m) => ({ default: m.SupplementsTab })));
const MoodTab = lazy(() => import('@/components/dashboard/tabs/MoodTab').then((m) => ({ default: m.MoodTab })));
const InsightsTab = lazy(() => import('@/components/dashboard/tabs/InsightsTab').then((m) => ({ default: m.InsightsTab })));

const Onboarding = lazy(() => import('@/components/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })));
const Marketing = lazy(() => import('@/components/marketing/Landing').then((m) => ({ default: m.Landing })));

const AIChatPanel = lazy(() => import('@/components/dashboard/ai/AIChatPanel').then((m) => ({ default: m.AIChatPanel })));
const SettingsPage = lazy(() => import('@/components/dashboard/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const DoctorReport = lazy(() => import('@/components/dashboard/modals/DoctorReport').then((m) => ({ default: m.DoctorReport })));

type View = 'marketing' | 'onboarding' | 'dashboard';

export function App() {
  const user = useStore((s) => s.user);
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);

  // Synchronously decide initial view based on hydrated user state.
  const [view, setView] = useState<View>(() => (user ? 'dashboard' : 'marketing'));
  const [aiOpen, setAIOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Keep view aligned to user state once hydrated changes settle.
  useEffect(() => {
    if (user && view !== 'dashboard') setView('dashboard');
    if (!user && view === 'dashboard') setView('marketing');
  }, [user, view]);

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
        <Onboarding
          onCancel={() => setView('marketing')}
          onComplete={() => setView('dashboard')}
        />
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
        {settingsOpen && <SettingsPage open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
        {reportOpen && <DoctorReport open={reportOpen} onClose={() => setReportOpen(false)} />}
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
      <Card span={7} className="min-h-[340px]"><Skeleton className="w-full h-full" /></Card>
      <Card span={5} className="min-h-[340px]"><Skeleton className="w-full h-full" /></Card>
      <Card span={4} className="min-h-[180px]"><Skeleton className="w-full h-full" /></Card>
      <Card span={4} className="min-h-[180px]"><Skeleton className="w-full h-full" /></Card>
      <Card span={4} className="min-h-[180px]"><Skeleton className="w-full h-full" /></Card>
    </div>
  );
}
