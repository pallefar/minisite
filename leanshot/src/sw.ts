/// <reference lib="webworker" />
// Phase 42 Plan 04 — LeanShot service worker (injectManifest strategy).
//
// Why injectManifest (not generateSW): Plan 42-08 (Wave 3) extends this file
// with a `push` event listener for VAPID web-push delivery. generateSW does
// not support arbitrary event listeners — workbox.additionalManifestEntries
// is for precache assets, not SW logic. With injectManifest the workbox
// helpers (precaching + routing) live INSIDE this source file, and the
// VitePWA plugin injects the build-time precache manifest at `self.__WB_MANIFEST`.
//
// HIPAA constraint (Pitfall 1, T-42-04-01): the Workbox runtime cache key is
// the request URL — `Authorization` headers do NOT discriminate cached
// responses, so caching authenticated Supabase API responses would leak PHI
// across users on the same PWA install. Therefore the API allowlist below is
// EXPLICIT: only the three public-read tables (kb_articles, changelog_entries,
// status_components) are cached. NEVER add an authenticated endpoint here
// without a per-user cache-key plugin.

import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// (1) Public-read Supabase API endpoints — NetworkFirst, 3s timeout, 5min TTL.
// Allowlist is explicit; PHI-bearing endpoints (/rest/v1/injections,
// /rest/v1/clinic_invites, /rest/v1/profiles, etc.) are NOT listed and
// therefore pass through to the network on every request.
registerRoute(
  ({ url }) =>
    /\/rest\/v1\/(kb_articles|changelog_entries|status_components)/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'public-api-cache',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
  }),
);

// (2) Image / font assets — CacheFirst, 1 day TTL.
registerRoute(
  ({ url }) => /\.(png|jpg|jpeg|svg|webp|avif|woff2)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'asset-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 86_400 })],
  }),
);

// Plan 42-08 (Wave 3) — VAPID web-push handler.
//
// Why HERE (not leanshot/public/sw-push-handler.js): injectManifest gives us a
// single SW source file that owns ALL background behavior in the SW context.
// generateSW would not support arbitrary event listeners.
//
// Payload contract matches supabase/functions/notification-send/index.ts —
// keep these two in sync: a change to one MUST be paired with the other.
//   { title, body, icon?, tag?, urgency?, deeplink? }
//
// Urgency mapping: 'high' (clinic-alerts per D-03) sets requireInteraction so
// the notification stays on screen until the user dismisses it; 'normal' /
// 'low' use the OS default (auto-dismiss after a few seconds).
//
// notificationclick: focuses an existing leanshot tab matching the deeplink
// path if open, otherwise opens a new window at the deeplink. Standard
// best-practice per web.dev/push-notifications/handling-messages.
interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  urgency?: 'low' | 'normal' | 'high';
  deeplink?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload | null = null;
  try {
    payload = event.data?.json() as PushPayload | null;
  } catch {
    payload = null;
  }
  if (!payload || !payload.title) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? '/pwa-192x192.png',
      tag: payload.tag,
      requireInteraction: payload.urgency === 'high',
      data: { deeplink: payload.deeplink ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { deeplink?: string } | undefined;
  const url = data?.deeplink ?? '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          // Match by trailing path so e.g. https://app.leanshot.app/dashboard
          // matches a stored deeplink of '/dashboard'.
          if (c.url.endsWith(url) && 'focus' in c) {
            return c.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
        return undefined;
      }),
  );
});

// Update lifecycle: do NOT auto-skipWaiting (D-17). The client posts the
// SKIP_WAITING message AFTER the user clicks "Reload" in the SW update toast.
self.addEventListener('message', (event) => {
  if (event.data && (event.data as { type?: string }).type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
