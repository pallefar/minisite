/**
 * Phase 22 Plan 22-06 — /admin/members (ADMIN-01).
 *
 * Composition root for the operator members surface. Owns:
 *   - is_staff gate (via AdminLayout)
 *   - filter state (tier + search) + URL serialization (?page= &size= &tier= &q=)
 *   - data fetch via admin-api.listMembers (30s polling per planner truth set)
 *   - KPI strip (4 cards: total · paid · clinic seats · 30d churn placeholder)
 *   - MembersFilterBar + MembersTable + pagination footer
 *
 * NOTE: KPI churn metric requires the dedicated ADMIN-02 `/admin/metrics`
 * page (plan 22-07 / future). For v1.2 the KPI strip shows zero with a "—"
 * placeholder for churn; client-side aggregates for total/paid/clinic are
 * computed off the current page (correct only when total ≤ page size; for
 * v1.2 user counts <10k this is acceptable — flagged in SUMMARY as deferred
 * for v1.3 `admin_members_kpi_strip` RPC).
 *
 * NOTE: This file does not self-route — App.tsx wiring is plan 22-12.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import {
  MembersFilterBar,
  type TierFilterValue,
} from '@/components/admin/members/MembersFilterBar';
import { MembersTable } from '@/components/admin/members/MembersTable';
import { Button } from '@/components/ui/Button';
import { Card, StatTile } from '@/components/ui/Card';
import {
  AdminApiError,
  listMembers,
  type Member,
  type MemberTier,
} from '@/lib/admin/admin-api';

const POLL_INTERVAL_MS = 30_000;
const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof ALLOWED_PAGE_SIZES)[number];

function readUrlState(): {
  tier: TierFilterValue;
  search: string;
  page: number;
  size: PageSize;
} {
  if (typeof window === 'undefined') {
    return { tier: 'all', search: '', page: 1, size: 50 };
  }
  const params = new URLSearchParams(window.location.search);
  const tierParam = params.get('tier') as TierFilterValue | null;
  const sizeParam = parseInt(params.get('size') ?? '50', 10);
  const pageParam = parseInt(params.get('page') ?? '1', 10);
  const allowedTiers: TierFilterValue[] = ['all', 'free', 'paid', 'clinic_seat', 'past_due'];
  return {
    tier: tierParam && allowedTiers.includes(tierParam) ? tierParam : 'all',
    search: params.get('q') ?? '',
    page: Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1,
    size: (ALLOWED_PAGE_SIZES as readonly number[]).includes(sizeParam)
      ? (sizeParam as PageSize)
      : 50,
  };
}

function writeUrlState(s: {
  tier: TierFilterValue;
  search: string;
  page: number;
  size: PageSize;
}): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (s.tier !== 'all') params.set('tier', s.tier);
  if (s.search) params.set('q', s.search);
  if (s.page !== 1) params.set('page', String(s.page));
  if (s.size !== 50) params.set('size', String(s.size));
  const next = params.toString();
  const url = `${window.location.pathname}${next ? '?' + next : ''}`;
  window.history.replaceState({}, '', url);
}

/**
 * Inner content component — only mounts AFTER `AdminLayout` has confirmed
 * `is_staff = true`. Keeping the data-fetching `useEffect` here (rather
 * than on `AdminMembersPage`) is what prevents the RPC from firing during
 * the is_staff probe or for non-staff callers (Pattern S1 client-side
 * mirror: client gate is UX-only, but it MUST not pre-fetch admin data).
 */
function MembersPageContent() {
  const initial = useMemo(() => readUrlState(), []);
  const [tier, setTier] = useState<TierFilterValue>(initial.tier);
  const [search, setSearch] = useState<string>(initial.search);
  const [page, setPage] = useState<number>(initial.page);
  const [size, setSize] = useState<PageSize>(initial.size);
  const [rows, setRows] = useState<Member[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const result = await listMembers({
        search: search || null,
        tier: tier === 'all' ? null : (tier as MemberTier),
        page,
        size,
      });
      setRows(result.rows);
    } catch (e) {
      if (e instanceof AdminApiError && e.code === 'not_staff') {
        // AdminLayout client gate already prevents this; covers race
        // between gate resolution and fetch.
        setErrorMessage('You no longer have access to this page.');
      } else {
        setErrorMessage("Couldn't load members. Try refreshing.");
      }
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [search, tier, page, size]);

  useEffect(() => {
    void fetchRows();
    const t = setInterval(() => {
      void fetchRows();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchRows]);

  useEffect(() => {
    writeUrlState({ tier, search, page, size });
  }, [tier, search, page, size]);

  // Reset page to 1 when filters change.
  const onTierChange = (next: TierFilterValue) => {
    setTier(next);
    setPage(1);
  };
  const onSearchChange = (next: string) => {
    setSearch(next);
    setPage(1);
  };
  const onSizeChange = (next: PageSize) => {
    setSize(next);
    setPage(1);
  };

  // Client-side KPI aggregates over current page (deferred v1.3: dedicated RPC).
  const kpi = useMemo(() => {
    if (!rows) return { total: 0, paid: 0, clinic: 0 };
    let paid = 0;
    let clinic = 0;
    for (const r of rows) {
      if (r.tier === 'paid') paid += 1;
      if (r.tier === 'clinic_seat') clinic += 1;
    }
    return { total: rows.length, paid, clinic };
  }, [rows]);

  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-12 gap-4 md:gap-6 mb-6">
        <StatTile span={3} label="Total members" value={kpi.total} />
        <StatTile span={3} label="Paid" value={kpi.paid} />
        <StatTile span={3} label="Clinic seats" value={kpi.clinic} />
        <StatTile span={3} label="30d churn" value="—" unit="%" />
      </div>

      <MembersFilterBar
        tier={tier}
        onTierChange={onTierChange}
        search={search}
        onSearchChange={onSearchChange}
      />

      {errorMessage && (
        <Card variant="flat" padding="md" className="mb-4">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {errorMessage}
          </p>
        </Card>
      )}

      <MembersTable
        rows={rows}
        isLoading={isLoading}
        onRowOpen={(userId) => {
          if (typeof window !== 'undefined') {
            window.location.assign(`/admin/members/${userId}`);
          }
        }}
      />

      {/* Pagination footer */}
      <Card variant="flat" padding="md" className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[var(--color-text-secondary)]">
          {rows && rows.length > 0
            ? `Showing ${(page - 1) * size + 1}–${(page - 1) * size + rows.length} on page ${page}`
            : 'No results'}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--color-text-secondary)]" htmlFor="page-size">
            Page size
          </label>
          <select
            id="page-size"
            className="h-8 text-xs rounded-pill border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3"
            value={size}
            onChange={(e) => onSizeChange(parseInt(e.target.value, 10) as PageSize)}
          >
            {ALLOWED_PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!rows || rows.length < size}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </Card>
    </>
  );
}

export function AdminMembersPage() {
  return (
    <AdminLayout active="members" heading="Members">
      <MembersPageContent />
    </AdminLayout>
  );
}

export default AdminMembersPage;
