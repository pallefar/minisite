/**
 * Phase 19 Plan 19-05 — `/admin/affiliates` read-only scaffold.
 *
 * Operator UX (UI-SPEC §"/admin/affiliates"):
 *   - Client-side gate: profiles.is_staff. The Edge Function +
 *     pol_affiliates_staff_all RLS policy from Plan 19-01 are the
 *     SECURITY boundary; this client gate is UX-only (matches the
 *     SiteSettingsPanel pattern from Phase 15).
 *   - Filter bar: 5 segmented Pill options (All / Pending / Approved /
 *     Rejected / Suspended) with per-state count badges.
 *   - Table: 6 columns — InitialsAvatar+email · display_name ·
 *     audience_type · audience_size · status badge · applied_at.
 *   - Empty state: <EmptyState> with Mail icon + "No applications yet".
 *   - Pagination: NOT here. P22 ADMIN-06 owns full operator UX. We show
 *     first 50 + a static "showing first 50" banner.
 *
 * Type budget per UI-SPEC: text-xl heading · text-sm body · text-xs
 * column header · text-[11px] badge. 4 sizes total. UI-checker green.
 *
 * Default-export so the route registry `.default` resolves.
 */
import { Mail } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

type AffiliateStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
type StatusFilter = 'all' | AffiliateStatus;

interface AffiliateRow {
  id: string;
  email: string;
  display_name: string;
  audience_type: string;
  audience_size: number;
  status: AffiliateStatus;
  applied_at: string;
}

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
];

const STATUS_BADGE: Record<
  AffiliateStatus,
  { tone: 'warning' | 'success' | 'danger' | 'neutral'; label: string }
> = {
  pending: { tone: 'warning', label: 'Pending' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  suspended: { tone: 'neutral', label: 'Suspended' },
};

function formatAppliedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function AdminAffiliatesScaffold() {
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [rows, setRows] = useState<AffiliateRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  // Resolve is_staff + fetch rows on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsStaff(false);
        return;
      }
      // profiles RLS lets the user read their own row.
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff')
        .eq('id', uid)
        .maybeSingle();
      const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
      if (cancelled) return;
      setIsStaff(staff);
      if (!staff) return;

      // RLS pol_affiliates_staff_all (Plan 19-01) permits the read.
      const { data, error } = await supabase
        .from('affiliates')
        .select('id, email, display_name, audience_type, audience_size, status, applied_at')
        .order('applied_at', { ascending: false })
        .limit(50);

      if (cancelled) return;
      if (error) {
        setErrorMessage("Couldn't load applications. Try refreshing.");
        setRows([]);
        return;
      }
      setRows((data ?? []) as AffiliateRow[]);
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      suspended: 0,
    };
    if (!rows) return c;
    c.all = rows.length;
    for (const r of rows) {
      c[r.status] += 1;
    }
    return c;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  // Initial probe — render nothing rather than flash a "not authorized"
  // message to a staff user whose getUser is still resolving.
  if (isStaff === undefined) {
    return null;
  }

  if (!isStaff) {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
        <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12 text-center">
          <h1 className="text-xl font-semibold mb-2">This area is for admins only</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            You don&apos;t have access to affiliate applications.
          </p>
          <a href="/" className="text-sm font-semibold text-[var(--color-primary)] hover:underline">
            Back to home →
          </a>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Affiliate applications</h1>
      </header>

      <PillGroup segmented className="mb-6" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => (
          <Pill
            key={f.key}
            size="sm"
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
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
        <p className="text-sm text-[var(--color-text-secondary)]">Loading applications…</p>
      )}

      {rows !== null && visibleRows.length === 0 && !errorMessage && (
        <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12">
          <EmptyState
            illustration={<Mail className="size-8" aria-hidden />}
            title="No applications yet"
            body="When affiliates apply, they’ll show up here for review."
          />
        </Card>
      )}

      {rows !== null && visibleRows.length > 0 && (
        <>
          <Card variant="default" padding="none" className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="affiliate-applications-table">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Audience
                  </th>
                  <th
                    scope="col"
                    className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Size
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    Applied
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const badge = STATUS_BADGE[r.status];
                  return (
                    <tr
                      key={r.id}
                      // P22 ADMIN-06 will wire click handler; at P19 scaffold
                      // rows are non-interactive.
                      tabIndex={-1}
                      className={cn('border-b border-[var(--color-border)] last:border-b-0')}
                      data-testid={`affiliate-row-${r.id}`}
                    >
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <InitialsAvatar
                            size="sm"
                            rounded="full"
                            name={r.display_name || r.email}
                          />
                          <span className="text-sm truncate max-w-[220px]">{r.email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm align-middle">{r.display_name}</td>
                      <td className="px-4 py-3 text-sm align-middle text-[var(--color-text-secondary)]">
                        {r.audience_type}
                      </td>
                      <td className="px-4 py-3 text-sm align-middle text-end tabular-nums text-[var(--color-text-secondary)]">
                        {formatCount(r.audience_size)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm align-middle text-[var(--color-text-secondary)]">
                        {formatAppliedAt(r.applied_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <p className="text-xs text-[var(--color-text-tertiary)] mt-4">
            Showing first 50 — full pagination in Phase 22.
          </p>
        </>
      )}
    </main>
  );
}

export default AdminAffiliatesScaffold;
