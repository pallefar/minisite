/**
 * Phase 42 Plan 04 (D-13) — React hook over the offline store.
 */
import { useEffect, useState } from 'react';

import { getOfflineState, subscribeOffline, type OfflineState } from '@/lib/pwa/offline-store';

export function useOfflineState(): OfflineState {
  const [snapshot, setSnapshot] = useState<OfflineState>(() => getOfflineState());
  useEffect(() => {
    const unsubscribe = subscribeOffline(setSnapshot);
    // Sync once on mount in case the store mutated before subscribe ran.
    setSnapshot(getOfflineState());
    return unsubscribe;
  }, []);
  return snapshot;
}
