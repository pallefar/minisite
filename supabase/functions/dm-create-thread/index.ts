/**
 * Phase 45 Plan 45-04 — dm-create-thread Edge Function.
 *
 * POST /functions/v1/dm-create-thread
 *
 * Auth — DUAL (mirrors notify-community/index.ts):
 *   (a) SUPABASE_SERVICE_ROLE_KEY bearer (constant-time comparison)
 *   (b) User JWT → admin.auth.getUser(bearer).user.id MUST equal
 *       body.creator_user_id (T-45-02 spoofing defense)
 *
 * Enforcement points (Phase 45 CONTEXT.md decisions):
 *   D-06 — recipient.dm_open=false → 403 dm_closed
 *   D-07 — 3 new threads/24h per creator → 429 rate_limited + Retry-After
 *   D-08 — profiles.is_clinician_verified=true bypasses rate limit, INSERTs
 *          dm_thread_audit row with reason='clinician_bypass'
 *   D-09 — body ≤ 2000 chars, server-side sanitized BEFORE insert
 *   D-10 — symmetric block: user_block_list(blocker=recipient, blocked=creator)
 *          → 403 blocked (Edge Fn belt; DB RLS suspenders)
 *   D-20 — recipient.community_last_active_at > now()-5min → SKIP notify
 *
 * Reuses:
 *   - corsHeaders / jsonResponse / jsonError / bearerFromReq / constantTimeEqual
 *   - Lazy admin singleton + Proxy override hook
 *   - hashForLog PII guard
 *   - Dual-auth pattern
 *
 * Sanitization parity: server-side regex allowlist that MIRRORS the
 * leanshot/src/lib/community/dompurify-config.ts FORBID_TAGS set (img,
 * script, iframe, style, object, embed, base, form). The browser sanitizer
 * runs at render time as the authoritative gate; this is defense-in-depth
 * to avoid persisting dangerous markup. Per memory
 * feedback_silent_scope_reduction_patterns we do NOT instantiate a second
 * sanitizer policy here — Deno Edge Runtime lacks the DOM that the browser
 * policy needs anyway.
 *
 * References:
 *   - reference_deno_test_top_level_serve_trap — Deno.serve guarded by import.meta.main
 *   - reference_supabase_functions_deploy_import_map_flag — per-fn deno.json owns imports
 *   - feedback_rpc_auth_uid_vs_service_role_mismatch — user-invoked; uses dual-auth, NOT auth.uid()
 *   - 45-PATTERNS.md §dm-create-thread/index.ts — template
 *   - 45-RESEARCH.md §Pattern 2 (rate-limit) + §Pattern 7 (activity debounce)
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CORS
// ============================================================================

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
  });
}

function jsonError(status: number, code: string, extraHeaders?: Record<string, string>): Response {
  return jsonResponse(status, { code }, extraHeaders);
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
// Lazy admin singleton + override hook (test-injectable)
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
// Test-injectable notify-community caller
// ============================================================================

interface NotifyDmPayload {
  thread_id: string;
  sender_user_id: string;
  sender_handle: string;
  recipient_user_id: string;
  body_excerpt: string;
}

type NotifyCommunityFn = (payload: NotifyDmPayload) => Promise<void>;

const defaultNotifyCommunity: NotifyCommunityFn = async (payload) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  await fetch(`${supabaseUrl}/functions/v1/notify-community`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ kind: 'dm_new', ...payload }),
  });
};

let _notifyCommunityOverride: NotifyCommunityFn | null = null;
function setNotifyCommunityForTest(fn: NotifyCommunityFn | null): void {
  _notifyCommunityOverride = fn;
}

async function callNotifyCommunity(payload: NotifyDmPayload): Promise<void> {
  const fn = _notifyCommunityOverride ?? defaultNotifyCommunity;
  await fn(payload);
}

// ============================================================================
// PII guard: sha256-hash a string before logging
// ============================================================================

async function hashForLog(value: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(value);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  } catch {
    return '[hash-err]';
  }
}

// ============================================================================
// Server-side body sanitization (parity with browser community sanitizer)
//
// Strips any of the FORBID_TAGS set (img/script/iframe/style/object/embed/
// base/form) and rewrites dangerous URL schemes (javascript:/data:/vbscript:)
// to # in href= / src= attributes. Mirrors the browser sanitizer policy
// without re-instantiating a sanitizer that would need DOM/jsdom in Deno.
// ============================================================================

const FORBIDDEN_TAG_REGEX = /<\/?(img|script|iframe|style|object|embed|base|form)[^>]*>/gi;
// Strip dangerous URL schemes from href= / src= attributes (defense in depth
// vs javascript:/data:/vbscript: matching dompurify-config afterSanitizeAttributes hook).
const DANGEROUS_HREF_REGEX = /(href|src)\s*=\s*["']?\s*(javascript|data|vbscript):/gi;

function sanitizeDmBody(raw: string): string {
  return raw
    .replace(FORBIDDEN_TAG_REGEX, '')
    .replace(DANGEROUS_HREF_REGEX, '$1="#"');
}

// ============================================================================
// Auth (dual-path)
// ============================================================================

type AuthOutcome =
  | { kind: 'service_role' }
  | { kind: 'user'; userId: string }
  | { kind: 'reject'; status: 401 | 403; code: 'unauthorized' | 'identity_mismatch' };

async function authenticate(
  req: Request,
  body: { creator_user_id?: string },
): Promise<AuthOutcome> {
  const bearer = bearerFromReq(req);
  if (!bearer) return { kind: 'reject', status: 401, code: 'unauthorized' };

  // Path A: service-role bearer
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceRoleKey && constantTimeEqual(bearer, serviceRoleKey)) {
    return { kind: 'service_role' };
  }

  // Path B: user JWT — validate via admin.auth.getUser
  // deno-lint-ignore no-explicit-any
  const { data, error } = await (admin.auth as any).getUser(bearer) as {
    data: { user?: { id: string } | null };
    error: { message?: string } | null;
  };
  if (error || !data?.user?.id) {
    return { kind: 'reject', status: 401, code: 'unauthorized' };
  }

  // T-45-02: JWT sub MUST match body.creator_user_id
  const claimedUserId = body.creator_user_id ?? '';
  if (!claimedUserId || claimedUserId !== data.user.id) {
    return { kind: 'reject', status: 403, code: 'identity_mismatch' };
  }

  return { kind: 'user', userId: data.user.id };
}

// ============================================================================
// Body interface + validation
// ============================================================================

interface DmCreateThreadRequest {
  recipient_user_id: string;
  body: string;
  attachment_path?: string;
  creator_user_id?: string;
}

function validateBody(raw: unknown): { ok: true; body: DmCreateThreadRequest } | { ok: false } {
  if (!raw || typeof raw !== 'object') return { ok: false };
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.recipient_user_id !== 'string' || obj.recipient_user_id.length === 0 ||
    typeof obj.body !== 'string'
  ) {
    return { ok: false };
  }
  if (obj.body.length > 2000) return { ok: false };
  if (obj.attachment_path !== undefined && typeof obj.attachment_path !== 'string') {
    return { ok: false };
  }
  if (obj.creator_user_id !== undefined && typeof obj.creator_user_id !== 'string') {
    return { ok: false };
  }
  return { ok: true, body: obj as unknown as DmCreateThreadRequest };
}

// ============================================================================
// Rate limit (D-07) — 3 threads / 24h per creator
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;
const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000;

async function checkRateLimit(
  creatorId: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  // deno-lint-ignore no-explicit-any
  const adminAny = admin as any;
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  const { count, error: countErr } = await adminAny
    .from('dm_threads')
    .select('id', { count: 'exact', head: true })
    .eq('creator_user_id', creatorId)
    .gte('created_at', windowStart);

  if (countErr) {
    console.error('[dm-create-thread] rate-limit count error', countErr.message);
    // Fail-closed: treat error as over-limit to avoid runaway loops.
    return { allowed: false, retryAfterSeconds: 3600 };
  }

  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    const { data: oldest } = await adminAny
      .from('dm_threads')
      .select('created_at')
      .eq('creator_user_id', creatorId)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    const retryAfterSeconds = oldest?.created_at
      ? Math.max(1, Math.ceil(
          (new Date(oldest.created_at).getTime() + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000,
        ))
      : 3600;

    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true };
}

// ============================================================================
// Core handler
// ============================================================================

async function handleDmCreateThread(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }

  const validated = validateBody(raw);
  if (!validated.ok) return jsonError(400, 'invalid_body');
  const body = validated.body;

  // Authenticate
  const authResult = await authenticate(req, { creator_user_id: body.creator_user_id });
  if (authResult.kind === 'reject') {
    return jsonError(authResult.status, authResult.code);
  }

  // Resolve creator_id
  const creatorId =
    authResult.kind === 'service_role'
      ? (body.creator_user_id ?? '')
      : authResult.userId;
  if (!creatorId) return jsonError(400, 'invalid_body');

  // Block self-DM defensively (DB CHECK enforces this; we still 400 for clarity)
  if (creatorId === body.recipient_user_id) {
    return jsonError(400, 'invalid_body');
  }

  // Sanitize body before any DB write (D-09 + T-45-05)
  const sanitizedBody = sanitizeDmBody(body.body);

  // deno-lint-ignore no-explicit-any
  const adminAny = admin as any;

  // ─── Recipient profile fetch (D-06 + D-20 debounce + handle) ──────────────
  const { data: recipientProfile, error: recipErr } = await adminAny
    .from('profiles')
    .select('dm_open, community_last_active_at, is_clinician_verified, leaderboard_handle')
    .eq('id', body.recipient_user_id)
    .single();

  if (recipErr || !recipientProfile) {
    console.error('[dm-create-thread] recipient profile lookup error', recipErr?.message);
    return jsonError(500, 'internal');
  }

  // D-06: dm_open=false → 403 dm_closed
  if (recipientProfile.dm_open === false) {
    return jsonError(403, 'dm_closed');
  }

  // ─── D-10: symmetric block check (Edge Fn belt; RLS suspenders) ───────────
  const { data: blockRow, error: blockErr } = await adminAny
    .from('user_block_list')
    .select('blocker_user_id')
    .eq('blocker_user_id', body.recipient_user_id)
    .eq('blocked_user_id', creatorId)
    .limit(1)
    .maybeSingle();

  if (blockErr) {
    console.error('[dm-create-thread] block lookup error', blockErr.message);
    return jsonError(500, 'internal');
  }
  if (blockRow) {
    return jsonError(403, 'blocked');
  }

  // ─── D-08: verified-clinician bypass (sender side) ────────────────────────
  const { data: senderProfile, error: senderErr } = await adminAny
    .from('profiles')
    .select('is_clinician_verified, leaderboard_handle')
    .eq('id', creatorId)
    .single();

  if (senderErr || !senderProfile) {
    console.error('[dm-create-thread] sender profile lookup error', senderErr?.message);
    return jsonError(500, 'internal');
  }

  const senderIsClinician: boolean = senderProfile.is_clinician_verified === true;

  // ─── D-07: rate limit (skipped on clinician path) ─────────────────────────
  if (!senderIsClinician) {
    const rl = await checkRateLimit(creatorId);
    if (!rl.allowed) {
      return jsonError(429, 'rate_limited', {
        'Retry-After': String(rl.retryAfterSeconds ?? 3600),
      });
    }
  }

  // ─── Thread upsert (UNIQUE on creator_user_id, recipient_user_id) ─────────
  let threadId: string | null = null;
  {
    const { data: insThread, error: insErr } = await adminAny
      .from('dm_threads')
      .insert({
        creator_user_id: creatorId,
        recipient_user_id: body.recipient_user_id,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insErr) {
      // Duplicate (UNIQUE violation) — reuse existing thread per D-09 idempotency
      const { data: existing, error: existErr } = await adminAny
        .from('dm_threads')
        .select('id')
        .eq('creator_user_id', creatorId)
        .eq('recipient_user_id', body.recipient_user_id)
        .limit(1)
        .maybeSingle();
      if (existErr || !existing?.id) {
        console.error('[dm-create-thread] thread insert error', insErr.message);
        return jsonError(500, 'internal');
      }
      threadId = existing.id as string;
    } else {
      threadId = (insThread?.id ?? null) as string | null;
    }
  }

  if (!threadId) {
    console.error('[dm-create-thread] thread_id unresolved after insert');
    return jsonError(500, 'internal');
  }

  // ─── Message insert ───────────────────────────────────────────────────────
  const { data: insMsg, error: msgErr } = await adminAny
    .from('direct_messages')
    .insert({
      thread_id: threadId,
      sender_user_id: creatorId,
      body: sanitizedBody,
      attachment_path: body.attachment_path ?? null,
    })
    .select('id')
    .single();

  if (msgErr || !insMsg?.id) {
    console.error('[dm-create-thread] message insert error', msgErr?.message);
    return jsonError(500, 'internal');
  }
  const messageId: string = insMsg.id as string;

  // ─── Bump last_message_at on the thread ──────────────────────────────────
  const { error: updErr } = await adminAny
    .from('dm_threads')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', threadId);
  if (updErr) {
    // Non-fatal — log but proceed.
    console.error('[dm-create-thread] last_message_at update error', updErr.message);
  }

  // ─── D-08: clinician bypass audit row ────────────────────────────────────
  if (senderIsClinician) {
    const { error: auditErr } = await adminAny
      .from('dm_thread_audit')
      .insert({
        thread_id: threadId,
        actor_user_id: creatorId,
        reason: 'clinician_bypass',
      });
    if (auditErr) {
      // Non-fatal — log but proceed (write success is more important than audit).
      console.error('[dm-create-thread] audit insert error', auditErr.message);
    }
  }

  // ─── D-20: 5-min activity debounce on notify fanout ──────────────────────
  const lastActive = recipientProfile.community_last_active_at as string | null;
  const debounceCutoff = new Date(Date.now() - ACTIVITY_DEBOUNCE_MS).toISOString();
  const isActive = lastActive !== null && lastActive > debounceCutoff;

  if (!isActive) {
    const senderHandle: string =
      (senderProfile.leaderboard_handle as string | null) ?? 'someone';
    const excerpt = sanitizedBody.slice(0, 80);
    const hashRecipient = await hashForLog(body.recipient_user_id);
    console.log(`[dm-create-thread] notify dm_new → recipient sha256:${hashRecipient}`);
    await callNotifyCommunity({
      kind: 'dm_new',
      thread_id: threadId,
      sender_user_id: creatorId,
      sender_handle: senderHandle,
      recipient_user_id: body.recipient_user_id,
      body_excerpt: excerpt,
    } as NotifyDmPayload & { kind: 'dm_new' });
  } else {
    const hashRecipient = await hashForLog(body.recipient_user_id);
    console.log(
      `[dm-create-thread] notify SKIPPED — recipient active (sha256:${hashRecipient})`,
    );
  }

  return jsonResponse(201, { thread_id: threadId, message_id: messageId });
}

// ============================================================================
// Deno.serve entrypoint — guarded per reference_deno_test_top_level_serve_trap
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handleDmCreateThread);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleDmCreateThread,
  setAdminForTest,
  resetAdminForTest,
  setNotifyCommunityForTest,
  sanitizeDmBody,
};
