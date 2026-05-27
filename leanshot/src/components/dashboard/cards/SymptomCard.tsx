import { ShieldAlert, Plus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { EmptySymptoms } from '@/illustrations/EmptySymptoms';
import { SYMPTOMS_LIST } from '@/lib/constants';
import { relTime } from '@/lib/helpers';
import { useStore } from '@/lib/store';

export function SymptomCard() {
  const { t } = useTranslation('patient');
  const symptoms = useStore((s) => s.symptoms);
  const setTab = useStore((s) => s.setTab);
  const recent = symptoms
    .filter((s) => Date.now() - new Date(s.date).getTime() < 7 * 86_400_000)
    .slice(0, 3);

  return (
    <Card span={4} variant="default" data-tour="symptoms">
      <CardHeader
        title={t('patient:card.symptoms.title')}
        icon={<ShieldAlert className="size-4" />}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTab('symptoms')}
            leadingIcon={<Plus className="size-3.5" />}
          >
            {t('patient:card.symptoms.action_log')}
          </Button>
        }
      />
      {recent.length === 0 ? (
        <EmptyState
          inline
          illustration={<EmptySymptoms className="w-32" />}
          title={t('patient:card.symptoms.empty_title')}
          body={t('patient:card.symptoms.empty_body')}
        />
      ) : (
        <ul className="space-y-3">
          {recent.map((s, i) => {
            const sym = SYMPTOMS_LIST.find((x) => x.id === s.symptom);
            return (
              <li key={i} className="flex items-center gap-3">
                <span className="size-9 rounded-xl bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] inline-flex items-center justify-center shrink-0 font-bold text-[12px] uppercase">
                  {(sym?.name ?? s.symptom).slice(0, 2)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate">{sym?.name ?? s.symptom}</p>
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">{relTime(s.date)}</p>
                </div>
                <div className="flex gap-1 shrink-0" aria-label={`Severity ${s.severity} of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      className={`size-1.5 rounded-full ${n <= s.severity ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-border-strong)]'}`}
                      aria-hidden
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {recent.length >= 2 && (
        <div className="mt-4 rounded-2xl bg-[var(--color-warning-soft)] text-[var(--color-warning)] px-3 py-2.5 flex items-start gap-2 text-[12px] leading-snug">
          <Sparkles className="size-3.5 mt-0.5 shrink-0" />
          <span>{t('patient:card.symptoms.pattern_warning')}</span>
        </div>
      )}
    </Card>
  );
}
