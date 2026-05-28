/**
 * Phase 27 Plan 27-02 — AdminCohortList.
 *
 * Mirrors the verbatim shape of AdminAffiliatesReviewQueue:
 *   - isStaff probe via `supabase.auth.getUser` + `profiles.is_staff` lookup
 *     (UX-only — server-side gates via is_admin_at_least).
 *   - 4-state segmented filter pill (All / Draft / Active / Archived) with
 *     per-state count badge.
 *   - Per-row Promote (draft→active) + Archive (active→archived; superadmin).
 *
 * The Promote button is REQUIRED — without it, draft cohorts never reach
 * 'active' status and the rebuild routine skips them, silently breaking
 * consumer plans (P35/P38/P39/P40) per [[feedback_status_machine_transition_owner]].
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import {
  archiveCohort,
  CohortApiError,
  setCohortStatus,
  type CohortStatus,
} from '@/lib/cohort/api';
import { supabase } from '@/lib/supabase';

interface CohortRow {
  id: string;
  name: string;
  status: CohortStatus;
  created_at: string;
}

type StatusFilter = 'all' | CohortStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
];

const STATUS_BADGE: Record<
  CohortStatus,
  { tone: 'neutral' | 'success' | 'warning'; label: string }
> = {
  draft: { tone: 'warning', label: 'Draft' },
  active: { tone: 'success', label: 'Active' },
  archived: { tone: 'neutral', label: 'Archived' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

interface ProfileProbeRow {
  is_staff?: boolean;
  admin_role?: string | null;
}

export function AdminCohortList() {
  const toast = useToast();
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [rows, setRows] = useState<CohortRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase
      .from('cohort_definitions')
      .select('id, name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      setErrorMessage("Couldn't load cohorts. Try refreshing.");
      setRows([]);
      return;
    }
    setErrorMessage('');
    setRows((data ?? []) as CohortRow[]);
  }, []);

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
        .select('is_staff, admin_role')
        .eq('id', uid)
        .maybeSingle();
      const probe = (profile ?? null) as ProfileProbeRow | null;
      const staff = probe?.is_staff === true || !!probe?.admin_role;
      if (cancelled) return;
      setIsStaff(staff);
      setIsSuperadmin(probe?.admin_role === 'superadmin');
      if (!staff) return;
      await reload();
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: 0,
      draft: 0,
      active: 0,
      archived: 0,
    };
    if (!rows) return c;
    c.all = rows.length;
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    return filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const promote = async (row: CohortRow) => {
    setBusyRowId(row.id);
    try {
      await setCohortStatus(row.id, 'active');
      toast(`Cohort "${row.name}" promoted to active`, 'success');
      await reload();
    } catch (e) {
      const code = e instanceof CohortApiError ? e.code : 'unknown';
      toast(`Could not promote (${code})`, 'error');
    } finally {
      setBusyRowId(null);
    }
  };

  const archive = async (row: CohortRow) => {
    if (
      !window.confirm(`Archive cohort "${row.name}"? It will be excluded from the next rebuild.`)
    ) {
      return;
    }
    setBusyRowId(row.id);
    try {
      await archiveCohort(row.id);
      toast(`Cohort "${row.name}" archived`, 'success');
      await reload();
    } catch (e) {
      const code = e instanceof CohortApiError ? e.code : 'unknown';
      toast(`Could not archive (${code})`, 'error');
    } finally {
      setBusyRowId(null);
    }
  };

  if (isStaff === undefined) {
    return (
      <Card variant="flat" padding="lg">
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      </Card>
    );
  }

  if (!isStaff) {
    return (
      <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-8 text-center">
        <h2 className="text-lg font-semibold mb-2">Admins only</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          You don&apos;t have access to cohort administration.
        </p>
      </Card>
    );
  }

  return (
    <Card variant="elevated" padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Cohorts</h2>
        <PillGroup segmented className="ms-auto" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <Pill
              key={f.key}
              active={filter === f.key}
              onClick={() => setFilter(f.key)}
              count={counts[f.key]}
              size="sm"
            >
              {f.label}
            </Pill>
          ))}
        </PillGroup>
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {errorMessage}
        </p>
      )}

      {visibleRows.length === 0 ? (
        <EmptyState
          title="No cohorts yet"
          body="Use the builder above to create your first cohort."
          inline
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {visibleRows.map((row) => (
            <li
              key={row.id}
              className="py-3 flex items-center gap-3 flex-wrap"
              data-testid={`cohort-row-${row.id}`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{row.name}</span>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  Created {formatDate(row.created_at)}
                </span>
              </div>
              <Badge tone={STATUS_BADGE[row.status].tone}>{STATUS_BADGE[row.status].label}</Badge>
              <div className="ms-auto flex gap-2">
                {row.status === 'draft' && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => promote(row)}
                    disabled={busyRowId === row.id}
                    loading={busyRowId === row.id}
                  >
                    Promote
                  </Button>
                )}
                {row.status === 'active' && isSuperadmin && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => archive(row)}
                    disabled={busyRowId === row.id}
                    loading={busyRowId === row.id}
                  >
                    Archive
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
