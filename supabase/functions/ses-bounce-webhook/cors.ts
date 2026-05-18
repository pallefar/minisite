/**
 * cors.ts — Minimal response headers for the ses-bounce-webhook Edge Function.
 *
 * AWS SNS does NOT send an `Origin` header — these are server-to-server POSTs.
 * No `Access-Control-Allow-*` headers are needed or set here.
 * This is intentionally identical to `stripe-webhook/cors.ts`.
 *
 * Every response (including 4xx / 5xx / OPTIONS) carries:
 *   - `Cache-Control: private, no-store` — prevents CDN/proxy from caching any
 *     webhook payload or suppression-list response fragment (T-25-03-I2).
 *
 * Phase 25 Plan 25-03 (HIPAA-05, T-25-03-I2).
 */

export const BASE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};
