/**
 * Phase 22 Plan 22-06 — MemberAuditTab (UI-SPEC line 257).
 *
 * audit_logs rows scoped to `target_user_id = {id}` in reverse-chronological
 * order; each row exposes timestamp + actor + action + expandable before/after
 * JSON. RLS is admin-readable (audit_logs admin policy already lives in P19
 * migration set).
 */
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

interface AuditRow {
  id: string;
  created_at: string;
  user_id: string | null;
  action: string;
  table_name: string | null;
  row_id: string | null;
  before?: unknown;
  after?: unknown;
}

export interface MemberAuditTabProps {
  userId: string;
}

export function MemberAuditTab({ userId }: MemberAuditTabProps) {
  const [rows, setRows] = useState<AuditRow[] | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, created_at, user_id, action, table_name, row_id')
        .eq('target_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (error) {
        console.error('[member-audit-tab] query failed', error.message);
        setRows([]);
        return;
      }
      setRows((data as AuditRow[] | null) ?? []);
    })().catch((e: unknown) => {
      console.error('[member-audit-tab] threw', e);
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (rows === undefined) {
    return (
      <Card variant="default" padding="md" data-testid="member-audit-tab-loading">
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
      <Card variant="flat" padding="lg" data-testid="member-audit-tab">
        <EmptyState
          illustration={<FileText className="size-8" aria-hidden />}
          title="No audit entries"
          body="When this member is the target of an audited action it shows here."
        />
      </Card>
    );
  }

  return (
    <Card variant="default" padding="none" className="overflow-x-auto" data-testid="member-audit-tab">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th scope="col" className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              When
            </th>
            <th scope="col" className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              Actor
            </th>
            <th scope="col" className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              Action
            </th>
            <th scope="col" className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              Target
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[var(--color-border)] last:border-b-0 cursor-pointer hover:bg-[var(--color-surface-elevated)]"
              tabIndex={0}
              onClick={() => setExpanded((cur) => (cur === row.id ? null : row.id))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpanded((cur) => (cur === row.id ? null : row.id));
                }
              }}
              data-testid={`audit-row-${row.id}`}
            >
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                {new Date(row.created_at).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-xs font-mono text-[var(--color-text-secondary)] truncate max-w-[140px]">
                {row.user_id ?? '—'}
              </td>
              <td className="px-4 py-3 text-sm font-mono">{row.action}</td>
              <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)] font-mono">
                {row.table_name ? `${row.table_name}${row.row_id ? `/${row.row_id}` : ''}` : '—'}
                {expanded === row.id && (
                  <pre className="mt-2 text-[11px] whitespace-pre-wrap bg-[var(--color-surface-elevated)] p-2 rounded">
                    {JSON.stringify(row, null, 2)}
                  </pre>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
