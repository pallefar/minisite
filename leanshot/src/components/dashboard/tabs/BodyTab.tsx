import {
  Scale,
  Ruler,
  Camera,
  ChartLine,
  ListChecks,
  Plus,
  X,
  Target,
  ArrowLeftRight,
} from 'lucide-react';
import { useState } from 'react';
import { WeightChart, CompositionChart } from '@/components/dashboard/charts/SimpleCharts';
import { PhotoCompareModal } from '@/components/dashboard/modals/PhotoCompareModal';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressRing';
import { SwipeToDelete } from '@/components/ui/SwipeToDelete';
import { useToast } from '@/hooks/useToast';
import { EmptyPhotos } from '@/illustrations/EmptyPhotos';
import { todayStr, formatShort } from '@/lib/helpers';
import { TRIAL_DATA, trialClass } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';
import type { Measurement, Photo } from '@/types';

export function BodyTab() {
  const u = useStore((s) => s.user!);
  const weights = useStore((s) => s.weights);
  const upsertWeight = useStore((s) => s.upsertWeight);
  const removeWeight = useStore((s) => s.removeWeight);
  const addMeasurement = useStore((s) => s.addMeasurement);
  const photos = useStore((s) => s.photos);
  const addPhoto = useStore((s) => s.addPhoto);
  const removePhoto = useStore((s) => s.removePhoto);
  const toast = useToast();

  const [compareOpen, setCompareOpen] = useState(false);
  const [wForm, setWForm] = useState({ date: todayStr(), value: '', bf: '' });
  const [meas, setMeas] = useState({
    waist: '',
    hips: '',
    chest: '',
    neck: '',
    arms: '',
    thighs: '',
  });

  const wU = u.units === 'metric' ? 'kg' : 'lb';
  const latest = weights[weights.length - 1];
  const lost = latest ? u.startWeight - latest.weight : 0;
  const goalLoss = u.startWeight - u.goalWeight;
  const goalPct = goalLoss > 0 ? Math.min(100, Math.max(0, (lost / goalLoss) * 100)) : 0;
  const lean = latest && latest.bodyFat ? latest.weight * (1 - latest.bodyFat / 100) : null;

  const weeks = Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000));
  const trial = TRIAL_DATA[trialClass(u.medication)];
  let trialPct = 0;
  let myPct = 0;
  if (trial && weeks > 2) {
    myPct = u.startWeight > 0 ? (lost / u.startWeight) * 100 : 0;
    for (let i = 0; i < trial.length; i++) {
      const cur = trial[i]!;
      if (cur.w >= weeks) {
        if (i === 0) {
          trialPct = (weeks / cur.w) * cur.pct;
        } else {
          const a = trial[i - 1]!;
          trialPct = a.pct + ((weeks - a.w) / (cur.w - a.w)) * (cur.pct - a.pct);
        }
        break;
      }
      if (i === trial.length - 1) trialPct = cur.pct;
    }
  }
  const ahead = myPct >= trialPct;

  const submitWeight = (): void => {
    const w = parseFloat(wForm.value);
    const bf = parseFloat(wForm.bf) || null;
    if (!wForm.date || !w) return toast('Date and weight required', 'error');
    upsertWeight({ date: wForm.date, weight: w, bodyFat: bf, ts: Date.now() });
    toast('Weight saved');
    setWForm({ date: todayStr(), value: '', bf: '' });
  };

  const submitMeasurements = (): void => {
    const entry: Measurement = { date: todayStr() };
    let any = false;
    (Object.keys(meas) as Array<keyof typeof meas>).forEach((k) => {
      const v = parseFloat(meas[k]);
      if (v) {
        (entry as unknown as Record<string, number | string>)[k] = v;
        any = true;
      }
    });
    if (!any) return toast('Enter at least one measurement', 'error');
    addMeasurement(entry);
    toast('Measurements saved');
    setMeas({ waist: '', hips: '', chest: '', neck: '', arms: '', thighs: '' });
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const max = 600;
        const r = Math.min(max / img.width, max / img.height, 1);
        const c = document.createElement('canvas');
        c.width = img.width * r;
        c.height = img.height * r;
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/jpeg', 0.7);
        const p: Photo = { date: todayStr(), data, weight: latest?.weight ?? null };
        addPhoto(p);
        toast('Photo saved');
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <StatTile label="Current weight" value={latest ? latest.weight.toFixed(1) : '—'} unit={wU} />
      <StatTile label="Total lost" value={lost.toFixed(1)} unit={wU} />
      <StatTile label="Goal progress" value={`${Math.round(goalPct)}%`} />
      <StatTile
        label="Est. lean mass"
        value={lean ? lean.toFixed(1) : 'Log BF%'}
        unit={lean ? wU : ''}
      />

      {trial && weeks > 2 && (
        <Card span={12}>
          <CardHeader title="vs. clinical trial average" icon={<Target className="size-4" />} />
          <div className="grid grid-cols-2 gap-4 items-center">
            <div>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                Your loss at week {weeks}
              </p>
              <p
                className={`text-[28px] font-extrabold tracking-tight ${ahead ? 'text-[var(--color-success)]' : ''}`}
              >
                {myPct.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-text-secondary)]">Trial average</p>
              <p className="text-[28px] font-extrabold tracking-tight">{trialPct.toFixed(1)}%</p>
            </div>
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)] mt-3">
            {ahead
              ? 'Ahead of trial average — keep your protein up.'
              : "Trial averages don't reflect everyone — your pace is your own."}{' '}
            <em>STEP/SURMOUNT data.</em>
          </p>
        </Card>
      )}

      <Card span={6}>
        <CardHeader title="Log weight" icon={<Scale className="size-4" />} />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              type="date"
              value={wForm.date}
              onChange={(e) => setWForm({ ...wForm, date: e.target.value })}
            />
            <Input
              label={`Weight (${wU})`}
              type="number"
              step="0.1"
              inputMode="decimal"
              value={wForm.value}
              onChange={(e) => setWForm({ ...wForm, value: e.target.value })}
            />
          </div>
          <Input
            label="Body fat % (optional)"
            type="number"
            step="0.1"
            inputMode="decimal"
            value={wForm.bf}
            onChange={(e) => setWForm({ ...wForm, bf: e.target.value })}
          />
          <Button block onClick={submitWeight}>
            Save weight
          </Button>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader title="Body measurements" icon={<Ruler className="size-4" />} />
        <div className="grid grid-cols-2 gap-3">
          {(['waist', 'hips', 'chest', 'neck', 'arms', 'thighs'] as const).map((k) => (
            <Input
              key={k}
              label={k[0]!.toUpperCase() + k.slice(1)}
              type="number"
              step="0.1"
              inputMode="decimal"
              value={meas[k]}
              onChange={(e) => setMeas({ ...meas, [k]: e.target.value })}
            />
          ))}
        </div>
        <Button block onClick={submitMeasurements} className="mt-3">
          Save measurements
        </Button>
      </Card>

      <Card span={12}>
        <CardHeader title="Weight trajectory" icon={<ChartLine className="size-4" />} />
        <WeightChart />
      </Card>

      <Card span={6}>
        <CardHeader
          title="Journey photos"
          icon={<Camera className="size-4" />}
          action={
            photos.length >= 2 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCompareOpen(true)}
                leadingIcon={<ArrowLeftRight className="size-3.5" />}
              >
                Compare
              </Button>
            ) : undefined
          }
        />
        <input type="file" accept="image/*" id="photo-up" hidden onChange={onPhoto} />
        <Button
          variant="ghost"
          block
          leadingIcon={<Plus className="size-4" />}
          onClick={() => document.getElementById('photo-up')?.click()}
        >
          Add photo
        </Button>
        {photos.length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptyPhotos className="w-32" />}
            title="No photos yet"
            body="Take a photo every 2 weeks. The mirror lies; the receipts don't."
          />
        ) : (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {photos.map((p, i) => (
              <SwipeToDelete
                key={i}
                onDelete={() => removePhoto(i)}
                className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[var(--color-surface-elevated)] border border-[var(--color-border)] group"
              >
                <img src={p.data} alt="" className="w-full h-full object-cover absolute inset-0" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent text-white px-2 py-1.5 text-[10px] font-semibold">
                  <p>{formatShort(p.date)}</p>
                  {p.weight && (
                    <p className="opacity-80">
                      {p.weight.toFixed(1)} {wU}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removePhoto(i)}
                  aria-label="Delete photo"
                  className="absolute top-1.5 right-1.5 size-6 rounded-full bg-black/60 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity z-10"
                >
                  <X className="size-3.5" />
                </button>
                <span className="sr-only">Swipe left to delete on mobile</span>
                <span aria-hidden className="absolute inset-0" />
              </SwipeToDelete>
            ))}
          </div>
        )}
      </Card>

      <Card span={6}>
        <CardHeader title="Lean vs fat" icon={<ChartLine className="size-4" />} />
        <CompositionChart />
      </Card>

      <Card span={12}>
        <CardHeader title="Weight history" icon={<ListChecks className="size-4" />} />
        {weights.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-4">
            Log your first weight above.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-left font-semibold py-2 px-1">Date</th>
                  <th className="text-left font-semibold py-2 px-1">Weight</th>
                  <th className="text-left font-semibold py-2 px-1">BF%</th>
                  <th className="text-left font-semibold py-2 px-1">Δ</th>
                  <th aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {[...weights].reverse().map((w, idx, arr) => {
                  const next = arr[idx + 1];
                  const delta = next ? w.weight - next.weight : 0;
                  const realIdx = weights.length - 1 - idx;
                  return (
                    <tr key={w.date} className="border-t border-[var(--color-border)]">
                      <td className="py-2 px-1">{formatShort(w.date)}</td>
                      <td className="py-2 px-1 font-bold numerals-tabular">
                        {w.weight.toFixed(1)} {wU}
                      </td>
                      <td className="py-2 px-1">{w.bodyFat ? `${w.bodyFat.toFixed(1)}%` : '—'}</td>
                      <td className="py-2 px-1">
                        {delta ? (
                          <span
                            className={
                              delta < 0
                                ? 'text-[var(--color-success)]'
                                : 'text-[var(--color-warning)]'
                            }
                          >
                            {delta < 0 ? '↓' : '↑'}
                            {Math.abs(delta).toFixed(1)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 px-1 text-right">
                        <button
                          onClick={() => removeWeight(realIdx)}
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
        {weights.length > 0 && (
          <ProgressBar
            value={goalPct}
            className="mt-4"
            color="var(--color-success)"
            thickness="thick"
            label="Goal progress"
          />
        )}
      </Card>

      <PhotoCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
    </div>
  );
}
