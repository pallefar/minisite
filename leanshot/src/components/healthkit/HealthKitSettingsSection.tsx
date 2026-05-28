// Phase 55 Plan 55-04 — HealthKit Settings section (HEALTH-07 UI: revoke + purge controls).
//
// Renders three states (UI-SPEC Screens 2-4):
//   connected  — "Connected" badge, last-sync caption, Auto-sync Pill, Sync now, Revoke
//   revoked    — "Access revoked" badge, status line, Reconnect, Delete imported data (purge)
//   not-connected — "Connect Apple Health" primary CTA → opens HealthKitConsentModal
//
// Revoke + Purge are gated by useConfirm (HIPAA: no accidental data loss).
// Platform guard: non-iOS → unavailable message only, no interactive controls.
//
// DO NOT import from any *.ad-eligible.ts, src/lib/analytics/*, src/lib/affiliate/*,
// src/lib/ads/*, src/lib/marketing/*, or src/lib/native/ads*.ts file.

import { Heart, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Pill } from '@/components/ui/Pill';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { isEnabled, purgeImportedData, revokeAccess, syncNow } from '@/lib/native/health';
import { detectPlatform } from '@/lib/native/platform';
import { HealthKitConsentModal } from './HealthKitConsentModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HKState = 'loading' | 'not-connected' | 'connected' | 'revoked';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HealthKitSettingsSection() {
  const toast = useToast();
  const {
    confirm,
    open: confirmOpen,
    message: confirmMessage,
    title: confirmTitle,
    confirmLabel,
    cancelLabel,
    destructive: confirmDestructive,
    handleConfirm,
    handleCancel,
  } = useConfirm();

  const [hkState, setHkState] = useState<HKState>('loading');
  const [syncing, setSyncing] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  // Last-sync caption: updated after a successful syncNow
  const [lastSyncLabel, setLastSyncLabel] = useState<string>('Never');

  const platform = detectPlatform();
  const isIos = platform === 'ios';

  // Load initial state
  useEffect(() => {
    if (!isIos) {
      setHkState('not-connected');
      return;
    }
    void isEnabled().then((enabled) => {
      setHkState(enabled ? 'connected' : 'not-connected');
    });
  }, [isIos]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleRevoke = async (): Promise<void> => {
    const ok = await confirm(
      'Future syncs will stop. Data already imported remains in your logs unless you choose to delete it below.',
      {
        title: 'Revoke Apple Health access?',
        confirmLabel: 'Revoke access',
        cancelLabel: 'Keep connected',
        destructive: true,
      },
    );
    if (!ok) return;
    try {
      await revokeAccess();
      setHkState('revoked');
      toast('Apple Health access revoked. Future syncs are disabled.', 'success');
    } catch {
      toast('Something went wrong. Try again or contact support.', 'error');
    }
  };

  const handlePurge = async (): Promise<void> => {
    const ok = await confirm(
      'This will permanently delete all data imported from Apple Health. Your manually logged data will not be affected. This cannot be undone.',
      {
        title: 'Delete imported Apple Health data?',
        confirmLabel: 'Delete imported data',
        cancelLabel: 'Keep my data',
        destructive: true,
      },
    );
    if (!ok) return;
    try {
      await purgeImportedData();
      toast('Imported Apple Health data deleted from your account.', 'success');
    } catch {
      toast('Deletion failed. Try again or contact support.', 'error');
    }
  };

  const handleSyncNow = async (): Promise<void> => {
    if (syncing) return;
    setSyncing(true);
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      await syncNow(thirtyDaysAgo, now);
      setLastSyncLabel('Just now');
      toast('Sync complete.', 'success');
    } catch {
      toast('Sync failed. Check your connection and try again.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleConnected = (): void => {
    setConsentOpen(false);
    setHkState('connected');
    // CR-04: trigger initial sync immediately after authorization granted so the
    // "Starting initial sync…" toast in HealthKitConsentModal is truthful.
    void handleSyncNow();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isIos) {
    return (
      <Card variant="default">
        <div className="flex items-center gap-2.5 mb-3">
          <Heart className="size-4 text-[var(--color-text-secondary)]" aria-hidden />
          <span className="text-[13px] font-semibold text-[var(--color-text)]">Apple Health</span>
        </div>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Apple Health sync is only available on iPhone.
        </p>
      </Card>
    );
  }

  if (hkState === 'loading') {
    return (
      <Card variant="default">
        <div className="flex items-center gap-2.5">
          <Heart className="size-4 text-[var(--color-text-secondary)]" aria-hidden />
          <span className="text-[13px] font-semibold text-[var(--color-text)]">Apple Health</span>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card variant="default">
        {/* Card header row: icon + title + status badge */}
        <div className="flex items-center gap-2.5 mb-3">
          <Heart className="size-4 text-[var(--color-primary)] shrink-0" aria-hidden />
          <span className="text-[13px] font-semibold text-[var(--color-text)] flex-1">
            Apple Health
          </span>
          {hkState === 'connected' && (
            <Badge tone="success" role="status">
              Connected
            </Badge>
          )}
          {hkState === 'revoked' && (
            <Badge tone="danger" role="status">
              Access revoked
            </Badge>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* STATE: not-connected                                                */}
        {/* ------------------------------------------------------------------ */}
        {hkState === 'not-connected' && (
          <div className="space-y-2">
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Connect Apple Health to automatically import your weight, steps, sleep, and heart
              rate.
            </p>
            <Button
              variant="primary"
              size="md"
              onClick={() => setConsentOpen(true)}
              aria-label="Connect Apple Health"
            >
              Connect Apple Health
            </Button>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE: connected                                                    */}
        {/* ------------------------------------------------------------------ */}
        {hkState === 'connected' && (
          <div className="space-y-3">
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              Last synced {lastSyncLabel}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Pill active aria-pressed={true}>
                Auto-sync enabled
              </Pill>
              <Button
                variant="tonal"
                size="sm"
                disabled={syncing}
                aria-label={syncing ? 'Syncing…' : 'Sync now'}
                onClick={() => {
                  void handleSyncNow();
                }}
              >
                {syncing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Syncing...
                  </>
                ) : (
                  'Sync now'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE: revoked                                                      */}
        {/* ------------------------------------------------------------------ */}
        {hkState === 'revoked' && (
          <div className="space-y-3">
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              HealthKit sync is disabled. Previously imported data remains in your logs.
            </p>
            <Button
              variant="tonal"
              size="sm"
              aria-label="Reconnect Apple Health"
              onClick={() => setConsentOpen(true)}
            >
              Reconnect
            </Button>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* DESTRUCTIVE ZONE: connected or revoked                             */}
        {/* ------------------------------------------------------------------ */}
        {(hkState === 'connected' || hkState === 'revoked') && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border)] space-y-3">
            {hkState === 'connected' && (
              <Button
                variant="destructive"
                size="sm"
                aria-label="Revoke HealthKit access"
                onClick={() => {
                  void handleRevoke();
                }}
              >
                Revoke HealthKit access
              </Button>
            )}
            {hkState === 'revoked' && (
              <>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--color-text)] mb-1">
                    Remove imported data
                  </p>
                  <p className="text-[13px] text-[var(--color-text-secondary)]">
                    This permanently deletes all data LeanShot imported from Apple Health. Manually
                    logged data is not affected.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label="Delete imported Apple Health data"
                  onClick={() => {
                    void handlePurge();
                  }}
                >
                  Delete imported Apple Health data
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      {/* Consent modal (opened from not-connected or reconnect) */}
      <HealthKitConsentModal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        onConnected={handleConnected}
      />

      {/* useConfirm modal (revoke + purge gates) */}
      <ConfirmModal
        open={confirmOpen}
        message={confirmMessage}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        destructive={confirmDestructive}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
