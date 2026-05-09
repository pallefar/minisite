import { useState } from 'react';
import { Syringe, Plus, ChartLine, Package, ListChecks, TrendingUp, X, Wallet } from 'lucide-react';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { EmptyInjections } from '@/illustrations/EmptyInjections';
import { VialIllustration } from '@/illustrations/Vial';
import { MedLevelChart } from '@/components/dashboard/charts/MedLevelChart';
import { useStore } from '@/lib/store';
import { useToast } from '@/hooks/useToast';
import { HALF_LIVES, TITRATION } from '@/lib/pharmacology';
import { SITES, siteShort } from '@/lib/constants';
import { formatShort, todayStr } from '@/lib/helpers';
import type { DoseUnit, Injection, InjectionSite, Vial, Cost } from '@/types';
import { cn } from '@/lib/helpers';

export function MedicationTab() {
  const u = useStore((s) => s.user!);
  const injections = useStore((s) => s.injections);
  const vials = useStore((s) => s.vials);
  const costs = useStore((s) => s.costs);
  const addInjection = useStore((s) => s.addInjection);
  const removeInjection = useStore((s) => s.removeInjection);
  const addVial = useStore((s) => s.addVial);
  const removeVial = useStore((s) => s.removeVial);
  const useVialDose = useStore((s) => s.useVialDose);
  const addCost = useStore((s) => s.addCost);
  const removeCost = useStore((s) => s.removeCost);
  const toast = useToast();

  const [vialOpen, setVialOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [injForm, setInjForm] = useState({
    datetime: new Date().toISOString().slice(0, 16),
    dose: u.dose,
    unit: u.doseUnit as DoseUnit,
    site: null as InjectionSite | null,
    notes: '',
  });

  const halfLifeDays = ((HALF_LIVES[u.medication] ?? 168) / 24).toFixed(1);
  const totalRemaining = vials.reduce((s, v) => s + Math.max(0, v.dosesPerVial - v.dosesUsed), 0);
  const lastInj = injections[0];
  const lastInjDays = lastInj
    ? Math.floor((Date.now() - new Date(lastInj.datetime).getTime()) / 86_400_000)
    : null;
  const titList = TITRATION[u.medication];
  const weeks = Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000));

  const totalSpent = costs.reduce((s, c) => s + (c.amount || 0), 0);
  const monthly = costs.filter((c) => Date.now() - new Date(c.date).getTime() < 30 * 86_400_000).reduce((s, c) => s + (c.amount || 0), 0);

  const submitInjection = (): void => {
    if (!injForm.datetime) return toast('Date & time required', 'error');
    addInjection(injForm as Injection);
    toast('Injection logged');
    setInjForm({
      datetime: new Date().toISOString().slice(0, 16),
      dose: injForm.dose,
      unit: injForm.unit,
      site: null,
      notes: '',
    });
  };

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <StatTile label="Current dose" value={u.dose} unit={u.doseUnit} />
      <StatTile label="Last shot" value={lastInjDays != null ? lastInjDays : '—'} unit={lastInjDays != null ? 'd ago' : ''} />
      <StatTile label="Total injections" value={injections.length} />
      <StatTile label="Doses remaining" value={totalRemaining > 0 ? totalRemaining : '—'} />

      {/* Hero: full-width medication-level chart */}
      <Card span={12}>
        <CardHeader
          title="Estimated medication levels"
          icon={<ChartLine className="size-4" />}
          action={<Badge tone="info">Half-life · {halfLifeDays}d</Badge>}
        />
        <MedLevelChart height={300} />
        <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2">
          Solid line = past · dashed = projected from your dose pattern
        </p>
      </Card>

      <Card span={6}>
        <CardHeader title="Log new injection" icon={<Syringe className="size-4" />} />
        <div className="space-y-3">
          <Input
            label="Date & time"
            type="datetime-local"
            value={injForm.datetime}
            onChange={(e) => setInjForm({ ...injForm, datetime: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Dose"
              inputMode="decimal"
              placeholder={u.dose}
              value={injForm.dose}
              onChange={(e) => setInjForm({ ...injForm, dose: e.target.value })}
            />
            <Select label="Unit" value={injForm.unit} onChange={(e) => setInjForm({ ...injForm, unit: e.target.value as DoseUnit })}>
              <option value="mg">mg</option>
              <option value="units">units</option>
              <option value="ml">ml</option>
            </Select>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">Site (rotate weekly)</p>
            <div className="grid grid-cols-4 gap-1.5">
              {SITES.map((s) => (
                <button
                  key={s}
                  onClick={() => setInjForm({ ...injForm, site: s })}
                  aria-pressed={injForm.site === s}
                  className={cn(
                    'px-2 py-2.5 rounded-xl border text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                    injForm.site === s
                      ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]',
                  )}
                >
                  {siteShort(s)}
                </button>
              ))}
            </div>
          </div>
          <Textarea label="Notes" rows={2} value={injForm.notes} onChange={(e) => setInjForm({ ...injForm, notes: e.target.value })} />
          <Button block onClick={submitInjection}>Log injection</Button>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader
          title="Vials & supply"
          icon={<Package className="size-4" />}
          action={
            <Button variant="secondary" size="sm" onClick={() => setVialOpen(true)} leadingIcon={<Plus className="size-3.5" />}>
              Add vial
            </Button>
          }
        />
        {vials.length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptyInjections className="w-32" />}
            title="No vials tracked yet"
            body="Add your current vial to track refills and prevent gaps."
            cta={
              <Button size="sm" onClick={() => setVialOpen(true)} leadingIcon={<Plus className="size-3.5" />}>
                Add vial
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {vials.map((v, i) => {
              const remaining = v.dosesPerVial - v.dosesUsed;
              const pct = Math.max(0, Math.min(100, (remaining / v.dosesPerVial) * 100));
              const expDays = v.expirationDate ? Math.floor((new Date(v.expirationDate).getTime() - Date.now()) / 86_400_000) : null;
              const warn = remaining <= 1 || (expDays != null && expDays < 14);
              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-2xl border',
                    warn
                      ? 'bg-[var(--color-warning-soft)] border-[var(--color-warning)]'
                      : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)]',
                    remaining <= 0 && 'opacity-55',
                  )}
                >
                  <VialIllustration fillPct={pct} warning={warn} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold truncate">{v.name || `Vial ${i + 1}`}</p>
                    <p className="text-[12px] text-[var(--color-text-secondary)] numerals-tabular">
                      {remaining}/{v.dosesPerVial} doses{expDays != null ? ` · expires ${expDays}d` : ''}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="ghost" onClick={() => useVialDose(i)} disabled={remaining <= 0}>
                        − 1 dose
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeVial(i)} aria-label="Delete vial">
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card span={6}>
        <CardHeader title="Titration schedule" icon={<TrendingUp className="size-4" />} />
        {titList ? (
          <div className="space-y-1.5">
            {titList.map((t) => {
              const wks = t.w.split('–');
              const start = parseInt(wks[0] ?? '0') || 0;
              const end = wks[1] ? parseInt(wks[1]) : 999;
              const isCurrent = weeks >= start && weeks <= end;
              return (
                <div
                  key={t.d + t.w}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-2xl border',
                    isCurrent
                      ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)]'
                      : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)]',
                  )}
                >
                  <span className="font-bold text-[14px] min-w-[60px]">{t.d}</span>
                  <span className="flex-1 text-[12px] text-[var(--color-text-secondary)]">
                    <strong className="text-[var(--color-text)]">Wk {t.w}</strong>
                    {t.n ? ` — ${t.n}` : ''}
                  </span>
                  {isCurrent && <Badge tone="info" pulse>You</Badge>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">Custom titration — follow your prescriber's plan.</p>
        )}
      </Card>

      <Card span={6}>
        <CardHeader title="Recent injections" icon={<ListChecks className="size-4" />} />
        {injections.length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptyInjections className="w-32" />}
            title="No injections logged"
            body="Log your first dose to start your med-level curve. The graph below builds itself from here."
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-left font-semibold py-2 px-1">Date</th>
                  <th className="text-left font-semibold py-2 px-1">Dose</th>
                  <th className="text-left font-semibold py-2 px-1">Site</th>
                  <th className="px-1" aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {injections.slice(0, 8).map((i, idx) => (
                  <tr key={idx} className="border-t border-[var(--color-border)]">
                    <td className="py-2 px-1">{formatShort(i.datetime)}</td>
                    <td className="py-2 px-1 font-bold numerals-tabular">{i.dose} {i.unit}</td>
                    <td className="py-2 px-1 text-[var(--color-text-secondary)]">{siteShort(i.site ?? '—')}</td>
                    <td className="py-2 px-1 text-right">
                      <button
                        onClick={() => removeInjection(idx)}
                        aria-label={`Delete injection on ${formatShort(i.datetime)}`}
                        className="size-7 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-elevated)] inline-flex items-center justify-center"
                      >
                        <X className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card span={12}>
        <CardHeader
          title="Cost tracker"
          icon={<Wallet className="size-4" />}
          action={
            <Button variant="secondary" size="sm" onClick={() => setCostOpen(true)} leadingIcon={<Plus className="size-3.5" />}>
              Add expense
            </Button>
          }
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <CostTile label="Total" value={`$${totalSpent.toFixed(0)}`} />
          <CostTile label="Per dose" value={`$${injections.length > 0 ? (totalSpent / injections.length).toFixed(0) : '0'}`} />
          <CostTile label="Last 30 days" value={`$${monthly.toFixed(0)}`} />
          <CostTile label="Annual projected" value={`$${(monthly * 12).toFixed(0)}`} />
        </div>
        {costs.length === 0 ? (
          <EmptyState
            inline
            title="No expenses tracked"
            body="Add your first to see cost-per-dose, monthly spend, and an annual projection."
            cta={
              <Button size="sm" variant="ghost" onClick={() => setCostOpen(true)} leadingIcon={<Plus className="size-3.5" />}>
                Add expense
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-left font-semibold py-2 px-1">Date</th>
                  <th className="text-left font-semibold py-2 px-1">Type</th>
                  <th className="text-left font-semibold py-2 px-1">Amount</th>
                  <th className="text-left font-semibold py-2 px-1">Notes</th>
                  <th aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {costs.slice(0, 20).map((c, i) => (
                  <tr key={i} className="border-t border-[var(--color-border)]">
                    <td className="py-2 px-1">{formatShort(c.date)}</td>
                    <td className="py-2 px-1"><Badge tone="info">{c.type}</Badge></td>
                    <td className="py-2 px-1 font-bold numerals-tabular">${c.amount.toFixed(2)}</td>
                    <td className="py-2 px-1 text-[var(--color-text-secondary)] truncate max-w-[200px]">{c.notes || '—'}</td>
                    <td className="py-2 px-1 text-right">
                      <button onClick={() => removeCost(i)} aria-label="Delete expense" className="size-7 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-elevated)] inline-flex items-center justify-center">
                        <X className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <VialModal open={vialOpen} onClose={() => setVialOpen(false)} onAdd={(v) => { addVial(v); setVialOpen(false); toast('Vial added'); }} />
      <CostModal open={costOpen} onClose={() => setCostOpen(false)} onAdd={(c) => { addCost(c); setCostOpen(false); toast('Expense logged'); }} />
    </div>
  );
}

function CostTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="text-[20px] font-bold numerals-tabular tracking-tight mt-1">{value}</p>
    </div>
  );
}

interface VialModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (v: Vial) => void;
}
function VialModal({ open, onClose, onAdd }: VialModalProps) {
  const [draft, setDraft] = useState<Vial>({
    name: '',
    dosesPerVial: 4,
    dosesUsed: 0,
    startDate: todayStr(),
    expirationDate: '',
  });
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Add vial" mobileFullscreen>
      <div className="space-y-3">
        <Input label="Label" placeholder="e.g. Pen 1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Doses per vial"
            type="number"
            inputMode="numeric"
            value={draft.dosesPerVial || ''}
            onChange={(e) => setDraft({ ...draft, dosesPerVial: parseInt(e.target.value) || 0 })}
          />
          <Input
            label="Already used"
            type="number"
            inputMode="numeric"
            value={draft.dosesUsed}
            onChange={(e) => setDraft({ ...draft, dosesUsed: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
          <Input label="Expiration" type="date" value={draft.expirationDate} onChange={(e) => setDraft({ ...draft, expirationDate: e.target.value })} />
        </div>
        <Button
          block
          onClick={() => {
            if (!draft.dosesPerVial) return toast('Doses per vial required', 'error');
            onAdd(draft);
          }}
        >
          Add vial
        </Button>
      </div>
    </Modal>
  );
}

interface CostModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (c: Cost) => void;
}
function CostModal({ open, onClose, onAdd }: CostModalProps) {
  const [draft, setDraft] = useState<Cost>({ date: todayStr(), amount: 0, type: 'vial', notes: '' });
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Add expense" mobileFullscreen>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <Input
            label="Amount ($)"
            type="number"
            step="0.01"
            inputMode="decimal"
            value={draft.amount || ''}
            placeholder="299.00"
            onChange={(e) => setDraft({ ...draft, amount: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <Select label="Type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Cost['type'] })}>
          <option value="vial">Vial / pen</option>
          <option value="copay">Copay</option>
          <option value="compound">Compounding pharmacy</option>
          <option value="telehealth">Telehealth visit</option>
          <option value="lab">Lab work</option>
          <option value="other">Other</option>
        </Select>
        <Input label="Notes" placeholder="e.g. Pen 2 from CVS" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        <Button
          block
          onClick={() => {
            if (!draft.date || !draft.amount) return toast('Date and amount required', 'error');
            onAdd(draft);
          }}
        >
          Add expense
        </Button>
      </div>
    </Modal>
  );
}
