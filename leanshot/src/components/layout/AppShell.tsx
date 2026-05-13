import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { EmailVerificationBanner } from '@/components/auth/EmailVerificationBanner';
import { QuickLogSheet } from '@/components/dashboard/QuickLogSheet';
import { Toast } from '@/components/ui/Toast';
import { cn } from '@/lib/helpers';
import { LegalFooter } from './LegalFooter';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export interface AppShellProps {
  children: ReactNode;
  onLogDose: () => void;
  onOpenReport: () => void;
  onOpenAI: () => void;
  onOpenSettings: () => void;
}

export function AppShell({
  children,
  onLogDose,
  onOpenReport,
  onOpenAI,
  onOpenSettings,
}: AppShellProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Phase 13 DS-08 / D-12: sidebar collapsed state. Internal only — not exposed
  // on AppShellProps. Sidebar handles its own 72↔232 px instant snap; <main>
  // tracks the matching left-margin (NEVER on a CSS transition — chat1.md
  // landmines 1 + 3). Outer wrapper stays a plain block — DO NOT add `flex`.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <Sidebar
        onOpenAI={onOpenAI}
        onOpenSettings={onOpenSettings}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      />
      <main
        className={cn(
          'pt-5 md:pt-7 pb-[140px] md:pb-12 px-4 md:px-7 max-w-[1280px] mx-auto',
          sidebarCollapsed ? 'md:ml-[72px]' : 'md:ml-[232px]',
        )}
        data-testid="dashboard"
      >
        {/* Phase 9 Plan 09-08 — WorkspaceSwitcher (D-09 + D-14 single-identity affordance).
            Mounted above the topbar so Pitfall #8's "one auth.users + relationship-table
            contexts" invariant is visible on every authenticated route. The switcher
            self-defers until supabase.auth.getSession() resolves (Pitfall #9) and
            auto-hides on anonymous routes. */}
        <div className="mb-3 md:mb-4">
          <WorkspaceSwitcher />
        </div>
        <Topbar
          onLogDose={onLogDose}
          onOpenReport={onOpenReport}
          onOpenAI={onOpenAI}
          onOpenSettings={onOpenSettings}
        />
        <EmailVerificationBanner />
        {children}
      </main>
      <MobileNav />
      {/* Phase 7 Plan 07-02 — Conspicuous legal-link footer for the
          authenticated SPA (researcher OQ#7 + WMHMDA RCW 19.373.030(1)(b)
          applied to the in-app homepage). Rendered AFTER MobileNav so the
          mb-[80px] on mobile clears the fixed bottom nav; on desktop the
          footer flows inline below <main>. The FAB below is `fixed` and so
          floats independently of document order. */}
      <LegalFooter variant="app" />
      {/* Mobile-only floating quick-log FAB */}
      <button
        onClick={() => setSheetOpen(true)}
        aria-label="Quick log"
        className="md:hidden fixed bottom-[calc(76px+env(safe-area-inset-bottom,0))] right-4 z-50 size-14 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] inline-flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
      >
        <Plus className="size-6" strokeWidth={2.4} />
      </button>
      <QuickLogSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onOpenAI={onOpenAI} />
      <Toast />
    </div>
  );
}

/** Light wrapper for tab content to give framer-motion a stable container. */
export function TabSwitcher({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  return <Wrapped key={tabKey}>{children}</Wrapped>;
}

function Wrapped({ children }: { children: ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
