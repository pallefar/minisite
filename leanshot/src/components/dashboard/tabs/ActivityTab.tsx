import { Activity, Footprints, Upload, ListChecks, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { ConnectData } from '@/illustrations/ConnectData';
import { todayStr, formatShort } from '@/lib/helpers';
import { useStore } from '@/lib/store';
import type { Workout } from '@/types';

type WorkoutType = Workout['type'];

export function ActivityTab() {
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
    if (!wo.date) return toast('Date required', 'error');
    addWorkout({
      date: wo.date,
      type: wo.type,
      name: wo.name,
      minutes: parseInt(wo.minutes) || 0,
      rpe: parseInt(wo.rpe) || null,
      notes: wo.notes,
    });
    toast('Workout logged');
    setWo({ date: today, type: 'resistance', name: '', minutes: '', rpe: '', notes: '' });
  };

  const submitSteps = (): void => {
    const v = parseInt(stepVal);
    if (!stepDate || !v) return toast('Date and steps required', 'error');
    setSteps(stepDate, v);
    toast('Steps saved');
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
      toast(`Imported ${stepsAdded} steps, ${weightsAdded} weights`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <StatTile label="Workouts/wk" value={weekly.length} />
      <StatTile label="Steps today" value={(steps[today] ?? 0).toLocaleString()} />
      <StatTile label="Volume (min)" value={weekly.reduce((s, w) => s + (w.minutes || 0), 0)} />
      <StatTile label="Total sessions" value={workouts.length} />

      <Card span={7}>
        <CardHeader title="Log workout" icon={<Activity className="size-4" />} />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              type="date"
              value={wo.date}
              onChange={(e) => setWo({ ...wo, date: e.target.value })}
            />
            <Select
              label="Type"
              value={wo.type}
              onChange={(e) => setWo({ ...wo, type: e.target.value as WorkoutType })}
            >
              <option value="resistance">Resistance</option>
              <option value="cardio">Cardio</option>
              <option value="hybrid">Hybrid</option>
              <option value="walk">Walk</option>
              <option value="yoga">Yoga / Mobility</option>
            </Select>
          </div>
          <Input
            label="Name / focus"
            placeholder="e.g. Push day"
            value={wo.name}
            onChange={(e) => setWo({ ...wo, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Duration (min)"
              type="number"
              inputMode="numeric"
              value={wo.minutes}
              onChange={(e) => setWo({ ...wo, minutes: e.target.value })}
            />
            <Input
              label="RPE (1–10)"
              type="number"
              min={1}
              max={10}
              inputMode="numeric"
              value={wo.rpe}
              onChange={(e) => setWo({ ...wo, rpe: e.target.value })}
            />
          </div>
          <Textarea
            label="Notes"
            rows={2}
            value={wo.notes}
            onChange={(e) => setWo({ ...wo, notes: e.target.value })}
          />
          <Button block onClick={submitWorkout}>
            Log workout
          </Button>
        </div>
      </Card>

      <Card span={5}>
        <CardHeader title="Steps & health" icon={<Footprints className="size-4" />} />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              type="date"
              value={stepDate}
              onChange={(e) => setStepDate(e.target.value)}
            />
            <Input
              label="Steps"
              type="number"
              inputMode="numeric"
              value={stepVal}
              onChange={(e) => setStepVal(e.target.value)}
            />
          </div>
          <Button block onClick={submitSteps}>
            Save steps
          </Button>
          <div className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 mt-2">
            <div className="flex items-start gap-3 mb-3">
              <ConnectData className="w-24 shrink-0" />
              <div>
                <p className="text-[13px] font-bold">Apple Health import</p>
                <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug">
                  Upload XML / CSV from Health export.
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
              Import file
            </Button>
          </div>
        </div>
      </Card>

      <Card span={12}>
        <CardHeader title="Workout history" icon={<ListChecks className="size-4" />} />
        {workouts.length === 0 ? (
          <EmptyState
            inline
            title="No workouts logged"
            body="Resistance training preserves muscle on GLP-1. Even two sessions a week meaningfully changes the lean-vs-fat split."
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-left font-semibold py-2 px-1">Date</th>
                  <th className="text-left font-semibold py-2 px-1">Type</th>
                  <th className="text-left font-semibold py-2 px-1">Name</th>
                  <th className="text-left font-semibold py-2 px-1">Min</th>
                  <th className="text-left font-semibold py-2 px-1">RPE</th>
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
                      <td className="py-2 px-1 text-right">
                        <button
                          onClick={() => removeWorkout(realIdx)}
                          aria-label="Delete"
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
