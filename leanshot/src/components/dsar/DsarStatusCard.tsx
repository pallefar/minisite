/**
 * Phase 22 plan 22-11 — DSAR status card (GDPR-03).
 *
 * Renders the live state of a single `dsar_requests` row per UI-SPEC
 * §`/settings/privacy/dsar` lines 348-353:
 *   - pending / in_progress / completed / rejected → Badge tone mapping
 *   - completed → "Download bundle" CTA opens signed URL + caption with expiry
 *   - rejected → rejection_reason + "Contact support" link
 *   - `aria-live="polite"` on the badge so a transitioning status announces
 */
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  formatExpiryDate,
  type DsarRequestRow,
  type DsarRequestStatus,
} from '@/lib/dsar/dsar-export-client';

const STATUS_TONE: Record<DsarRequestStatus, BadgeTone> = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'success',
  rejected: 'danger',
};

const STATUS_LABEL: Record<DsarRequestStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Ready to download',
  rejected: 'Rejected',
};

export interface DsarStatusCardProps {
  request: DsarRequestRow;
  /** Pre-signed download URL when status='completed' (fetched by caller). */
  downloadUrl?: string | null;
}

export function DsarStatusCard({ request, downloadUrl = null }: DsarStatusCardProps) {
  const tone = STATUS_TONE[request.status];
  const label = STATUS_LABEL[request.status];
  const expiry = formatExpiryDate(request.export_signed_url_expires_at);

  return (
    <Card padding="md" data-testid="dsar-status-card">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {/* aria-live='polite' so the status flip announces to AT users. */}
          <span aria-live="polite" data-testid="dsar-status-badge">
            <Badge tone={tone}>{label}</Badge>
          </span>
          <span className="text-[12px] text-[var(--color-text-tertiary)]">
            Requested {new Date(request.requested_at).toLocaleString()}
          </span>
        </div>

        {request.status === 'completed' && (
          <div className="space-y-1">
            <Button
              variant="primary"
              onClick={() => {
                if (downloadUrl) {
                  window.open(downloadUrl, '_blank', 'noopener,noreferrer');
                }
              }}
              disabled={!downloadUrl}
            >
              Download bundle
            </Button>
            {expiry && (
              <p className="text-[12px] text-[var(--color-text-tertiary)]">
                Available until {expiry}
              </p>
            )}
          </div>
        )}

        {request.status === 'rejected' && (
          <div className="space-y-2">
            <h3 className="text-[14px] font-semibold">We couldn&apos;t process this request</h3>
            {request.rejection_reason && (
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                {request.rejection_reason}
              </p>
            )}
            <a
              href="mailto:support@leanshot.app"
              className="text-[13px] underline text-[var(--color-primary)]"
            >
              Contact support
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}
