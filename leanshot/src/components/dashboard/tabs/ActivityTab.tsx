import { Activity, Footprints, Upload, ListChecks, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { ActivityRings } from '@/illustrations/ActivityRings';
import { ConnectData } from '@/illustrations/ConnectData';
import { todayStr, formatShort } from '@/lib/helpers';
import { useStore } from '@/lib/store';
import type { Workout } from '@/types';

type WorkoutType = Workout['type'];

export function ActivityTab() {
  const { t } = useTranslation('patient');
  const workouts = useStore((s) => s.workouts);
  const steps = useStore((s) => s.steps);
  const addWorkout = useStore((s) => s.addWorkout);
  const removeWorkout = useStore((s) => s.removeWorkout);
  const setSteps = useStore((s) => s.setSteps);
  const bulkSetSteps = useStore((s) => s.bulkSetSteps);
  const bulkAddWeights = useStore((s) => s.bulkAddWeights);
  const toast = useToast();

  const today = todayStr();
  const weekStart = Date.now() - 7 * 86_400_000;
  const weekly = workouts.filter((w) => new Date(w.date).getTime() > weekStart);

  const [wo, setWo] = useState<{
    date: string;
    type: WorkoutType;
    name: string;
    minutes: string;
    rpe: string;
    notes: string;
  }>({ date: today, type: 'resistance', name: '', minutes: '', rpe: '', notes: '' });
  const [stepDate, setStepDate] = useState(today);
  const [stepVal, setStepVal] = useState('');

  const submitWorkout = (): void => {
    if (!wo.date) return toast(t('patient:tab.activity.toast_date_required'), 'error');
    addWorkout({
      date: wo.date,
      type: wo.type,
      name: wo.name,
      minutes: parseInt(wo.minutes) || 0,
      rpe: parseInt(wo.rpe) || null,
      notes: wo.notes,
    });
    toast(t('patient:tab.activity.toast_workout_logged'));
    setWo({ date: today, type: 'resistance', name: '', minutes: '', rpe: '', notes: '' });
  };

  const submitSteps = (): void => {
    const v = parseInt(stepVal);
    if (!stepDate || !v) return toast(t('patient:tab.activity.toast_steps_date_required'), 'error');
    setSteps(stepDate, v);
    toast(t('patient:tab.activity.toast_steps_saved'));
    setStepVal('');
  };

  const importHealth = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      let stepsAdded = 0;
      let weightsAdded = 0;
      const stepEntries: Record<string, number> = {};
      const weights: { date: string; weight: number; bodyFat: number | null; ts: number }[] = [];

      if (file.name.endsWith('.csv') || (text.includes(',') && !text.includes('<HealthData'))) {
        text.split(/\r?\n/).forEach((line) => {
          const parts = line.split(',');
          if (parts.length >= 2) {
            const date = (parts[0] ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
            const val = parseFloat(parts[1] ?? '');
            if (date && val > 100 && val < 100_000) {
              stepEntries[date] = (stepEntries[date] ?? 0) + val;
              stepsAdded++;
            }
          }
        });
      }
      if (file.name.endsWith('.xml') || text.includes('<HealthData')) {
        const stepRe =
          /<Record[^>]*type="HKQuantityTypeIdentifierStepCount"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = stepRe.exec(text)) !== null) {
          const date = m[1]!.slice(0, 10);
          const val = parseFloat(m[2]!);
          if (val > 0) {
            stepEntries[date] = (stepEntries[date] ?? 0) + val;
            stepsAdded++;
          }
        }
        const wtRe =
          /<Record[^>]*type="HKQuantityTypeIdentifierBodyMass"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
        while ((m = wtRe.exec(text)) !== null) {
          const date = m[1]!.slice(0, 10);
          const val = parseFloat(m[2]!);
          if (val > 30 && val < 300) {
            weights.push({ date, weight: val, bodyFat: null, ts: Date.now() });
            weightsAdded++;
          }
        }
      }
      bulkSetSteps(stepEntries);
      if (weights.length) bulkAddWeights(weights);
      toast(t('patient:tab.activity.toast_imported', { steps: stepsAdded, weights: weightsAdded }));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <StatTile label={t('patient:tab.activity.stat_workouts_wk')} value={weekly.length} />
      <StatTile label={t('patient:tab.activity.stat_steps_today')} value={(steps[today] ?? 0).toLocaleString()} />
      <StatTile label={t('patient:tab.activity.stat_volume_min')} value={weekly.reduce((s, w) => s + (w.minutes || 0), 0)} />
      <StatTile label={t('patient:tab.activity.stat_total_sessions')} value={workouts.length} />

      <Card span={7}>
        <CardHeader title={t('patient:tab.activity.log_title')} icon={<Activity className="size-4" />} />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('patient:tab.activity.label_date')}
              type="date"
              value={wo.date}
              onChange={(e) => setWo({ ...wo, date: e.target.value })}
            />
            <Select
              label={t('patient:tab.activity.label_type')}
              value={wo.type}
              onChange={(e) => setWo({ ...wo, type: e.target.value as WorkoutType })}
            >
              <option value="resistance">{t('patient:tab.activity.type_resistance')}</option>
              <option value="cardio">{t('patient:tab.activity.type_cardio')}</option>
              <option value="hybrid">{t('patient:tab.activity.type_hybrid')}</option>
              <option value="walk">{t('patient:tab.activity.type_walk')}</option>
              <option value="yoga">{t('patient:tab.activity.type_yoga')}</option>
            </Select>
          </div>
          <Input
            label={t('patient:tab.activity.label_name')}
            placeholder="e.g. Push day"
            value={wo.name}
            onChange={(e) => setWo({ ...wo, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('patient:tab.activity.label_duration')}
              type="number"
              inputMode="numeric"
              value={wo.minutes}
              onChange={(e) => setWo({ ...wo, minutes: e.target.value })}
            />
            <Input
              label={t('patient:tab.activity.label_rpe')}
              type="number"
              min={1}
              max={10}
              inputMode="numeric"
              value={wo.rpe}
              onChange={(e) => setWo({ ...wo, rpe: e.target.value })}
            />
          </div>
          <Textarea
            label={t('patient:tab.activity.label_notes')}
            rows={2}
            value={wo.notes}
            onChange={(e) => setWo({ ...wo, notes: e.target.value })}
          />
          <Button block onClick={submitWorkout}>
            {t('patient:tab.activity.action_log_workout')}
          </Button>
        </div>
      </Card>

      <Card span={5}>
        <CardHeader title={t('patient:tab.activity.steps_title')} icon={<Footprints className="size-4" />} />
        <div className="space-y-3">
          <div className="flex items-center gap-4 rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-3">
            <ActivityRings className="w-20 shrink-0" staticOnly />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--color-text-tertiary)]">
                {t('patient:tab.activity.steps_today_label')}
              </p>
              <p className="text-[20px] font-bold tracking-tight numerals-tabular leading-none">
                {(steps[today] ?? 0).toLocaleString()}
                <span className="text-[12px] text-[var(--color-text-secondary)] font-medium ms-1">
                  {t('patient:tab.activity.steps_unit')}
                </span>
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('patient:tab.activity.label_date')}
              type="date"
              value={stepDate}
              onChange={(e) => setStepDate(e.target.value)}
            />
            <Input
              label={t('patient:tab.activity.label_steps')}
              type="number"
              inputMode="numeric"
              value={stepVal}
              onChange={(e) => setStepVal(e.target.value)}
            />
          </div>
          <Button block onClick={submitSteps}>
            {t('patient:tab.activity.action_save_steps')}
          </Button>
          <div className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 mt-2">
            <div className="flex items-start gap-3 mb-3">
              <ConnectData className="w-24 shrink-0" />
              <div>
                <p className="text-[13px] font-bold">{t('patient:tab.activity.health_import_title')}</p>
                <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug">
                  {t('patient:tab.activity.health_import_body')}
                </p>
              </div>
            </div>
            <input
              type="file"
              id="health-up"
              accept=".csv,.xml,.txt"
              hidden
              onChange={importHealth}
            />
            <Button
              variant="ghost"
              block
              leadingIcon={<Upload className="size-4" />}
              onClick={() => document.getElementById('health-up')?.click()}
            >
              {t('patient:tab.activity.action_import_file')}
            </Button>
          </div>
        </div>
      </Card>

      <Card span={12}>
        <CardHeader title={t('patient:tab.activity.history_title')} icon={<ListChecks className="size-4" />} />
        {workouts.length === 0 ? (
          <EmptyState
            inline
            title={t('patient:tab.activity.history_empty_title')}
            body={t('patient:tab.activity.history_empty_body')}
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-start font-semibold py-2 px-1">{t('patient:tab.activity.col_date')}</th>
                  <th className="text-start font-semibold py-2 px-1">{t('patient:tab.activity.col_type')}</th>
                  <th className="text-start font-semibold py-2 px-1">{t('patient:tab.activity.col_name')}</th>
                  <th className="text-start font-semibold py-2 px-1">{t('patient:tab.activity.col_min')}</th>
                  <th className="text-start font-semibold py-2 px-1">{t('patient:tab.activity.col_rpe')}</th>
                  <th aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {workouts.slice(0, 30).map((w) => {
                  const realIdx = workouts.indexOf(w);
                  return (
                    <tr key={w.date + w.name} className="border-t border-[var(--color-border)]">
                      <td className="py-2 px-1">{formatShort(w.date)}</td>
                      <td className="py-2 px-1">
                        <Badge tone="info">{w.type}</Badge>
                      </td>
                      <td className="py-2 px-1">{w.name || '—'}</td>
                      <td className="py-2 px-1 numerals-tabular">{w.minutes || '—'}</td>
                      <td className="py-2 px-1 numerals-tabular">{w.rpe ?? '—'}</td>
                      <td className="py-2 px-1 text-end">
                        <button
                          onClick={() => removeWorkout(realIdx)}
                          aria-label={t('patient:tab.activity.aria_delete')}
                          className="size-7 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-elevated)] inline-flex items-center justify-center"
                        >
                          <X className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
