import { Search, Plus, FileDown, Sun, Moon, Menu, Bot } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { TAB_TITLES } from '@/lib/constants';
import { useStore } from '@/lib/store';
import type { TabId } from '@/types';

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
}

export function Topbar({ onLogDose, onOpenReport, onOpenAI }: TopbarProps) {
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  const meta = TAB_TITLES[currentTab];
  const [search, setSearch] = useState('');
  const { theme, toggle } = useTheme();

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
          <Bot className="size-5" />
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
          <span className="hidden sm:inline">Export</span>
        </Button>
        <Button onClick={onLogDose} size="sm" trailingIcon={<Plus className="size-4" />}>
          Log dose
        </Button>
      </div>
      {/* Hidden visual hint for the menu button placement on mobile */}
      <span className="sr-only" aria-hidden>
        <Menu />
      </span>
    </header>
  );
}
