/**
 * Phase 42 Plan 42-05 (POLISH-05/06) — notification-snooze Edge Function.
 *
 * POST /functions/v1/notification-snooze
 *
 * Auth: Authorization: Bearer <user-jwt>.
 * Body: { category: Category, duration_days: 1 | 7 | 30 }.
 *
 * Behavior:
 *   1. Verify JWT → auth.uid().
 *   2. Validate body (allowed durations only).
 *   3. UPSERT notification_settings rows for (auth.uid(), category, channel) for
 *      each of the 3 channels SET snoozed_until = now() + duration_days * 1 day.
 *      ON CONFLICT (user_id, category, channel) DO UPDATE — preserves the
 *      user's enabled/cap_override values.
 *   4. Respond 200 { snoozed_until }.
 *
 * Snooze is per-CATEGORY: the user picks "snooze ai-insights for 7 days" once
 * in /settings/notifications, not per-channel. We write the snooze on all 3
 * channel rows so isSnoozeActive() in the pure function returns true via any
 * pref row (defensive — pure function does a `prefs.some()` check).
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ─── CORS ──────────────────────────────────────────────────────────────────────

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

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ─── Lazy admin singleton ──────────────────────────────────────────────────────

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

// ─── Body validation ──────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set([
  'dose-reminders',
  'ai-insights',
  'clinic-alerts',
  'billing',
  'marketing',
]);
const VALID_CHANNELS = ['email', 'web-push', 'in-app'] as const;
const VALID_DURATIONS = new Set([1, 7, 30]);

interface SnoozeBody {
  category: string;
  duration_days: number;
}

function validateBody(raw: unknown): { ok: true; body: SnoozeBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body_not_object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.category !== 'string' || !VALID_CATEGORIES.has(obj.category)) {
    return { ok: false, reason: 'category_invalid' };
  }
  if (typeof obj.duration_days !== 'number' || !VALID_DURATIONS.has(obj.duration_days)) {
    return { ok: false, reason: 'duration_days_must_be_1_7_or_30' };
  }
  return { ok: true, body: { category: obj.category, duration_days: obj.duration_days } };
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleSnooze(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(jwt))) as {
    data: { user?: { id?: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
  const userId = userData.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'body_not_json');
  }
  const valid = validateBody(raw);
  if (!valid.ok) return jsonError(400, valid.reason);
  const { category, duration_days } = valid.body;

  const snoozedUntil = new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000).toISOString();

  // UPSERT one row per channel (snooze is per-category but stored per-row).
  const rows = VALID_CHANNELS.map((channel) => ({
    user_id: userId,
    category,
    channel,
    enabled: true, // Preserved by ON CONFLICT DO UPDATE only on insert; existing rows keep prior `enabled`.
    snoozed_until: snoozedUntil,
  }));

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // Two-step approach: UPDATE existing rows snoozed_until, then INSERT missing.
  // Bulk upsert with onConflict would clobber `enabled`. So:
  // 1. UPDATE snoozed_until on any existing rows.
  const updateRes = (await ((admin.from('notification_settings') as any)
    .update({ snoozed_until: snoozedUntil })
    .eq('user_id', userId)
    .eq('category', category))) as { error: { message?: string } | null };

  if (updateRes.error) {
    console.error('[notification-snooze] update failed', updateRes.error.message);
    return jsonError(500, 'internal');
  }

  // 2. INSERT any missing channels using upsert with ignoreDuplicates=true.
  const insertRes = (await ((admin.from('notification_settings') as any).upsert(
    rows,
    { onConflict: 'user_id,category,channel', ignoreDuplicates: true },
  ))) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (insertRes.error) {
    console.error('[notification-snooze] insert failed', insertRes.error.message);
    return jsonError(500, 'internal');
  }

  return jsonResponse(200, { snoozed_until: snoozedUntil });
}

// ─── Deno.serve entrypoint ────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleSnooze);
}

export const __internal = {
  handleSnooze,
  setAdminForTest,
  resetAdminForTest,
  validateBody,
};
