import { Home, Syringe, ShieldAlert, User, Apple, Activity, Pill, Smile, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/helpers';
import type { TabId } from '@/types';

const TABS: { id: TabId; label: string; short: string; Icon: typeof Home }[] = [
  { id: 'home',        label: 'Today',        short: 'Today', Icon: Home },
  { id: 'medication',  label: 'Medication',   short: 'Shot',  Icon: Syringe },
  { id: 'symptoms',    label: 'Side effects', short: 'Sx',    Icon: ShieldAlert },
  { id: 'body',        label: 'Body',         short: 'Body',  Icon: User },
  { id: 'nutrition',   label: 'Nutrition',    short: 'Food',  Icon: Apple },
  { id: 'activity',    label: 'Activity',     short: 'Move',  Icon: Activity },
  { id: 'supplements', label: 'Stack',        short: 'Stack', Icon: Pill },
  { id: 'mood',        label: 'Mood',         short: 'Mood',  Icon: Smile },
  { id: 'insights',    label: 'Wins',         short: 'Wins',  Icon: Trophy },
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
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  return (
    <nav
      aria-label="Primary navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2"
    >
      <div data-tour="mobile-nav" className="glass border border-[var(--color-border)] rounded-[28px] shadow-lg overflow-x-auto scrollbar-none">
        <div className="flex justify-between min-w-full px-2 py-1.5">
          {TABS.map(({ id, short, Icon, label }) => {
            const active = currentTab === id;
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
                  className={cn('size-5 relative z-10', active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]')}
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
