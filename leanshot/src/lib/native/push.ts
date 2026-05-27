/**
 * Phase 54 Plan 54-03 — Native push registration (replaces Phase 12 throw-stub).
 *
 * Implements registerForPush() for APNs (iOS) and FCM (Android) via
 * @capacitor/push-notifications. Web path returns {ok:false} immediately so
 * the web VAPID path in permission.ts stays unchanged (PUSH-05 separation).
 *
 * Firewall: detectPlatform from './platform' is the SOLE Capacitor/core import
 * site in src/lib/native/*. Do NOT import from '@capacitor/core' directly.
 * Do NOT import from './health' (import-x/no-restricted-paths).
 *
 * Soft-prompt ordering (PUSH-05):
 *   checkPermissions() → if 'prompt' → requestPermissions() → if 'granted' → register()
 *   Never calls requestPermissions() if check already returns 'granted' or 'denied'.
 */

import { PushNotifications } from '@capacitor/push-notifications';
import { detectPlatform } from './platform';

// ─── Exported types ──────────────────────────────────────────────────────────

export type PushChannel = 'apns' | 'fcm' | 'web-push';

export interface PushRegisterResult {
  ok: boolean;
  error?: string;
}

// ─── Registration ID — stored on globalThis so it survives module resets ─────
// vitest's vi.resetModules() re-evaluates this module but keeps the shared
// globalThis, allowing stale listeners (from previous calls/tests) to detect
// they have been superseded and bail out before issuing fetch calls.
const _REG_ID_KEY = '__leanshot_push_reg_id__';

function _nextRegId(): number {
  const g = globalThis as Record<string, unknown>;
  const next = ((g[_REG_ID_KEY] as number | undefined) ?? 0) + 1;
  g[_REG_ID_KEY] = next;
  return next;
}

function _currentRegId(): number {
  return ((globalThis as Record<string, unknown>)[_REG_ID_KEY] as number | undefined) ?? 0;
}

// ─── registerForPush ──────────────────────────────────────────────────────────

/**
 * Register the device for native push notifications and store the token in
 * push_subscriptions via the push-subscribe Edge Function.
 *
 * @param accessToken  Supabase user JWT (Bearer token for the Edge Fn)
 * @param supabaseUrl  Supabase project URL (e.g. https://abc.supabase.co)
 */
export async function registerForPush(
  accessToken: string,
  supabaseUrl: string,
): Promise<PushRegisterResult> {
  const platform = detectPlatform();

  // Web path: return early — web uses the VAPID path in permission.ts (PUSH-05)
  if (platform === 'web' || platform === 'capacitor-web') {
    return { ok: false, error: 'not-native: use web VAPID path' };
  }

  // ── Soft-prompt ordering (PUSH-05) ──────────────────────────────────────────
  // Always check first; only call requestPermissions() when status is 'prompt'.
  // Never OS-prompt if already granted or denied.
  const checkResult = await PushNotifications.checkPermissions();
  let receive = checkResult.receive;

  if (receive === 'prompt') {
    const reqResult = await PushNotifications.requestPermissions();
    receive = reqResult.receive;
  }

  if (receive !== 'granted') {
    return { ok: false, error: `permission-${receive}` };
  }

  // ── Bump registration ID before adding listeners ──────────────────────────
  // Any stale listener from a previous registerForPush call will see that
  // _currentRegId() has advanced past its captured myId and return early.
  // Using globalThis ensures the ID is shared even when vi.resetModules()
  // re-evaluates this module (each test gets a fresh module but shares globalThis).
  const myId = _nextRegId();

  await PushNotifications.removeAllListeners();

  // ── Add listeners before register() ──────────────────────────────────────────
  // Capacitor fires 'registration' / 'registrationError' AFTER register() resolves.
  // We wrap in a Promise so the caller can await the token delivery.
  return new Promise<PushRegisterResult>((resolve) => {
    // Registration success — token arrived from APNs/FCM
    void PushNotifications.addListener('registration', async (token) => {
      // Guard: if a newer registration has started, this callback is stale — ignore it.
      if (_currentRegId() !== myId) return;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/push-subscribe`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            platform,
            device_token: token.value,
          }),
        });
        resolve({ ok: res.ok });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : 'fetch-failed' });
      }
    });

    // Registration error — APNs/FCM rejected the registration attempt
    void PushNotifications.addListener('registrationError', (error) => {
      if (_currentRegId() !== myId) return;
      resolve({ ok: false, error: String(error) });
    });

    // Trigger native registration — 'registration' / 'registrationError' fires asynchronously
    void PushNotifications.register();
  });
}
