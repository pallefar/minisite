import { Printer } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SYMPTOMS_LIST, siteShort } from '@/lib/constants';
import { PK_DISCLAIMER_DOCTOR_REPORT } from '@/lib/disclaimers';
import { formatShort } from '@/lib/helpers';
import { medLabel } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';
import type { Injection, SymptomLog, WeightLog } from '@/types';
import type { SnapshotResponse } from '@/types/share';

/**
 * Phase 8 Plan 08-04 (HI-5) — optional snapshot props let the doctor read-share
 * route render this component without touching Zustand. When `snapshot` is
 * provided, the store reads still run (Rules of Hooks) but their values are
 * ignored in favor of the snapshot. When `readOnly` is set (or when snapshot is
 * present), edit affordances are disabled and the print-button label is
 * preserved.
 *
 * INVARIANT: this is the ONLY component shared between the dashboard path
 * (props-less call site in App.tsx) and the share path (snapshot-driven call
 * site in SharePage). Adding `useStore` to `src/components/share/*` is a
 * regression — the share route MUST pass data via props only.
 */
export interface DoctorReportProps {
  open: boolean;
  onClose: () => void;
  /** When provided, treats the entire snapshot as the data source. */
  snapshot?: SnapshotResponse['snapshot'];
  /** Forces read-only chrome even when snapshot is undefined (testing affordance). */
  readOnly?: boolean;
}

/** Map snapshot injections to dashboard Injection rows for table rendering. */
function snapshotInjectionsToRows(
  injections: SnapshotResponse['snapshot']['injections'],
): Injection[] {
  return injections.map((i) => ({
    log_id: i.log_id,
    datetime: i.timestamp,
    dose: String(i.dose),
    unit: i.unit as Injection['unit'],
    site: (i.site || null) as Injection['site'],
    notes: '',
  }));
}

/** Map snapshot weights to dashboard WeightLog rows. */
function snapshotWeightsToRows(weights: SnapshotResponse['snapshot']['weights']): WeightLog[] {
  return weights.map((w) => ({
    date: w.timestamp.slice(0, 10),
    weight: w.weight_kg,
    bodyFat: null,
    ts: new Date(w.timestamp).getTime(),
  }));
}

/** Map snapshot symptoms to dashboard SymptomLog rows. */
function snapshotSymptomLogsToRows(
  symptoms: SnapshotResponse['snapshot']['symptoms'],
): SymptomLog[] {
  return symptoms.map((s) => ({
    date: s.timestamp.slice(0, 10),
    symptom: s.symptom,
    severity: s.severity as 1 | 2 | 3 | 4 | 5,
    notes: '',
  }));
}

export function DoctorReport({ open, onClose, snapshot, readOnly }: DoctorReportProps) {
  // Phase 7 Plan 07-09 (D-06): nullable selector + early-return after hooks.
  // Phase 8 Plan 08-04 (HI-5): the share route passes snapshot data via props;
  // store reads still run (Rules of Hooks) but are ignored when snapshot
  // is present. The dashboard path (no props) continues to read from store.
  const storeUser = useStore((s) => s.user);
  const storeWeights = useStore((s) => s.weights);
  const storeInjections = useStore((s) => s.injections);
  const storeSymptomLogs = useStore((s) => s.symptoms);

  // Resolve data source: snapshot wins; else store. If neither has a logged-in
  // user, return null (mirrors prior dashboard behavior).
  const hasSnapshot = snapshot !== undefined;
  const isReadOnly = readOnly ?? hasSnapshot;
  void isReadOnly; // tracked for future edit-affordance guards (Plan 08-06 print mode)

  if (!hasSnapshot && !storeUser) return null;

  const weights: WeightLog[] = hasSnapshot
    ? snapshotWeightsToRows(snapshot.weights)
    : storeWeights;
  const injections: Injection[] = hasSnapshot
    ? snapshotInjectionsToRows(snapshot.injections)
    : storeInjections;
  const symptoms: SymptomLog[] = hasSnapshot
    ? snapshotSymptomLogsToRows(snapshot.symptoms)
    : storeSymptomLogs;

  const patientName = hasSnapshot ? snapshot.patient_first_name : storeUser!.name;
  const wU = hasSnapshot ? 'kg' : storeUser!.units === 'metric' ? 'kg' : 'lb';

  // Summary-section bits (medication, dose, startWeight, startDate) only exist
  // on the dashboard path — the snapshot intentionally does NOT carry them
  // (SC#3 minimization + Plan 08-01 view definition).
  const summaryAvailable = !hasSnapshot && storeUser !== null;
  const latest = weights[weights.length - 1];
  const lost = summaryAvailable && latest ? storeUser!.startWeight - latest.weight : 0;
  const weeks = summaryAvailable
    ? Math.floor((Date.now() - new Date(storeUser!.startDate).getTime()) / (7 * 86_400_000))
    : 0;
  const recentInj = injections.slice(0, 12);
  const recentSx = symptoms.slice(0, 20);
  const sxCounts: Record<string, number> = {};
  symptoms.forEach((s) => (sxCounts[s.symptom] = (sxCounts[s.symptom] ?? 0) + 1));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Doctor-ready report"
      size="lg"
      headerAction={
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Printer className="size-4" />}
          onClick={() => window.print()}
        >
          Print / save PDF
        </Button>
      }
    >
      <div className="space-y-6 leading-relaxed">
        <header>
          <h2 className="text-[22px] font-bold tracking-tight">
            {patientName} — GLP-1 Journey Report
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Generated {new Date().toLocaleDateString()} · LeanShot
          </p>
        </header>

        {/* CONTEXT D-10: DoctorReport PDF watermark parity — see .planning/phases/03-pharmacology-insights-hardening/03-CONTEXT.md */}
        <aside
          role="note"
          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-[12px] italic text-[var(--color-text-secondary)] print:border-black"
        >
          <strong className="not-italic font-semibold">Pharmacokinetic estimate:</strong>{' '}
          {PK_DISCLAIMER_DOCTOR_REPORT}
        </aside>

        {summaryAvailable && (
          <section className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4">
            <h3 className="text-[14px] font-bold mb-2">Summary</h3>
            <table className="w-full text-[13px]">
              <tbody>
                <Row label="Medication" value={medLabel(storeUser!.medication)} bold />
                <Row
                  label="Current dose"
                  value={`${storeUser!.dose} ${storeUser!.doseUnit} (weekly)`}
                  bold
                />
                <Row
                  label="Started"
                  value={`${formatShort(storeUser!.startDate)} (week ${weeks})`}
                />
                <Row label="Starting weight" value={`${storeUser!.startWeight} ${wU}`} />
                <Row
                  label="Current weight"
                  value={latest ? `${latest.weight.toFixed(1)} ${wU}` : '—'}
                  bold
                />
                <Row
                  label="Total change"
                  value={
                    <span
                      className={
                        lost >= 0
                          ? 'text-[var(--color-success)] font-bold'
                          : 'text-[var(--color-danger)] font-bold'
                      }
                    >
                      {lost >= 0 ? '−' : '+'}
                      {Math.abs(lost).toFixed(1)} {wU} (
                      {storeUser!.startWeight > 0
                        ? ((lost / storeUser!.startWeight) * 100).toFixed(1)
                        : 0}
                      %)
                    </span>
                  }
                />
                <Row label="Total injections" value={String(injections.length)} />
              </tbody>
            </table>
          </section>
        )}

        <section>
          <h3 className="text-[15px] font-bold mb-3">Recent injections</h3>
          {recentInj.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-tertiary)]">None logged.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-left font-semibold py-2">Date</th>
                  <th className="text-left font-semibold py-2">Dose</th>
                  <th className="text-left font-semibold py-2">Site</th>
                  <th className="text-left font-semibold py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {recentInj.map((i, idx) => (
                  <tr key={idx} className="border-t border-[var(--color-border)]">
                    <td className="py-1.5">{formatShort(i.datetime)}</td>
                    <td className="py-1.5 font-bold numerals-tabular">
                      {i.dose} {i.unit}
                    </td>
                    <td className="py-1.5">{siteShort(i.site ?? '—')}</td>
                    <td className="py-1.5 text-[var(--color-text-secondary)]">{i.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h3 className="text-[15px] font-bold mb-3">Side effects</h3>
          {Object.keys(sxCounts).length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-tertiary)]">No side effects logged.</p>
          ) : (
            <>
              <div className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 mb-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                  Lifetime frequency
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(sxCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => {
                      const sym = SYMPTOMS_LIST.find((s) => s.id === k);
                      return (
                        <Badge key={k} tone="warning">
                          {sym?.name ?? k}: {v}×
                        </Badge>
                      );
                    })}
                </div>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                    <th className="text-left font-semibold py-2">Date</th>
                    <th className="text-left font-semibold py-2">SymptomLog</th>
                    <th className="text-left font-semibold py-2">Severity</th>
                    <th className="text-left font-semibold py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSx.map((s, i) => {
                    const sym = SYMPTOMS_LIST.find((x) => x.id === s.symptom);
                    return (
                      <tr key={i} className="border-t border-[var(--color-border)]">
                        <td className="py-1.5">{formatShort(s.date)}</td>
                        <td className="py-1.5">{sym?.name ?? s.symptom}</td>
                        <td className="py-1.5">{s.severity}/5</td>
                        <td className="py-1.5 text-[var(--color-text-secondary)]">
                          {s.notes || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section>
          <h3 className="text-[15px] font-bold mb-3">Recent weight log</h3>
          {weights.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-tertiary)]">No entries.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className="text-left font-semibold py-2">Date</th>
                  <th className="text-left font-semibold py-2">Weight</th>
                  <th className="text-left font-semibold py-2">BF%</th>
                </tr>
              </thead>
              <tbody>
                {weights
                  .slice(-15)
                  .reverse()
                  .map((w) => (
                    <tr key={w.date} className="border-t border-[var(--color-border)]">
                      <td className="py-1.5">{formatShort(w.date)}</td>
                      <td className="py-1.5 numerals-tabular">
                        {w.weight.toFixed(1)} {wU}
                      </td>
                      <td className="py-1.5">{w.bodyFat ? `${w.bodyFat.toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="text-[11px] text-[var(--color-text-tertiary)] italic pt-4 border-t border-[var(--color-border)]">
          Generated by LeanShot. This is a tracking summary, not medical documentation. Always defer
          to your healthcare provider.
        </p>
      </div>
    </Modal>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <tr>
      <td className="py-1 text-[var(--color-text-secondary)] pr-4">{label}</td>
      <td className={`py-1 text-right ${bold ? 'font-bold' : ''}`}>{value}</td>
    </tr>
  );
}
