/**
 * Phase 64 Plan 04 (LEGAL-04) — SubprocessorList.
 *
 * Public-facing live view of the subprocessor snapshot pipeline output (Phase 25).
 * Reads public.subprocessor_snapshots via anon-key RLS (verified publicly readable
 * per Phase 25 HIPAA-12 disclosure requirement).
 *
 * Security note (T-64-04-01): selects ONLY captured_at + vendors — no BAA renewal
 * dates, NDA timestamps, or internal compliance metadata. React auto-escapes JSX
 * so XSS via vendors jsonb (T-64-04-02) is mitigated.
 *
 * Token safety (T-64-04-03): only var(--color-*) tokens verified in src/index.css.
 * All colors use bracket-syntax: bg-[var(--color-*)] — no undefined Tailwind v4 tokens.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Vendor {
  name: string;
  purpose: string;
  baa_status: string;
  region?: string;
}

interface SubprocessorSnapshot {
  captured_at: string;
  vendors: Vendor[];
}

type LoadingState = 'loading' | 'empty' | 'error' | 'loaded';

function formatDate(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export function SubprocessorList() {
  const [state, setState] = useState<LoadingState>('loading');
  const [snapshot, setSnapshot] = useState<SubprocessorSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from('subprocessor_snapshots')
        .select('captured_at, vendors')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setState('error');
        return;
      }

      if (!data) {
        setState('empty');
        return;
      }

      setSnapshot(data as SubprocessorSnapshot);
      setState('loaded');
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div role="status" aria-label="Loading subprocessor list">
        <div
          className="animate-pulse rounded bg-[var(--color-surface-elevated)] h-[140px] w-full"
          aria-hidden="true"
        />
        <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
          Loading subprocessor list…
        </p>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        Subprocessor list updating — check back shortly.
      </p>
    );
  }

  if (state === 'error') {
    return (
      <p role="alert" className="text-[13px] text-[var(--color-danger)]">
        Unable to load subprocessor list. Email{' '}
        <a href="mailto:privacy@leanshot.app" className="underline decoration-1 underline-offset-2">
          privacy@leanshot.app
        </a>{' '}
        for the latest list.
      </p>
    );
  }

  const vendors = snapshot?.vendors ?? [];

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-[13px] text-[var(--color-text)]">
          <thead>
            <tr className="bg-[var(--color-surface-elevated)]">
              {['Vendor', 'Purpose', 'BAA Status', 'Region'].map((col) => (
                <th
                  key={col}
                  className="px-4 py-2 text-start text-[13px] font-semibold border-b border-[var(--color-border)]"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vendors.map((v, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 font-semibold">{v.name}</td>
                <td className="px-4 py-2 text-[var(--color-text-secondary)]">{v.purpose}</td>
                <td className="px-4 py-2 text-[var(--color-text-secondary)]">{v.baa_status}</td>
                <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                  {v.region ?? 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {snapshot && (
        <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
          Captured: {formatDate(snapshot.captured_at)} · Live from subprocessor_diff snapshot
          pipeline (Phase 25)
        </p>
      )}
    </div>
  );
}

export default SubprocessorList;
