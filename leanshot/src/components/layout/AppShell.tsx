import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { QuickLogSheet } from '@/components/dashboard/QuickLogSheet';
import { Toast } from '@/components/ui/Toast';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

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
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <Sidebar onOpenAI={onOpenAI} onOpenSettings={onOpenSettings} />
      <main className="md:ml-[80px] pt-5 md:pt-7 pb-[140px] md:pb-12 px-4 md:px-7 max-w-[1280px] mx-auto">
        <Topbar onLogDose={onLogDose} onOpenReport={onOpenReport} onOpenAI={onOpenAI} />
        {children}
      </main>
      <MobileNav />
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
