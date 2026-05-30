import { Syringe, Plus, ChartLine, Package, ListChecks, TrendingUp, X, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MedLevelChart } from '@/components/dashboard/charts/MedLevelChart';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { CalendarDose } from '@/illustrations/CalendarDose';
import { EmptyInjections } from '@/illustrations/EmptyInjections';
import { PenInjector } from '@/illustrations/PenInjector';
import { VialIllustration } from '@/illustrations/Vial';
import { SITES, siteShort } from '@/lib/constants';
import { formatShort, todayStr } from '@/lib/helpers';
import { cn } from '@/lib/helpers';
import { useActiveProtocolAssignment } from '@/lib/hooks/useActiveProtocolAssignment';
import { HALF_LIVES, TITRATION } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';
import type { DoseUnit, Injection, InjectionSite, Vial, Cost } from '@/types';

export function MedicationTab() {
  const { t } = useTranslation('patient');
  // Phase 5 G3 (Plan 05-06) — UAT Test 7 reported a TypeError during the
  // SIGNED_OUT view transition: clearUserDataSlices sets user=null and
  // MedicationTab renders one more time before App.tsx swaps the view. The
  // null-guard below (after all hooks, rules-of-hooks compliant) makes that
  // render a clean no-op.
  const user = useStore((s) => s.user);
  const injections = useStore((s) => s.injections);
  // Phase 61 Plan 07 — active protocol assignment for Expected/Logged deviation row (PROTOCOL-07).
  // Hook is called unconditionally (rules-of-hooks); patientId is null when not signed in
  // so the hook returns null data immediately without a DB round-trip.
  // User ID comes from the Supabase signedIn slice (not the LeanShot User shape which lacks id).
  const currentUserId = useStore((s) => s.signedIn?.user?.id ?? null);
  const { data: activeAssignment } = useActiveProtocolAssignment(currentUserId);
  const vials = useStore((s) => s.vials);
  const costs = useStore((s) => s.costs);
  const addInjection = useStore((s) => s.addInjection);
  const removeInjection = useStore((s) => s.removeInjection);
  const addVial = useStore((s) => s.addVial);
  const removeVial = useStore((s) => s.removeVial);
  const consumeVialDose = useStore((s) => s.useVialDose);
  const addCost = useStore((s) => s.addCost);
  const removeCost = useStore((s) => s.removeCost);
  const toast = useToast();

  const [vialOpen, setVialOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  // Phase 5 G3: useState initial value must tolerate user=null. When user
  // becomes null, the next render returns early below; this initializer runs
  // once at mount (when user is non-null per the App.tsx state machine) so
  // the optional chaining is defensive belt-and-braces only.
  const [injForm, setInjForm] = useState({
    datetime: new Date().toISOString().slice(0, 16),
    dose: user?.dose ?? '',
    unit: (user?.doseUnit ?? 'mg') as DoseUnit,
    site: null as InjectionSite | null,
    notes: '',
  });

  // Phase 5 G3 null-guard — see top-of-function comment. MUST come after
  // every hook above so rules-of-hooks ordering stays stable.
  if (!user) return null;

  const halfLifeDays = ((HALF_LIVES[user.medication] ?? 168) / 24).toFixed(1);
  const totalRemaining = vials.reduce((s, v) => s + Math.max(0, v.dosesPerVial - v.dosesUsed), 0);
  // Most-recent injection by datetime, not injections[0] (store prepends on add,
  // so [0] is wrong after backdating a shot or any cloud/Realtime merge).
  const lastInj = injections.length
    ? injections.reduce((a, b) =>
        new Date(b.datetime).getTime() > new Date(a.datetime).getTime() ? b : a,
      )
    : undefined;
  const lastInjDays = lastInj
    ? Math.floor((Date.now() - new Date(lastInj.datetime).getTime()) / 86_400_000)
    : null;
  const titList = TITRATION[user.medication];
  const weeks = Math.floor((Date.now() - new Date(user.startDate).getTime()) / (7 * 86_400_000));

  const totalSpent = costs.reduce((s, c) => s + (c.amount || 0), 0);
  const monthly = costs
    .filter((c) => Date.now() - new Date(c.date).getTime() < 30 * 86_400_000)
    .reduce((s, c) => s + (c.amount || 0), 0);

  const submitInjection = (): void => {
    if (!injForm.datetime)
      return toast(t('patient:tab.medication.toast_datetime_required'), 'error');
    addInjection(injForm as Injection);
    toast(t('patient:tab.medication.toast_injection_logged'));
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
      <StatTile
        label={t('patient:tab.medication.stat_current_dose')}
        value={user.dose}
        unit={user.doseUnit}
      />
      <StatTile
        label={t('patient:tab.medication.stat_last_shot')}
        value={lastInjDays != null ? lastInjDays : '—'}
        unit={lastInjDays != null ? t('patient:tab.medication.stat_last_shot_unit') : ''}
      />
      <StatTile
        label={t('patient:tab.medication.stat_total_injections')}
        value={injections.length}
      />
      <StatTile
        label={t('patient:tab.medication.stat_doses_remaining')}
        value={totalRemaining > 0 ? totalRemaining : '—'}
      />

      {/* Hero: full-width medication-level chart */}
      <Card span={12}>
        <CardHeader
          title={t('patient:tab.medication.chart_title')}
          icon={<ChartLine className="size-4" />}
          action={
            <Badge tone="info">
              {t('patient:tab.medication.half_life_badge', { days: halfLifeDays })}
            </Badge>
          }
        />
        <MedLevelChart height={300} />
        <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2">
          {t('patient:tab.medication.chart_footnote')}
        </p>
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.medication.log_title')}
          icon={<Syringe className="size-4" />}
          action={<PenInjector className="w-16" />}
        />
        <div className="space-y-3">
          <Input
            label={t('patient:tab.medication.label_datetime')}
            type="datetime-local"
            value={injForm.datetime}
            onChange={(e) => setInjForm({ ...injForm, datetime: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('patient:tab.medication.label_dose')}
              inputMode="decimal"
              placeholder={user.dose}
              value={injForm.dose}
              onChange={(e) => setInjForm({ ...injForm, dose: e.target.value })}
              data-testid="injection-dose-input"
            />
            <Select
              label={t('patient:tab.medication.label_unit')}
              value={injForm.unit}
              onChange={(e) => setInjForm({ ...injForm, unit: e.target.value as DoseUnit })}
            >
              <option value="mg">mg</option>
              <option value="units">units</option>
              <option value="ml">ml</option>
            </Select>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
              {t('patient:tab.medication.site_rotate')}
            </p>
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
          <Textarea
            label={t('patient:tab.medication.label_notes')}
            rows={2}
            value={injForm.notes}
            onChange={(e) => setInjForm({ ...injForm, notes: e.target.value })}
          />
          <Button block onClick={submitInjection} data-testid="injection-submit">
            {t('patient:tab.medication.action_log_injection')}
          </Button>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.medication.vials_title')}
          icon={<Package className="size-4" />}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setVialOpen(true)}
              leadingIcon={<Plus className="size-3.5" />}
            >
              {t('patient:tab.medication.action_add_vial')}
            </Button>
          }
        />
        {vials.length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptyInjections className="w-32" />}
            title={t('patient:tab.medication.vials_empty_title')}
            body={t('patient:tab.medication.vials_empty_body')}
            cta={
              <Button
                size="sm"
                onClick={() => setVialOpen(true)}
                leadingIcon={<Plus className="size-3.5" />}
              >
                {t('patient:tab.medication.action_add_vial')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {vials.map((v, i) => {
              const remaining = v.dosesPerVial - v.dosesUsed;
              const pct = Math.max(0, Math.min(100, (remaining / v.dosesPerVial) * 100));
              const expDays = v.expirationDate
                ? Math.floor((new Date(v.expirationDate).getTime() - Date.now()) / 86_400_000)
                : null;
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
                      {t('patient:tab.medication.vial_doses_of', {
                        remaining,
                        total: v.dosesPerVial,
                      })}
                      {expDays != null
                        ? ` · ${t('patient:tab.medication.vial_expires', { days: expDays })}`
                        : ''}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => consumeVialDose(i)}
                        disabled={remaining <= 0}
                      >
                        {t('patient:tab.medication.action_minus_dose')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeVial(i)}
                        aria-label={t('patient:tab.medication.aria_delete_vial')}
                      >
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
        <CardHeader
          title={t('patient:tab.medication.titration_title')}
          icon={<TrendingUp className="size-4" />}
        />
        {titList ? (
          <div className="flex gap-4 items-start">
            <CalendarDose className="w-24 shrink-0" />
            <div className="flex-1 space-y-1.5">
              {titList.map((step) => {
                const wks = step.w.split('–');
                const start = parseInt(wks[0] ?? '0') || 0;
                const end = wks[1] ? parseInt(wks[1]) : 999;
                const isCurrent = weeks >= start && weeks <= end;
                return (
                  <div
                    key={step.d + step.w}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-2xl border',
                      isCurrent
                        ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)]'
                        : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)]',
                    )}
                  >
                    <span className="font-bold text-[14px] min-w-[60px]">{step.d}</span>
                    <span className="flex-1 text-[12px] text-[var(--color-text-secondary)]">
                      <strong className="text-[var(--color-text)]">
                        {t('patient:tab.medication.titration_week', { week: step.w })}
                      </strong>
                      {step.n ? ` — ${step.n}` : ''}
                    </span>
                    {isCurrent && (
                      <Badge tone="info" pulse>
                        {t('patient:tab.medication.titration_you')}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            {t('patient:tab.medication.titration_custom')}
          </p>
        )}
      </Card>

      <Card span={6}>
        <CardHeader
          title={t('patient:tab.medication.recent_title')}
          icon={<ListChecks className="size-4" />}
        />
        {injections.length === 0 ? (
          <EmptyState
            inline
            illustration={<EmptyInjections className="w-32" />}
            title={t('patient:tab.medication.recent_empty_title')}
            body={t('patient:tab.medication.recent_empty_body')}
          />
        ) : (
          <div className="overflow-x-auto -mx-1" data-testid="injection-list">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.medication.col_date')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.medication.col_dose')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.medication.col_site')}
                  </th>
                  <th className="px-1" aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {injections.slice(0, 8).map((i, idx) => {
                  // Phase 61 Plan 07 — Expected/Logged deviation row (PROTOCOL-07).
                  // Non-destructive: only annotates; never overwrites logged data.
                  // Only show when: active assignment exists, currentStep exists,
                  // logged dose differs from expected, and dose is in 'mg' units.
                  const expectedMg = activeAssignment?.currentStep?.dose_mg ?? null;
                  const loggedMg = i.unit === 'mg' ? parseFloat(i.dose) : null;
                  const showDeviation =
                    expectedMg !== null &&
                    loggedMg !== null &&
                    !isNaN(loggedMg) &&
                    Math.abs(expectedMg - loggedMg) > Number.EPSILON;
                  const deviationPct =
                    showDeviation && expectedMg !== 0
                      ? Math.abs(expectedMg - loggedMg!) / expectedMg
                      : 0;
                  const loggedClass =
                    deviationPct > 0.2
                      ? 'text-[var(--color-warning)]'
                      : 'text-[var(--color-text-secondary)]';
                  return (
                    <tr key={idx} className="border-t border-[var(--color-border)]">
                      <td className="py-2 px-1">{formatShort(i.datetime)}</td>
                      <td className="py-2 px-1">
                        <span className="font-bold numerals-tabular">
                          {i.dose} {i.unit}
                        </span>
                        {showDeviation && (
                          <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                            Expected: <span className="font-mono tabular-nums">{expectedMg}mg</span>
                            <span className="mx-1 text-[var(--color-text-tertiary)]">•</span>
                            Logged:{' '}
                            <span className={cn('font-mono tabular-nums', loggedClass)}>
                              {loggedMg}mg
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-1 text-[var(--color-text-secondary)]">
                        {siteShort(i.site ?? '—')}
                      </td>
                      <td className="py-2 px-1 text-end">
                        <button
                          onClick={() => removeInjection(idx)}
                          aria-label={t('patient:tab.medication.aria_delete_injection', {
                            date: formatShort(i.datetime),
                          })}
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

      <Card span={12}>
        <CardHeader
          title={t('patient:tab.medication.cost_title')}
          icon={<Wallet className="size-4" />}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCostOpen(true)}
              leadingIcon={<Plus className="size-3.5" />}
            >
              {t('patient:tab.medication.action_add_expense')}
            </Button>
          }
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <CostTile
            label={t('patient:tab.medication.cost_total')}
            value={`$${totalSpent.toFixed(0)}`}
          />
          <CostTile
            label={t('patient:tab.medication.cost_per_dose')}
            value={`$${injections.length > 0 ? (totalSpent / injections.length).toFixed(0) : '0'}`}
          />
          <CostTile
            label={t('patient:tab.medication.cost_last_30')}
            value={`$${monthly.toFixed(0)}`}
          />
          <CostTile
            label={t('patient:tab.medication.cost_annual')}
            value={`$${(monthly * 12).toFixed(0)}`}
          />
        </div>
        {costs.length === 0 ? (
          <EmptyState
            inline
            title={t('patient:tab.medication.cost_empty_title')}
            body={t('patient:tab.medication.cost_empty_body')}
            cta={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCostOpen(true)}
                leadingIcon={<Plus className="size-3.5" />}
              >
                {t('patient:tab.medication.action_add_expense')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.medication.col_date')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.medication.col_type')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.medication.col_amount')}
                  </th>
                  <th className="text-start font-semibold py-2 px-1">
                    {t('patient:tab.medication.col_notes')}
                  </th>
                  <th aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {costs.slice(0, 20).map((c, i) => (
                  <tr key={i} className="border-t border-[var(--color-border)]">
                    <td className="py-2 px-1">{formatShort(c.date)}</td>
                    <td className="py-2 px-1">
                      <Badge tone="info">{c.type}</Badge>
                    </td>
                    <td className="py-2 px-1 font-bold numerals-tabular">${c.amount.toFixed(2)}</td>
                    <td className="py-2 px-1 text-[var(--color-text-secondary)] truncate max-w-[200px]">
                      {c.notes || '—'}
                    </td>
                    <td className="py-2 px-1 text-end">
                      <button
                        onClick={() => removeCost(i)}
                        aria-label={t('patient:tab.medication.aria_delete_expense')}
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

      <VialModal
        open={vialOpen}
        onClose={() => setVialOpen(false)}
        onAdd={(v) => {
          addVial(v);
          setVialOpen(false);
          toast(t('patient:tab.medication.toast_vial_added'));
        }}
      />
      <CostModal
        open={costOpen}
        onClose={() => setCostOpen(false)}
        onAdd={(c) => {
          addCost(c);
          setCostOpen(false);
          toast(t('patient:tab.medication.toast_expense_logged'));
        }}
      />
    </div>
  );
}

function CostTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        {label}
      </p>
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
  const { t } = useTranslation('patient');
  const [draft, setDraft] = useState<Vial>({
    name: '',
    dosesPerVial: 4,
    dosesUsed: 0,
    startDate: todayStr(),
    expirationDate: '',
  });
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('patient:tab.medication.action_add_vial')}
      mobileFullscreen
    >
      <div className="space-y-3">
        <Input
          label={t('patient:tab.medication.vial_label')}
          placeholder="e.g. Pen 1"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('patient:tab.medication.vial_doses_per')}
            type="number"
            inputMode="numeric"
            value={draft.dosesPerVial || ''}
            onChange={(e) => setDraft({ ...draft, dosesPerVial: parseInt(e.target.value) || 0 })}
          />
          <Input
            label={t('patient:tab.medication.vial_already_used')}
            type="number"
            inputMode="numeric"
            value={draft.dosesUsed}
            onChange={(e) => setDraft({ ...draft, dosesUsed: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('patient:tab.medication.vial_start_date')}
            type="date"
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
          />
          <Input
            label={t('patient:tab.medication.vial_expiration')}
            type="date"
            value={draft.expirationDate}
            onChange={(e) => setDraft({ ...draft, expirationDate: e.target.value })}
          />
        </div>
        <Button
          block
          onClick={() => {
            if (!draft.dosesPerVial)
              return toast(t('patient:tab.medication.vial_doses_required'), 'error');
            onAdd(draft);
          }}
        >
          {t('patient:tab.medication.action_add_vial')}
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
  const { t } = useTranslation('patient');
  const [draft, setDraft] = useState<Cost>({
    date: todayStr(),
    amount: 0,
    type: 'vial',
    notes: '',
  });
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('patient:tab.medication.action_add_expense')}
      mobileFullscreen
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('patient:tab.medication.col_date')}
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
          <Input
            label={t('patient:tab.medication.cost_amount_label')}
            type="number"
            step="0.01"
            inputMode="decimal"
            value={draft.amount || ''}
            placeholder="299.00"
            onChange={(e) => setDraft({ ...draft, amount: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <Select
          label={t('patient:tab.medication.col_type')}
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as Cost['type'] })}
        >
          <option value="vial">{t('patient:tab.medication.cost_type_vial')}</option>
          <option value="copay">{t('patient:tab.medication.cost_type_copay')}</option>
          <option value="compound">{t('patient:tab.medication.cost_type_compound')}</option>
          <option value="telehealth">{t('patient:tab.medication.cost_type_telehealth')}</option>
          <option value="lab">{t('patient:tab.medication.cost_type_lab')}</option>
          <option value="other">{t('patient:tab.medication.cost_type_other')}</option>
        </Select>
        <Input
          label={t('patient:tab.medication.col_notes')}
          placeholder="e.g. Pen 2 from CVS"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
        <Button
          block
          onClick={() => {
            if (!draft.date || !draft.amount)
              return toast(t('patient:tab.medication.cost_date_amount_required'), 'error');
            onAdd(draft);
          }}
        >
          {t('patient:tab.medication.action_add_expense')}
        </Button>
      </div>
    </Modal>
  );
}
