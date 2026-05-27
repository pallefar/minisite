/**
 * Phase 8 Plan 08-04 — Doctor read-share top-level component.
 * Phase 10 Plan 10-05 — Refactored: snapshot-rendered branch now delegates
 * to ReadOnlyPatientView (shared/ReadOnlyPatientView.tsx) with viewerMode='share'.
 * The state machine (loading / needs-code / rendering / revoked / expired / error)
 * and all share-chrome (header, disclaimer note, print button, footer) are UNCHANGED.
 *
 * State machine:
 *   loading       → initial mount; fetchSnapshot in-flight
 *   needs-code    → 401 'requires-code' or 'invalid-session' → CodeEntryScreen
 *   rendering     → 200 → snapshot rendered via ReadOnlyPatientView
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
 * this module. ReadOnlyPatientView maintains the same invariant.
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
import type { SnapshotData } from '@/types/snapshot';
import { CodeEntryScreen } from './CodeEntryScreen';
import { fetchSnapshot } from './share-client';
import { ShareRevokedScreen } from './ShareRevokedScreen';

// Phase 10 Plan 10-05 — ReadOnlyPatientView is in the new shared chunk
// 'read-only-patient-view'. The share chunk lazy-imports from it so the
// body-section rendering (6 sections) moves out of the share chunk and
// into the shared chunk. This reduces the share chunk size by ~8 kB.
const ReadOnlyPatientView = lazy(() =>
  import('@/components/shared/ReadOnlyPatientView').then((m) => ({
    default: m.ReadOnlyPatientView,
  })),
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

/**
 * Adapt Phase 8 SnapshotResponse['snapshot'] shape to the canonical SnapshotData
 * shape expected by ReadOnlyPatientView.
 *
 * Phase 8 snapshot has a different field naming convention (log_id, timestamp,
 * dose/unit/medication) vs SnapshotData (id, created_at, dose_mg). This adapter
 * bridges the two shapes without modifying either the share Edge Function or
 * the canonical SnapshotData type.
 */
function adaptSnapshotToReadOnly(snap: SnapshotResponse['snapshot']): SnapshotData {
  return {
    patient_user_id: snap.user_id,
    display_name: snap.patient_first_name,
    injections: snap.injections.map((i) => ({
      id: i.log_id,
      dose_mg: i.dose,
      site: i.site,
      created_at: i.timestamp,
    })),
    weights: snap.weights.map((w) => ({
      id: w.id,
      weight_kg: w.weight_kg,
      recorded_at: w.timestamp,
    })),
    symptoms: snap.symptoms.map((s) => ({
      id: s.id,
      name: s.symptom,
      severity: s.severity,
      recorded_at: s.timestamp,
    })),
    photos: snap.photos.map((p) => ({
      id: p.id,
      storage_path: p.signed_url, // share mode: signed_url IS the accessible URL
      taken_at: p.timestamp,
    })),
    viewer_context: 'share',
  };
}

interface Props {
  /**
   * Optional token override (mostly for tests). When omitted, SharePage reads
   * the token from `window.location.hash` directly so App.tsx doesn't have to
   * parse the hash itself (bundle-budget — keeps the regex in the lazy chunk).
   */
  token?: string;
}

/** Extract the share token from a hash route like `#/share/<token>`. */
function tokenFromHash(): string {
  return typeof window !== 'undefined'
    ? window.location.hash.replace(/^#\/share\//, '')
    : '';
}

export function SharePage({ token: tokenProp }: Props = {}) {
  // Resolve token once on mount — App.tsx's render branch doesn't pass it so
  // the hash regex stays inside the lazy chunk and off the index budget.
  const [token] = useState<string>(() => tokenProp ?? tokenFromHash());
  const [state, setState] = useState<State>({ kind: 'loading' });

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
  // Phase 10 Plan 10-05: body section rendering delegated to ReadOnlyPatientView.
  // Share chrome (header, disclaimer note, print button, footers) unchanged.
  const { snapshot, expiresAt, shareId } = state;
  const readOnlySnapshot = adaptSnapshotToReadOnly(snapshot);

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
                {snapshot.patient_first_name}&apos;s LeanShot record
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
          advice. Consult the patient&apos;s care plan.
        </div>

        {/*
          Phase 10 Plan 10-05 — ReadOnlyPatientView with viewerMode='share' renders
          all 6 body sections. No permissionMap passed (share mode: all sections visible).
        */}
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <ReadOnlyPatientView snapshot={readOnlySnapshot} viewerMode="share" />
        </Suspense>

        {/*
          Screen-only footer — hidden in print to avoid duplicating with the
          print-only footer below (per UI-SPEC §"Print flow" step 4).
        */}
        <footer className="text-[12px] text-[var(--color-text-tertiary)] text-center pt-4 border-t border-[var(--color-border)] print:hidden">
          Shared via LeanShot · This window will close automatically when the share expires or is
          revoked.
        </footer>

        {/*
          Print-only footer per UI-SPEC §"Print flow" step 4 + BL-1 (Plan 08-02):
          uses the opaque `share_id` returned by /snapshot — NEVER the patient
          user_id (which would leak the patient identifier across the trust
          boundary). slice(0, 8) keeps the printed identifier short.
        */}
        <footer className="hidden print:block text-[12px] text-center pt-4 border-t border-[var(--color-border)]">
          Shared via LeanShot · {new Date().toLocaleDateString()} · Patient ID redacted (share id{' '}
          {shareId.slice(0, 8)})
        </footer>
      </div>
    </main>
  );
}
