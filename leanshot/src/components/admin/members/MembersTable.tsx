/**
 * Phase 22 Plan 22-06 — MembersTable (ADMIN-01).
 *
 * Layout: 7 columns per UI-SPEC §/admin/members:
 *   avatar+email · tier · signup · last_active · clinic · country · stripe · row-actions
 *
 * Sort pattern: 3-click cycle (default → asc → desc → reset) — mirrors
 * `RosterTable` Phase 10. Server-side sort is NOT yet implemented in
 * `admin_list_members` RPC (v1.2 punts sort to client-side over current
 * page; full server-side sort is a v1.3 follow-up tracked in SUMMARY).
 *
 * Mobile: collapses to vertical card list at <md breakpoint.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Member } from '@/lib/admin/admin-api';
import { cn } from '@/lib/helpers';
import { MemberRowActions } from './MemberRowActions';

type SortColumn = 'email' | 'tier' | 'signup_date' | 'last_active_at' | 'clinic_name' | 'country' | 'stripe_status';
type SortDirection = 'asc' | 'desc' | null;

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

const COLUMN_HEADERS: { key: SortColumn; label: string; align?: 'left' | 'right' }[] = [
  { key: 'email', label: 'Email' },
  { key: 'tier', label: 'Tier' },
  { key: 'signup_date', label: 'Signed up' },
  { key: 'last_active_at', label: 'Last active' },
  { key: 'clinic_name', label: 'Clinic' },
  { key: 'country', label: 'Country' },
  { key: 'stripe_status', label: 'Stripe' },
];

function tierBadge(tier: string): { tone: 'neutral' | 'success' | 'info' | 'warning'; label: string } {
  switch (tier) {
    case 'paid':
      return { tone: 'success', label: 'Paid' };
    case 'clinic_seat':
      return { tone: 'info', label: 'Clinic' };
    case 'past_due':
      return { tone: 'warning', label: 'Past due' };
    case 'free':
    default:
      return { tone: 'neutral', label: 'Free' };
  }
}

function stripeBadge(status: string): { tone: 'success' | 'warning' | 'neutral' | 'danger'; label: string } {
  switch (status) {
    case 'active':
      return { tone: 'success', label: 'Active' };
    case 'past_due':
      return { tone: 'warning', label: 'Past due' };
    case 'canceled':
      return { tone: 'danger', label: 'Canceled' };
    case 'none':
    default:
      return { tone: 'neutral', label: 'None' };
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never';
  try {
    const d = new Date(iso).getTime();
    const diffSec = Math.floor((Date.now() - d) / 1000);
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
    return fmtDate(iso);
  } catch {
    return iso;
  }
}

export interface MembersTableProps {
  rows: Member[] | null;
  isLoading: boolean;
  onImpersonate?: (userId: string) => void;
  onRowOpen?: (userId: string) => void;
}

export function MembersTable({ rows, isLoading, onImpersonate, onRowOpen }: MembersTableProps) {
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });

  const sortedRows = useMemo(() => {
    if (!rows) return null;
    if (!sort.column || !sort.direction) return rows;
    const col = sort.column;
    const dir = sort.direction;
    return [...rows].sort((a, b) => {
      const av = (a[col] ?? '') as string;
      const bv = (b[col] ?? '') as string;
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sort]);

  const handleSortClick = (col: SortColumn) => {
    setSort((cur) => {
      if (cur.column !== col) return { column: col, direction: 'asc' };
      if (cur.direction === 'asc') return { column: col, direction: 'desc' };
      // 3rd click — revert to unsorted.
      return { column: null, direction: null };
    });
  };

  if (isLoading || rows === null) {
    return (
      <Card variant="default" padding="none">
        <div className="p-4 space-y-2" data-testid="members-table-loading">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card variant="flat" padding="lg">
        <EmptyState
          illustration={<Users className="size-8" aria-hidden />}
          title="No members match your filters"
          body="Try clearing your filters or widening the date range."
        />
      </Card>
    );
  }

  return (
    <>
      {/* Desktop: <table>. Mobile (<md): hidden, replaced by card list below. */}
      <Card variant="default" padding="none" className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm" data-testid="members-table">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {COLUMN_HEADERS.map((col) => {
                const isActive = sort.column === col.key;
                const ariaSort = isActive
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortClick(col.key)}
                      className="inline-flex items-center gap-1 hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:underline"
                      data-sort-key={col.key}
                    >
                      <span>{col.label}</span>
                      {isActive ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown
                          className="size-3 opacity-40"
                          aria-hidden
                        />
                      )}
                    </button>
                  </th>
                );
              })}
              <th
                scope="col"
                className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
              >
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows!.map((row) => {
              const tBadge = tierBadge(row.tier);
              const sBadge = stripeBadge(row.stripe_status);
              return (
                <tr
                  key={row.user_id}
                  tabIndex={0}
                  onClick={() => onRowOpen?.(row.user_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowOpen?.(row.user_id);
                    }
                  }}
                  data-testid={`member-row-${row.user_id}`}
                  className={cn(
                    'border-b border-[var(--color-border)] last:border-b-0 cursor-pointer hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-elevated)]',
                  )}
                >
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-3">
                      <InitialsAvatar size="sm" rounded="full" name={row.email} />
                      <span className="text-sm truncate max-w-[260px]">{row.email}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Badge tone={tBadge.tone}>{tBadge.label}</Badge>
                  </td>
                  <td className="px-4 py-3 align-middle text-sm text-[var(--color-text-secondary)]">
                    {fmtDate(row.signup_date)}
                  </td>
                  <td className="px-4 py-3 align-middle text-sm text-[var(--color-text-secondary)]">
                    {fmtRelative(row.last_active_at)}
                  </td>
                  <td className="px-4 py-3 align-middle text-sm text-[var(--color-text-secondary)]">
                    {row.clinic_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 align-middle text-sm text-[var(--color-text-secondary)]">
                    {row.country ?? '—'}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Badge tone={sBadge.tone}>{sBadge.label}</Badge>
                  </td>
                  <td
                    className="px-4 py-3 align-middle text-right"
                    // Swallow row-open clicks originating from the kebab popover —
                    // the actions menu must NOT also navigate to the detail page.
                    // <td> is presentational here; no a11y semantics added.
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MemberRowActions
                      userId={row.user_id}
                      email={row.email}
                      onImpersonate={onImpersonate}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Mobile card list */}
      <div className="md:hidden flex flex-col gap-3" data-testid="members-table-mobile">
        {sortedRows!.map((row) => {
          const tBadge = tierBadge(row.tier);
          const sBadge = stripeBadge(row.stripe_status);
          return (
            <Card
              key={row.user_id}
              variant="default"
              padding="md"
              onClick={() => onRowOpen?.(row.user_id)}
              className="cursor-pointer"
              data-testid={`member-card-${row.user_id}`}
            >
              <div className="flex items-center gap-3 mb-2">
                <InitialsAvatar size="sm" rounded="full" name={row.email} />
                <span className="text-sm font-medium truncate flex-1">{row.email}</span>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- presentational wrapper to swallow card-open click for nested kebab menu */}
                <div onClick={(e) => e.stopPropagation()}>
                  <MemberRowActions
                    userId={row.user_id}
                    email={row.email}
                    onImpersonate={onImpersonate}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge tone={tBadge.tone}>{tBadge.label}</Badge>
                <Badge tone={sBadge.tone}>{sBadge.label}</Badge>
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] grid grid-cols-2 gap-x-3 gap-y-1">
                <div>Signed up: {fmtDate(row.signup_date)}</div>
                <div>Last active: {fmtRelative(row.last_active_at)}</div>
                <div>Clinic: {row.clinic_name ?? '—'}</div>
                <div>Country: {row.country ?? '—'}</div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
