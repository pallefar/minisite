/**
 * Phase 22 Plan 22-07 — CompSubModal (ADMIN-04).
 *
 * Grants comp months on a Stripe subscription via the `admin-stripe-action`
 * Edge Function (Plan 22-03). Stripe extends `trial_end` by N days so the
 * customer isn't charged during the comp window.
 *
 * UX: Pill quick-fill for comp duration (1 month / 3 months / 6 months /
 * Custom). Custom reveals a number input (days). Confirm button enabled only
 * when comp_days > 0.
 *
 * Copy pattern per UI-SPEC §Copywriting line 689.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import {
  AdminStripeError,
  compSubscription,
} from '@/lib/admin/admin-stripe-actions';

export interface CompSubModalProps {
  isOpen: boolean;
  targetUserId: string;
  targetUserEmail: string;
  subscriptionId: string;
  onClose: () => void;
  onSuccess: () => void;
}

type PresetKey = '1m' | '3m' | '6m' | 'custom';

const PRESET_DAYS: Record<Exclude<PresetKey, 'custom'>, number> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
};

export function CompSubModal({
  isOpen,
  targetUserId,
  targetUserEmail,
  subscriptionId,
  onClose,
  onSuccess,
}: CompSubModalProps) {
  const toast = useToast();
  const [preset, setPreset] = useState<PresetKey>('1m');
  const [customDays, setCustomDays] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const compDays = useMemo(() => {
    if (preset === 'custom') {
      const n = Number.parseInt(customDays, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return PRESET_DAYS[preset];
  }, [preset, customDays]);

  const close = (): void => {
    if (busy) return;
    setInlineError(null);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    if (compDays <= 0) return;
    setBusy(true);
    setInlineError(null);
    try {
      await compSubscription({ targetUserId, subscriptionId, compDays });
      toast(
        `Comped ${compDays} day${compDays === 1 ? '' : 's'} for ${targetUserEmail}`,
        'success',
      );
      onSuccess();
      onClose();
    } catch (e) {
      if (e instanceof AdminStripeError && e.code === 'stripe') {
        setInlineError(
          `Stripe rejected the comp: ${e.stripeCode ?? 'unknown_error'}. Try again or contact support.`,
        );
      } else if (e instanceof AdminStripeError && e.code === 'forbidden') {
        setInlineError('You do not have permission to comp subscriptions.');
      } else {
        setInlineError('Could not grant the comp. Try again or contact support.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={close} title="Grant comp" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          Extend {targetUserEmail}&apos;s subscription with free access. Stripe will
          skip the next charge cycle.
        </p>
        <PillGroup segmented aria-label="Comp duration">
          <Pill size="sm" active={preset === '1m'} onClick={() => setPreset('1m')}>
            1 month
          </Pill>
          <Pill size="sm" active={preset === '3m'} onClick={() => setPreset('3m')}>
            3 months
          </Pill>
          <Pill size="sm" active={preset === '6m'} onClick={() => setPreset('6m')}>
            6 months
          </Pill>
          <Pill size="sm" active={preset === 'custom'} onClick={() => setPreset('custom')}>
            Custom
          </Pill>
        </PillGroup>
        {preset === 'custom' && (
          <Input
            label="Days"
            type="number"
            inputMode="numeric"
            min="1"
            max="365"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            placeholder="e.g. 14"
          />
        )}
        {inlineError && (
          <p role="alert" className="text-sm text-[var(--color-danger)] leading-relaxed">
            {inlineError}
          </p>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || compDays <= 0}
            onClick={() => {
              void handleConfirm();
            }}
          >
            Grant comp
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default CompSubModal;
