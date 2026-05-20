/**
 * Phase 38 Plan 38-08 — HitlDecisionModal.
 *
 * Modal opened from HitlQueueRow "Edit" button. Shows the full payload
 * (narrative for digest; suggested actions for recommender; email subject for
 * win_back) and lets a super-admin edit the narrative before approving.
 *
 * On Save (Approve with edits):
 *   - Calls onSubmit({ decision: 'edited', edited_payload }).
 *   - Parent (HitlQueuePage) invokes supabase.rpc('hitl_decide', …) AND, for
 *     `type='digest'`, supabase.functions.invoke('weekly-digest', …).
 *
 * Lightweight modal — uses native dialog-style div with role="dialog" so the
 * RTL test can scope `within(modal).getByRole('button', { name: /save/i })`.
 * (The Phase 1 Modal primitive uses framer-motion's AnimatePresence which
 * doesn't play well with synchronous waitFor in RTL.)
 */
import { useEffect, useState } from 'react';
import type { HitlRow } from './HitlQueueRow';

export interface HitlDecisionModalProps {
  row: HitlRow;
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { decision: 'edited'; edited_payload: Record<string, unknown> }) => void;
}

export function HitlDecisionModal({ row, open, onClose, onSubmit }: HitlDecisionModalProps) {
  const initialNarrative =
    (row.payload as { narrative?: string }).narrative ??
    (row.payload as { subject?: string }).subject ??
    '';
  const [narrative, setNarrative] = useState(initialNarrative);

  useEffect(() => {
    if (open) setNarrative(initialNarrative);
  }, [open, initialNarrative]);

  if (!open) return null;

  const isDigest = row.type === 'digest';

  function handleSave() {
    const edited_payload = {
      ...row.payload,
      narrative,
    };
    onSubmit({ decision: 'edited', edited_payload });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-surface-overlay,rgba(0,0,0,0.6))] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit AI suggestion"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[var(--color-surface,#fff)] rounded-lg p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold mb-3">
          Edit {row.type} suggestion
        </h2>

        <dl className="grid grid-cols-2 gap-2 text-[12px] mb-4 text-[var(--color-text-secondary)]">
          <div>
            <dt className="font-semibold">Source type</dt>
            <dd className="font-mono">{row.source_type ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Action id</dt>
            <dd className="font-mono">{row.action_id ?? '—'}</dd>
          </div>
        </dl>

        <label className="block mb-4">
          <span className="text-sm font-semibold block mb-1">Narrative</span>
          <textarea
            aria-label="Narrative"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={6}
            className="w-full p-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-sm text-[var(--color-text)]"
          />
        </label>

        {isDigest && (row.payload as { actions?: Array<{ id: string; reason: string }> }).actions && (
          <section className="mb-4">
            <h3 className="text-sm font-semibold mb-2">Actions (preview)</h3>
            <ul className="space-y-1">
              {(row.payload as { actions: Array<{ id: string; reason: string }> }).actions.map(
                (a, i) => (
                  <li key={i} className="text-[12px] text-[var(--color-text-secondary)]">
                    <span className="font-mono">{a.id}</span> — {a.reason}
                  </li>
                ),
              )}
            </ul>
          </section>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-pill text-sm font-semibold bg-[var(--color-surface)] border border-[var(--color-border)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-9 px-4 rounded-pill text-sm font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          >
            Save &amp; Approve
          </button>
        </div>
      </div>
    </div>
  );
}

export default HitlDecisionModal;
