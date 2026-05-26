/**
 * Phase 60 Plan 60-09 — FederatedSourcesPage.
 *
 * Admin page at /admin/rag/federated (via RagLayout SUB_ROUTES).
 * Renders 3 FederatedSourceRow instances in stable SQL order (dailymed, openfda, pubmed).
 *
 * Option D resolution (orchestrator decision 2026-05-26):
 *   - "Pull full history" button is rendered DISABLED in FederatedSourceRow.
 *   - The admin-action-token auth mechanism is deferred to 60-15.
 *   - triggerHistoricalPull is imported (wired to handler below) but never
 *     actually invoked from this page until 60-15 enables the button.
 *
 * Carry-over to 60-15:
 *   "ship admin-action-token mechanism + wire Pull-history button in FederatedSourceRow"
 *
 * Typography: 11/13/18 only — no 16px classes (UI-SPEC §2 ceiling).
 * Pattern: useState + useEffect + void fetchFn() — matches RagTopicsPage.tsx convention.
 */

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';
import {
  listFederatedSources,
  setFederatedSourceEnabled,
  triggerHistoricalPull,
  SOURCE_META,
  type FederatedSource,
} from '@/lib/admin/rag/federated-api';
import { FederatedSourceRow } from './FederatedSourceRow';

export default function FederatedSourcesPage() {
  const toast = useToast();
  const [sources, setSources] = useState<FederatedSource[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Per-source busy state keyed by source name
  const [toggleBusy, setToggleBusy] = useState<Record<string, boolean>>({});
  const [pullBusy, setPullBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void listFederatedSources()
      .then((rows) => {
        if (!cancelled) setSources(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : 'Unknown error loading federated sources');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (name: FederatedSource['name'], enabled: boolean): Promise<void> => {
    if (!sources) return;

    // Optimistic update
    const prev = sources;
    setSources(sources.map((s) => (s.name === name ? { ...s, enabled } : s)));
    setToggleBusy((b) => ({ ...b, [name]: true }));

    try {
      await setFederatedSourceEnabled(name, enabled);
      const meta = SOURCE_META[name];
      toast(`${meta.display_name} sync ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (e: unknown) {
      // Rollback on error
      setSources(prev);
      const meta = SOURCE_META[name];
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast(`Failed to update ${meta.display_name}: ${msg}`, 'error');
    } finally {
      setToggleBusy((b) => ({ ...b, [name]: false }));
    }
  };

  const handleTriggerPull = async (name: FederatedSource['name']): Promise<void> => {
    setPullBusy((b) => ({ ...b, [name]: true }));
    try {
      await triggerHistoricalPull(name);
      const meta = SOURCE_META[name];
      toast(`Historical pull queued for ${meta.display_name}`, 'success');
    } catch (e: unknown) {
      const meta = SOURCE_META[name];
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast(`Failed to pull history for ${meta.display_name}: ${msg}`, 'error');
    } finally {
      setPullBusy((b) => ({ ...b, [name]: false }));
    }
  };

  if (sources === null && err === null) {
    return (
      <div className="p-6 text-[13px] text-[var(--color-text-secondary)]">
        Loading federated sources…
      </div>
    );
  }

  if (err) {
    return (
      <EmptyState
        title="Failed to load federated sources"
        body="Refresh to try again."
        inline
      />
    );
  }

  if (sources && sources.length === 0) {
    return (
      <EmptyState
        title="No access"
        body="Federated source management is restricted to staff accounts."
        inline
      />
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-[18px] font-semibold tracking-tight">Federated Sources</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Manage external data adapter sync schedules and historical backfills.
        </p>
      </header>

      {/* Source rows — rendered in SQL alphabetical order: dailymed, openfda, pubmed */}
      <ul className="space-y-3 list-none p-0 m-0">
        {(sources ?? []).map((source) => (
          <li key={source.name}>
            <FederatedSourceRow
              source={source}
              onToggle={(enabled) => void handleToggle(source.name, enabled)}
              onTriggerPull={() => void handleTriggerPull(source.name)}
              isToggleBusy={toggleBusy[source.name] ?? false}
              isPullBusy={pullBusy[source.name] ?? false}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
