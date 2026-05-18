/**
 * Phase 27 Plan 27-01 — AdminBulkActionsBar (ADMIN-04).
 *
 * Renders a sticky toolbar at the top of MembersTable when ≥1 member is
 * selected. 5 action buttons (CONTEXT D-04 set). Each opens
 * AdminBulkConfirmModal with the chosen action_type.
 *
 * No PHI in this component — it operates on opaque user_id strings + display
 * names already visible in the table. PostHog event firing lives in
 * AdminBulkConfirmModal (after Confirm) so cancel events aren't logged as
 * action attempts.
 */
import { Ban, FileSpreadsheet, KeyRound, Sparkles, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { BulkActionType, BulkActionResult } from '@/lib/admin/bulk/types';
import { AdminBulkConfirmModal } from './AdminBulkConfirmModal';

export interface AdminBulkActionsBarProps {
  selectedIds: string[];
  sampleNames: string[];
  onClear: () => void;
  /** Called after a successful sync execute that mints an undo_token. */
  onUndoAvailable: (info: { undoToken: string; count: number; actionType: BulkActionType }) => void;
  /** Called after any successful execute so the parent can refetch the table. */
  onActionComplete?: (info: { result: BulkActionResult; actionType: BulkActionType }) => void;
}

const ACTIONS: { key: BulkActionType; label: string; icon: typeof Ban; variant: 'secondary' | 'destructive' }[] = [
  { key: 'csv_export',           label: 'Export CSV',     icon: FileSpreadsheet, variant: 'secondary' },
  { key: 'tag',                  label: 'Tag',            icon: Tag,             variant: 'secondary' },
  { key: 'comp_plan',            label: 'Grant Pro',      icon: Sparkles,        variant: 'secondary' },
  { key: 'force_password_reset', label: 'Reset password', icon: KeyRound,        variant: 'secondary' },
  { key: 'ban',                  label: 'Ban',            icon: Ban,             variant: 'destructive' },
];

export function AdminBulkActionsBar({
  selectedIds,
  sampleNames,
  onClear,
  onUndoAvailable,
  onActionComplete,
}: AdminBulkActionsBarProps) {
  const [pendingAction, setPendingAction] = useState<BulkActionType | null>(null);

  return (
    <div
      className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 shadow-sm"
      role="toolbar"
      aria-label={`Bulk actions on ${selectedIds.length} selected member${selectedIds.length === 1 ? '' : 's'}`}
      data-testid="admin-bulk-actions-bar"
    >
      <span className="text-sm font-semibold text-[var(--color-text)]">
        {selectedIds.length} selected
      </span>

      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<X className="size-3.5" aria-hidden />}
        onClick={onClear}
        aria-label="Clear selection"
      >
        Clear
      </Button>

      <span className="ms-auto flex flex-wrap gap-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Button
              key={a.key}
              variant={a.variant}
              size="sm"
              leadingIcon={<Icon className="size-3.5" aria-hidden />}
              onClick={() => setPendingAction(a.key)}
              data-testid={`admin-bulk-action-${a.key}`}
            >
              {a.label}
            </Button>
          );
        })}
      </span>

      {pendingAction && (
        <AdminBulkConfirmModal
          actionType={pendingAction}
          selectedIds={selectedIds}
          sampleNames={sampleNames}
          onClose={() => setPendingAction(null)}
          onUndoAvailable={onUndoAvailable}
          onActionComplete={onActionComplete}
        />
      )}
    </div>
  );
}
