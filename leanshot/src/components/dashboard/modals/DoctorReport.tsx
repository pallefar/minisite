import { Printer } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useStore } from '@/lib/store';
import { medLabel } from '@/lib/pharmacology';
import { SYMPTOMS_LIST, siteShort } from '@/lib/constants';
import { formatShort } from '@/lib/helpers';

export function DoctorReport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const u = useStore((s) => s.user!);
  const weights = useStore((s) => s.weights);
  const injections = useStore((s) => s.injections);
  const symptoms = useStore((s) => s.symptoms);

  const wU = u.units === 'metric' ? 'kg' : 'lb';
  const latest = weights[weights.length - 1];
  const lost = latest ? u.startWeight - latest.weight : 0;
  const weeks = Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000));
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
        <Button size="sm" variant="secondary" leadingIcon={<Printer className="size-4" />} onClick={() => window.print()}>
          Print / save PDF
        </Button>
      }
    >
      <div className="space-y-6 leading-relaxed">
        <header>
          <h2 className="text-[22px] font-bold tracking-tight">{u.name} — GLP-1 Journey Report</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">Generated {new Date().toLocaleDateString()} · LeanShot</p>
        </header>

        <section className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4">
          <h3 className="text-[14px] font-bold mb-2">Summary</h3>
          <table className="w-full text-[13px]">
            <tbody>
              <Row label="Medication" value={medLabel(u.medication)} bold />
              <Row label="Current dose" value={`${u.dose} ${u.doseUnit} (weekly)`} bold />
              <Row label="Started" value={`${formatShort(u.startDate)} (week ${weeks})`} />
              <Row label="Starting weight" value={`${u.startWeight} ${wU}`} />
              <Row label="Current weight" value={latest ? `${latest.weight.toFixed(1)} ${wU}` : '—'} bold />
              <Row
                label="Total change"
                value={
                  <span className={lost >= 0 ? 'text-[var(--color-success)] font-bold' : 'text-[var(--color-danger)] font-bold'}>
                    {lost >= 0 ? '−' : '+'}{Math.abs(lost).toFixed(1)} {wU}
                    {' '}
                    ({u.startWeight > 0 ? ((lost / u.startWeight) * 100).toFixed(1) : 0}%)
                  </span>
                }
              />
              <Row label="Total injections" value={String(injections.length)} />
            </tbody>
          </table>
        </section>

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
                    <td className="py-1.5 font-bold numerals-tabular">{i.dose} {i.unit}</td>
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
                  {Object.entries(sxCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
                    const sym = SYMPTOMS_LIST.find((s) => s.id === k);
                    return <Badge key={k} tone="warning">{sym?.name ?? k}: {v}×</Badge>;
                  })}
                </div>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                    <th className="text-left font-semibold py-2">Date</th>
                    <th className="text-left font-semibold py-2">Symptom</th>
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
                        <td className="py-1.5 text-[var(--color-text-secondary)]">{s.notes || '—'}</td>
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
                {weights.slice(-15).reverse().map((w) => (
                  <tr key={w.date} className="border-t border-[var(--color-border)]">
                    <td className="py-1.5">{formatShort(w.date)}</td>
                    <td className="py-1.5 numerals-tabular">{w.weight.toFixed(1)} {wU}</td>
                    <td className="py-1.5">{w.bodyFat ? `${w.bodyFat.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="text-[11px] text-[var(--color-text-tertiary)] italic pt-4 border-t border-[var(--color-border)]">
          Generated by LeanShot. This is a tracking summary, not medical documentation. Always defer to your healthcare provider.
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
