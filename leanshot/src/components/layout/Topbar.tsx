import { Search, Plus, FileDown, Sun, Moon, Menu, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { AIAvatar } from '@/illustrations/AIAvatar';
// Phase 42 Plan 42-09 — useChangelog drives the avatar unread-dot indicator.
// The WhatsNewDrawer itself is React.lazy-mounted from App.tsx so the
// react-markdown + dompurify + rehype-raw chunk stays off the index
// static graph (Pitfall 9; bundle-budget enforces ≤50 kB gz on `index`).
import { useChangelog } from '@/lib/changelog/changelog-store';
import { TAB_TITLES } from '@/lib/constants';
import { useStore } from '@/lib/store';
import type { TabId } from '@/types';
import { AvatarMenu } from './AvatarMenu';

const TAB_VALUES = new Set<string>([
  'home',
  'medication',
  'symptoms',
  'body',
  'nutrition',
  'activity',
  'supplements',
  'mood',
  'insights',
]);

interface TopbarProps {
  onLogDose: () => void;
  onOpenReport: () => void;
  onOpenAI: () => void;
  /** Phase 5 D-04: AvatarMenu surfaces Account/Settings which both route through here. */
  onOpenSettings?: () => void;
  /** Phase 42 Plan 42-09 (POLISH-11) — opens the lazy-loaded What's New drawer. */
  onOpenWhatsNew?: () => void;
}

export function Topbar({
  onLogDose,
  onOpenReport,
  onOpenAI,
  onOpenSettings,
  onOpenWhatsNew,
}: TopbarProps) {
  const { t } = useTranslation(['nav', 'common']);
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  const meta = TAB_TITLES[currentTab];
  const [search, setSearch] = useState('');
  const { theme, toggle } = useTheme();
  // Phase 42 Plan 42-09 — drives the avatar unread-dot indicator. Hook
  // short-circuits to {hasUnread:false, entries:[]} when there is no
  // session, so the dot is silent on the marketing/onboarding views.
  const { hasUnread, entries } = useChangelog();
  const unreadCount = entries.length;
  const whatsNewAriaLabel = hasUnread ? `What's new — ${unreadCount} unread updates` : "What's new";

  const handleSearch = (q: string): void => {
    setSearch(q);
    const map: Record<string, string> = {
      weight: 'body',
      injection: 'medication',
      shot: 'medication',
      dose: 'medication',
      symptom: 'symptoms',
      side: 'symptoms',
      nausea: 'symptoms',
      meal: 'nutrition',
      food: 'nutrition',
      protein: 'nutrition',
      water: 'nutrition',
      workout: 'activity',
      step: 'activity',
      supp: 'supplements',
      vitamin: 'supplements',
      mood: 'mood',
      sleep: 'mood',
      win: 'insights',
      report: 'insights',
    };
    const key = q.toLowerCase().trim();
    if (!key) return;
    for (const [k, tab] of Object.entries(map)) {
      if (key.includes(k)) {
        if (TAB_VALUES.has(tab)) {
          setTab(tab as TabId);
        }
        setSearch('');
        return;
      }
    }
  };

  return (
    <header className="flex items-start md:items-center justify-between gap-3 mb-5 md:mb-6 flex-wrap">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight leading-tight">
          {meta.title}
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5 truncate">{meta.sub}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="hidden md:flex items-center gap-2 px-4 py-2.5 rounded-pill bg-[var(--color-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)] transition-shadow min-w-[220px]">
          <Search className="size-4 text-[var(--color-text-tertiary)]" />
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Jump to weight, food, mood…"
            className="bg-transparent border-none outline-none flex-1 text-[13px] placeholder:text-[var(--color-text-tertiary)]"
            aria-label="Search across the app"
          />
        </div>
        <IconButton
          aria-label="Ask AI"
          onClick={onOpenAI}
          variant="ghost"
          size="sm"
          className="md:hidden"
        >
          <AIAvatar size={20} />
        </IconButton>
        <IconButton
          aria-label="Open menu"
          variant="ghost"
          size="sm"
          className="md:hidden"
          onClick={toggle}
        >
          {theme === 'light' ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </IconButton>
        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenReport}
          leadingIcon={<FileDown className="size-4" />}
        >
          <span className="hidden sm:inline">{t('nav:export', 'Export')}</span>
        </Button>
        <Button onClick={onLogDose} size="sm" trailingIcon={<Plus className="size-4" />}>
          {t('nav:fab_log_dose')}
        </Button>
        {/* Phase 42 Plan 42-09 (POLISH-11) — What's New trigger with unread dot.
            The button sits BEFORE AvatarMenu so the dot rides on the changelog
            affordance (not the profile menu). aria-label switches between
            generic + count-bearing variants so AT users hear the unread state. */}
        {onOpenWhatsNew && (
          <IconButton
            aria-label={whatsNewAriaLabel}
            onClick={onOpenWhatsNew}
            variant="ghost"
            size="sm"
            className="relative"
          >
            <Sparkles className="size-5" aria-hidden="true" />
            {hasUnread && (
              <span
                data-testid="whats-new-unread-dot"
                aria-hidden="true"
                className="absolute top-1 right-1 size-2 rounded-full bg-[var(--color-primary)] ring-2 ring-[var(--color-bg)]"
              />
            )}
          </IconButton>
        )}
        <AvatarMenu onOpenSettings={onOpenSettings} />
      </div>
      {/* Hidden visual hint for the menu button placement on mobile */}
      <span className="sr-only" aria-hidden>
        <Menu />
      </span>
    </header>
  );
}
