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
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/helpers';
import { tabLongLabel, tabShortLabel } from '@/lib/i18n/nav-labels';
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
  // Added as the 11th entry; MobileNav uses overflow-x scroll
  // (className includes `overflow-x-auto scrollbar-none`) so iOS-style
  // strip remains usable without dropping Insights or other tabs.
  // Nav button below calls setTab('classroom') via the TABS.map iteration.
  { id: 'classroom', Icon: BookOpen },
  // Phase 47 Plan 10 — Events (consumer-side calendar / RSVP / Join Meeting surface).
  // 12th entry — overflow-x scroll keeps the strip usable. Positioned per D-13
  // AFTER classroom. Nav button below calls setTab('events').
  { id: 'events', Icon: CalendarDays },
];

/**
 * iOS-native bottom nav.
 *  - glassmorphism + blurred backdrop
 *  - Active tab gets an animated "pill" indicator that slides between
 *    positions (layoutId)
 *  - Horizontal scroll on small screens; otherwise even-spaced
 *  - Honors safe-area-inset-bottom
 */
export function MobileNav() {
  const { t } = useTranslation('nav');
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  return (
    <nav
      aria-label={t('menu_open')}
      className="md:hidden fixed bottom-0 inset-x-0 z-40 px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2"
    >
      <div
        data-tour="mobile-nav"
        className="glass border border-[var(--color-border)] rounded-[28px] shadow-lg overflow-x-auto scrollbar-none"
      >
        <div className="flex justify-between min-w-full px-2 py-1.5">
          {TABS.map(({ id, Icon }) => {
            const active = currentTab === id;
            const label = tabLongLabel(t, id);
            const short = tabShortLabel(t, id);
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className="relative flex-1 min-w-[48px] inline-flex flex-col items-center justify-center gap-0.5 py-1.5 px-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                {active && (
                  <motion.span
                    layoutId="mn-active"
                    className="absolute inset-0 rounded-2xl bg-[var(--color-primary-soft)]"
                    transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                  />
                )}
                <Icon
                  className={cn(
                    'size-5 relative z-10',
                    active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]',
                  )}
                  strokeWidth={active ? 2.2 : 1.8}
                />
                <span
                  className={cn(
                    'relative z-10 text-[10px] font-semibold tracking-tight',
                    active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]',
                  )}
                >
                  {short}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
