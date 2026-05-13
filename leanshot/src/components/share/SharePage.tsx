/**
 * Phase 8 Plan 08-04 — Doctor read-share top-level component.
 *
 * State machine:
 *   loading       → initial mount; fetchSnapshot in-flight
 *   needs-code    → 401 'requires-code' or 'invalid-session' → CodeEntryScreen
 *   rendering     → 200 → snapshot rendered (chart + sections + doctor report)
 *   revoked       → 401 'revoked' → ShareRevokedScreen kind='revoked'
 *   expired       → 401 'expired' → ShareRevokedScreen kind='expired'
 *   error         → any other failure / network → ShareRevokedScreen kind='load-error'
 *
 * Polling (HI-4): while rendering, /snapshot is polled every 5_000 ms so a
 * revoke from the patient side (Plan 08-03) flips the doctor view to
 * ShareRevokedScreen within 5-6s. DB check is <150ms per D-02 so 5s is well
 * inside the cost ceiling and satisfies SC#3 "within seconds" tightly.
 *
 * INVARIANT — no Zustand store reads, no supabase client imports anywhere in
 * this module. The chart + DoctorReport are reused via the new optional
 * snapshot props added in this plan (HI-5); they keep their own Zustand
 * fallback for the dashboard call site.
 *
 * Per BL-1 (Plan 08-02), the /snapshot 200 response includes an opaque
 * `share_id`. We capture it into local state so Plan 08-06's print-only
 * footer can render it without any further data plumbing.
 */

import { Printer } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatShort } from '@/lib/helpers';
import type { SnapshotResponse } from '@/types/share';
import { CodeEntryScreen } from './CodeEntryScreen';
import { ShareRevokedScreen } from './ShareRevokedScreen';
import { fetchSnapshot } from './share-client';

// Lazy-load chart + doctor report so they ride their existing chunks
// (vendor-charts + the dashboard modal split). They never touch Zustand on
// this route — they receive the snapshot via the HI-5 optional props.
const MedLevelChart = lazy(() =>
  import('@/components/dashboard/charts/MedLevelChart').then((m) => ({
    default: m.MedLevelChart,
  })),
);
const DoctorReport = lazy(() =>
  import('@/components/dashboard/modals/DoctorReport').then((m) => ({ default: m.DoctorReport })),
);

type State =
  | { kind: 'loading' }
  | { kind: 'needs-code' }
  | {
      kind: 'rendering';
      snapshot: SnapshotResponse['snapshot'];
      expiresAt: string;
      shareId: string;
    }
  | { kind: 'revoked' }
  | { kind: 'expired' }
  | { kind: 'error' };

interface Props {
  token: string;
}

export function SharePage({ token }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [doctorReportOpen, setDoctorReportOpen] = useState(true);

  const load = useCallback(async () => {
    const result = await fetchSnapshot(token);
    if (result.ok) {
      setState({
        kind: 'rendering',
        snapshot: result.data.snapshot,
        expiresAt: result.data.expires_at,
        // BL-1 — opaque share_id captured for Plan 08-06 print footer
        shareId: result.data.share_id,
      });
      return;
    }
    switch (result.error) {
      case 'requires-code':
      case 'invalid-session':
        setState({ kind: 'needs-code' });
        return;
      case 'revoked':
        setState({ kind: 'revoked' });
        return;
      case 'expired':
        setState({ kind: 'expired' });
        return;
      case 'not-found':
      default:
        setState({ kind: 'error' });
        return;
    }
  }, [token]);

  // Initial fetch
  useEffect(() => {
    void load();
  }, [load]);

  // HI-4: 5s polling while rendering — picks up revocation / expiry within
  // one cycle. Polling stops as soon as the state transitions away from
  // 'rendering' (revoked / expired / error). The setInterval is cleared on
  // unmount and on state-kind change.
  useEffect(() => {
    if (state.kind !== 'rendering') return;
    // HI-4 — 5s cadence; DB check is <150ms per D-02 so this stays well
    // inside the cost ceiling and satisfies SC#3 "within seconds" tightly.
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, [state.kind, load]);

  if (state.kind === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
        <Card padding="lg" className="w-full max-w-2xl">
          <h2 className="text-[18px] font-semibold mb-4">Opening shared record…</h2>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-40 w-full mt-2" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </Card>
      </main>
    );
  }

  if (state.kind === 'needs-code') {
    return <CodeEntryScreen token={token} onSuccess={load} />;
  }

  if (state.kind === 'revoked') return <ShareRevokedScreen kind="revoked" />;
  if (state.kind === 'expired') return <ShareRevokedScreen kind="expired" />;
  if (state.kind === 'error') return <ShareRevokedScreen kind="load-error" />;

  // Rendering — read-only patient view (UI-SPEC §"State C")
  const { snapshot, expiresAt, shareId } = state;
  // Reference shareId so unused-var lint passes — Plan 08-06's print footer
  // will consume this; the capture from BL-1 lands here.
  void shareId;

  return (
    <main className="min-h-screen bg-[var(--color-bg)] pb-16">
      <div className="max-w-3xl mx-auto px-4 pt-8 flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
            Read-only share
          </p>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {snapshot.patient_first_name}'s LeanShot record
              </h1>
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                Expires {formatShort(expiresAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center px-3 h-8 rounded-pill text-[12px] font-medium bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                aria-label="Status: Recipient verified"
              >
                Recipient verified
              </span>
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Printer className="size-4" aria-hidden />}
                aria-label="Print this share"
                onClick={() => window.print()}
              >
                Print
              </Button>
            </div>
          </div>
        </header>

        <div
          role="note"
          className="rounded-card border border-[var(--color-border)] bg-[var(--color-warning-soft)] p-4 text-[13px] leading-relaxed"
        >
          This is a modeled estimate of medication levels — not a measured serum value. Not medical
          advice. Consult the patient's care plan.
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Drug-level estimate</h2>
          <Card padding="md">
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <MedLevelChart injections={snapshot.injections} weights={snapshot.weights} />
            </Suspense>
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Recent injections</h2>
          <Card padding="md">
            {snapshot.injections.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">None logged.</p>
            ) : (
              <ul role="list" className="flex flex-col gap-2 text-[13px]">
                {snapshot.injections.slice(0, 12).map((i) => (
                  <li
                    key={i.log_id}
                    className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <span>{formatShort(i.timestamp)}</span>
                    <span className="font-bold numerals-tabular">
                      {i.dose} {i.unit}
                    </span>
                    <span className="text-[var(--color-text-secondary)]">{i.site || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Symptoms</h2>
          <Card padding="md">
            {snapshot.symptoms.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">No symptoms logged.</p>
            ) : (
              <ul role="list" className="flex flex-col gap-2 text-[13px]">
                {snapshot.symptoms.slice(0, 20).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <span>{formatShort(s.timestamp)}</span>
                    <span>{s.symptom}</span>
                    <span className="font-bold numerals-tabular">{s.severity}/5</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Body photos</h2>
          <Card padding="md">
            {snapshot.photos.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">No photos shared.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {snapshot.photos.map((p) => (
                  <figure key={p.id} className="flex flex-col gap-1">
                    <img
                      src={p.signed_url}
                      alt={`Body photo from ${formatShort(p.timestamp)}`}
                      className="w-full h-auto rounded-md border border-[var(--color-border)]"
                      loading="lazy"
                    />
                    <figcaption className="text-[11px] text-[var(--color-text-tertiary)]">
                      {formatShort(p.timestamp)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Weight log</h2>
          <Card padding="md">
            {snapshot.weights.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">No entries.</p>
            ) : (
              <ul role="list" className="flex flex-col gap-2 text-[13px]">
                {snapshot.weights
                  .slice(-15)
                  .reverse()
                  .map((w) => (
                    <li
                      key={w.id}
                      className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-b-0"
                    >
                      <span>{formatShort(w.timestamp)}</span>
                      <span className="font-bold numerals-tabular">
                        {w.weight_kg.toFixed(1)} kg
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Doctor report</h2>
          <Card padding="md">
            <Suspense fallback={<Skeleton className="h-32 w-full" />}>
              <DoctorReport
                open={doctorReportOpen}
                onClose={() => setDoctorReportOpen(false)}
                snapshot={snapshot}
                readOnly
              />
            </Suspense>
          </Card>
        </section>

        <footer className="text-[12px] text-[var(--color-text-tertiary)] text-center pt-4 border-t border-[var(--color-border)]">
          Shared via LeanShot · This window will close automatically when the share expires or is
          revoked.
        </footer>
      </div>
    </main>
  );
}
