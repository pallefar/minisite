import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Beef, Syringe, Scale, PackageOpen, PillBottle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { pickFocus } from '@/lib/insights';
import { initialState } from '@/lib/storage';
import { useStore } from '@/lib/store';
import type { TabId } from '@/types';

const ICON_MAP = {
  Sparkles,
  Beef,
  Syringe,
  Scale,
  PackageOpen,
  PillBottle,
};

/**
 * Daily Focus card — picks the single most important action today,
 * given the user's data. One tap takes you there.
 */
export function FocusCard() {
  const { t } = useTranslation('patient');
  const setTab = useStore((s) => s.setTab);
  // pickFocus returns a fresh object each call, so calling it inside the selector
  // makes Zustand's useSyncExternalStore snapshot unstable (infinite render loop).
  // Subscribe to the raw slices it reads, then memoize the derivation.
  const user = useStore((s) => s.user);
  const injections = useStore((s) => s.injections);
  const vials = useStore((s) => s.vials);
  const meals = useStore((s) => s.meals);
  const supplements = useStore((s) => s.supplements);
  const weights = useStore((s) => s.weights);
  const focus = useMemo(
    () => pickFocus({ ...initialState, user, injections, vials, meals, supplements, weights }),
    [user, injections, vials, meals, supplements, weights],
  );
  const Icon = (ICON_MAP as Record<string, typeof Sparkles>)[focus.icon] ?? Sparkles;

  return (
    <Card
      span={12}
      variant="elevated"
      className="bg-[var(--color-primary-soft)] border-[var(--color-primary-soft)]"
      data-tour="focus"
    >
      <div className="flex items-start gap-4">
        <motion.span
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 18, stiffness: 240 }}
          className="size-12 rounded-2xl bg-[var(--color-primary)] text-[var(--color-primary-foreground)] inline-flex items-center justify-center shrink-0 shadow-md"
        >
          <Icon className="size-5" strokeWidth={1.9} />
        </motion.span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-primary)]">
            {t('patient:card.focus.label')}
          </p>
          <h2 className="text-[18px] md:text-[20px] font-bold leading-tight tracking-tight mt-0.5">
            {focus.title}
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] mt-1.5 max-w-[60ch] leading-snug">
            {focus.body}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setTab(focus.cta.tab as TabId)}
          trailingIcon={<ArrowRight className="size-4" />}
          className="shrink-0 hidden sm:inline-flex"
        >
          {focus.cta.label}
        </Button>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => setTab(focus.cta.tab as TabId)}
        trailingIcon={<ArrowRight className="size-4" />}
        className="mt-3 sm:hidden"
        block
      >
        {focus.cta.label}
      </Button>
    </Card>
  );
}
