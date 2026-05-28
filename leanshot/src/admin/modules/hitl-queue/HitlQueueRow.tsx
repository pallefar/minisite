/**
 * Phase 38 Plan 38-08 — HitlQueueRow (admin queue row primitive per Phase 27).
 *
 * Compact pending-suggestion row with:
 *   - type badge (recommender / digest / win_back)
 *   - source/action metadata
 *   - relative-time created_at
 *   - stale badge for pending rows >7 days old
 *   - selection checkbox (D-12 bulk-approve workflow)
 *   - inline Approve / Reject / Edit buttons (pending rows only)
 *   - audit-only rendering for status='auto_approved_kb' (D-13)
 *
 * Decision lifecycle:
 *   pending → approved / rejected / edited / auto_approved_kb
 *
 * Approve+digest triggers a follow-on `weekly-digest` Edge Fn invocation —
 * handled by the parent (HitlQueuePage). This row component is presentational
 * over the row-level actions; it does NOT call supabase directly.
 */
import { type ReactNode } from 'react';

export interface HitlRow {
  id: string;
  type: 'recommender' | 'digest' | 'win_back';
  user_id: string | null;
  org_id: string | null;
  payload: Record<string, unknown>;
  source_type: string | null;
  action_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'edited' | 'auto_approved_kb';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface HitlQueueRowProps {
  row: HitlRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onApprove: (row: HitlRow) => void;
  onReject: (row: HitlRow) => void;
  onEdit: (row: HitlRow) => void;
}

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function isStale(row: HitlRow): boolean {
  if (row.status !== 'pending') return false;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return ageMs > STALE_THRESHOLD_MS;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function typeBadgeClass(type: HitlRow['type']): string {
  switch (type) {
    case 'recommender':
      return 'bg-[var(--color-info-soft,#dbeafe)] text-[var(--color-info,#1e40af)]';
    case 'digest':
      return 'bg-[var(--color-success-soft,#dcfce7)] text-[var(--color-success,#166534)]';
    case 'win_back':
      return 'bg-[var(--color-warning-soft,#fef3c7)] text-[var(--color-warning,#92400e)]';
  }
}

function payloadPreview(row: HitlRow): ReactNode {
  const p = row.payload as { narrative?: string; title?: string; subject?: string };
  // Digest narrative → first 120 chars. Recommender → title. Win-back → subject.
  const text = p.narrative ?? p.title ?? p.subject ?? JSON.stringify(row.payload).slice(0, 120);
  return <p className="text-[13px] text-[var(--color-text-secondary)] line-clamp-2">{text}</p>;
}

export function HitlQueueRow({
  row,
  selected,
  onToggleSelect,
  onApprove,
  onReject,
  onEdit,
}: HitlQueueRowProps) {
  const isAuditOnly = row.status === 'auto_approved_kb';
  const stale = isStale(row);

  return (
    <li
      className="flex items-start gap-3 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
      data-testid={`hitl-row-${row.id}`}
    >
      {!isAuditOnly && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(row.id)}
          aria-label={`Select row ${row.id}`}
          className="mt-1.5"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center px-2 h-5 rounded-pill text-[11px] font-semibold uppercase tracking-wide ${typeBadgeClass(row.type)}`}
          >
            {row.type}
          </span>
          {row.source_type && (
            <span className="text-[11px] text-[var(--color-text-tertiary)] font-mono">
              {row.source_type}
            </span>
          )}
          {row.action_id && (
            <span className="text-[11px] text-[var(--color-text-tertiary)] font-mono">
              {row.action_id}
            </span>
          )}
          {isAuditOnly && (
            <span className="inline-flex items-center px-2 h-5 rounded-pill text-[11px] font-semibold bg-[var(--color-info-soft,#dbeafe)] text-[var(--color-info,#1e40af)]">
              KB audit — auto-approved
            </span>
          )}
          {stale && (
            <span
              className="inline-flex items-center px-2 h-5 rounded-pill text-[11px] font-semibold bg-[var(--color-warning-soft,#fef3c7)] text-[var(--color-warning,#92400e)]"
              title="Pending >7 days"
            >
              stale
            </span>
          )}
          <span className="ml-auto text-[11px] text-[var(--color-text-tertiary)]">
            {relTime(row.created_at)}
          </span>
        </div>
        <div className="mt-2">{payloadPreview(row)}</div>
        {!isAuditOnly && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onApprove(row)}
              className="h-8 px-3 rounded-pill text-[12px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReject(row)}
              className="h-8 px-3 rounded-pill text-[12px] font-semibold bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-error,#dc2626)]"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => onEdit(row)}
              className="h-8 px-3 rounded-pill text-[12px] font-semibold bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)]"
            >
              Edit
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export default HitlQueueRow;
