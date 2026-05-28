/*
 * Phase 13 DS-08 / D-12: 72 ↔ 232 px instant snap.
 *
 * INVARIANTS — DO NOT REGRESS:
 *   1. NO `transition` on the width property. var() interpolation requires
 *      @property registration (chat1.md landmine 1); even discrete Tailwind
 *      widths get a hard snap by design.
 *   2. Sidebar stays `position: fixed`. AppShell stays a plain block container
 *      — NO `display:flex` on .app-shell (chat1.md landmine 3).
 *   3. Inner content (wordmark, tab labels, account row) gets a 200ms
 *      opacity fade — gated by useReducedMotion().
 *   4. `data-tour="nav"` MUST remain on the <aside> (GuidedTour reads it).
 */
import { motion } from 'framer-motion';
import {
  Home,
  Syringe,
  ShieldAlert,
  User,
  Apple,
  Activity,
  Pill,
  Smile,
  Trophy,
  Users,
  BookOpen,
  CalendarDays,
  Bot,
  Moon,
  Sun,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/helpers';
import { tabLongLabel } from '@/lib/i18n/nav-labels';
import { useStore } from '@/lib/store';
import type { TabId } from '@/types';

const TABS: { id: TabId; Icon: typeof Home }[] = [
  { id: 'home', Icon: Home },
  { id: 'medication', Icon: Syringe },
  { id: 'symptoms', Icon: ShieldAlert },
  { id: 'body', Icon: User },
  { id: 'nutrition', Icon: Apple },
  { id: 'activity', Icon: Activity },
  { id: 'supplements', Icon: Pill },
  { id: 'mood', Icon: Smile },
  { id: 'insights', Icon: Trophy },
  { id: 'community', Icon: Users },
  // Phase 46 Plan 08 — Classroom (consumer-side course surface).
  // EXCEPTION to the no-new-TabId rule per CONTEXT (see TabId in src/types/index.ts).
  // Nav button below calls setTab('classroom') via the TABS.map iteration.
  { id: 'classroom', Icon: BookOpen },
  // Phase 47 Plan 10 — Events (consumer-side calendar / RSVP / Join Meeting surface).
  // Positioned per D-13 AFTER classroom in the desktop sidebar. EXCEPTION to the
  // no-new-TabId rule per CONTEXT D-13. Nav button below calls setTab('events').
  { id: 'events', Icon: CalendarDays },
];

interface SidebarProps {
  onOpenAI: () => void;
  onOpenSettings: () => void;
  /** Phase 13 DS-08: collapsed (72 px) vs expanded (232 px). Default false. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar({
  onOpenAI,
  onOpenSettings,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const { t } = useTranslation(['nav', 'common']);
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  const userInitial = useStore((s) => s.user?.name?.[0]?.toUpperCase() ?? 'L');
  const userName = useStore((s) => s.user?.name ?? t('common:profile_fallback', 'Profile'));
  const { theme, toggle } = useTheme();
  const reduced = useReducedMotion();

  // Phase 13 DS-08: 200 ms opacity fade on inner content; dropped under reduced-motion.
  const fadeCls = reduced ? '' : 'transition-opacity duration-200 ease-out';
  // Hide-when-collapsed helper for label/wordmark spans.
  const labelHidden = collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100';

  return (
    <aside
      data-tour="nav"
      data-sidebar={collapsed ? 'collapsed' : 'expanded'}
      /* DO NOT animate the width property here — see .planning/design-system/chats/chat1.md
         landmine 1: var() widths cannot be interpolated without @property registration,
         and even discrete Tailwind classes should NOT carry a width transition (DS-08
         mandates an INSTANT snap; inner content gets the 200ms fade instead). */
      className={cn(
        'hidden md:flex fixed top-0 left-0 bottom-0 z-30 flex-col py-5 bg-[var(--color-surface)] border-e border-[var(--color-border)] safe-top',
        collapsed ? 'w-[72px] items-center' : 'w-[232px] items-stretch px-3',
      )}
    >
      <div
        className={cn(
          'flex items-center mb-5',
          collapsed ? 'justify-center' : 'justify-between gap-2',
        )}
      >
        <button
          onClick={() => setTab('home')}
          aria-label="LeanShot home"
          className={cn(
            'inline-flex items-center gap-2 rounded-2xl bg-[var(--color-text)] text-[var(--color-bg)] hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            collapsed ? 'size-12 justify-center' : 'h-12 px-3',
          )}
        >
          {/* Brand mark */}
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
          </svg>
          {!collapsed && (
            <span
              aria-hidden
              className={cn(
                'text-[15px] font-semibold tracking-tight text-[var(--color-bg)]',
                fadeCls,
                labelHidden,
              )}
            >
              LeanShot
            </span>
          )}
        </button>
        {!collapsed && onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            aria-label="Collapse navigation"
            className="size-8 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
          >
            <ChevronsLeft className="size-4" strokeWidth={2} />
          </button>
        )}
      </div>

      <nav
        className={cn(
          'flex-1 flex flex-col gap-1 w-full',
          collapsed ? 'items-center' : 'items-stretch',
        )}
        aria-label="Primary navigation"
      >
        {TABS.map(({ id, Icon }) => {
          const active = currentTab === id;
          const label = tabLongLabel(t, id);
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative rounded-2xl inline-flex items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
                collapsed ? 'size-12 justify-center' : 'h-12 w-full justify-start px-3',
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
              <Icon className="size-5 relative z-10 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
              {!collapsed && (
                <span
                  className={cn('ms-3 text-[13px] font-medium relative z-10', fadeCls, labelHidden)}
                >
                  {label}
                </span>
              )}
              {collapsed && (
                <span className="pointer-events-none absolute left-full ms-3 px-2.5 py-1 rounded-md text-[12px] font-semibold whitespace-nowrap bg-[var(--color-text)] text-[var(--color-bg)] opacity-0 group-hover:opacity-100 transition-opacity z-50">
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div
        className={cn('flex flex-col gap-1 w-full', collapsed ? 'items-center' : 'items-stretch')}
      >
        <button
          onClick={onOpenAI}
          aria-label="Ask LeanShot AI"
          className={cn(
            'group relative rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            collapsed ? 'size-12 justify-center' : 'h-12 w-full justify-start px-3',
          )}
        >
          <Bot className="size-5 shrink-0" strokeWidth={1.8} />
          {!collapsed && (
            <span className={cn('ms-3 text-[13px] font-medium', fadeCls, labelHidden)}>
              {t('nav:ask_ai')}
            </span>
          )}
        </button>
        <button
          onClick={toggle}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className={cn(
            'rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            collapsed ? 'size-12 justify-center' : 'h-12 w-full justify-start px-3',
          )}
        >
          {theme === 'light' ? (
            <Moon className="size-5 shrink-0" strokeWidth={1.8} />
          ) : (
            <Sun className="size-5 shrink-0" strokeWidth={1.8} />
          )}
          {!collapsed && (
            <span className={cn('ms-3 text-[13px] font-medium', fadeCls, labelHidden)}>
              {theme === 'light' ? t('nav:dark_mode') : t('nav:light_mode')}
            </span>
          )}
        </button>
        <button
          onClick={onOpenSettings}
          aria-label="Open settings"
          className={cn(
            'rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            collapsed ? 'size-12 justify-center' : 'h-12 w-full justify-start px-3',
          )}
        >
          <Settings className="size-5 shrink-0" strokeWidth={1.8} />
          {!collapsed && (
            <span className={cn('ms-3 text-[13px] font-medium', fadeCls, labelHidden)}>
              {t('nav:settings')}
            </span>
          )}
        </button>
        <div
          className={cn(
            'h-px bg-[var(--color-border)] my-1.5',
            collapsed ? 'w-6 mx-auto' : 'w-full',
          )}
        />
        <button
          onClick={onOpenSettings}
          aria-label="Open profile"
          className={cn(
            'inline-flex items-center transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            collapsed ? 'size-10 justify-center hover:scale-105' : 'h-12 w-full justify-start px-1',
          )}
        >
          <span
            className={cn(
              'size-10 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] inline-flex items-center justify-center font-bold text-[13px] border-2 border-[var(--color-surface)] shrink-0',
            )}
          >
            {userInitial}
          </span>
          {!collapsed && (
            <span
              className={cn(
                'ms-3 text-[13px] font-medium text-[var(--color-text)] truncate',
                fadeCls,
                labelHidden,
              )}
            >
              {userName}
            </span>
          )}
        </button>
        {collapsed && onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            aria-label="Expand navigation"
            className="mt-1 size-10 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
          >
            <ChevronsRight className="size-4" strokeWidth={2} />
          </button>
        )}
      </div>
    </aside>
  );
}
