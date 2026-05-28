/**
 * Phase 36 Plan 36-03 Task 1 — NPSPromptModal (Surface A).
 *
 * Consumer 5-star rating prompt rendered as a DS Modal (size="sm").
 *
 * Behavioural contract (per 36-UI-SPEC.md Surface A + 36-03-PLAN.md):
 *   - 5 star buttons render inside role="radiogroup" as role="radio" siblings.
 *   - Submit button stays disabled until value >= 1.
 *   - Clicking a star sets the internal value; clicking Submit calls onRate(N).
 *   - Keyboard: ArrowLeft/ArrowRight/Home/End move focus; Enter/Space select.
 *   - Backdrop click + X dismiss BOTH call onDismiss — both count as quota
 *     consumed (D-12). The history INSERT happened server-side at decide-time
 *     so dismissal does not need to re-write history.
 *   - useReducedMotion()=true → no transition utility class on star buttons.
 *
 * V13-3 (CONTEXT D-03/D-21) — see useNPSPromptListener.ts for the
 * unconditional native-review wiring; this consumer modal never imports the
 * native trigger hook nor the native shim, nor the DB client (W9).
 *
 * Forbidden copy (per Surface A spec): no mention of cooldown duration /
 * lifetime cap / "you'll see this again in N days".
 */
import { Star } from 'lucide-react';
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/helpers';

export type NPSRating = 1 | 2 | 3 | 4 | 5;

export interface NPSPromptModalProps {
  /** Render the modal open. Parent controls lifecycle. */
  open: boolean;
  /** Optional copy variant key (currently unused at the UI level; reserved for A/B copy in a later plan). */
  copyVariant?: string;
  /** Called with the selected star value (1..5) on Submit click. */
  onRate: (value: NPSRating) => void;
  /**
   * Called on backdrop click, X click, or ESC. Per D-12, BOTH dismiss paths
   * count as fired prompt — the server-side history INSERT already consumed
   * the quota slot at decide-time, so the modal just emits the close.
   */
  onDismiss: () => void;
}

const STAR_VALUES: readonly NPSRating[] = [1, 2, 3, 4, 5] as const;

export function NPSPromptModal({ open, copyVariant, onRate, onDismiss }: NPSPromptModalProps) {
  // copyVariant is part of the public API for future A/B copy lookup; reference
  // it so `noUnusedParameters` does not fail. The Wave 2 decide payload always
  // includes it even if not yet branched on the client.
  void copyVariant;

  const [value, setValue] = useState<NPSRating | null>(null);
  const reduced = useReducedMotion();
  const starRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusStar = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(STAR_VALUES.length - 1, idx));
    starRefs.current[clamped]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (idx: number) =>
      (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            e.preventDefault();
            focusStar(idx + 1);
            return;
          case 'ArrowLeft':
          case 'ArrowUp':
            e.preventDefault();
            focusStar(idx - 1);
            return;
          case 'Home':
            e.preventDefault();
            focusStar(0);
            return;
          case 'End':
            e.preventDefault();
            focusStar(STAR_VALUES.length - 1);
            return;
          case ' ':
          case 'Enter':
            e.preventDefault();
            setValue(STAR_VALUES[idx]);
            return;
          default:
            return;
        }
      },
    [focusStar],
  );

  const handleSubmit = useCallback((): void => {
    if (value === null) return;
    onRate(value);
  }, [value, onRate]);

  return (
    <Modal
      open={open}
      onClose={onDismiss}
      size="sm"
      dismissible
      mobileFullscreen={false}
      title="How likely are you to recommend LeanShot to a friend?"
    >
      <div className="flex flex-col gap-5">
        <p className="text-base text-[var(--color-text-secondary)]">
          Your feedback helps us improve. Takes 5 seconds.
        </p>

        <div
          role="radiogroup"
          aria-label="How likely are you to recommend LeanShot? 1 to 5 stars."
          className="flex items-center justify-center gap-1"
        >
          {STAR_VALUES.map((n, idx) => {
            const filled = value !== null && n <= value;
            const checked = value === n;
            return (
              <button
                key={n}
                ref={(el) => {
                  starRefs.current[idx] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={`Rate ${n} of 5 stars`}
                tabIndex={checked || (value === null && idx === 0) ? 0 : -1}
                onClick={() => setValue(n)}
                onKeyDown={onKeyDown(idx)}
                className={cn(
                  'inline-flex items-center justify-center min-w-11 min-h-11 rounded-pill',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                  filled
                    ? 'text-[var(--color-primary)]'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-primary)]',
                  !reduced && 'transition-colors duration-200',
                )}
              >
                <Star size={28} fill={filled ? 'currentColor' : 'none'} aria-hidden />
              </button>
            );
          })}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="primary" disabled={value === null} onClick={handleSubmit}>
            Submit rating
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default NPSPromptModal;
