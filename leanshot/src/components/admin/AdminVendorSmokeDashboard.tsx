/**
 * Phase 52 Plan 52-03 — AdminVendorSmokeDashboard.
 *
 * Staff-only admin module that surfaces per-vendor smoke-test results from
 * the `vendor_smoke_log` table at /admin/vendor-smoke.
 *
 * Gate: `vendor_smoke_log` RLS via `public.is_staff()` (server, migration 52-02)
 *       + `minRole: 'superadmin'` ADMIN_MODULES manifest entry (client UX layer).
 *       This is the exact dual-layer pattern used by AdminCompliancePage (Pattern S1).
 *       No MFA/AAL2 guard needed — this is a non-PHI admin surface; no admin module uses AAL2.
 *
 * Data layer modelled on BaaChainTable.tsx.
 * Layout modelled on AdminAffiliatesReviewQueue.tsx.
 * UI primitives from src/components/ui/.
 */
import { Play, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import { NotAuthorizedCard } from '@/components/admin/AdminShell';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SmokeStatus = 'ok' | 'fail' | 'not_configured';

interface VendorSmokeRow {
  vendor_name: string;
  status: SmokeStatus;
  latency_ms: number | null;
  message: string | null;
  checked_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BADGE_TONE: Record<SmokeStatus, 'success' | 'danger' | 'neutral'> = {
  ok: 'success',
  fail: 'danger',
  not_configured: 'neutral',
};

const STATUS_LABEL: Record<SmokeStatus, string> = {
  ok: 'ok',
  fail: 'fail',
  not_configured: 'not configured',
};

// ---------------------------------------------------------------------------
// RunSmokeButton — inline sub-component
// ---------------------------------------------------------------------------

interface RunSmokeButtonProps {
  running: boolean;
  onClick: () => void;
}

function RunSmokeButton({ running, onClick }: RunSmokeButtonProps) {
  return (
    <Button
      variant="primary"
      size="sm"
      loading={running}
      leadingIcon={running ? undefined : <Play size={14} aria-hidden />}
      onClick={onClick}
      {...(running ? { role: 'status' as const } : {})}
    >
      {running ? 'Running…' : 'Run smoke now'}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// AdminVendorSmokeDashboard
// ---------------------------------------------------------------------------

export function AdminVendorSmokeDashboard() {
  const toast = useToast();

  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [rows, setRows] = useState<VendorSmokeRow[] | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [running, setRunning] = useState(false);

  // ── Staff check ────────────────────────────────────────────────────────────
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
      if (!cancelled) setIsStaff(staff);
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const fetchRows = async (): Promise<void> => {
    const { data, error } = await supabase
      .from('vendor_smoke_log')
      .select('vendor_name,status,latency_ms,message,checked_at')
      .order('vendor_name');
    if (error) {
      setFetchError(true);
      return;
    }
    setFetchError(false);
    setRows((data ?? []) as VendorSmokeRow[]);
  };

  useEffect(() => {
    if (isStaff === true) {
      void fetchRows();
    }
  }, [isStaff]);

  // ── Run smoke now ──────────────────────────────────────────────────────────
  const handleRunSmoke = async (): Promise<void> => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('vendor-smoke', { body: {} });
      if (error) {
        toast('Could not trigger smoke check. Check staff permissions and Fn health.', 'error');
      } else {
        toast('Smoke check running — results will update in a few seconds.', 'info');
        await fetchRows();
      }
    } catch {
      toast('Could not trigger smoke check. Check staff permissions and Fn health.', 'error');
    } finally {
      setRunning(false);
    }
  };

  // ── Guard: staff check pending ─────────────────────────────────────────────
  if (isStaff === undefined) return null;

  // ── Guard: not staff ───────────────────────────────────────────────────────
  if (!isStaff) {
    return <NotAuthorizedCard />;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="p-6 min-h-screen bg-[var(--color-bg)]">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
            Vendor health
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Per-vendor smoke test results. Run daily at 08:00 UTC or on demand.
          </p>
        </div>
      </header>

      <Card span={12} variant="default" padding="none">
        <div className="p-4">
          <CardHeader
            title="Vendor integrations"
            icon={<ShieldCheck size={16} aria-hidden />}
            action={<RunSmokeButton running={running} onClick={() => void handleRunSmoke()} />}
          />
        </div>

        {/* Loading */}
        {rows === null && !fetchError && (
          <div className="px-4 pb-4">
            <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
          </div>
        )}

        {/* Error */}
        {fetchError && (
          <div className="px-4 pb-4">
            <Card variant="flat" padding="md">
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                Could not load smoke results. Try refreshing — if the problem persists, check
                Supabase connectivity.
              </p>
            </Card>
          </div>
        )}

        {/* Empty */}
        {rows !== null && rows.length === 0 && !fetchError && (
          <div className="px-4 pb-6">
            <EmptyState
              illustration={<ShieldCheck className="size-8" aria-hidden />}
              title="No smoke results yet"
              body="Run the smoke check to see per-vendor integration health."
              cta={<RunSmokeButton running={running} onClick={() => void handleRunSmoke()} />}
            />
          </div>
        )}

        {/* Table */}
        {rows !== null && rows.length > 0 && !fetchError && (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Vendor
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                    style={{ width: '100px' }}
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                    style={{ width: '130px' }}
                  >
                    Last checked
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                    style={{ width: '80px' }}
                  >
                    Latency
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.vendor_name}
                    className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-elevated)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] outline-none"
                    tabIndex={0}
                    role="row"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                      {row.vendor_name}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={BADGE_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                      {new Date(row.checked_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-[var(--color-text-secondary)]">
                      {row.latency_ms != null ? `${row.latency_ms}ms` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.message ? (
                        <span className="text-xs font-mono text-[var(--color-text-secondary)] max-w-[40ch] truncate block">
                          {row.message}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-secondary)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}

export default AdminVendorSmokeDashboard;
