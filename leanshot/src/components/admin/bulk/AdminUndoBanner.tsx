/**
 * Phase 27 Plan 27-01 — AdminUndoBanner (ADMIN-04).
 *
 * Fixed-bottom toast with 60-second visual countdown ring + Undo button.
 *
 * Behaviour:
 *   - Mounted only when an undo_token was returned by the execute RPC
 *     (parent passes via `onUndoAvailable` callback).
 *   - Countdown ring uses ProgressRing primitive; starts at 60s remaining,
 *     drains to 0, then auto-dismisses.
 *   - Undo click → redeemUndoToken → on success toast 'Reversed' + dismiss;
 *     on token_expired → toast 'Undo window expired' + dismiss.
 *   - role="status" + aria-live="polite" so screen readers announce arrival
 *     without trapping focus (per leanshot/CLAUDE.md accessibility section).
 *   - Server-side TTL is the source of truth — this is UX only.
 */
import { Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { useToast } from '@/hooks/useToast';
import { BulkApiError, type BulkActionType } from '@/lib/admin/bulk/types';
import { redeemUndoToken } from '@/lib/admin/bulk/undo';

const TTL_SECONDS = 60;

export interface AdminUndoBannerProps {
  undoToken: string;
  count: number;
  actionType: BulkActionType;
  onDismiss: () => void;
  /** Called after a successful undo so the parent can refetch the table. */
  onUndone?: () => void;
}

const VERB_LABELS: Record<BulkActionType, string> = {
  csv_export:           'Exported',
  tag:                  'Tagged',
  comp_plan:            'Granted Pro to',
  ban:                  'Banned',
  force_password_reset: 'Password reset for',
};

export function AdminUndoBanner({
  undoToken,
  count,
  actionType,
  onDismiss,
  onUndone,
}: AdminUndoBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState(TTL_SECONDS);
  const [redeeming, setRedeeming] = useState(false);
  const toast = useToast();
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    startedAtRef.current = Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const remaining = Math.max(0, TTL_SECONDS - elapsed);
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(intervalId);
        onDismiss();
      }
    };
    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [onDismiss]);

  const handleUndo = async () => {
    if (redeeming) return;
    setRedeeming(true);
    try {
      const { reversed } = await redeemUndoToken(undoToken);
      toast(`Reversed for ${reversed} member${reversed === 1 ? '' : 's'}.`, 'success');
      onUndone?.();
      onDismiss();
    } catch (err) {
      if (err instanceof BulkApiError && err.code === 'token_expired') {
        toast('Undo window expired.', 'error');
      } else {
        toast('Undo failed. Please retry.', 'error');
      }
      onDismiss();
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-2 shadow-lg"
      data-testid="admin-undo-banner"
    >
      <ProgressRing
        value={secondsLeft}
        max={TTL_SECONDS}
        size={36}
        strokeWidth={3}
        label={`${secondsLeft} seconds remaining`}
      >
        <span className="text-[11px] font-semibold tabular-nums">{secondsLeft}</span>
      </ProgressRing>

      <span className="text-sm">
        {VERB_LABELS[actionType]}{' '}
        <span className="font-semibold">
          {count} member{count === 1 ? '' : 's'}
        </span>
        .
      </span>

      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<Undo2 className="size-3.5" aria-hidden />}
        onClick={() => void handleUndo()}
        loading={redeeming}
        data-testid="admin-undo-button"
      >
        Undo
      </Button>

      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss undo banner"
        onClick={onDismiss}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
