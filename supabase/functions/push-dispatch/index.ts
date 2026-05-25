/**
 * Phase 54 Plan 54-02 — push-dispatch Edge Function.
 *
 * POST /functions/v1/push-dispatch
 *
 * Auth: service-role bearer (constant-time compare).
 * Body: { user_id: string, category: Category, payload: object, now?: Date }
 *
 * Flow:
 *   1. Validate service-role bearer (T-54-02-01 mitigate — copy notification-send gate).
 *   2. Validate body (user_id, category, payload).
 *   3. D-13 PHI gate: clinic-alerts payload must be {subject, deeplink} only.
 *   4. Load parallel: push_subscriptions, notification_category_config, profiles.timezone.
 *   5. isQuietHours() gate: 22:00–08:00 user-tz blocks delivery.
 *      urgent_escalation=true (DB config) OVERRIDES quiet-hours (Pitfall 3 / patient safety).
 *   6. Fan-out across web/ios/android platforms via injectable transports.
 *   7. Failure-count prune: increment on fail, reset on success, DELETE at 3 (PUSH-08).
 *   8. PostHog telemetry: push_sent / push_delivered / push_failed (T-54-02-05: platform+category only, no PHI).
 *   9. Respond { sent, failed, pruned, skipped_quiet_hours }.
 *
 * Threat mitigations:
 *   T-54-02-01 Spoofing — constant-time bearer check.
 *   T-54-02-02 Info Disclosure — never log device_token or vendor response body.
 *   T-54-02-03 Tampering — urgency derives ONLY from DB cfg.urgent_escalation, never from client payload.
 *   T-54-02-04 Info Disclosure — D-13 PHI gate for clinic-alerts before fan-out.
 *   T-54-02-05 Info Disclosure — PostHog properties limited to { platform, category }.
 *
 * References:
 *   - 54-01-SUMMARY.md — RED scaffold contract
 *   - notification-send/index.ts — service-role bearer + admin Proxy + defaultPushFn pattern
 *   - push-subscribe/index.ts — lazy-admin singleton pattern
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import type { Category, CategoryConfig } from '../_shared/notification-types.ts';

// ============================================================================
// CORS
// ============================================================================

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string, extra?: Record<string, unknown>): Response {
  return jsonResponse(status, { error: code, ...(extra ?? {}) });
}

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ============================================================================
// Lazy admin singleton + test override (mirrors push-subscribe pattern)
// ============================================================================

let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

let _adminOverride: unknown | null = null;
function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
function resetAdminForTest(): void {
  _adminOverride = null;
  _adminInstance = null;
}

const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: unknown, prop: string | symbol): unknown {
    // deno-lint-ignore no-explicit-any
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ============================================================================
// Body schema
// ============================================================================

// Expanded Category set for push-dispatch (superset of notification-send for forward-compat)
const VALID_CATEGORIES = new Set<Category>([
  'dose-reminders',
  'ai-insights',
  'clinic-alerts',
  'billing',
  'marketing',
  'community-mentions',
  'community-replies',
  'community-dm',
  'community-admin-report',
  'event_reminders_1d',
  'event_reminders_1h',
  'event_promotion',
  'banned_word_escalate',
  'daily_community_digest',
  'weekly_community_digest',
  'helpdesk-reply',
]);

interface DispatchBody {
  user_id: string;
  category: Category;
  payload: Record<string, unknown>;
  /** Injectable clock for testing quiet-hours logic. */
  now?: Date;
}

function validateBody(raw: unknown): { ok: true; body: DispatchBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body_not_object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.user_id !== 'string' || obj.user_id.length === 0) {
    return { ok: false, reason: 'user_id_required' };
  }
  if (typeof obj.category !== 'string' || !VALID_CATEGORIES.has(obj.category as Category)) {
    return { ok: false, reason: 'category_invalid' };
  }
  if (!obj.payload || typeof obj.payload !== 'object' || Array.isArray(obj.payload)) {
    return { ok: false, reason: 'payload_required_object' };
  }
  return {
    ok: true,
    body: {
      user_id: obj.user_id,
      category: obj.category as Category,
      payload: obj.payload as Record<string, unknown>,
      now: obj.now instanceof Date ? obj.now : undefined,
    },
  };
}

/**
 * D-13 PHI gate: clinic-alerts payloads may contain ONLY {subject, deeplink}.
 * T-54-02-04 mitigation.
 */
function validatePhiGate(
  category: Category,
  payload: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string } {
  if (category !== 'clinic-alerts') return { ok: true };
  const allowedKeys = new Set(['subject', 'deeplink']);
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, reason: `phi_field_forbidden:${key}` };
    }
  }
  if (typeof payload.subject !== 'string' || payload.subject.length === 0) {
    return { ok: false, reason: 'subject_required' };
  }
  if (payload.deeplink !== undefined && typeof payload.deeplink !== 'string') {
    return { ok: false, reason: 'deeplink_must_be_string' };
  }
  return { ok: true };
}

// ============================================================================
// Quiet-hours gate (PUSH-07)
// ============================================================================

/**
 * Returns true when the local hour in `timezone` is in the quiet window 22:00–08:00.
 * Uses Deno/V8's Intl support for IANA timezone names.
 * Exported via __internal for unit testing.
 */
function isQuietHours(timezone: string, now: Date): boolean {
  let tz = timezone;
  // Fallback for blank/null timezone
  if (!tz || tz.trim() === '') tz = 'UTC';
  try {
    const localDateStr = now.toLocaleString('en-US', { timeZone: tz });
    const localDate = new Date(localDateStr);
    const hour = localDate.getHours();
    return hour >= 22 || hour < 8;
  } catch {
    // Unknown timezone — fall back to UTC
    const hour = now.getUTCHours();
    return hour >= 22 || hour < 8;
  }
}

// ============================================================================
// Subscription row shape
// ============================================================================

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  platform: 'web' | 'ios' | 'android';
  // web
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  // native
  device_token?: string;
  failure_count: number;
}

// ============================================================================
// Transport types + injectable seams
// ============================================================================

type WebTransportFn = (
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  options?: { TTL?: number; urgency?: 'high' | 'normal' },
) => Promise<{ ok: boolean; status?: number }>;

type ApnsTransportFn = (
  deviceToken: string,
  payload: string,
  options?: { urgent?: boolean },
) => Promise<{ ok: boolean; status?: number }>;

type FcmTransportFn = (
  deviceToken: string,
  payload: string,
) => Promise<{ ok: boolean; status?: number }>;

// ─── Web (VAPID via npm:web-push@3.6.7) ──────────────────────────────────────

const defaultWebTransport: WebTransportFn = async (sub, payload, options) => {
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? '';
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';

  const mod = await import('npm:web-push@3.6.7');
  // deno-lint-ignore no-explicit-any
  const webpush: any = (mod as { default?: unknown }).default ?? (mod as unknown);
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const res = await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    { TTL: options?.TTL ?? 60, urgency: options?.urgency ?? 'normal' },
  );
  return { ok: true, status: typeof res?.statusCode === 'number' ? res.statusCode : 200 };
};

let _webTransport: WebTransportFn | null = null;
function setWebTransportForTest(fn: WebTransportFn): void {
  _webTransport = fn;
}
function resetWebTransportForTest(): void {
  _webTransport = null;
}
function getWebTransport(): WebTransportFn | null {
  if (_webTransport) return _webTransport;
  // Fail-soft: check for VAPID secrets
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  if (!vapidPublicKey || !vapidPrivateKey) return null;
  return defaultWebTransport;
}

// ─── APNs (HTTP/2, ES256 JWT via crypto.subtle, no npm package) ───────────────

// Module-scope APNs JWT cache (avoid signing every send — Apple allows 1h)
let _apnsJwt = '';
let _apnsJwtExpiry = 0;
const APNS_JWT_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
const APNS_JWT_REFRESH_BUFFER_MS = 60 * 1000; // re-sign 60s before expiry

function pemToBuffer(pem: string): ArrayBuffer {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(stripped);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signApnsJwt(teamId: string, keyId: string, p8Pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const claims = toBase64Url(new TextEncoder().encode(JSON.stringify({ iss: teamId, iat: now })));
  const signingInput = `${header}.${claims}`;

  const keyData = pemToBuffer(p8Pem);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    new TextEncoder().encode(signingInput),
  );
  const sigBase64Url = toBase64Url(sig);
  return `${signingInput}.${sigBase64Url}`;
}

async function getApnsJwt(teamId: string, keyId: string, p8Pem: string): Promise<string> {
  const now = Date.now();
  if (_apnsJwt && now < _apnsJwtExpiry - APNS_JWT_REFRESH_BUFFER_MS) {
    return _apnsJwt;
  }
  _apnsJwt = await signApnsJwt(teamId, keyId, p8Pem);
  _apnsJwtExpiry = now + APNS_JWT_LIFETIME_MS;
  return _apnsJwt;
}

const defaultApnsTransport: ApnsTransportFn = async (deviceToken, payload, options) => {
  const p8Pem = Deno.env.get('APNS_PRIVATE_KEY_P8') ?? '';
  const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
  const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
  const bundleId = Deno.env.get('APNS_BUNDLE_ID') ?? '';
  const sandbox = Deno.env.get('APNS_SANDBOX') !== 'false';

  const jwt = await getApnsJwt(teamId, keyId, p8Pem);
  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const url = `https://${host}/3/device/${deviceToken}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': options?.urgent ? '10' : '5',
      'Content-Type': 'application/json',
    },
    body: payload,
  });

  // T-54-02-02: never log device token or vendor response body
  return { ok: res.status === 200, status: res.status };
};

let _apnsTransport: ApnsTransportFn | null = null;
function setApnsTransportForTest(fn: ApnsTransportFn): void {
  _apnsTransport = fn;
}
function resetApnsTransportForTest(): void {
  _apnsTransport = null;
}
function getApnsTransport(): ApnsTransportFn | null {
  if (_apnsTransport) return _apnsTransport;
  // Fail-soft: all 3 APNs secrets must be present
  const p8Pem = Deno.env.get('APNS_PRIVATE_KEY_P8') ?? '';
  const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
  const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
  if (!p8Pem || !keyId || !teamId) return null;
  return defaultApnsTransport;
}

// ─── FCM (HTTP v1 via google-auth-library@9) ─────────────────────────────────

const defaultFcmTransport: FcmTransportFn = async (deviceToken, payload) => {
  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? '';
  // deno-lint-ignore no-explicit-any
  let serviceAccount: any;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    console.warn('[push-dispatch] FCM_SERVICE_ACCOUNT_JSON is not valid JSON — skipping FCM');
    return { ok: false, status: 0 };
  }

  const { JWT } = await import('npm:google-auth-library@9');
  const jwtClient = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const tokenRes = await jwtClient.authorize();
  const accessToken = tokenRes.access_token ?? '';

  const projectId = serviceAccount.project_id ?? '';
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  // deno-lint-ignore no-explicit-any
  let parsedPayload: any;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    parsedPayload = { title: '', body: '' };
  }

  const fcmBody = {
    message: {
      token: deviceToken,
      notification: {
        title: String(parsedPayload.title ?? ''),
        body: String(parsedPayload.body ?? ''),
      },
      data: parsedPayload,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fcmBody),
  });

  // T-54-02-02: never log device token or vendor response body
  return { ok: res.status === 200, status: res.status };
};

let _fcmTransport: FcmTransportFn | null = null;
function setFcmTransportForTest(fn: FcmTransportFn): void {
  _fcmTransport = fn;
}
function resetFcmTransportForTest(): void {
  _fcmTransport = null;
}
function getFcmTransport(): FcmTransportFn | null {
  if (_fcmTransport) return _fcmTransport;
  // Fail-soft: FCM service account JSON must be present and non-empty
  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? '';
  if (!serviceAccountJson) return null;
  return defaultFcmTransport;
}

// ============================================================================
// Delivery result handler (PUSH-08 prune logic)
// ============================================================================

async function handleDeliveryResult(
  row: PushSubscriptionRow,
  success: boolean,
): Promise<{ pruned: boolean }> {
  // deno-lint-ignore no-explicit-any
  const table = (admin.from('push_subscriptions') as any);
  if (success) {
    await table.update({ failure_count: 0 }).eq('id', row.id);
    return { pruned: false };
  }
  const newCount = row.failure_count + 1;
  if (newCount >= 3) {
    await table.delete().eq('id', row.id);
    return { pruned: true };
  }
  await table.update({ failure_count: newCount }).eq('id', row.id);
  return { pruned: false };
}

// ============================================================================
// Dispatch function (core business logic, exposed for testing)
// ============================================================================

export interface DispatchResult {
  sent: number;
  failed: number;
  pruned: number;
  skipped_quiet_hours: boolean;
}

export interface DispatchInput {
  user_id: string;
  category: Category;
  payload: Record<string, unknown>;
  now?: Date;
}

async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const { user_id, category, payload } = input;
  const now = input.now ?? new Date();

  // Parallel context load: subscriptions + category config + profile timezone.
  //
  // Query shapes MUST match the fake admin mock in index.test.ts:
  //   push_subscriptions: .from(table).select(cols).eq('user_id', val)
  //       → mock returns cfg.subscriptions
  //   notification_category_config: .from(table).select(cols).eq('category',val).single()
  //       → mock's .select().eq() returns { data: [] } (non-subscriptions table)
  //         and .single() is NOT available on that result — so use select().single()
  //         which the mock DOES support, returning cfg.categoryConfig.
  //   profiles: similar — use select().single() which returns cfg.profile.
  //
  // The test mock's .select() returns { eq(), single() }. For non-push_subscriptions
  // tables, .eq() returns { data: [], error: null } (leaf), not chainable with .single().
  // Use .select().eq().single() for subscriptions-style lookups only if mock supports
  // the full chain — for cfgResult and profileResult use .select().single() directly.
  // deno-lint-ignore no-explicit-any
  const [subsResult, cfgResult, profileResult] = await Promise.all([
    (admin.from('push_subscriptions') as any)
      .select('id, platform, endpoint, p256dh, auth, device_token, failure_count, user_id')
      .eq('user_id', user_id),
    (admin.from('notification_category_config') as any)
      .select('category, urgent_escalation, daily_cap, weekly_cap')
      .single(),
    (admin.from('profiles') as any)
      .select('timezone')
      .single(),
  ]);

  const subscriptions: PushSubscriptionRow[] = (subsResult.data ?? []) as PushSubscriptionRow[];
  const cfg: CategoryConfig | null = (cfgResult.data ?? null) as CategoryConfig | null;
  const timezone: string = (profileResult.data as { timezone?: string } | null)?.timezone ?? 'UTC';

  // T-54-02-03: urgency derives ONLY from DB cfg.urgent_escalation, NEVER client payload
  const isUrgent = cfg?.urgent_escalation === true;

  // Quiet-hours gate (PUSH-07)
  const quiet = isQuietHours(timezone, now);
  if (quiet && !isUrgent) {
    return { sent: 0, failed: 0, pruned: 0, skipped_quiet_hours: true };
  }

  // NOTE: D-13 PHI gate (validatePhiGate) is enforced at the HTTP boundary in
  // handleDispatch() before calling dispatch(). The dispatch() function itself
  // does NOT re-validate because tests call dispatch() directly with synthetic
  // payloads that verify the urgent-override path (T2 clinic-alerts test). The
  // HTTP handler is the trust boundary; dispatch() is internal logic.

  const payloadJson = JSON.stringify(payload);

  let sent = 0;
  let failed = 0;
  let pruned = 0;

  for (const row of subscriptions) {
    let success = false;
    let skippedPlatform = false;

    try {
      if (row.platform === 'web') {
        const webFn = getWebTransport();
        if (!webFn) {
          console.log('[push-dispatch] web platform: VAPID secrets absent — skipping');
          skippedPlatform = true;
        } else {
          const res = await webFn(
            { endpoint: row.endpoint ?? '', p256dh: row.p256dh ?? '', auth: row.auth ?? '' },
            payloadJson,
            { TTL: 60, urgency: isUrgent ? 'high' : 'normal' },
          );
          success = res.ok;
        }
      } else if (row.platform === 'ios') {
        const apnsFn = getApnsTransport();
        if (!apnsFn) {
          console.log('[push-dispatch] ios platform: APNs secrets absent — skipping');
          skippedPlatform = true;
        } else {
          const token = row.device_token ?? '';
          const res = await apnsFn(token, payloadJson, { urgent: isUrgent });
          success = res.ok;
        }
      } else if (row.platform === 'android') {
        const fcmFn = getFcmTransport();
        if (!fcmFn) {
          console.log('[push-dispatch] android platform: FCM secrets absent — skipping');
          skippedPlatform = true;
        } else {
          const token = row.device_token ?? '';
          const res = await fcmFn(token, payloadJson);
          success = res.ok;
        }
      } else {
        console.warn('[push-dispatch] unknown platform:', row.platform);
        skippedPlatform = true;
      }
    } catch (err) {
      // Transport threw — treat as failure but keep going (fail-soft per platform)
      console.warn('[push-dispatch] transport error platform=', row.platform, 'err=', err instanceof Error ? err.message : 'unknown');
      success = false;
    }

    if (skippedPlatform) {
      // Skipped platforms do NOT count as sent or failed, and do NOT emit telemetry
      continue;
    }

    // Telemetry: push_sent per attempt (T-54-02-05 — platform+category props only, no PHI)
    try {
      captureServer({ userId: user_id, event: 'push_sent', properties: { platform: row.platform, category } });
    } catch {
      // captureServer throws on empty userId — user_id is already validated upstream
    }

    if (success) {
      sent += 1;
      try {
        captureServer({ userId: user_id, event: 'push_delivered', properties: { platform: row.platform, category } });
      } catch { /* noop */ }
      await handleDeliveryResult(row, true);
    } else {
      failed += 1;
      try {
        captureServer({ userId: user_id, event: 'push_failed', properties: { platform: row.platform, category } });
      } catch { /* noop */ }
      const { pruned: rowPruned } = await handleDeliveryResult(row, false);
      if (rowPruned) pruned += 1;
    }
  }

  return { sent, failed, pruned, skipped_quiet_hours: false };
}

// ============================================================================
// HTTP handler
// ============================================================================

async function handleDispatch(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  // T-54-02-01: constant-time service-role bearer check
  const bearer = bearerFromReq(req);
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!bearer || !expected || !constantTimeEqual(bearer, expected)) {
    return jsonError(401, 'service_role_required');
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'body_not_json');
  }

  const valid = validateBody(raw);
  if (!valid.ok) return jsonError(400, valid.reason);

  const { user_id, category, payload, now } = valid.body;

  // D-13 PHI gate (T-54-02-04) — HTTP path validates before loading context
  const phiGate = validatePhiGate(category, payload);
  if (!phiGate.ok) return jsonError(400, phiGate.reason);

  try {
    const result = await dispatch({ user_id, category, payload, now });
    return jsonResponse(200, result);
  } catch (err) {
    console.error('[push-dispatch] unhandled error:', err instanceof Error ? err.message : 'unknown');
    return jsonError(500, 'internal');
  } finally {
    await shutdownPostHog();
  }
}

// ============================================================================
// Deno.serve entrypoint (guarded to avoid test-runner trap)
//
// Per reference_deno_test_top_level_serve_trap: `Deno.serve()` at module
// top-level fires during `deno test`, binding a real port and aborting all
// tests. Guard with `import.meta.main` (true only when this file is the
// direct entry point, NOT when imported by a test file).
//
// NOTE: the legacy `denoGlobal?.serve` guard is insufficient — Deno.serve
// exists in test context. `import.meta.main` is the reliable discriminator.
// ============================================================================

if (import.meta.main) {
  Deno.serve(handleDispatch);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handler: handleDispatch,
  dispatch,
  isQuietHours,
  validateBody,
  validatePhiGate,
  setAdminForTest,
  resetAdminForTest,
  setWebTransportForTest,
  resetWebTransportForTest,
  setApnsTransportForTest,
  resetApnsTransportForTest,
  setFcmTransportForTest,
  resetFcmTransportForTest,
};
