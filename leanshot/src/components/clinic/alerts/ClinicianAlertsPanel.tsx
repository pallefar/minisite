/**
 * Phase 30 Plan 03 — ClinicianAlertsPanel.
 *
 * Bell-icon dropdown panel showing pending / snoozed / resolved clinician alerts.
 * Subscribes to the org-{hmac8}-alerts HMAC channel for live updates.
 *
 * Desktop: fixed-position anchored dropdown (380px wide, max-height 60vh).
 * Mobile: Sheet bottom-drawer.
 *
 * Accessibility:
 *   - role="region" aria-label="Clinician alerts" on the panel container
 *   - Closes on Escape + outside click
 *   - Status badges use amber (NOT warning — per UI-SPEC §Color)
 *   - Framer-motion entry animations gated by useReducedMotion()
 *
 * Per D-10 status machine:
 *   pending → acknowledged: acknowledge_clinician_alert SECDEF
 *   pending → snoozed: snooze_clinician_alert SECDEF (via AlertSnoozePopover)
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import { AlertSnoozePopover } from './AlertSnoozePopover';
import { groupByStatus, useClinicianAlerts } from './use-clinician-alerts';
import type { ClinicianAlert } from './use-clinician-alerts';
import { useClinicianAlertsRealtime } from './use-clinician-alerts-realtime';

// ---- Status helpers -------------------------------------------------------

function statusToTone(status: ClinicianAlert['status']): BadgeTone {
  switch (status) {
    case 'pending': return 'amber'; // NOT 'warning' — per UI-SPEC §Color
    case 'snoozed': return 'neutral';
    case 'acknowledged': return 'success';
    case 'auto_resolved': return 'success';
    case 'delivery_failed': return 'danger';
  }
}

function statusLabel(status: ClinicianAlert['status']): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'snoozed': return 'Snoozed';
    case 'acknowledged': return 'Acknowledged';
    case 'auto_resolved': return 'Auto-resolved';
    case 'delivery_failed': return 'Delivery failed';
  }
}

function alertTypeLabel(type: ClinicianAlert['alert_type']): string {
  return type === 'dose_adherence' ? 'Missed doses' : 'Dose variance';
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---- Props ----------------------------------------------------------------

export interface ClinicianAlertsPanelProps {
  orgId: string;
  orgSlug: string;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

// ---- Alert row component --------------------------------------------------

interface AlertRowProps {
  alert: ClinicianAlert;
  orgSlug: string;
  onAcknowledge: (alertId: string) => Promise<void>;
  onSnoozeOpen: (alertId: string, ref: React.RefObject<HTMLButtonElement | null>) => void;
  isNew?: boolean;
}

function AlertRow({ alert, orgSlug, onAcknowledge, onSnoozeOpen, isNew = false }: AlertRowProps) {
  const snoozeRef = useRef<HTMLButtonElement | null>(null);
  const reduced = useReducedMotion();
  const [acking, setAcking] = useState(false);

  const isPending = alert.status === 'pending';

  const handleAck = async () => {
    setAcking(true);
    try {
      await onAcknowledge(alert.id);
    } finally {
      setAcking(false);
    }
  };

  const rowContent = (
    <div
      className={`flex flex-col gap-2 p-3 rounded-lg border border-[var(--color-border)] ${
        isPending ? 'bg-[var(--color-amber-soft)]' : 'bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={statusToTone(alert.status)}>{statusLabel(alert.status)}</Badge>
        <span className="text-[15px] font-medium text-[var(--color-text)]">
          {alertTypeLabel(alert.alert_type)}
        </span>
        {alert.display_name && (
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            {alert.display_name}
          </span>
        )}
        <span className="ml-auto text-[13px] text-[var(--color-text-tertiary)]">
          {relativeTime(alert.created_at)}
        </span>
      </div>
      {alert.status === 'snoozed' && alert.snooze_until && (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Snoozed until {relativeTime(alert.snooze_until)}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={`/clinic/${orgSlug}/roster/${alert.patient_user_id}`}
          className="text-[13px] font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
        >
          View patient
        </a>
        {isPending && (
          <>
            <Button
              variant="primary"
              size="sm"
              loading={acking}
              onClick={() => void handleAck()}
            >
              Acknowledge
            </Button>
            <Button
              ref={snoozeRef}
              variant="secondary"
              size="sm"
              onClick={() => onSnoozeOpen(alert.id, snoozeRef)}
            >
              Snooze
            </Button>
          </>
        )}
      </div>
    </div>
  );

  if (isNew && !reduced) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {rowContent}
      </motion.div>
    );
  }

  return rowContent;
}

// ---- Main panel -----------------------------------------------------------

export function ClinicianAlertsPanel({
  orgId,
  orgSlug,
  open,
  onClose,
  anchorRef,
}: ClinicianAlertsPanelProps) {
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const alertsQuery = useClinicianAlerts({ orgId });
  const [showResolved, setShowResolved] = useState(false);
  const [newAlertIds, setNewAlertIds] = useState<Set<string>>(new Set());
  const [snoozeState, setSnoozeState] = useState<{
    alertId: string;
    triggerRef: React.RefObject<HTMLButtonElement | null>;
  } | null>(null);

  const handleNewAlert = useCallback(
    (payload: { alert_id: string; alert_type: string }) => {
      setNewAlertIds((prev) => new Set(prev).add(payload.alert_id));
      alertsQuery.refetch();
    },
    [alertsQuery],
  );

  const { isSubscribed } = useClinicianAlertsRealtime({ orgId, onNewAlert: handleNewAlert });

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onClose, anchorRef]);

  const handleAcknowledge = useCallback(
    async (alertId: string) => {
      const { error } = await supabase.rpc('acknowledge_clinician_alert', { p_alert_id: alertId });
      if (error) {
        toast('Failed to acknowledge alert. Please try again.', 'error');
      } else {
        toast('Alert acknowledged', 'success');
        alertsQuery.refetch();
      }
    },
    [alertsQuery, toast],
  );

  const handleSnoozeOpen = useCallback(
    (alertId: string, triggerRef: React.RefObject<HTMLButtonElement | null>) => {
      setSnoozeState({ alertId, triggerRef });
    },
    [],
  );

  const handleSnoozeClose = useCallback(() => {
    setSnoozeState(null);
    alertsQuery.refetch();
  }, [alertsQuery]);

  if (!open) return null;

  const { pending, snoozed, resolved } = groupByStatus(alertsQuery.data);

  const panelBody = (
    <div
      ref={panelRef}
      role="region"
      aria-label="Clinician alerts"
      className="flex flex-col gap-3"
    >
      {/* Subscription failure warning */}
      {!isSubscribed && alertsQuery.data.length >= 0 && !alertsQuery.isLoading && (
        <div
          role="alert"
          className="rounded-lg px-3 py-2 bg-[var(--color-warning-soft)] text-[13px] text-[var(--color-warning)] flex items-center gap-2"
        >
          <span>Live updates paused. Reload to reconnect.</span>
        </div>
      )}

      {/* Loading state */}
      {alertsQuery.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      )}

      {/* DB load error */}
      {alertsQuery.error && !alertsQuery.isLoading && (
        <p className="text-[13px] text-[var(--color-danger)] px-1">
          Could not load alerts. Reload the page to try again.
        </p>
      )}

      {/* Empty state */}
      {!alertsQuery.isLoading && !alertsQuery.error && pending.length === 0 && snoozed.length === 0 && !showResolved && (
        <EmptyState
          inline
          title="No active alerts"
          body="Your patients are within the configured thresholds. Check back after the nightly scan."
        />
      )}

      {/* Pending alerts (topmost, amber-soft background) */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {pending.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                orgSlug={orgSlug}
                onAcknowledge={handleAcknowledge}
                onSnoozeOpen={handleSnoozeOpen}
                isNew={newAlertIds.has(alert.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Snoozed alerts */}
      {snoozed.length > 0 && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-[var(--color-text-secondary)] px-1">
            Snoozed
          </p>
          {snoozed.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              orgSlug={orgSlug}
              onAcknowledge={handleAcknowledge}
              onSnoozeOpen={handleSnoozeOpen}
            />
          ))}
        </div>
      )}

      {/* Show resolved toggle */}
      {resolved.length > 0 && (
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 text-left"
          aria-expanded={showResolved}
        >
          {showResolved ? 'Hide resolved' : `Show resolved (${resolved.length})`}
        </button>
      )}

      {/* Resolved alerts (collapsed by default) */}
      {showResolved && resolved.length > 0 && (
        <div className="space-y-2">
          {resolved.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              orgSlug={orgSlug}
              onAcknowledge={handleAcknowledge}
              onSnoozeOpen={handleSnoozeOpen}
            />
          ))}
        </div>
      )}

      {/* AlertSnoozePopover (rendered inline; anchored below Snooze button) */}
      {snoozeState && (
        <AlertSnoozePopover
          alertId={snoozeState.alertId}
          triggerRef={snoozeState.triggerRef}
          open={true}
          onClose={handleSnoozeClose}
        />
      )}
    </div>
  );

  // Mobile: Sheet bottom-drawer
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
    return (
      <Sheet open={open} onClose={onClose} title="Clinician alerts">
        {panelBody}
      </Sheet>
    );
  }

  // Desktop: fixed-position anchored dropdown
  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 8,
        right: Math.max(8, window.innerWidth - anchorRect.right),
        width: 380,
        maxHeight: '60vh',
        overflowY: 'auto',
        zIndex: 50,
      }
    : {
        position: 'fixed',
        top: 64,
        right: 16,
        width: 380,
        maxHeight: '60vh',
        overflowY: 'auto',
        zIndex: 50,
      };

  return (
    <div
      style={style}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-card shadow-lg p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[16px] font-semibold text-[var(--color-text)]">Clinician alerts</h2>
        <button
          type="button"
          aria-label="Close alerts panel"
          onClick={onClose}
          className="size-8 flex items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          ✕
        </button>
      </div>
      {panelBody}
    </div>
  );
}
