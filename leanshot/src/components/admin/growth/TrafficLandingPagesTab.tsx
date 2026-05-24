/**
 * Phase 51 Plan 51-08 — TrafficLandingPagesTab (TRAFFIC-12).
 *
 * Top Landing Pages tab in the Traffic dashboard module. Replaces the
 * Plan 51-05 stub at this path; preserves the slot contract (named export
 * `TrafficLandingPagesTab`, zero-prop React.FC, named-export consumed by
 * the lazy() import in `TrafficDashboardPage.tsx`).
 *
 * Data path:
 *   - `supabase.rpc('get_traffic_landing_page_rollup', { p_org_id, p_start_date,
 *     p_end_date, p_audience, p_top_n })` (Plan 51-03 SECDEF accessor).
 *   - Returns rows from `traffic_landing_page_rollup` matview, with
 *     `page_variant_id` nullable (Phase 15 PAGEAB carry-over per 51-03 D-11).
 *
 * Auth + scope:
 *   - Role sourced from `s.signedIn?.user?.app_metadata?.role` (real codebase
 *     shape; see 51-05-SUMMARY § "Sourced clinic_owner role from
 *     s.signedIn?.user?.app_metadata?.role"). PLAN's `s.user?.role` is
 *     fictional — this is the Rule 1 carry-over from sibling Plan 51-05.
 *   - org_id sourced from `s.currentOrg?.id` when role === 'clinic_owner'
 *     (canonical org-context layer; see `src/types/org.ts` OrgContext).
 *     Admin sees all rows by passing `p_org_id=null`.
 *   - 51-03 SECDEF gate `is_admin_at_least('admin')` OR
 *     `_is_org_clinician(p_org_id, auth.uid())` enforces the security
 *     boundary server-side — UI scoping is a UX-only narrowing.
 *
 * UI contract (per 51-UI-SPEC § "Landing Pages tab"):
 *   - Section eyebrow: `Top Landing Pages`
 *   - Filter input placeholder: `Filter by path…` (client-side substring).
 *   - Top-N pill group: `Top 10` / `Top 25` / `Top 50` (default 25).
 *   - Audience pill group: All / Consumer / Clinic-org / Affiliate.
 *   - Table columns: Path, Variant, Visits, Bounce %, Signup Rate, Paid Conv.
 *   - Variant cell shows `—` (em-dash) for non-PAGEAB pages (page_variant_id
 *     is null in matview).
 *   - Sortable: Visits / Bounce % / Signup Rate / Paid Conv (default Visits desc).
 *
 * Typography ceiling: 11/13/18/28 px only — no off-grid literals in this file
 * (verified by per-task grep). The shared `Input` primitive's internal CSS
 * is the primitive's responsibility, not a drift in this file.
 *
 * No `@tanstack/react-query` (per project invariant + plan must_haves).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Inline types — no new types file (mirrors CACDashboardPage convention)
// ---------------------------------------------------------------------------

type Row = {
  landing_path: string;
  page_variant_id: string | null;
  audience: string;
  day: string;
  org_id: string | null;
  visits: number;
  signups: number;
  activations: number;
  paids: number;
};

type AggregatedRow = Row & {
  signup_rate: number;
  paid_conv: number;
  bounce: number;
};

type Audience = 'consumer' | 'clinic-org' | 'affiliate' | 'all';
type TopN = 10 | 25 | 50;
type SortKey = 'visits' | 'signup_rate' | 'paid_conv' | 'bounce';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------

export const TrafficLandingPagesTab: React.FC = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audience, setAudience] = useState<Audience>('all');
  const [topN, setTopN] = useState<TopN>(25);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('visits');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Role-scoped org filter (see file-header rationale).
  const role = useStore(
    (s) =>
      (s.signedIn?.user?.app_metadata as { role?: string } | undefined)?.role ??
      null,
  );
  const currentOrgId = useStore((s) => s.currentOrg?.id ?? null);
  const orgFilter = role === 'clinic_owner' ? currentOrgId : null;

  const { startDate, endDate } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sevenAgo = new Date(Date.now() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    return { startDate: sevenAgo, endDate: today };
  }, []);

  const fetchLanding = useCallback(async () => {
    setLoading(true);
    setError(null);
    // REVIEW CR-04 fix: fetch the server cap (500 — see SECDEF accessor
    // migration ..0012 line 195) so the client-side `Filter by path…` substring
    // search runs over the FULL set, then we slice to the chosen topN after
    // filter + sort. Previously we passed `p_top_n: topN` and filtered the
    // visible N rows — paths matching the filter but ranked below position N
    // by visits were silently invisible (filter found "0" matches for data
    // that exists). The order-by-visits-desc + slice in `tableRows` preserves
    // the same default presentation.
    const { data, error: rpcErr } = await supabase.rpc(
      'get_traffic_landing_page_rollup',
      {
        p_org_id: orgFilter,
        p_start_date: startDate,
        p_end_date: endDate,
        p_audience: audience === 'all' ? null : audience,
        p_top_n: 500,
      },
    );
    if (rpcErr) {
      if (rpcErr.code === '42501') {
        setError('Permission denied — admin role required');
      } else {
        setError(`Failed to load landing pages — ${rpcErr.message}`);
      }
      setRows(null);
    } else {
      setRows((data as Row[]) ?? []);
    }
    setLoading(false);
  }, [orgFilter, audience, startDate, endDate]);

  useEffect(() => {
    void fetchLanding();
  }, [fetchLanding]);

  // Aggregate per (landing_path × page_variant_id) — matview rows are per-day,
  // so we sum within the 7-day window. Then compute rates + apply
  // client-side filter + sort.
  const tableRows = useMemo<AggregatedRow[] | null>(() => {
    if (!rows) return null;
    const agg = new Map<string, AggregatedRow>();
    for (const r of rows) {
      const key = `${r.landing_path}::${r.page_variant_id ?? '_'}`;
      const prev = agg.get(key);
      if (prev) {
        prev.visits += r.visits;
        prev.signups += r.signups;
        prev.activations += r.activations;
        prev.paids += r.paids;
      } else {
        agg.set(key, { ...r, signup_rate: 0, paid_conv: 0, bounce: 0 });
      }
    }
    const list: AggregatedRow[] = Array.from(agg.values()).map((r) => ({
      ...r,
      signup_rate: r.visits > 0 ? r.signups / r.visits : 0,
      paid_conv: r.visits > 0 ? r.paids / r.visits : 0,
      bounce: r.visits > 0 ? Math.max(0, 1 - r.signups / r.visits) : 0,
    }));
    const lc = filter.toLowerCase();
    const filtered = filter
      ? list.filter((r) => r.landing_path.toLowerCase().includes(lc))
      : list;
    filtered.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return filtered.slice(0, topN);
  }, [rows, filter, sortKey, sortDir, topN]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const ariaSortFor = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none';

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'desc' ? '↓' : '↑') : '';

  return (
    <section aria-label="Top landing pages">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
          Top Landing Pages
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Filter by path…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by path"
            className="w-48"
          />
          <PillGroup aria-label="Audience" segmented>
            <Pill
              size="sm"
              active={audience === 'all'}
              onClick={() => setAudience('all')}
            >
              All
            </Pill>
            <Pill
              size="sm"
              active={audience === 'consumer'}
              onClick={() => setAudience('consumer')}
            >
              Consumer
            </Pill>
            <Pill
              size="sm"
              active={audience === 'clinic-org'}
              onClick={() => setAudience('clinic-org')}
            >
              Clinic-org
            </Pill>
            <Pill
              size="sm"
              active={audience === 'affiliate'}
              onClick={() => setAudience('affiliate')}
            >
              Affiliate
            </Pill>
          </PillGroup>
          <PillGroup aria-label="Row count" segmented>
            <Pill size="sm" active={topN === 10} onClick={() => setTopN(10)}>
              Top 10
            </Pill>
            <Pill size="sm" active={topN === 25} onClick={() => setTopN(25)}>
              Top 25
            </Pill>
            <Pill size="sm" active={topN === 50} onClick={() => setTopN(50)}>
              Top 50
            </Pill>
          </PillGroup>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RefreshCw size={13} aria-hidden />}
            onClick={() => void fetchLanding()}
            loading={loading}
            aria-label="Refresh landing pages"
          >
            Refresh
          </Button>
        </div>
      </div>

      {loading && <Skeleton className="h-64 rounded-card" />}

      {error && !loading && (
        <Card variant="flat" padding="md">
          <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
        </Card>
      )}

      {!loading && !error && tableRows && tableRows.length === 0 && (
        <Card variant="flat" padding="md">
          <EmptyState
            inline
            title="No landing-page traffic"
            body="No visits recorded in this window. Verify lt_anon_id cookie is being set on the landing route."
          />
        </Card>
      )}

      {!loading && !error && tableRows && tableRows.length > 0 && (
        <Card variant="flat" padding="md">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] text-left border-b border-[var(--color-border)]">
                <th className="py-2 pe-3 text-start">Path</th>
                <th className="py-2 pe-3 text-start">Variant</th>
                <th
                  className="py-2 pe-3 text-end cursor-pointer select-none"
                  role="button"
                  tabIndex={0}
                  aria-label="Sort by visits"
                  aria-sort={ariaSortFor('visits')}
                  onClick={() => handleSort('visits')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSort('visits');
                  }}
                >
                  Visits {sortArrow('visits')}
                </th>
                <th
                  className="py-2 pe-3 text-end cursor-pointer select-none"
                  role="button"
                  tabIndex={0}
                  aria-label="Sort by bounce rate"
                  aria-sort={ariaSortFor('bounce')}
                  onClick={() => handleSort('bounce')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSort('bounce');
                  }}
                >
                  Bounce % {sortArrow('bounce')}
                </th>
                <th
                  className="py-2 pe-3 text-end cursor-pointer select-none"
                  role="button"
                  tabIndex={0}
                  aria-label="Sort by signup rate"
                  aria-sort={ariaSortFor('signup_rate')}
                  onClick={() => handleSort('signup_rate')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      handleSort('signup_rate');
                  }}
                >
                  Signup Rate {sortArrow('signup_rate')}
                </th>
                <th
                  className="py-2 text-end cursor-pointer select-none"
                  role="button"
                  tabIndex={0}
                  aria-label="Sort by paid conversion"
                  aria-sort={ariaSortFor('paid_conv')}
                  onClick={() => handleSort('paid_conv')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      handleSort('paid_conv');
                  }}
                >
                  Paid Conv {sortArrow('paid_conv')}
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr
                  key={`${r.landing_path}::${r.page_variant_id ?? '_'}`}
                  className="border-b border-[var(--color-border)] last:border-b-0"
                >
                  <td className="py-2 pe-3 truncate max-w-[260px]">
                    <span className="numerals-tabular">{r.landing_path}</span>
                  </td>
                  <td className="py-2 pe-3 numerals-tabular">
                    {r.page_variant_id ? r.page_variant_id.slice(0, 8) : '—'}
                  </td>
                  <td className="py-2 pe-3 text-end numerals-tabular">
                    {r.visits.toLocaleString()}
                  </td>
                  <td className="py-2 pe-3 text-end numerals-tabular">
                    {(r.bounce * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 pe-3 text-end numerals-tabular">
                    {(r.signup_rate * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 text-end numerals-tabular">
                    {(r.paid_conv * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
};

export default TrafficLandingPagesTab;
