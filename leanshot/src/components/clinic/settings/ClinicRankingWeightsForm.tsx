/**
 * Phase 30 Plan 02 — ClinicRankingWeightsForm.
 *
 * Settings form for per-clinic ranking weights (CLIN-01).
 * 4 number inputs (dose_adherence / weight_loss / activity / symptoms) in
 * integer-percent units (0–100). Auto-normalizes on blur to sum=100.
 * Save converts to 0–1 numerics and calls SECDEF update_org_ranking_weights.
 *
 * Accessibility:
 *   - aria-label="{signal} weight" on each input
 *   - aria-describedby → sum row id
 *   - sum row: role="status" aria-live="polite"
 *   - Save button: aria-busy during flight
 *
 * UI-SPEC compliance:
 *   - 4 number inputs (NOT sliders)
 *   - Live "Total: N%" counter (--color-success at 100, --color-danger otherwise)
 *   - Save disabled when sum ≠ 100
 *   - Reset to equal weights link (NOT a button)
 *   - Copy matches Copywriting Contract exactly
 */
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface SignalWeight {
  key: 'dose_adherence' | 'weight_loss' | 'activity' | 'symptoms';
  label: string;
  ariaLabel: string;
}

const SIGNALS: SignalWeight[] = [
  { key: 'dose_adherence', label: 'Dose adherence', ariaLabel: 'Dose adherence weight' },
  { key: 'weight_loss', label: 'Weight loss', ariaLabel: 'Weight loss weight' },
  { key: 'activity', label: 'Activity', ariaLabel: 'Activity weight' },
  { key: 'symptoms', label: 'Symptoms', ariaLabel: 'Symptoms weight' },
];

const EQUAL_WEIGHTS: [number, number, number, number] = [25, 25, 25, 25];

export interface ClinicRankingWeightsFormProps {
  orgId: string;
  /**
   * Initial weights from org_settings.ranking_weights.
   * If null (org has not saved custom weights), defaults to 25/25/25/25.
   */
  initialWeights?: {
    dose_adherence: number;
    weight_loss: number;
    activity: number;
    symptoms: number;
  } | null;
}

/**
 * Proportionally normalize an array of numbers to sum to 100.
 * If sum is 0 (all zeros), falls back to equal distribution.
 * Uses integer rounding and distributes rounding error to the largest value.
 */
function normalizeToHundred(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const eq = Math.round(100 / values.length);
    const result = values.map(() => eq);
    // Adjust last element to ensure exact sum
    result[result.length - 1] = 100 - eq * (values.length - 1);
    return result;
  }

  const scale = 100 / sum;
  const rounded = values.map((v) => Math.round(v * scale));
  const roundedSum = rounded.reduce((a, b) => a + b, 0);
  const diff = 100 - roundedSum;

  if (diff !== 0) {
    // Distribute rounding error to the largest value
    let maxIdx = 0;
    let maxVal = rounded[0];
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i] > maxVal) {
        maxVal = rounded[i];
        maxIdx = i;
      }
    }
    rounded[maxIdx] += diff;
  }

  return rounded;
}

export function ClinicRankingWeightsForm({
  orgId,
  initialWeights = null,
}: ClinicRankingWeightsFormProps) {
  const toast = useToast();

  const getInitialValues = (): [number, number, number, number] => {
    if (!initialWeights) return [...EQUAL_WEIGHTS] as [number, number, number, number];
    return [
      Math.round(initialWeights.dose_adherence * 100),
      Math.round(initialWeights.weight_loss * 100),
      Math.round(initialWeights.activity * 100),
      Math.round(initialWeights.symptoms * 100),
    ];
  };

  const [values, setValues] = useState<[number, number, number, number]>(getInitialValues);
  const [isSaving, setIsSaving] = useState(false);

  const sum = values.reduce((a, b) => a + b, 0);
  const isValid = sum === 100;

  const handleChange = (index: number, raw: string) => {
    const parsed = parseInt(raw, 10);
    const clamped = isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed));
    setValues((prev) => {
      const next = [...prev] as [number, number, number, number];
      next[index] = clamped;
      return next;
    });
  };

  const handleBlur = useCallback(() => {
    // Auto-normalize all 4 values on any input blur
    setValues((prev) => {
      const normalized = normalizeToHundred([...prev]);
      return normalized as [number, number, number, number];
    });
  }, []);

  const handleReset = () => {
    setValues([...EQUAL_WEIGHTS] as [number, number, number, number]);
  };

  const handleSave = async () => {
    if (!isValid || isSaving) return;
    setIsSaving(true);
    try {
      const p_weights = {
        dose_adherence: values[0] / 100,
        weight_loss: values[1] / 100,
        activity: values[2] / 100,
        symptoms: values[3] / 100,
      };
      const { error } = await supabase.rpc('update_org_ranking_weights', {
        p_org_id: orgId,
        p_weights,
      });
      if (error) {
        toast('Save failed — please try again.', 'error');
      } else {
        toast('Ranking weights saved. Roster will reorder shortly.', 'success');
      }
    } catch {
      toast('Save failed — please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const sumRowId = 'weights-sum-row';

  return (
    <Card variant="elevated" padding="md">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--color-text)]">
            Ranking weights
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
            Adjust how patient signals are weighted when ordering the roster. Weights must sum to
            100%.
          </p>
        </div>

        {/* 4 number inputs */}
        <div className="space-y-3">
          {SIGNALS.map((signal, index) => (
            <div key={signal.key} className="flex items-center gap-3">
              <label
                htmlFor={`weight-${signal.key}`}
                className="flex-1 text-[15px] font-medium text-[var(--color-text)]"
              >
                {signal.label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={`weight-${signal.key}`}
                  type="number"
                  min={0}
                  max={100}
                  value={values[index]}
                  onChange={(e) => handleChange(index, e.target.value)}
                  onBlur={handleBlur}
                  aria-label={signal.ariaLabel}
                  aria-describedby={sumRowId}
                  className={[
                    'w-20 h-10 rounded-xl border text-center text-[15px] font-mono font-medium',
                    'bg-[var(--color-surface)] border-[var(--color-border)]',
                    'focus:outline-none focus:border-[var(--color-primary)]',
                    'focus:shadow-[0_0_0_3px_var(--color-primary-soft)]',
                    'transition-[box-shadow,border-color]',
                  ].join(' ')}
                />
                <span className="text-[13px] text-[var(--color-text-tertiary)] w-4">%</span>
              </div>
            </div>
          ))}
        </div>

        {/* Sum validation row */}
        <div
          id={sumRowId}
          role="status"
          aria-live="polite"
          className={[
            'text-[13px] font-medium',
            isValid
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-danger)]',
          ].join(' ')}
        >
          {isValid
            ? `Total: 100% — ready to save`
            : `Total: ${sum}% — must equal 100%`}
        </div>

        {/* Save button */}
        <div className="flex items-center gap-4 flex-wrap">
          <Button
            variant="primary"
            disabled={!isValid || isSaving}
            aria-busy={isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? 'Saving…' : 'Save ranking weights'}
          </Button>

          {/* Reset link — NOT a button per UI-SPEC */}
          <button
            type="button"
            onClick={handleReset}
            className={[
              'text-[13px] text-[var(--color-text-tertiary)] underline-offset-2',
              'hover:text-[var(--color-text-secondary)] hover:underline',
              'focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-[var(--color-primary)] rounded',
              'transition-colors',
            ].join(' ')}
          >
            Reset to equal weights
          </button>
        </div>
      </div>
    </Card>
  );
}

export default ClinicRankingWeightsForm;
