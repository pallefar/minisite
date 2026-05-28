/**
 * Phase 10 Plan 10-08 — AuditRow.
 *
 * Renders one audit event in collapsed format. Click toggles expanded details.
 * Multiple rows can be expanded simultaneously (caller manages isExpanded state
 * via the onToggle callback and an external Set<string> of expanded IDs).
 *
 * Collapsed format (per UI-SPEC):
 *   {relative-time} · {actor display name} ({role badge}) {action verb} {target description}
 *
 * Expanded block:
 *   Event details section with font-mono key:value pairs.
 */
import type { AuditEvent } from './use-audit-events';

/** Canonical action enum → operator-facing human label. */
const ACTION_LABELS: Record<string, string> = {
  'member.invite': 'Invited a patient',
  'member.accept': 'Patient accepted invitation',
  'member.decline': 'Patient declined invitation',
  'member.revoke': 'Revoked patient access',
  'role.create': 'Created role',
  'role.update': 'Updated role',
  'role.delete': 'Deleted role',
  'role.assign': 'Assigned role to member',
  'patient_data.read': 'Viewed patient data',
  'patient_photos.read': 'Viewed patient photos',
  section_view: 'Viewed section',
  rank_computed: 'System recomputed roster ranking',
  rank_threshold_crossed: 'Score crossed needs-attention threshold',
  bulk_pdf_export: 'Included in bulk PDF export',
  bulk_csv_export: 'Included in bulk CSV symptom export',
};

function humanAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Destructive-toned actions (shown in danger pill). */
const DESTRUCTIVE_ACTIONS = new Set(['member.revoke', 'role.delete']);

/**
 * Format a timestamp as relative time (e.g., "3 days ago", "2 hours ago").
 * Falls back to locale date string for very old dates.
 */
function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export interface AuditRowProps {
  event: AuditEvent;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

export function AuditRow({ event, isExpanded, onToggle }: AuditRowProps) {
  const isDestructive = DESTRUCTIVE_ACTIONS.has(event.action);
  const actorName =
    event.actor_display_name ?? (event.actor_type === 'org_system' ? 'System' : 'Unknown member');
  const actionLabel = humanAction(event.action);

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle(event.id)}
        aria-expanded={isExpanded}
        aria-controls={`audit-row-${event.id}-details`}
        className="w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]"
      >
        {/* Timestamp */}
        <span className="text-[12px] font-mono numerals-tabular text-[var(--color-text-secondary)] shrink-0 min-w-[64px]">
          {relativeTime(event.created_at)}
        </span>

        {/* Actor + action */}
        <span className="flex-1 min-w-0 text-[13px] text-[var(--color-text)]">
          <span className="font-semibold">{actorName}</span>
          {event.actor_type !== 'org_system' && (
            <span className="ms-1.5 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
              member
            </span>
          )}{' '}
          <span
            className={
              isDestructive ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-secondary)]'
            }
          >
            {actionLabel}
          </span>
        </span>

        {/* Expand indicator */}
        <span
          aria-hidden
          className="text-[11px] text-[var(--color-text-tertiary)] shrink-0 transition-transform"
          style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
        >
          ›
        </span>
      </button>

      {isExpanded && (
        <div
          id={`audit-row-${event.id}-details`}
          role="region"
          aria-labelledby={`audit-row-${event.id}`}
          className="px-4 pb-3 pt-1 bg-[var(--color-bg)]"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
            Event details
          </p>
          <dl className="flex flex-col gap-1 font-mono text-[12px] text-[var(--color-text-secondary)]">
            <div className="flex gap-2">
              <dt className="text-[var(--color-text-tertiary)] shrink-0 min-w-[120px]">Action:</dt>
              <dd className="text-[var(--color-text)]">{event.action}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--color-text-tertiary)] shrink-0 min-w-[120px]">Actor:</dt>
              <dd className="text-[var(--color-text)]">
                {actorName} ({event.actor_type})
              </dd>
            </div>
            {event.target_user_id && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-text-tertiary)] shrink-0 min-w-[120px]">
                  Target patient:
                </dt>
                <dd className="text-[var(--color-text)] truncate">{event.target_user_id}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-[var(--color-text-tertiary)] shrink-0 min-w-[120px]">Org:</dt>
              <dd className="text-[var(--color-text)] truncate">{event.org_id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--color-text-tertiary)] shrink-0 min-w-[120px]">Time:</dt>
              <dd className="text-[var(--color-text)]">
                {new Date(event.created_at).toISOString()}
              </dd>
            </div>
            {event.metadata && Object.keys(event.metadata).length > 0 && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-text-tertiary)] shrink-0 min-w-[120px]">
                  Metadata:
                </dt>
                <dd className="text-[var(--color-text)] break-all whitespace-pre-wrap">
                  {JSON.stringify(event.metadata, null, 2)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
