/**
 * Phase 27 plan 27-04 — AdminAnomalyAcknowledgeQueue.
 *
 * Operator queue for the firing → acknowledged transition on
 * funnel_anomaly_alerts. Mirrors the shape of
 * src/components/admin/AdminAffiliatesReviewQueue.tsx per 27-PATTERNS D8:
 * filter pills by resolution_status, row list, busy-row guard, per-row Ack
 * button calling acknowledgeAnomalyAlert.
 *
 * Routed under /admin/anomaly. Surfaced from AdminAnomalyBanner's "View queue"
 * button. The full /admin/anomaly settings page (tracked-funnels config UI)
 * is OWNED BY PLAN 27-05 — this component covers ONLY the acknowledge queue.
 */
import { Mail } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import {
  acknowledgeAnomalyAlert,
  AnomalyApiError,
  type AnomalyAlertRow,
  type AnomalyResolutionStatus,
  listFiringAlerts,
} from '@/lib/admin/anomaly/api';
import { supabase } from '@/lib/supabase';

type StatusFilter = 'all' | AnomalyResolutionStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'firing', label: 'Firing' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'all', label: 'All' },
];

const STATUS_BADGE: Record<
  AnomalyResolutionStatus,
  { tone: 'warning' | 'success' | 'neutral'; label: string }
> = {
  firing: { tone: 'warning', label: 'Firing' },
  acknowledged: { tone: 'success', label: 'Acknowledged' },
  resolved: { tone: 'neutral', label: 'Resolved' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function AdminAnomalyAcknowledgeQueue() {
  const toast = useToast();
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [rows, setRows] = useState<AnomalyAlertRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('firing');
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  // Initial probe + load (mirror AdminAffiliatesReviewQueue lines 134-161).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsStaff(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff')
        .eq('id', uid)
        .maybeSingle();
      const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
      if (cancelled) return;
      setIsStaff(staff);
      if (!staff) return;
      await reload(filter);
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
    // Initial load only — filter reload handled by handleFilterClick below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = async (status: StatusFilter): Promise<void> => {
    try {
      const data = await listFiringAlerts(status);
      setRows(data);
      setErrorMessage('');
    } catch {
      setErrorMessage("Couldn't load alerts. Try refreshing.");
      setRows([]);
    }
  };

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, firing: 0, acknowledged: 0, resolved: 0 };
    if (!rows) return c;
    c.all = rows.length;
    for (const r of rows) c[r.resolution_status] += 1;
    return c;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    return rows.filter((r) => r.resolution_status === filter);
  }, [rows, filter]);

  const handleAck = async (rowId: string): Promise<void> => {
    if (busyRowId) return;
    setBusyRowId(rowId);
    try {
      await acknowledgeAnomalyAlert(rowId);
      toast('Alert acknowledged.', 'success');
      await reload(filter);
    } catch (e) {
      if (e instanceof AnomalyApiError && e.code === 'not_staff') {
        toast('Forbidden — admin role required.', 'error');
      } else {
        toast('Could not acknowledge — please retry.', 'error');
      }
    } finally {
      setBusyRowId(null);
    }
  };

  if (isStaff === undefined) return null;

  if (!isStaff) {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
        <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12 text-center">
          <h1 className="text-xl font-semibold mb-2">This area is for admins only</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            You don&apos;t have access to the anomaly queue.
          </p>
          <a
            href="/"
            className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
          >
            Back to home →
          </a>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Funnel anomaly queue</h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Acknowledge fired alerts so the queue clears for the next baseline window.
          </p>
        </div>
      </header>

      <PillGroup segmented className="mb-6" aria-label="Filter by resolution status">
        {STATUS_FILTERS.map((f) => (
          <Pill
            key={f.key}
            size="sm"
            active={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              void reload(f.key);
            }}
            count={counts[f.key]}
            role="tab"
            aria-selected={filter === f.key}
          >
            {f.label}
          </Pill>
        ))}
      </PillGroup>

      {errorMessage && (
        <Card variant="flat" padding="md" className="mb-4">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {errorMessage}
          </p>
        </Card>
      )}

      {rows === null && !errorMessage && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading alerts…</p>
      )}

      {rows !== null && visibleRows.length === 0 && !errorMessage && (
        <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12">
          <EmptyState
            illustration={<Mail className="size-8" aria-hidden />}
            title="No alerts to acknowledge"
            body="When funnel anomalies fire, they'll show up here for one-click acknowledgment."
          />
        </Card>
      )}

      {rows !== null && visibleRows.length > 0 && (
        <Card variant="default" padding="none" className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="anomaly-alerts-table">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Funnel
                </th>
                <th scope="col" className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Observed (24h)
                </th>
                <th scope="col" className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Expected (μ ± σ)
                </th>
                <th scope="col" className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  z-score
                </th>
                <th scope="col" className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Status
                </th>
                <th scope="col" className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Fired
                </th>
                <th scope="col" className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const badge = STATUS_BADGE[r.resolution_status];
                const isFiring = r.resolution_status === 'firing';
                return (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--color-border)] last:border-b-0"
                    data-testid={`alert-row-${r.id}`}
                  >
                    <td className="px-4 py-3 text-sm align-middle font-mono">
                      {r.event_name ?? r.funnel_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-end align-middle">
                      {r.observed_count}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-end align-middle text-[var(--color-text-secondary)]">
                      {Number(r.expected_mean).toFixed(2)} ± {Number(r.expected_stddev).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-end align-middle font-semibold">
                      {Number(r.z_score).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs align-middle text-[var(--color-text-secondary)]">
                      {formatDate(r.fired_at)}
                    </td>
                    <td className="px-4 py-3 text-end align-middle">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!isFiring || busyRowId === r.id}
                        loading={busyRowId === r.id}
                        onClick={() => {
                          void handleAck(r.id);
                        }}
                      >
                        Acknowledge
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

export default AdminAnomalyAcknowledgeQueue;
