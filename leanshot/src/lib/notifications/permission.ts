/**
 * Phase 42 Plan 42-08 — web-push permission helper.
 *
 * Pitfall 3 enforcement (42-RESEARCH §Pitfall 3): Notification.requestPermission
 * MUST be invoked inside an explicit user gesture. Chrome's "abusive permission
 * prompt" heuristic will permanently block future prompts for the origin if
 * called eagerly (page load, post-signup). The `fromUserGesture` runtime guard
 * is the explicit gate — every call site MUST pass `{ fromUserGesture: true }`
 * inside a click handler. Calling without the flag throws synchronously.
 *
 * Flow:
 *   1. caller (NotificationsSubtab "Enable push notifications" button) calls
 *      requestPushPermission({ fromUserGesture: true }) inside its onClick.
 *   2. Notification.requestPermission() resolves with 'granted'/'denied'/'default'.
 *   3. On 'granted': pushManager.subscribe() with VAPID applicationServerKey;
 *      POST the resulting PushSubscription to the /push-subscribe Edge Fn
 *      (deployed in Plan 42-05) with the user's auth bearer token.
 *
 * VAPID public key MUST be referenced as a literal `import.meta.env.VITE_VAPID_PUBLIC_KEY`
 * per memory reference_vite_static_env_inlining — dynamic key construction
 * (`import.meta.env[\`VITE_${name}\`]`) is NOT inlined by Vite at build time.
 */

import { supabase } from '@/lib/supabase';

export interface RequestPushPermissionOpts {
  /**
   * Pitfall 3 enforcement. Caller MUST pass true to confirm this call is
   * happening synchronously inside a click handler. Calls without this flag
   * throw immediately — DO NOT remove this guard without re-reading
   * 42-RESEARCH §Pitfall 3.
   */
  fromUserGesture: true;
}

export type PermissionResult =
  | { state: 'granted'; subscription: PushSubscription }
  | { state: 'denied' }
  | { state: 'default' }
  | { state: 'unsupported'; reason: string }
  | { state: 'subscribe-failed'; error: string };

/** Convert a base64url-encoded VAPID public key to the Uint8Array the
 *  PushManager API requires. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function requestPushPermission(
  opts: RequestPushPermissionOpts,
): Promise<PermissionResult> {
  // Pitfall 3 enforcement — runtime guard.
  if (!opts || opts.fromUserGesture !== true) {
    throw new Error(
      'requestPushPermission must be called from a user gesture (Pitfall 3). ' +
        'Pass { fromUserGesture: true } from an explicit click handler.',
    );
  }

  // Capability gates — older browsers / non-secure-context simply don't have
  // these globals.
  if (typeof Notification === 'undefined' || typeof navigator === 'undefined') {
    return { state: 'unsupported', reason: 'Notification API not available' };
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { state: 'unsupported', reason: 'PushManager / ServiceWorker not available' };
  }

  // VITE_VAPID_PUBLIC_KEY — LITERAL reference per memory reference_vite_static_env_inlining.
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    return { state: 'unsupported', reason: 'VAPID public key not configured' };
  }

  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { state: 'denied' };
  if (permission !== 'granted') return { state: 'default' };

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    // POST the subscription to the /push-subscribe Edge Fn. The Edge Fn
    // verifies the JWT subject against the user_id and upserts into
    // push_subscriptions ON CONFLICT (user_id, endpoint) per Plan 42-05.
    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;
    if (!accessToken) {
      return { state: 'subscribe-failed', error: 'no auth session' };
    }
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-subscribe`;
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { state: 'subscribe-failed', error: `${res.status} ${text}` };
    }
    return { state: 'granted', subscription: sub };
  } catch (e) {
    return {
      state: 'subscribe-failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
