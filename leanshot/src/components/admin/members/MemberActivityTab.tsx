/**
 * Phase 22 Plan 22-06 — MemberActivityTab (UI-SPEC line 254).
 *
 * Activity feed: last 50 audit_logs events where the member was actor OR
 * target. Uses `audit_logs` table directly via the staff-readable RLS path.
 */
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

interface ActivityRow {
  id: string;
  created_at: string;
  action: string;
  table_name: string | null;
  row_id: string | null;
}

export interface MemberActivityTabProps {
  userId: string;
}

export function MemberActivityTab({ userId }: MemberActivityTabProps) {
  const [rows, setRows] = useState<ActivityRow[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, created_at, action, table_name, row_id')
        .or(`user_id.eq.${userId},target_user_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.error('[member-activity-tab] query failed', error.message);
        setRows([]);
        return;
      }
      setRows((data as ActivityRow[] | null) ?? []);
    })().catch((e: unknown) => {
      console.error('[member-activity-tab] threw', e);
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (rows === undefined) {
    return (
      <Card variant="default" padding="md" data-testid="member-activity-tab-loading">
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card variant="flat" padding="lg" data-testid="member-activity-tab">
        <EmptyState
          illustration={<Activity className="size-8" aria-hidden />}
          title="No activity yet"
          body="Events appear here as the member uses the product."
        />
      </Card>
    );
  }

  return (
    <Card
      variant="default"
      padding="none"
      className="overflow-x-auto"
      data-testid="member-activity-tab"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th
              scope="col"
              className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
            >
              When
            </th>
            <th
              scope="col"
              className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
            >
              Action
            </th>
            <th
              scope="col"
              className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
            >
              Target
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[var(--color-border)] last:border-b-0"
              data-testid={`activity-row-${row.id}`}
            >
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                {new Date(row.created_at).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-sm font-mono">{row.action}</td>
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)] font-mono">
                {row.table_name ? `${row.table_name}${row.row_id ? `/${row.row_id}` : ''}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
