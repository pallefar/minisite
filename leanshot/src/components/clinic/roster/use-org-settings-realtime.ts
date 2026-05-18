/**
 * Phase 30 Plan 02 — useOrgSettingsRealtime hook.
 *
 * Subscribes to the org-scoped settings HMAC channel from Phase 28.
 * Topic format: channelNameFor(orgId, 'settings') → 'org-{hmac8}-settings'
 *
 * On postgres_changes UPDATE event on org_settings where new.org_id matches
 * the caller's orgId → calls onWeightsChanged callback.
 *
 * This enables SC#1: roster reorders within ~1s of weight save in another tab.
 *
 * Mirrors use-roster-realtime.ts structure: same channelNameFor + channel.subscribe
 * pattern; async channelNameFor handled inside useEffect.
 *
 * Subscription failure (CHANNEL_ERROR): logs a warning, does NOT throw.
 * The Phase 10 30-second polling failsafe in RosterTable remains the backup.
 *
 * @param orgId - UUID of the organization
 * @param onWeightsChanged - Callback invoked on org_settings UPDATE for this org
 */
import { useEffect } from 'react';
import { channelNameFor } from '@/lib/org-realtime';
import { supabase } from '@/lib/supabase';

export interface UseOrgSettingsRealtimeOptions {
  orgId: string;
  onWeightsChanged: () => void;
}

export function useOrgSettingsRealtime({
  orgId,
  onWeightsChanged,
}: UseOrgSettingsRealtimeOptions): void {
  useEffect(() => {
    if (!orgId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const setup = async (): Promise<void> => {
      let topic: string;
      try {
        topic = await channelNameFor(orgId, 'settings');
      } catch (err) {
        console.warn('[use-org-settings-realtime] Failed to compute HMAC channel name for org', orgId, err);
        return;
      }

      if (cancelled) return;

      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'org_settings' },
          (payload) => {
            const newRow = payload.new as { org_id?: string } | undefined;
            if (newRow?.org_id === orgId) {
              onWeightsChanged();
            }
          },
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            console.warn(
              '[use-org-settings-realtime] HMAC channel subscribe failed for org',
              orgId,
            );
          }
        });
    };

    void setup();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
    // onWeightsChanged intentionally excluded from deps — callers should memoize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
}
