import { ChartLine, ListChecks, Zap } from 'lucide-react';
import { useState } from 'react';
import { SymptomChart } from '@/components/dashboard/charts/SimpleCharts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { EmptySymptoms } from '@/illustrations/EmptySymptoms';
import { SYMPTOMS_LIST } from '@/lib/constants';
import { formatShort } from '@/lib/helpers';
import { cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';

export function SymptomsTab() {
  const symptoms = useStore((s) => s.symptoms);
  const addSymptom = useStore((s) => s.addSymptom);
  const toast = useToast();

  const [selected, setSelected] = useState<string | null>(null);
  const [severity, setSeverity] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [notes, setNotes] = useState('');

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <Card span={7}>
        <CardHeader title="Log how you're feeling" icon={<Zap className="size-4" />} />
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-3">
          Tap any symptom, then set severity.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {SYMPTOMS_LIST.map((s) => {
            const active = selected === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-center gap-1 px-2 py-3 rounded-2xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                  active
                    ? 'border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)] hover:border-[var(--color-warning)]',
                )}
              >
                <span className="size-8 rounded-xl bg-[var(--color-surface)] inline-flex items-center justify-center text-[12px] font-bold uppercase border border-[var(--color-border)]">
                  {s.name.slice(0, 2)}
                </span>
                <span className="text-[11px] font-semibold text-center leading-tight">
                  {s.name}
                </span>
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                Severity (1=mild, 5=severe)
              </p>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSeverity(n as 1 | 2 | 3 | 4 | 5)}
                    aria-pressed={severity === n}
                    className={cn(
                      'flex-1 h-11 rounded-xl border text-[14px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                      severity === n
                        ? 'bg-[var(--color-warning)] border-[var(--color-warning)] text-white'
                        : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text-secondary)]',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              label="Notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button
              block
              onClick={() => {
                addSymptom({ date: new Date().toISOString(), symptom: selected, severity, notes });
                toast('Symptom logged');
                setSelected(null);
                setNotes('');
                setSeverity(3);
              }}
            >
              Save log
            </Button>
          </div>
        )}
      </Card>

      <Card span={5}>
        <CardHeader title="Frequency · 30 days" icon={<ChartLine className="size-4" />} />
        <SymptomChart />
      </Card>

      <Card span={12}>
        <CardHeader title="Recent log" icon={<ListChecks className="size-4" />} />
        {symptoms.length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptySymptoms className="w-32" />}
            title="No symptoms logged"
            body="That's a great sign. We'll be ready when you need us."
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-start font-semibold py-2 px-1">Date</th>
                  <th className="text-start font-semibold py-2 px-1">Symptom</th>
                  <th className="text-start font-semibold py-2 px-1">Severity</th>
                  <th className="text-start font-semibold py-2 px-1">Notes</th>
                </tr>
              </thead>
              <tbody>
                {symptoms.slice(0, 30).map((s, i) => {
                  const sym = SYMPTOMS_LIST.find((x) => x.id === s.symptom);
                  return (
                    <tr key={i} className="border-t border-[var(--color-border)]">
                      <td className="py-2 px-1">{formatShort(s.date)}</td>
                      <td className="py-2 px-1 font-semibold">{sym?.name ?? s.symptom}</td>
                      <td className="py-2 px-1">
                        <Badge tone="warning">{s.severity}/5</Badge>
                      </td>
                      <td className="py-2 px-1 text-[var(--color-text-secondary)] truncate max-w-[260px]">
                        {s.notes || '—'}
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
