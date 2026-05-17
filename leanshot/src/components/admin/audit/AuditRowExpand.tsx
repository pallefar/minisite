/**
 * Phase 24 Plan 24-06 — AuditRowExpand.
 *
 * Expanded details panel for a single audit_logs row.
 * Shown when the user clicks a row in AuditLogModule.
 *
 * Layout:
 *   Header: action_name, actor email, target email, timestamp.
 *   Body: <JsonDiffViewer before={row.before_data} after={row.after_data} />
 */
import { JsonDiffViewer } from './JsonDiffViewer';

export interface AuditLogRow {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action_name: string | null;
  table_name: string | null;
  row_pk: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  source: string | null;
  org_id: string | null;
  actor?: { email: string | null } | null;
  target?: { email: string | null } | null;
}

export interface AuditRowExpandProps {
  row: AuditLogRow;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function AuditRowExpand({ row }: AuditRowExpandProps) {
  const actorEmail = row.actor?.email ?? row.actor_user_id ?? '—';
  const targetEmail = row.target?.email ?? row.target_user_id ?? '—';

  return (
    <div className="flex flex-col gap-4 px-4 py-4 bg-[var(--color-bg)] border-t border-[var(--color-border)]">
      {/* Header metadata */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        <div>
          <dt className="text-[var(--color-text-tertiary)] font-semibold uppercase tracking-wide text-[10px] mb-0.5">
            Action
          </dt>
          <dd className="font-mono text-[var(--color-text)]">{row.action_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-tertiary)] font-semibold uppercase tracking-wide text-[10px] mb-0.5">
            Table
          </dt>
          <dd className="font-mono text-[var(--color-text)]">{row.table_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-tertiary)] font-semibold uppercase tracking-wide text-[10px] mb-0.5">
            Actor
          </dt>
          <dd className="font-mono text-[var(--color-text)] truncate" title={actorEmail}>
            {actorEmail}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-tertiary)] font-semibold uppercase tracking-wide text-[10px] mb-0.5">
            Target
          </dt>
          <dd className="font-mono text-[var(--color-text)] truncate" title={targetEmail}>
            {targetEmail}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-tertiary)] font-semibold uppercase tracking-wide text-[10px] mb-0.5">
            Timestamp
          </dt>
          <dd className="font-mono text-[var(--color-text)]">{formatTimestamp(row.created_at)}</dd>
        </div>
        {row.row_pk && (
          <div>
            <dt className="text-[var(--color-text-tertiary)] font-semibold uppercase tracking-wide text-[10px] mb-0.5">
              Row PK
            </dt>
            <dd className="font-mono text-[var(--color-text)] truncate" title={row.row_pk}>
              {row.row_pk}
            </dd>
          </div>
        )}
      </dl>

      {/* Diff viewer */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">
          Before / After
        </p>
        <JsonDiffViewer before={row.before_data} after={row.after_data} />
      </div>
    </div>
  );
}
