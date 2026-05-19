/**
 * Phase 42 Plan 42-05 (POLISH-05/06) — notification-send Edge Function.
 *
 * POST /functions/v1/notification-send
 *
 * Auth: service-role bearer (called from cron / RPCs / fan-out triggers, NOT
 * from user clients). Body { user_id, category, payload, channelHint? }.
 *
 * Flow per RESEARCH §Pattern 2:
 *   1. Validate body (zod-equivalent inline schema).
 *   2. PHI gate: for clinic-alerts category, payload must contain ONLY
 *      {subject, deeplink} (D-13 HIPAA non-PHI invariant).
 *   3. Load context in parallel: notification_settings rows for (user, category),
 *      notification_category_config row for category, notification_dismissal_state
 *      row, firedTodayCount + firedThisWeekCount from user_notifications.
 *   4. Call shouldFire() (pure function in _shared/notification-fire-decision.ts).
 *   5. For each true channel:
 *      - email   → _shared/email-router.sendEmail({phi: category==='clinic-alerts'})
 *      - push    → npm:web-push primary path (42-01 spike outcome) OR crypto.subtle fallback
 *      - in-app  → INSERT INTO user_notifications (handled below as a single row anyway)
 *   6. INSERT INTO user_notifications a source-of-truth row.
 *   7. Respond { decision, fired: ['email', 'push', 'in-app'], notification_id }.
 *
 * References:
 *   - reference_supabase_functions_deploy_no_linked_flag — deploy without --linked
 *   - reference_supabase_pg_cron_vault_service_role_pattern — not used here; we
 *     accept the service-role bearer directly from the cron's body
 *   - 42-01-SPIKE-RESULT.md — web-push import recipe (npm:web-push@3.6.7 primary)
 *
 * Internals (`__internal`) exported for Deno test suite.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, type EmailTemplate } from '../_shared/email-router.ts';
import {
  shouldFire,
  type Category,
  type CategoryConfig,
  type DismissalState,
  type FireDecision,
  type NotificationSetting,
} from '../_shared/notification-fire-decision.ts';

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
// Lazy admin singleton + override hook
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
// Pluggable email + push transports — injectable for Deno tests
// ============================================================================

type EmailFn = typeof sendEmail;
let _emailFn: EmailFn = sendEmail;
function setEmailFnForTest(fn: EmailFn): void {
  _emailFn = fn;
}
function resetEmailFnForTest(): void {
  _emailFn = sendEmail;
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

type PushFn = (
  subscription: PushSubscriptionRow,
  payload: string,
  options: { TTL: number; urgency: 'high' | 'normal' },
) => Promise<{ ok: boolean; status?: number }>;

const defaultPushFn: PushFn = async (subscription, payload, options) => {
  // Per 42-01 spike: primary path is npm:web-push@3.6.7. If runtime-fails, the
  // executor will hot-patch in the crypto.subtle fallback per the spike result.
  const mod = await import('npm:web-push@3.6.7');
  // deno-lint-ignore no-explicit-any
  const webpush: any =
    (mod as { default?: unknown }).default ?? (mod as unknown);
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@app.leanshot.app',
    Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  );
  const res = await webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    payload,
    { TTL: options.TTL, urgency: options.urgency },
  );
  return { ok: true, status: typeof res?.statusCode === 'number' ? res.statusCode : 200 };
};

let _pushFn: PushFn = defaultPushFn;
function setPushFnForTest(fn: PushFn): void {
  _pushFn = fn;
}
function resetPushFnForTest(): void {
  _pushFn = defaultPushFn;
}

// ============================================================================
// Body schema (zod-equivalent inline)
// ============================================================================

const VALID_CATEGORIES = new Set<Category>([
  'dose-reminders',
  'ai-insights',
  'clinic-alerts',
  'billing',
  'marketing',
]);

interface SendBody {
  user_id: string;
  category: Category;
  payload: Record<string, unknown>;
}

function validateBody(raw: unknown): { ok: true; body: SendBody } | { ok: false; reason: string } {
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
    },
  };
}

/**
 * D-13 PHI gate: clinic-alerts payloads may contain ONLY {subject, deeplink}.
 * Any other key → reject (T-42-05-01 mitigation).
 *
 * For all other categories, payload shape is open.
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
// Context loading
// ============================================================================

interface LoadedContext {
  prefs: NotificationSetting[];
  cfg: CategoryConfig | null;
  dismissal: DismissalState | null;
  firedTodayCount: number;
  firedThisWeekCount: number;
}

async function loadContext(userId: string, category: Category): Promise<LoadedContext> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [prefsRes, cfgRes, dismissRes, dayRes, weekRes] = await Promise.all([
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (admin.from('notification_settings') as any)
      .select('user_id, category, channel, enabled, snoozed_until, user_cap_override')
      .eq('user_id', userId)
      .eq('category', category),
    (admin.from('notification_category_config') as any)
      .select('*')
      .eq('category', category)
      .maybeSingle(),
    (admin.from('notification_dismissal_state') as any)
      .select('user_id, category, consecutive_dismissals, throttle_until, last_event_at')
      .eq('user_id', userId)
      .eq('category', category)
      .maybeSingle(),
    (admin.from('user_notifications') as any)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('category', category)
      .gte('fired_at', dayAgo),
    (admin.from('user_notifications') as any)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('category', category)
      .gte('fired_at', weekAgo),
    /* eslint-enable @typescript-eslint/no-explicit-any */
  ]);

  return {
    prefs: (prefsRes.data ?? []) as NotificationSetting[],
    cfg: (cfgRes.data ?? null) as CategoryConfig | null,
    dismissal: (dismissRes.data ?? null) as DismissalState | null,
    firedTodayCount: dayRes.count ?? 0,
    firedThisWeekCount: weekRes.count ?? 0,
  };
}

// ============================================================================
// Channel fan-out
// ============================================================================

/**
 * Map our 5 categories × PHI flag to the EmailRouter's EmailTemplate enum.
 * For categories without a dedicated template, use a sensible non-PHI default.
 */
function templateForCategory(category: Category): { template: EmailTemplate; phi: boolean } {
  switch (category) {
    case 'clinic-alerts':
      return { template: 'clinic_notification', phi: true };
    case 'dose-reminders':
      return { template: 'dose_alert', phi: true };
    case 'ai-insights':
      return { template: 'marketing_announcement', phi: false };
    case 'billing':
      return { template: 'receipt', phi: false };
    case 'marketing':
      return { template: 'marketing_announcement', phi: false };
  }
}

async function fanOutEmail(
  userId: string,
  category: Category,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  // Look up the user's email — admin.auth.admin.getUserById.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: u, error: userErr } = (await (admin.auth as any).admin.getUserById(userId)) as {
    data: { user?: { email?: string | null } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !u?.user?.email) return { ok: false, reason: 'email_lookup_failed' };

  const { template, phi: phiByTemplate } = templateForCategory(category);
  const phi = category === 'clinic-alerts' || phiByTemplate;
  try {
    // sendEmail signature: (supabase: SupabaseClient, args: SendEmailArgs).
    // The PHI suppression-list check needs the admin client; pass our proxied admin.
    // deno-lint-ignore no-explicit-any
    await _emailFn(admin as any, {
      template,
      to: u.user.email,
      vars: payload,
      phi,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : 'email_send_failed').slice(0, 80) };
  }
}

async function fanOutPush(
  userId: string,
  payload: Record<string, unknown>,
  urgent: boolean,
): Promise<{ ok: boolean; sent: number; reason?: string }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: subs, error } = (await (admin.from('push_subscriptions') as any)
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)) as {
    data: PushSubscriptionRow[] | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) return { ok: false, sent: 0, reason: 'subscription_lookup_failed' };
  const rows = subs ?? [];
  if (rows.length === 0) return { ok: false, sent: 0, reason: 'no_subscriptions' };

  const body = JSON.stringify(payload);
  let sent = 0;
  for (const sub of rows) {
    try {
      const res = await _pushFn(sub, body, { TTL: 60, urgency: urgent ? 'high' : 'normal' });
      if (res.ok) sent += 1;
    } catch {
      // best-effort per subscription — one failed endpoint must not block others
    }
  }
  return { ok: sent > 0, sent };
}

// ============================================================================
// Core handler
// ============================================================================

async function handleSend(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  // Service-role bearer check (constant-time)
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

  const { user_id, category, payload } = valid.body;

  // D-13 PHI gate
  const phiGate = validatePhiGate(category, payload);
  if (!phiGate.ok) return jsonError(400, phiGate.reason);

  // Load context (parallel)
  const ctx = await loadContext(user_id, category);
  if (!ctx.cfg) return jsonError(400, 'category_config_missing');

  const decision: FireDecision = shouldFire({
    user_id,
    category,
    prefs: ctx.prefs,
    cfg: ctx.cfg,
    dismissal: ctx.dismissal,
    firedTodayCount: ctx.firedTodayCount,
    firedThisWeekCount: ctx.firedThisWeekCount,
    now: new Date().toISOString(),
  });

  // Fan-out
  const fired: string[] = [];
  const errors: Record<string, string> = {};

  if (decision.email) {
    const r = await fanOutEmail(user_id, category, payload);
    if (r.ok) fired.push('email');
    else errors.email = r.reason ?? 'unknown';
  }
  if (decision.push) {
    const r = await fanOutPush(user_id, payload, decision.urgent);
    if (r.ok) fired.push('web-push');
    else errors.push = r.reason ?? 'unknown';
  }
  if (decision.in_app) {
    // In-app is recorded as a user_notifications row (the realtime channel
    // surfaces it to the browser). Recorded below as the source-of-truth row.
    fired.push('in-app');
  }

  // Append source-of-truth row (one per send attempt; channel reflects fan-out summary)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: insertData, error: insertErr } = (await (admin.from('user_notifications') as any)
    .insert({
      user_id,
      category,
      channel: fired.includes('in-app') ? 'in-app' : (fired[0] ?? 'in-app'),
      payload,
    })
    .select('id')
    .single()) as { data: { id?: string } | null; error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (insertErr) {
    console.error('[notification-send] user_notifications insert failed', insertErr.message);
    return jsonError(500, 'internal', { decision, fired, errors });
  }

  return jsonResponse(200, {
    decision,
    fired,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    notification_id: insertData?.id ?? null,
  });
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleSend);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleSend,
  setAdminForTest,
  resetAdminForTest,
  setEmailFnForTest,
  resetEmailFnForTest,
  setPushFnForTest,
  resetPushFnForTest,
  validateBody,
  validatePhiGate,
};
