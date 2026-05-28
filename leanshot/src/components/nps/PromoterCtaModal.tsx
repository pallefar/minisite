/**
 * Phase 36 Plan 36-03 Task 2 — PromoterCtaModal (Surface B).
 *
 * Consumer external-CTA opt-in modal shown to promoters (4-5 star rating).
 *
 * W9 lock-in: every CTA button uses the url_pattern EMBEDDED in the
 * decision.cta_set[i] item — there is NO DB read from this component and
 * NO sibling ctaUrlsBySlug map. The Edge Fn server-resolves url_pattern
 * from review_cta_catalog (Phase 36-01 CHECK constraint restricts schemes).
 *
 * D-13 (mobile-shell row filter): the consumer modal renders only Trustpilot /
 * G2 / Capterra display names. Mobile-only platform rows are server-side
 * filtered (Wave 2) so this client never sees them.
 *
 * Vendor-gate fallback: when ctaSet is an empty array the Wave 2 decision
 * was a vendor-block (review_cta_catalog had no rows for this user's
 * platform). Render a no-CTA "Thanks for the rating!" copy line and auto-
 * dismiss after 1500ms (D-16).
 *
 * V13-3 (CONTEXT D-03/D-21) — see useNPSPromptListener.ts for the
 * unconditional native-review wiring; this consumer modal never imports
 * the native trigger hook nor the native shim, nor the DB client (W9).
 */
import { ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { logCtaClick, type CtaItem, type CtaSlug } from '@/lib/nps/decide-client';

const DISPLAY_NAMES: Record<CtaSlug, string> = {
  trustpilot: 'Trustpilot',
  g2: 'G2',
  capterra: 'Capterra',
};

export interface PromoterCtaModalProps {
  open: boolean;
  /** Array threaded from the Wave 2 decision; max 2 items (D-09). */
  ctaSet: CtaItem[];
  onDismiss: () => void;
}

const FALLBACK_AUTO_DISMISS_MS = 1500;

export function PromoterCtaModal({ open, ctaSet, onDismiss }: PromoterCtaModalProps) {
  const isFallback = ctaSet.length === 0;

  // Vendor-gate fallback (D-16) — auto-dismiss after 1500ms when the decision
  // returned no CTA rows for the user's platform.
  useEffect(() => {
    if (!open || !isFallback) return;
    const t = window.setTimeout(onDismiss, FALLBACK_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [open, isFallback, onDismiss]);

  const handleClick = (item: CtaItem): void => {
    // logCtaClick is fire-and-forget — never block window.open on its promise
    // (Pitfall 10 — logging is best-effort; the network seam reaching the
    // server-side captureServer dual-write is the cron-anomaly source of
    // truth, not the client-side outcome).
    void logCtaClick(item.slug).catch(() => {
      /* swallow — logging is best-effort */
    });
    // W9: url_pattern is read DIRECTLY from the per-item prop — never from a
    // hard-coded map or a client-side DB fetch.
    window.open(item.url_pattern, '_blank', 'noopener,noreferrer');
    onDismiss();
  };

  return (
    <Modal open={open} onClose={onDismiss} size="sm" dismissible title="Help others find LeanShot">
      {isFallback ? (
        <p className="text-base text-[var(--color-text-secondary)]">Thanks for the rating!</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base text-[var(--color-text-secondary)]">
            Takes 30 seconds — would you share your experience on {DISPLAY_NAMES[ctaSet[0].slug]}?
          </p>
          <div className="flex flex-col gap-2">
            {ctaSet.map((item) => (
              <Button
                key={item.slug}
                variant="primary"
                block
                onClick={() => handleClick(item)}
                trailingIcon={<ExternalLink size={16} aria-hidden />}
              >
                Review on {DISPLAY_NAMES[item.slug]}
              </Button>
            ))}
            <Button variant="ghost" block onClick={onDismiss}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default PromoterCtaModal;
