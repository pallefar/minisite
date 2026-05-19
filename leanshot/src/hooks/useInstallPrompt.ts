/**
 * Phase 42 Plan 04 (D-16) — React hook over the install-prompt state machine.
 *
 * Re-evaluates on:
 *   - beforeinstallprompt fired (capturedPromptEvent appears).
 *   - appinstalled fired.
 *   - dashboard-visit count increments (App-level recordDashboardVisit
 *     dispatches a synthetic CustomEvent('leanshot:install-prompt-tick') the
 *     hook listens for).
 */
import { useEffect, useState } from 'react';

import {
  dismiss,
  getInstallPromptState,
  initializeInstallPromptModule,
  maybeLater,
  shouldShowCard,
  triggerInstallPrompt,
} from '@/lib/pwa/install-prompt';

export interface UseInstallPromptValue {
  show: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  later: () => void;
  dismiss: () => void;
}

const TICK_EVENT = 'leanshot:install-prompt-tick';

export function useInstallPrompt(): UseInstallPromptValue {
  const [show, setShow] = useState<boolean>(() => false);

  useEffect(() => {
    initializeInstallPromptModule();
    const recompute = (): void => setShow(shouldShowCard());
    recompute();
    window.addEventListener('beforeinstallprompt', recompute);
    window.addEventListener('appinstalled', recompute);
    window.addEventListener(TICK_EVENT, recompute as EventListener);
    return () => {
      window.removeEventListener('beforeinstallprompt', recompute);
      window.removeEventListener('appinstalled', recompute);
      window.removeEventListener(TICK_EVENT, recompute as EventListener);
    };
  }, []);

  return {
    show,
    install: async () => {
      const outcome = await triggerInstallPrompt();
      // Refresh visibility after the native prompt resolves.
      setShow(shouldShowCard());
      void getInstallPromptState();
      return outcome;
    },
    later: () => {
      maybeLater();
      setShow(shouldShowCard());
    },
    dismiss: () => {
      dismiss();
      setShow(shouldShowCard());
    },
  };
}

/** Tick helper used by the dashboard-visit recorder to wake the hook. */
export function notifyInstallPromptTick(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(TICK_EVENT));
}
