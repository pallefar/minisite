/**
 * Phase 45 Plan 07a — ReportButton.
 *
 * Reusable Flag button + bottom-sheet form for content reporting. Calls the
 * `community_report_create` SECDEF RPC shipped by 45-01 with target_type,
 * target_id, and a free-text reason. Toast "Report submitted" on success.
 *
 * Consumers (wired in 45-07b + 45-09):
 *   - CommunityPost / CommunityCommentThread → report posts / comments
 *   - DMThreadView                            → report DM messages
 *   - ProfileCard                             → report a profile
 *
 * Analog: leanshot/src/components/community/ReactionBar.tsx (small inline action).
 */
import { useState, type JSX } from 'react';
import { Flag } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportTargetType = 'post' | 'comment' | 'dm_message' | 'profile';

export interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  /** Optional className override for the trigger button. */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReportButton({
  targetType,
  targetId,
  className,
}: ReportButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSubmit = async (): Promise<void> => {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      toast('Please describe the issue before submitting', 'error');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc('community_report_create', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: trimmed,
    });
    setSubmitting(false);

    if (error) {
      toast(`Could not submit report: ${error.message}`, 'error');
      return;
    }
    toast('Report submitted — admin will review', 'success');
    setReason('');
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Report this ${targetType}`}
        className={
          className ??
          'inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-danger,#b91c1c)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1.5 py-0.5'
        }
      >
        <Flag className="size-3.5" aria-hidden />
        Report
      </button>
      <Sheet
        open={open}
        onClose={() => {
          if (!submitting) setOpen(false);
        }}
        title="Report content"
      >
        <div className="flex flex-col gap-3">
          <label htmlFor="report-reason" className="text-sm font-medium">
            What's wrong with this {targetType}?
          </label>
          <textarea
            id="report-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            maxLength={1000}
            placeholder="Describe the issue (1000 chars max)"
            aria-label="Reason for report"
            className="w-full rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            disabled={submitting}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? 'Submitting…' : 'Submit report'}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

export default ReportButton;
