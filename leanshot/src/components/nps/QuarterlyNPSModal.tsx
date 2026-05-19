/**
 * Phase 42 Plan 42-10 (POLISH-12 D-21) — Quarterly NPS in-app fallback modal.
 *
 * 5-star modal pattern from P36 D-09. Mapped 1..5 stars to 0..10 NPS scale via
 * stars*2 on submit (per plan action note). The email path uses the native 0..10
 * scale; the in-app fallback uses 5 stars for compact mobile-first UX.
 *
 * Submits to `nps-quarterly-respond` Edge Fn (POST):
 *   { score, comment, nonce, responded_via: 'in-app', skipped }
 * The same nonce single-use ledger guards email + in-app paths (Pitfall 11).
 *
 * a11y:
 *   - role="dialog" + aria-modal via DS Modal primitive.
 *   - 5 star buttons with aria-label "Rate N stars".
 *   - aria-pressed on the currently selected star.
 *   - Submit + Skip both have noun-qualified labels per project a11y convention.
 *
 * The modal is rendered lazily (lazy() in App.tsx) so the chunk stays off the
 * index static graph.
 */
import { Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { capture } from '@/lib/analytics/capture';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

export interface QuarterlyNPSModalProps {
  /** Render the modal open. Parent controls open/close lifecycle. */
  open: boolean;
  /** Called on close (after submit, after skip, or after explicit dismiss). */
  onClose: () => void;
  /** Single-use ledger key from the eligibility RPC. Echoed back on submit. */
  nonce: string;
  /** Current quarter (YYYY-QN), echoed back on submit for server consistency. */
  quarter: string;
}

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

export function QuarterlyNPSModal({
  open,
  onClose,
  nonce,
  quarter,
}: QuarterlyNPSModalProps) {
  // `quarter` is part of the API for documentation symmetry with the
  // eligibility RPC response shape — the actual quarter is derived server-side
  // via the nonce owner inside submit_quarterly_nps_in_app(). Reference it so
  // the strict-unused-locals TS rule doesn't fail.
  void quarter;
  const [stars, setStars] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset local state whenever the modal transitions from closed → open. Keeps
  // a second-quarter prompt clean if (under future flows) the same browser
  // session is asked again.
  useEffect(() => {
    if (open) {
      setStars(0);
      setComment('');
      setSubmitting(false);
      setErrorMessage(null);
    }
  }, [open]);

  const submitRpc = useCallback(
    async (args: {
      score: number | null;
      comment: string | null;
      skipped: boolean;
    }): Promise<boolean> => {
      setSubmitting(true);
      setErrorMessage(null);
      try {
        const { data, error } = await supabase.rpc('submit_quarterly_nps_in_app', {
          p_nonce: nonce,
          p_score: args.score,
          p_comment: args.comment,
          p_skipped: args.skipped,
        });
        if (error) {
          setErrorMessage("We couldn't save your response. Try again in a moment.");
          setSubmitting(false);
          return false;
        }
        // Treat both ok=true and replayed=true as "modal can close" — the
        // server-side single-use ledger guarantees per-quarter uniqueness
        // regardless of whether THIS call or a prior one wrote the row.
        const result = (data ?? {}) as { ok?: boolean; replayed?: boolean };
        if (!result.ok && !result.replayed) {
          setErrorMessage("We couldn't save your response. Try again in a moment.");
          setSubmitting(false);
          return false;
        }
        return true;
      } catch {
        setErrorMessage("We couldn't save your response. Check your connection and try again.");
        setSubmitting(false);
        return false;
      }
    },
    [nonce],
  );

  const handleSubmit = useCallback(async () => {
    if (stars < 1 || stars > 5) return;
    const score = stars * 2; // 5-star → 0-10 NPS scale.
    const trimmedComment = comment.trim();
    const ok = await submitRpc({
      score,
      comment: trimmedComment.length > 0 ? trimmedComment : null,
      skipped: false,
    });
    if (ok) {
      // Client-side responded event (server-side fires the canonical event).
      try {
        capture('nps_quarterly_responded', { score, responded_via: 'in-app' });
      } catch {
        /* analytics fail-soft. */
      }
      onClose();
    }
  }, [stars, comment, submitRpc, onClose]);

  const handleSkip = useCallback(async () => {
    // Per plan: a skip stores a row with score=NULL, responded_via='in-app'
    // (and skipped=true) so we don't re-prompt this quarter.
    const ok = await submitRpc({ score: null, comment: null, skipped: true });
    if (ok) onClose();
  }, [submitRpc, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Quick quarterly check-in" size="md" mobileFullscreen>
      <div className="flex flex-col gap-5">
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          How likely are you to recommend LeanShot?
        </p>

        <div className="flex items-center gap-2" role="group" aria-label="Recommendation rating">
          {STAR_VALUES.map((value) => {
            const filled = stars >= value;
            return (
              <button
                key={value}
                type="button"
                aria-label={`Rate ${value} star${value === 1 ? '' : 's'}`}
                aria-pressed={filled}
                onClick={() => setStars(value)}
                disabled={submitting}
                className={cn(
                  'p-2 rounded-pill focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-colors',
                  filled ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]',
                )}
              >
                <Star className="size-7" fill={filled ? 'currentColor' : 'none'} aria-hidden />
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-2 text-[13px]">
          <span className="font-semibold">Anything to add?</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={submitting}
            rows={3}
            maxLength={1000}
            placeholder="Optional — share what's working or what's not."
            className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </label>

        {errorMessage && (
          <p role="alert" className="text-[13px] text-[var(--color-danger)]">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleSkip} disabled={submitting}>
            Skip this quarter
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={stars < 1 || submitting}
            loading={submitting}
          >
            Submit feedback
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default QuarterlyNPSModal;
