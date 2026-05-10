import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useStore } from '@/lib/store';

const TOUR_KEY = 'leanshot_tour_seen_v4';

interface TourStep {
  selector: string;
  /** Mobile-only fallback selector when the main one is off-screen. */
  mobileSelector?: string;
  title: string;
  body: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="hero"]',
    title: 'Your hero card',
    body: 'At-a-glance summary — total lost, current phase, today\'s protein, and your titration timeline.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="glp"]',
    title: 'GLP-1 medication level',
    body: 'A real pharmacokinetic curve based on your medication\'s half-life. Circles mark each shot. The pill tells you when the next one is due.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="focus"]',
    title: 'Today\'s focus',
    body: 'Just the single most important thing today. Tap the button to jump straight there.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="sites"]',
    title: 'Injection site rotation',
    body: 'Coral = recent, amber = 2 weeks ago, green = where to inject next.',
    placement: 'top',
  },
  {
    selector: '[data-tour="symptoms"]',
    title: 'Spot side-effect patterns',
    body: 'Tap "Log" to record how you feel. Recurring patterns surface here automatically.',
    placement: 'top',
  },
  {
    selector: '[data-tour="nav"]',
    mobileSelector: '[data-tour="mobile-nav"]',
    title: 'Navigate everything',
    body: 'Eight more tabs. The bot icon is your AI coach. The cog is settings.',
    placement: 'right',
  },
];

export function GuidedTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setTab = useStore((s) => s.setTab);
  const [step, setStep] = useState(0);
  const [position, setPosition] = useState<{ rect: DOMRect; placement: TourStep['placement'] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('home');
    setStep(0);
  }, [open, setTab]);

  useEffect(() => {
    if (!open) return;
    const compute = (): void => {
      const s = STEPS[step];
      if (!s) return;
      const isMobile = window.innerWidth <= 768;
      const sel = isMobile && s.mobileSelector ? s.mobileSelector : s.selector;
      const target = document.querySelector(sel) as HTMLElement | null;
      if (!target) {
        setPosition(null);
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      window.setTimeout(() => {
        const r = target.getBoundingClientRect();
        setPosition({ rect: r, placement: s.placement });
      }, 320);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step]!;

  const finish = (): void => {
    try {
      localStorage.setItem(TOUR_KEY, '1');
    } catch {
      /* noop */
    }
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[150] pointer-events-none"
        role="dialog"
        aria-label="Guided tour"
      >
        {/* Backdrop with cutout via inverse box-shadow */}
        <div className="absolute inset-0 bg-black/55 pointer-events-auto" onClick={finish} />

        {position && (
          <>
            <motion.div
              initial={false}
              animate={{
                top: position.rect.top - 8,
                left: position.rect.left - 8,
                width: position.rect.width + 16,
                height: position.rect.height + 16,
              }}
              transition={{ duration: 0.32, ease: [0.25, 1, 0.5, 1] }}
              className="absolute rounded-[18px] border-2 border-white/40 pointer-events-none"
              style={{ boxShadow: '0 0 0 9999px rgba(11,20,19,0.55)' }}
            />
            <Tooltip rect={position.rect} placement={position.placement} step={step} total={STEPS.length} title={s.title} body={s.body}
              onPrev={() => setStep((x) => Math.max(0, x - 1))}
              onNext={() => (step >= STEPS.length - 1 ? finish() : setStep((x) => x + 1))}
              onSkip={finish}
            />
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

interface TooltipProps {
  rect: DOMRect;
  placement: TourStep['placement'];
  step: number;
  total: number;
  title: string;
  body: string;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}
function Tooltip({ rect, placement, step, total, title, body, onPrev, onNext, onSkip }: TooltipProps) {
  const ttW = Math.min(320, window.innerWidth - 32);
  const margin = 18;
  let top: number;
  let left: number;

  if (placement === 'top' && rect.top > 220 + margin) {
    top = rect.top - 220 - margin;
    left = rect.left + rect.width / 2 - ttW / 2;
  } else if (placement === 'right' && rect.right + ttW + margin < window.innerWidth) {
    top = rect.top;
    left = rect.right + margin;
  } else if (placement === 'left' && rect.left - ttW - margin > 0) {
    top = rect.top;
    left = rect.left - ttW - margin;
  } else {
    top = rect.bottom + margin;
    left = rect.left + rect.width / 2 - ttW / 2;
  }

  // Clamp
  left = Math.max(16, Math.min(left, window.innerWidth - ttW - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - 240));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
      style={{ top, left, width: ttW }}
      className="absolute pointer-events-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[18px] shadow-xl p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-primary)] bg-[var(--color-primary-soft)] px-2 py-1 rounded-pill">
          Step {step + 1} of {total}
        </span>
        <button
          onClick={onSkip}
          aria-label="Skip tour"
          className="size-7 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <X className="size-4" />
        </button>
      </div>
      <h3 className="text-[16px] font-bold tracking-tight mb-1">{title}</h3>
      <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug mb-3">{body}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-pill transition-all duration-300 ${
                i === step ? 'w-5 bg-[var(--color-primary)]' : 'w-1.5 bg-[var(--color-border)]'
              }`}
            />
          ))}
        </div>
        <div className="flex gap-1.5">
          {step > 0 && (
            <Button variant="ghost" size="sm" onClick={onPrev} leadingIcon={<ArrowLeft className="size-4" />}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={onNext} trailingIcon={step >= total - 1 ? undefined : <ArrowRight className="size-4" />}>
            {step >= total - 1 ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function shouldShowTour(): boolean {
  try {
    return !localStorage.getItem(TOUR_KEY);
  } catch {
    return false;
  }
}

export function clearTourSeen(): void {
  try {
    localStorage.removeItem(TOUR_KEY);
  } catch {
    /* noop */
  }
}
