/**
 * Phase 51 Plan 51-09 (TRAFFIC-12) — Real-time activity tab.
 *
 * Replaces the Plan 51-05 stub. Calls `get_realtime_traffic_summary` SECDEF
 * RPC (Plan 51-03) every 5 minutes via `setInterval`, paused while
 * `document.visibilityState !== 'visible'`. A secondary 30s tick derives the
 * stale pip state (`fresh` < 5min, `warn` < 10min, `stale` ≥ 10min) from
 * `Date.now() - lastSuccessAt`.
 *
 * Slot contract (Plan 51-05 SUMMARY):
 *   - Named export `TrafficRealtimeTab: React.FC`, zero props.
 *   - Reads role from `s.signedIn?.user?.app_metadata?.role` defensively.
 *
 * UI-SPEC §Real-time polling + §Interaction Contract + §Copywriting Contract.
 * Typography ceiling: 11 / 13 / 18 / 28 px only. No TanStack Query.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { useOrgScope } from './useOrgScope';

type Row = {
  channel_group: string;
  audience: string;
  visits: number;
  signups: number;
  activations: number;
  paids: number;
};

type Freshness = 'fresh' | 'warn' | 'stale';

const POLL_MS = 5 * 60 * 1000;
const STALE_TICK_MS = 30 * 1000;
const WARN_AGE_MS = 5 * 60 * 1000;
const STALE_AGE_MS = 10 * 60 * 1000;

export const TrafficRealtimeTab: React.FC = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [freshness, setFreshness] = useState<Freshness>('fresh');
  const pollRef = useRef<number | null>(null);

  // Defensive read mirroring TrafficDashboardPage shell — Phase 51 Plan 05
  // SUMMARY deviation 4 pinned this shape (s.user.role/org is fictional).
  const role = useStore(
    (s) =>
      (s.signedIn?.user?.app_metadata as { role?: string } | undefined)?.role ??
      null,
  );
  // REVIEW CR-03 + WR-04: forward the clinic_owner's org_id so the SECDEF
  // RPC's `(p_org_id is not null and _is_org_clinician(p_org_id))` branch can
  // authorize. Single source of truth via useOrgScope (canonical:
  // app_metadata.org_id).
  const orgFilter = useOrgScope();

  const fetchRealtime = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('get_realtime_traffic_summary', {
      p_minutes: 60,
      p_org_id: orgFilter,
    });
    if (rpcErr) {
      if (rpcErr.code === '42501') {
        setError('Permission denied — admin role required');
      } else {
        setError('Refresh failed — showing last cached data');
      }
    } else {
      setRows((data as Row[] | null) ?? []);
      setLastSuccessAt(Date.now());
      setError(null);
    }
    setLoading(false);
  }, [orgFilter]);

  // Primary 5-minute interval — visibility-aware. Cleanup on unmount.
  useEffect(() => {
    void fetchRealtime();
    const tick = () => {
      if (document.visibilityState === 'visible') void fetchRealtime();
    };
    pollRef.current = window.setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void fetchRealtime();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchRealtime]);

  // Secondary 30s interval — derives freshness pip state.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (lastSuccessAt == null) return;
      const ageMs = Date.now() - lastSuccessAt;
      if (ageMs < WARN_AGE_MS) setFreshness('fresh');
      else if (ageMs < STALE_AGE_MS) setFreshness('warn');
      else setFreshness('stale');
    }, STALE_TICK_MS);
    return () => window.clearInterval(id);
  }, [lastSuccessAt]);

  const refreshNow = () => {
    void fetchRealtime();
    if (pollRef.current != null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchRealtime();
    }, POLL_MS);
  };

  const totalVisits = rows?.reduce((acc, r) => acc + r.visits, 0) ?? 0;
  const topChannels = rows
    ? [...rows].sort((a, b) => b.visits - a.visits).slice(0, 5)
    : [];

  const pipColor =
    freshness === 'fresh'
      ? 'var(--color-success)'
      : freshness === 'warn'
        ? 'var(--color-warning)'
        : 'var(--color-danger)';
  const pipLabel =
    freshness === 'fresh'
      ? 'fresh'
      : freshness === 'warn'
        ? 'stale (5-10min)'
        : 'very stale (>10min)';
  const lastRefreshLabel = lastSuccessAt
    ? new Date(lastSuccessAt).toLocaleTimeString()
    : '—';

  // Hidden role marker so a future role-aware filter can re-introduce
  // per-org scoping. Today it only documents the role we read.
  const roleMarker = role ?? 'anonymous';

  return (
    <section data-role={roleMarker}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
          Last 60 Minutes
        </h2>
        <div className="flex items-center gap-2">
          <span
            title={`Last refreshed: ${lastRefreshLabel} (${pipLabel})`}
            aria-label={`Data freshness: ${pipLabel}`}
            data-testid="realtime-pip"
            data-freshness={freshness}
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: pipColor }}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RefreshCw size={12} aria-hidden />}
            onClick={refreshNow}
            aria-label="Refresh now"
          >
            Refresh now
          </Button>
        </div>
      </div>

      <p
        className="text-[11px] text-[var(--color-text-secondary)] mb-3"
        aria-live="polite"
      >
        Auto-refreshes every 5 minutes
      </p>

      {loading && rows == null && <Skeleton className="h-64 rounded-card" />}

      {error && (
        <p
          className="text-[13px] text-[var(--color-warning)] mb-3"
          role="status"
          aria-live="polite"
        >
          {error}
        </p>
      )}

      {rows != null && rows.length === 0 && !loading && (
        <EmptyState
          inline
          title="No activity in the last 60 minutes"
          body="Live traffic appears here. Refreshes every 5 minutes."
        />
      )}

      {rows != null && rows.length > 0 && (
        <>
          <Card padding="md" className="mb-4">
            <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
              Visits right now
            </p>
            <p
              className="text-[28px] font-bold numerals-tabular"
              aria-live="polite"
              data-testid="realtime-total-visits"
            >
              {totalVisits.toLocaleString()}
            </p>
          </Card>
          <Card padding="md">
            <h3 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] mb-3">
              Top 5 Channels
            </h3>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] text-left">
                  <th scope="col">Channel</th>
                  <th scope="col" className="text-right">Visits</th>
                  <th scope="col" className="text-right">Signups</th>
                  <th scope="col" className="text-right">Activations</th>
                </tr>
              </thead>
              <tbody>
                {topChannels.map((r) => (
                  <tr key={`${r.channel_group}_${r.audience}`}>
                    <td className="py-2">{r.channel_group}</td>
                    <td className="py-2 text-right numerals-tabular">
                      {r.visits.toLocaleString()}
                    </td>
                    <td className="py-2 text-right numerals-tabular">
                      {r.signups.toLocaleString()}
                    </td>
                    <td className="py-2 text-right numerals-tabular">
                      {r.activations.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </section>
  );
};

export default TrafficRealtimeTab;
