/**
 * Phase 25 Plan 25-09 — SubprocessorDiffFeed.
 * HIPAA-12: Renders chronological list of subprocessor snapshot changes.
 *
 * Data: reads subprocessor_snapshots ORDER BY captured_at DESC LIMIT 20.
 * RLS auto-scopes to staff+ (Plan 25-01 select policy).
 *
 * Shows: timestamp, vendor, sha256 hash. Expandable diff is a Phase 30+ enhancement.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface SnapshotRow {
  id: number;
  vendor_name: string;
  captured_at: string;
  content_hash: string;
  source_url: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortHash(hash: string): string {
  return hash.slice(0, 12) + '…';
}

export function SubprocessorDiffFeed() {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error: err } = await supabase
        .from('subprocessor_snapshots')
        .select('id, vendor_name, captured_at, content_hash, source_url')
        .order('captured_at', { ascending: false })
        .limit(20);

      if (cancelled) return;
      setLoading(false);

      if (err) {
        setError(err.message);
        return;
      }

      setSnapshots((data ?? []) as SnapshotRow[]);
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <section aria-labelledby="subprocessor-feed-heading">
      <h2 id="subprocessor-feed-heading" className="text-base font-semibold mb-3">
        Subprocessor Change Log
      </h2>

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          Failed to load subprocessor snapshots: {error}
        </p>
      )}

      {!loading && !error && snapshots.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No snapshots yet. Run the weekly subprocessor-diff cron to capture baselines.
        </p>
      )}

      {snapshots.length > 0 && (
        <ol className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {snapshots.map((snap) => (
            <li key={snap.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className="font-medium">{snap.vendor_name}</span>
                <time
                  dateTime={snap.captured_at}
                  className="text-[var(--color-text-secondary)] text-xs"
                >
                  {formatDate(snap.captured_at)}
                </time>
              </div>
              <p className="mt-1 text-[var(--color-text-secondary)] font-mono text-xs">
                sha256: {shortHash(snap.content_hash)}
                <a
                  href={snap.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-3 text-[var(--color-primary)] underline"
                  aria-label={`View subprocessor page for ${snap.vendor_name} (opens in new tab)`}
                >
                  source
                </a>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
