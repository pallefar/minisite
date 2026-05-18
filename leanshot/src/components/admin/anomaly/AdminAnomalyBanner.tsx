/**
 * Phase 27 plan 27-04 — AdminAnomalyBanner.
 *
 * Realtime-subscribed banner shown at the top of every /admin/* page when a
 * funnel-anomaly cron broadcasts an 'anomaly_fired' event on the
 * 'funnel_anomaly_alerts' channel. SC#5: from cron tick to banner render
 * inside 5 minutes.
 *
 * Behavior:
 *   - useAnomalyAlerts subscribes to the broadcast channel.
 *   - On payload arrival → setActive(payload). One banner at a time (latest wins).
 *   - Acknowledge button → acknowledgeAnomalyAlert(active.alert_id) → setActive(null).
 *   - "View queue" → navigates to /admin/anomaly (queue UI shipped by Plan 27-05;
 *     until then, the link is a soft hash route — non-blocking for SC#5).
 *
 * Accessibility (CLAUDE.md project conventions):
 *   - role="status" + aria-live="polite" — same posture as src/components/ui/Toast.tsx.
 *   - Acknowledge button has aria-busy while the RPC is in-flight.
 */
import { AlertTriangle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { acknowledgeAnomalyAlert, AnomalyApiError } from '@/lib/admin/anomaly/api';
import { useAnomalyAlerts, type AnomalyAlertPayload } from '@/lib/admin/anomaly/realtime-channel';

export function AdminAnomalyBanner() {
  const toast = useToast();
  const [active, setActive] = useState<AnomalyAlertPayload | null>(null);
  const [busy, setBusy] = useState(false);

  const onAlert = useCallback((payload: AnomalyAlertPayload) => {
    setActive(payload);
  }, []);

  useAnomalyAlerts({ onAlert });

  if (!active) return null;

  const handleAck = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await acknowledgeAnomalyAlert(active.alert_id);
      toast('Alert acknowledged.', 'success');
      setActive(null);
    } catch (e) {
      if (e instanceof AnomalyApiError && e.code === 'not_staff') {
        toast('Forbidden — admin role required.', 'error');
      } else {
        toast('Could not acknowledge — please retry.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const funnelLabel = active.funnel_name ?? active.funnel_id.slice(0, 8);
  const z = active.z_score.toFixed(2);

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-[var(--color-danger)] bg-[var(--color-surface-elevated)] px-4 py-3"
      data-testid="admin-anomaly-banner"
    >
      <div className="flex flex-wrap items-center gap-3 max-w-screen-2xl mx-auto">
        <AlertTriangle className="size-5 text-[var(--color-danger)] shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            Funnel anomaly: <code className="font-mono">{funnelLabel}</code>{' '}
            <Badge tone="warning">z = {z}</Badge>
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Observed {active.observed_count} (24h) vs expected mean{' '}
            {active.expected_mean.toFixed(2)} ± {active.expected_stddev.toFixed(2)}.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              void handleAck();
            }}
            loading={busy}
            aria-busy={busy}
          >
            Acknowledge
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.location.hash = '#/admin/anomaly';
            }}
          >
            View queue
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AdminAnomalyBanner;
