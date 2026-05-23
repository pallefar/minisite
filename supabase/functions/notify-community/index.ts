/**
 * Phase 44 Plan 44-05 — notify-community Edge Function.
 *
 * POST /functions/v1/notify-community
 *
 * Auth — DUAL:
 *   (a) SUPABASE_SERVICE_ROLE_KEY bearer (constant-time comparison) — full trust
 *   (b) User JWT → admin.auth.getUser(bearer).user.id MUST equal
 *       body.mentioned_by_user_id (kind='mention')
 *       OR body.commenter_user_id (kind='reply')
 *
 * Fan-out pattern:
 *   mention → iterates community_post_mentions / community_comment_mentions rows
 *             → calls notification-send once per user_id with category='community-mentions'
 *             → skips self-mention (mentioned_by_user_id)
 *   reply   → looks up community_posts.author_id
 *             → if author_id === commenter_user_id → fanout_count=0 (self-reply skip)
 *             → else → calls notification-send with category='community-replies'
 *
 * Threat model mitigations (44-05):
 *   T-44-03b — constantTimeEqual + admin.auth.getUser sub-check
 *   T-44-01b — PII guard: sha256 hash any user_id before console.log
 *   T-44-08  — 403 identity_mismatch when JWT.sub !== body identity field
 *
 * References:
 *   - reference_deno_test_top_level_serve_trap — Deno.serve guarded by import.meta.main
 *   - 44-PATTERNS.md lines 412–448 — fan-out loop pattern
 *   - notification-send/index.ts — copy corsHeaders, jsonResponse, jsonError,
 *     bearerFromReq, constantTimeEqual, admin singleton verbatim
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
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
// PII guard: sha256-hash a string before logging
// T-44-01b: NEVER log raw user_id or email.
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
// Auth
// ============================================================================

type AuthOutcome =
  | { kind: 'service_role' }
  | { kind: 'user'; userId: string }
  | { kind: 'reject'; status: 401 | 403; code: 'unauthorized' | 'identity_mismatch' };

async function authenticate(
  req: Request,
  body: { mentioned_by_user_id?: string; commenter_user_id?: string },
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

  // T-44-08: JWT sub must match the claimed identity in body
  const claimedUserId = body.mentioned_by_user_id ?? body.commenter_user_id ?? '';
  if (!claimedUserId || claimedUserId !== data.user.id) {
    return { kind: 'reject', status: 403, code: 'identity_mismatch' };
  }

  return { kind: 'user', userId: data.user.id };
}

// ============================================================================
// Fan-out helpers
// ============================================================================

async function callNotificationSend(
  userId: string,
  category: 'community-mentions' | 'community-replies',
  payload: Record<string, unknown>,
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  await fetch(`${supabaseUrl}/functions/v1/notification-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ user_id: userId, category, payload }),
  });
}

// ============================================================================
// Body interfaces
// ============================================================================

interface MentionBody {
  kind: 'mention';
  target_type: 'post' | 'comment';
  target_id: string;
  space_id: string;
  mentioned_by_user_id: string;
  mentioned_by_name: string;
}

interface ReplyBody {
  kind: 'reply';
  post_id: string;
  comment_id: string;
  space_id: string;
  commenter_user_id: string;
  commenter_name: string;
}

type NotifyBody = MentionBody | ReplyBody;

function validateBody(
  raw: unknown,
): { ok: true; body: NotifyBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body_not_object' };
  const obj = raw as Record<string, unknown>;

  if (obj.kind === 'mention') {
    if (
      typeof obj.target_type !== 'string' ||
      !['post', 'comment'].includes(obj.target_type) ||
      typeof obj.target_id !== 'string' ||
      obj.target_id.length === 0 ||
      typeof obj.space_id !== 'string' ||
      obj.space_id.length === 0 ||
      typeof obj.mentioned_by_user_id !== 'string' ||
      obj.mentioned_by_user_id.length === 0 ||
      typeof obj.mentioned_by_name !== 'string'
    ) {
      return { ok: false, reason: 'invalid_body' };
    }
    return {
      ok: true,
      body: obj as unknown as MentionBody,
    };
  }

  if (obj.kind === 'reply') {
    if (
      typeof obj.post_id !== 'string' ||
      obj.post_id.length === 0 ||
      typeof obj.comment_id !== 'string' ||
      obj.comment_id.length === 0 ||
      typeof obj.space_id !== 'string' ||
      obj.space_id.length === 0 ||
      typeof obj.commenter_user_id !== 'string' ||
      obj.commenter_user_id.length === 0 ||
      typeof obj.commenter_name !== 'string'
    ) {
      return { ok: false, reason: 'invalid_body' };
    }
    return {
      ok: true,
      body: obj as unknown as ReplyBody,
    };
  }

  return { ok: false, reason: 'invalid_body' };
}

// ============================================================================
// Core handler
// ============================================================================

async function handleNotify(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }

  const validated = validateBody(raw);
  if (!validated.ok) return jsonError(400, validated.reason);
  const body = validated.body;

  // Authenticate (dual-path)
  const authResult = await authenticate(req, {
    mentioned_by_user_id: body.kind === 'mention' ? body.mentioned_by_user_id : undefined,
    commenter_user_id: body.kind === 'reply' ? body.commenter_user_id : undefined,
  });

  if (authResult.kind === 'reject') {
    return jsonError(authResult.status, authResult.code);
  }

  // --- Mention fan-out ---
  if (body.kind === 'mention') {
    // deno-lint-ignore no-explicit-any
    const adminAny = admin as any;
    let rows: Array<{ user_id: string }>;

    if (body.target_type === 'post') {
      const { data, error } = await adminAny
        .from('community_post_mentions')
        .select('user_id')
        .eq('post_id', body.target_id);
      if (error) {
        console.error('[notify-community] post_mentions lookup error', error.message);
        return jsonError(500, 'internal');
      }
      rows = (data ?? []) as Array<{ user_id: string }>;
    } else {
      const { data, error } = await adminAny
        .from('community_comment_mentions')
        .select('user_id')
        .eq('comment_id', body.target_id);
      if (error) {
        console.error('[notify-community] comment_mentions lookup error', error.message);
        return jsonError(500, 'internal');
      }
      rows = (data ?? []) as Array<{ user_id: string }>;
    }

    // Filter self-mentions (T-44-06 DoS + UX — no self-ping)
    const recipients = rows.filter((r) => r.user_id !== body.mentioned_by_user_id);

    let fanout_count = 0;
    for (const row of recipients) {
      const hashId = await hashForLog(row.user_id);
      console.log(`[notify-community] mention fan-out to user sha256:${hashId}`);
      await callNotificationSend(row.user_id, 'community-mentions', {
        space_id: body.space_id,
        target_type: body.target_type,
        target_id: body.target_id,
        mentioned_by_user_id: body.mentioned_by_user_id,
        mentioned_by_name: body.mentioned_by_name,
      });
      fanout_count += 1;
    }

    return jsonResponse(200, { fanout_count });
  }

  // --- Reply fan-out ---
  // deno-lint-ignore no-explicit-any
  const adminAny = admin as any;
  const { data: postData, error: postError } = await adminAny
    .from('community_posts')
    .select('author_id')
    .eq('id', body.post_id)
    .single();

  if (postError || !postData?.author_id) {
    console.error('[notify-community] community_posts lookup error', postError?.message);
    return jsonError(500, 'internal');
  }

  const authorId: string = postData.author_id as string;

  // Self-reply: commenter is also the post author — no notification needed
  if (authorId === body.commenter_user_id) {
    return jsonResponse(200, { fanout_count: 0 });
  }

  const hashId = await hashForLog(authorId);
  console.log(`[notify-community] reply fan-out to post author sha256:${hashId}`);

  await callNotificationSend(authorId, 'community-replies', {
    post_id: body.post_id,
    comment_id: body.comment_id,
    space_id: body.space_id,
    commenter_user_id: body.commenter_user_id,
    commenter_name: body.commenter_name,
  });

  return jsonResponse(200, { fanout_count: 1 });
}

// ============================================================================
// Deno.serve entrypoint — guarded per reference_deno_test_top_level_serve_trap
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handleNotify);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleNotify,
  setAdminForTest,
  resetAdminForTest,
};
