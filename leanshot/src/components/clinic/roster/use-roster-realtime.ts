/**
 * Phase 10 Plan 10-06 — useRosterRealtime hook.
 *
 * Subscribes to the org-scoped Realtime channel from Plan 10-03.
 * Topic format: 'org:{orgId}' (colon, matching Phase 9 RLS).
 * On 'patient_signal_change' broadcast → calls onSignalChange with payload.
 *
 * Per D-16: this hook patches signal columns in-place; it does NOT
 * re-fire the rank_org_patients RPC. Score recompute is handled by the
 * passive 30s refresh + manual refresh button in RosterTable.
 */
import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';

export interface PatientSignalChangePayload {
  user_id: string;
  section: 'injections' | 'weights' | 'symptoms';
  changed_at: string;
}

export interface UseRosterRealtimeOptions {
  orgId: string;
  onSignalChange: (payload: PatientSignalChangePayload) => void;
}

export function useRosterRealtime({ orgId, onSignalChange }: UseRosterRealtimeOptions): void {
  useEffect(() => {
    if (!orgId) return;

    const topic = `org:${orgId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (broadcastPayload: any) => {
      const inner = broadcastPayload?.payload as PatientSignalChangePayload | undefined;
      if (inner?.user_id && inner.section && inner.changed_at) {
        onSignalChange(inner);
      }
    };

    const channel = supabase
      .channel(topic)
      .on('broadcast', { event: 'patient_signal_change' }, handler)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // onSignalChange is intentionally excluded from the dep array — callers
    // should memoize it; re-subscribing every render would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
}
