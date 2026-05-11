import { Smile, BedDouble, Frown, Meh, Annoyed, Laugh, ChartLine } from 'lucide-react';
import { useState } from 'react';
import { MoodChart, SleepChart } from '@/components/dashboard/charts/SimpleCharts';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { todayStr, cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';

const MOODS = [
  { v: 1, Icon: Frown, label: 'Tough' },
  { v: 2, Icon: Annoyed, label: 'Low' },
  { v: 3, Icon: Meh, label: 'Even' },
  { v: 4, Icon: Smile, label: 'Good' },
  { v: 5, Icon: Laugh, label: 'Great' },
] as const;

export function MoodTab() {
  const upsertMood = useStore((s) => s.upsertMood);
  const upsertSleep = useStore((s) => s.upsertSleep);
  const toast = useToast();

  const [mood, setMood] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [energy, setEnergy] = useState('');
  const [moodNotes, setMoodNotes] = useState('');

  const [sleep, setSleep] = useState({ hours: '', quality: '', wakings: '', notes: '' });

  const submitMood = (): void => {
    if (!mood) return toast('Pick a mood', 'error');
    upsertMood({ date: todayStr(), mood, energy: parseInt(energy) || null, notes: moodNotes });
    toast('Mood logged');
    setMood(null);
    setEnergy('');
    setMoodNotes('');
  };

  const submitSleep = (): void => {
    const hrs = parseFloat(sleep.hours);
    if (!hrs) return toast('Enter sleep hours', 'error');
    upsertSleep({
      date: todayStr(),
      hours: hrs,
      quality: parseInt(sleep.quality) || null,
      wakings: parseInt(sleep.wakings) || 0,
      notes: sleep.notes,
    });
    toast('Sleep logged');
    setSleep({ hours: '', quality: '', wakings: '', notes: '' });
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <Card span={6}>
        <CardHeader title="Today's mood" icon={<Smile className="size-4" />} />
        <div className="flex justify-between gap-1.5">
          {MOODS.map(({ v, Icon, label }) => {
            const active = mood === v;
            return (
              <button
                key={v}
                onClick={() => setMood(v)}
                aria-label={label}
                aria-pressed={active}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                  active
                    ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)] scale-[1.04] shadow-md'
                    : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]',
                )}
              >
                <Icon className="size-7" strokeWidth={1.6} />
                <span className="text-[11px] font-semibold">{label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 space-y-3">
          <Input
            label="Energy (1–10)"
            type="number"
            min={1}
            max={10}
            inputMode="numeric"
            value={energy}
            onChange={(e) => setEnergy(e.target.value)}
          />
          <Textarea
            label="Notes"
            rows={2}
            value={moodNotes}
            onChange={(e) => setMoodNotes(e.target.value)}
          />
          <Button block onClick={submitMood}>
            Save mood
          </Button>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader title="Last night's sleep" icon={<BedDouble className="size-4" />} />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Hours"
              type="number"
              step="0.25"
              inputMode="decimal"
              value={sleep.hours}
              onChange={(e) => setSleep({ ...sleep, hours: e.target.value })}
            />
            <Input
              label="Quality (1–10)"
              type="number"
              min={1}
              max={10}
              inputMode="numeric"
              value={sleep.quality}
              onChange={(e) => setSleep({ ...sleep, quality: e.target.value })}
            />
          </div>
          <Input
            label="Wakings"
            type="number"
            inputMode="numeric"
            value={sleep.wakings}
            onChange={(e) => setSleep({ ...sleep, wakings: e.target.value })}
          />
          <Textarea
            label="Notes"
            rows={2}
            value={sleep.notes}
            onChange={(e) => setSleep({ ...sleep, notes: e.target.value })}
          />
          <Button block onClick={submitSleep}>
            Save sleep
          </Button>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader title="Mood & energy · 14 days" icon={<ChartLine className="size-4" />} />
        <MoodChart />
      </Card>
      <Card span={6}>
        <CardHeader title="Sleep trend · 14 days" icon={<BedDouble className="size-4" />} />
        <SleepChart />
      </Card>
    </div>
  );
}
