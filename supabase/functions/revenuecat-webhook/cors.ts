/**
 * cors.ts — Minimal response headers for the revenuecat-webhook Edge Function.
 *
 * RevenueCat servers do NOT send an `Origin` header — they are server-to-server
 * POSTs. Therefore no `Access-Control-Allow-*` headers are needed or set here.
 * This is intentionally narrower than `share/cors.ts` (which echoes Origin for
 * browser-side fetch with credentials).
 *
 * Every response (including 4xx / 5xx / OPTIONS) carries
 * `Cache-Control: private, no-store` so that CDN/proxy layers cannot cache any
 * webhook payload fragment (T-16-06-04 — mirrors stripe-webhook T-14-03-I2).
 */

export const BASE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};
