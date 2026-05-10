import {
  Home, Syringe, ShieldAlert, User, Apple, Activity, Pill, Smile, Trophy,
  Bot, Moon, Sun, Settings,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { useTheme } from '@/hooks/useTheme';
import type { TabId } from '@/types';
import { cn } from '@/lib/helpers';
import { motion } from 'framer-motion';

const TABS: { id: TabId; label: string; Icon: typeof Home }[] = [
  { id: 'home',        label: 'Today',       Icon: Home },
  { id: 'medication',  label: 'Medication',  Icon: Syringe },
  { id: 'symptoms',    label: 'Side effects', Icon: ShieldAlert },
  { id: 'body',        label: 'Body',         Icon: User },
  { id: 'nutrition',   label: 'Nutrition',    Icon: Apple },
  { id: 'activity',    label: 'Activity',     Icon: Activity },
  { id: 'supplements', label: 'Stack',        Icon: Pill },
  { id: 'mood',        label: 'Mood',         Icon: Smile },
  { id: 'insights',    label: 'Wins',         Icon: Trophy },
];

interface SidebarProps {
  onOpenAI: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenAI, onOpenSettings }: SidebarProps) {
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  const userInitial = useStore((s) => s.user?.name?.[0]?.toUpperCase() ?? 'L');
  const { theme, toggle } = useTheme();

  return (
    <aside data-tour="nav" className="hidden md:flex fixed top-0 left-0 bottom-0 z-30 w-[80px] flex-col items-center py-5 bg-[var(--color-surface)] border-r border-[var(--color-border)] safe-top">
      <button
        onClick={() => setTab('home')}
        aria-label="LeanShot home"
        className="size-12 rounded-2xl bg-[var(--color-text)] text-[var(--color-bg)] inline-flex items-center justify-center mb-5 hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        {/* Brand mark */}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
        </svg>
      </button>

      <nav className="flex-1 flex flex-col gap-1 items-center w-full" aria-label="Primary navigation">
        {TABS.map(({ id, label, Icon }) => {
          const active = currentTab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative size-12 rounded-2xl inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
                active
                  ? 'text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]',
              )}
            >
              {active && (
                <motion.span
                  layoutId="sb-active"
                  className="absolute inset-0 rounded-2xl bg-[var(--color-primary)] shadow-[0_4px_12px_rgba(27,72,66,0.25)]"
                  transition={{ type: 'spring', damping: 22, stiffness: 320 }}
                />
              )}
              <Icon className="size-5 relative z-10" strokeWidth={active ? 2.2 : 1.8} />
              <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1 rounded-md text-[12px] font-semibold whitespace-nowrap bg-[var(--color-text)] text-[var(--color-bg)] opacity-0 group-hover:opacity-100 transition-opacity z-50">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 items-center w-full">
        <button
          onClick={onOpenAI}
          aria-label="Ask LeanShot AI"
          className="group relative size-12 rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <Bot className="size-5" strokeWidth={1.8} />
        </button>
        <button
          onClick={toggle}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="size-12 rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {theme === 'light' ? <Moon className="size-5" strokeWidth={1.8} /> : <Sun className="size-5" strokeWidth={1.8} />}
        </button>
        <button
          onClick={onOpenSettings}
          aria-label="Open settings"
          className="size-12 rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <Settings className="size-5" strokeWidth={1.8} />
        </button>
        <div className="w-6 h-px bg-[var(--color-border)] my-1.5" />
        <button
          onClick={onOpenSettings}
          aria-label="Open profile"
          className="size-10 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] inline-flex items-center justify-center font-bold text-[13px] border-2 border-[var(--color-surface)] hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {userInitial}
        </button>
      </div>
    </aside>
  );
}
