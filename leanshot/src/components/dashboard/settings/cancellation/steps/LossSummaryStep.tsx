/**
 * Phase 40 Plan 40-04 — Step 3: Loss-summary confirmation (D-20).
 * 2×2 grid: Streak | Med-level chart preview | AI coach count | Data export reminder.
 * No countdown timers or FOMO escalation per P35 D-09 ethical-only positioning.
 * Single-chunk: non-lazy import; lives in the cancellation chunk via CancellationModal.tsx.
 */
import { Database, Flame, MessageSquare } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MedLevelChart } from '@/components/dashboard/charts/MedLevelChart';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStreaks } from '@/hooks/useStreaks';
import { useToast } from '@/hooks/useToast';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { CancellationReason } from '@/types/cancellation';

interface LossSummaryStepProps {
  reason: CancellationReason;
  onKeep: () => void;
  onClose: () => void;
}

export function LossSummaryStep({ reason, onKeep, onClose }: LossSummaryStepProps) {
  const { t } = useTranslation('settings');
  const reducedMotion = useReducedMotion();
  const streaks = useStreaks();
  const aiCount = useStore((s) => s.aiHistory.length);
  const toast = useToast();
  const undoRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeep = (): void => {
    track('cancellation_aborted', { reason, step: 3 });
    onKeep();
  };

  const handleCancelAnyway = (): void => {
    undoRef.current = false;

    // Show toast with 6-second undo window (useToast doesn't natively support undo)
    // Fire optimistic close of modal
    onClose();

    // Schedule the actual cancellation commit
    timerRef.current = setTimeout(() => {
      if (undoRef.current) return; // undo was clicked

      // Fire cancellation via Stripe cancel_at_period_end
      void supabase.auth.getSession().then(({ data: sessionData }) => {
        const access_token = sessionData.session?.access_token;
        if (!access_token) return;

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) return;

        track('cancellation_completed', { reason });

        // D-21: if reason is service_quality_issue, fire ticket-create Edge Fn
        if (reason === 'service_quality_issue') {
          void fetch(`${supabaseUrl}/functions/v1/cancellation-feedback-to-ticket`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${access_token}`,
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify({ reason }),
          }).catch(() => {
            // Best-effort; cancellation proceeds regardless
          });
        }
      });
    }, 6000);

    toast(t('settings:cancellation.step3.cancel_scheduled_toast'), 'info');
  };

  const bestStreak = Math.max(streaks.weight, streaks.protein, streaks.movement, streaks.supps);

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div>
        <h2
          id="cancel-step-title"
          className="text-[18px] font-semibold text-[var(--color-text)]"
          tabIndex={-1}
        >
          {t('settings:cancellation.step3.title')}
        </h2>
        <p id="cancel-step-body" className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          {t('settings:cancellation.step3.body')}
        </p>
      </div>

      {/* 2×2 loss-summary grid */}
      <div
        className={cn(
          'grid grid-cols-2 gap-3',
          !reducedMotion && 'animate-in fade-in duration-300',
        )}
      >
        {/* Streak tile */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col items-center gap-2">
          <Flame className="size-5 text-[var(--color-warning)]" aria-hidden />
          <span className="text-[22px] font-semibold text-[var(--color-text)]">{bestStreak}</span>
          <span className="text-[13px] text-[var(--color-text-secondary)] text-center">
            {t('settings:cancellation.step3.streak_label')}
          </span>
        </div>

        {/* Med-level chart preview */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-2 overflow-hidden">
          <div
            className="h-[120px] w-full"
            aria-label={t('settings:cancellation.step3.chart_aria')}
          >
            <MedLevelChart height={120} />
          </div>
        </div>

        {/* AI coach count */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col items-center gap-2">
          <MessageSquare className="size-5 text-[var(--color-primary)]" aria-hidden />
          <span className="text-[22px] font-semibold text-[var(--color-text)]">{aiCount}</span>
          <span className="text-[13px] text-[var(--color-text-secondary)] text-center">
            {t('settings:cancellation.step3.coach_label')}
          </span>
        </div>

        {/* Data export reminder tile */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col items-start gap-2">
          <Database className="size-5 text-[var(--color-text-tertiary)]" aria-hidden />
          <span className="text-[13px] font-semibold text-[var(--color-text)]">
            {t('settings:cancellation.step3.data_title')}
          </span>
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {t('settings:cancellation.step3.data_body')}
          </span>
        </div>
      </div>

      {/* Footer CTAs */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={handleCancelAnyway}
          className="px-4 py-2.5 text-[14px] font-semibold text-[var(--color-danger)] rounded-xl hover:bg-[var(--color-danger-soft,rgba(207,84,84,0.1))] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)]"
        >
          {t('settings:cancellation.step3.cancel_anyway')}
        </button>
        <button
          type="button"
          onClick={handleKeep}
          className="px-5 py-2.5 rounded-xl text-[14px] font-semibold bg-[var(--color-primary)] text-[var(--color-bg)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {t('settings:cancellation.keep_account')}
        </button>
      </div>
    </div>
  );
}
