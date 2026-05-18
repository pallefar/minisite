/**
 * Phase 30 Plan 02 — ClinicDoseTrendThresholdsForm.
 *
 * Settings form for per-clinic dose-trend alert thresholds (CLIN-02).
 * 3 number inputs:
 *   N — Missed doses (min 1, max 30, default placeholder 2)
 *   M — Observation window days (min 7, max 90, default placeholder 14)
 *   X — Interval variance % (min 5, max 100, default placeholder 25)
 *
 * Input starts empty — placeholder shows v1.3 defaults.
 * Save calls SECDEF update_org_dose_trend_thresholds.
 *
 * Copy matches 30-UI-SPEC Copywriting Contract exactly.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface ThresholdField {
  key: 'missed_doses_n' | 'window_days_m' | 'variance_pct_x';
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  placeholder: string;
  unit?: string;
}

const FIELDS: ThresholdField[] = [
  {
    key: 'missed_doses_n',
    label: 'Missed doses (N)',
    ariaLabel: 'Missed doses (N)',
    min: 1,
    max: 30,
    placeholder: '2',
  },
  {
    key: 'window_days_m',
    label: 'Observation window (days)',
    ariaLabel: 'Observation window (days)',
    min: 7,
    max: 90,
    placeholder: '14',
    unit: 'days',
  },
  {
    key: 'variance_pct_x',
    label: 'Interval variance (%)',
    ariaLabel: 'Interval variance (%)',
    min: 5,
    max: 100,
    placeholder: '25',
    unit: '%',
  },
];

export interface ClinicDoseTrendThresholdsFormProps {
  orgId: string;
  /**
   * Existing custom thresholds from org_settings.dose_trend_thresholds.
   * If null, inputs start empty (placeholder shows defaults).
   */
  initialThresholds?: {
    missed_doses_n: number;
    window_days_m: number;
    variance_pct_x: number;
  } | null;
}

export function ClinicDoseTrendThresholdsForm({
  orgId,
  initialThresholds = null,
}: ClinicDoseTrendThresholdsFormProps) {
  const toast = useToast();

  const [values, setValues] = useState<{
    missed_doses_n: string;
    window_days_m: string;
    variance_pct_x: string;
  }>({
    missed_doses_n: initialThresholds ? String(initialThresholds.missed_doses_n) : '',
    window_days_m: initialThresholds ? String(initialThresholds.window_days_m) : '',
    variance_pct_x: initialThresholds ? String(initialThresholds.variance_pct_x) : '',
  });

  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (key: keyof typeof values, raw: string) => {
    // Allow any numeric string while typing (clamping only on blur)
    if (raw === '' || /^\d+$/.test(raw)) {
      setValues((prev) => ({ ...prev, [key]: raw }));
    }
  };

  const handleBlur = (key: keyof typeof values, field: ThresholdField) => {
    const raw = values[key];
    if (!raw) return;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) {
      setValues((prev) => ({ ...prev, [key]: '' }));
      return;
    }
    const clamped = Math.max(field.min, Math.min(field.max, parsed));
    setValues((prev) => ({ ...prev, [key]: String(clamped) }));
  };

  const getIntValue = (key: keyof typeof values, field: ThresholdField): number => {
    const raw = values[key];
    if (!raw) return parseInt(field.placeholder, 10);
    return parseInt(raw, 10);
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const nField = FIELDS.find((f) => f.key === 'missed_doses_n')!;
      const mField = FIELDS.find((f) => f.key === 'window_days_m')!;
      const xField = FIELDS.find((f) => f.key === 'variance_pct_x')!;

      const p_thresholds = {
        missed_doses_n: getIntValue('missed_doses_n', nField),
        window_days_m: getIntValue('window_days_m', mField),
        variance_pct_x: getIntValue('variance_pct_x', xField),
      };

      const { error } = await supabase.rpc('update_org_dose_trend_thresholds', {
        p_org_id: orgId,
        p_thresholds,
      });

      if (error) {
        toast('Save failed — please try again.', 'error');
      } else {
        toast('Alert thresholds saved. New alerts will use these thresholds.', 'success');
      }
    } catch {
      toast('Save failed — please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card variant="elevated" padding="md">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--color-text)]">
            Alert thresholds
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
            Alerts fire when a patient misses more doses than the threshold within the observation
            window, or when injection interval variance exceeds the set percentage.
          </p>
        </div>

        {/* 3 number inputs */}
        <div className="space-y-3">
          {FIELDS.map((field) => (
            <div key={field.key} className="flex items-center gap-3">
              <label
                htmlFor={`threshold-${field.key}`}
                className="flex-1 text-[15px] font-medium text-[var(--color-text)]"
              >
                {field.label}
              </label>
              <input
                id={`threshold-${field.key}`}
                type="number"
                min={field.min}
                max={field.max}
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                onBlur={() => handleBlur(field.key, field)}
                aria-label={field.ariaLabel}
                className={[
                  'w-20 h-10 rounded-xl border text-center text-[15px] font-mono font-medium',
                  'bg-[var(--color-surface)] border-[var(--color-border)]',
                  'focus:outline-none focus:border-[var(--color-primary)]',
                  'focus:shadow-[0_0_0_3px_var(--color-primary-soft)]',
                  'transition-[box-shadow,border-color]',
                ].join(' ')}
              />
            </div>
          ))}
        </div>

        {/* Save button */}
        <Button
          variant="primary"
          disabled={isSaving}
          aria-busy={isSaving}
          onClick={() => void handleSave()}
        >
          {isSaving ? 'Saving…' : 'Save thresholds'}
        </Button>
      </div>
    </Card>
  );
}

export default ClinicDoseTrendThresholdsForm;
