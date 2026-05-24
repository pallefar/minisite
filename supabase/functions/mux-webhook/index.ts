/**
 * mux-webhook Edge Function — Phase 44 Plan 04
 *
 * POST /functions/v1/mux-webhook
 *
 * Auth: Mux-Signature header HMAC verification via @mux/mux-node.
 *       This is a public webhook endpoint — the only authentication is the
 *       HMAC signature from Mux. (T-44-03: spoofing defense)
 *
 * Flow:
 *   1. Method guard (POST only).
 *   2. CRITICAL: read raw body as text BEFORE any other processing.
 *      (stripe-webhook pattern: raw-body-first to preserve HMAC integrity)
 *   3. Verify Mux-Signature via mux.webhooks.verifySignature() — handles
 *      timestamp tolerance and multi-sig headers automatically.
 *   4. JSON.parse(body) after verification.
 *   5. Parse passthrough JSON to recover post_id (AUTHORITATIVE key for UPDATE).
 *   6. Handle video.asset.ready → UPDATE community_posts SET video_status='ready',
 *      mux_playback_id=$1 WHERE id=passthrough.post_id.
 *   7. Handle video.asset.errored → UPDATE community_posts SET video_status='rejected'
 *      WHERE id=passthrough.post_id.
 *   8. Unknown event types: log + return 200 'ok' (idempotent ignore).
 *
 * Security:
 *   - T-44-03 (Spoofing): mux.webhooks.verifySignature() prevents replay attacks.
 *   - T-44-02b (Tampering — passthrough abuse): UPDATE scoped to
 *     community_posts.id=passthrough.post_id. Passthrough was server-minted
 *     by mux-create-upload (implicitly signed by Mux's HMAC), not client-supplied.
 *     Missing/malformed passthrough → log + 200 + skip UPDATE (no retry loop).
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Mux from 'npm:@mux/mux-node@14';

// ============================================================================
// Lazy admin singleton (service-role)
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
export function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
export function resetAdminForTest(): void {
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
// Injectable Mux verify function — allows tests to stub verifySignature
// without triggering env-var validation at client construction time
// ============================================================================

// Signature for the verifySignature method extracted from @mux/mux-node
type VerifySignatureFn = (body: string, headers: Headers, secret: string) => void;

let _verifyOverride: VerifySignatureFn | null = null;

export function setVerifyForTest(fn: VerifySignatureFn): void {
  _verifyOverride = fn;
}
export function resetVerifyForTest(): void {
  _verifyOverride = null;
}

function doVerifySignature(body: string, headers: Headers): void {
  if (_verifyOverride !== null) {
    // Test mode: call the injected stub directly
    _verifyOverride(body, headers, 'test-secret');
    return;
  }
  // Production: use @mux/mux-node with real secret
  const webhookSecret = Deno.env.get('MUX_WEBHOOK_SECRET');
  if (!webhookSecret) {
    throw new Error('MUX_WEBHOOK_SECRET must be set');
  }
  const mux = new Mux({ webhookSecret });
  mux.webhooks.verifySignature(body, headers, webhookSecret);
}

// ============================================================================
// Mux event type (minimal shape for what we care about)
// ============================================================================

interface MuxEventData {
  id: string;
  playback_ids?: Array<{ id: string; policy: string }>;
  passthrough?: string;
}

interface MuxEvent {
  type: string;
  data: MuxEventData;
}

// ============================================================================
// Handler
// ============================================================================

export async function handler(req: Request): Promise<Response> {
  // Method guard
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // CRITICAL: raw body read BEFORE any other processing
  // (stripe-webhook pattern: body must be consumed as text first for HMAC integrity)
  const body = await req.text();

  // Signature verification (T-44-03 mitigation)
  try {
    doVerifySignature(body, req.headers);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  // Parse body after verification (raw-body-first pattern)
  let event: MuxEvent;
  try {
    event = JSON.parse(body) as MuxEvent;
  } catch {
    console.warn('[mux-webhook] invalid JSON body; ignoring');
    return new Response('ok', { status: 200 });
  }

  // Parse passthrough JSON — extended in Plan 46-05 with `kind` discriminator.
  // (T-44-02b: passthrough was server-minted by mux-create-upload — implicitly
  //  signed by Mux's HMAC. Trust to route the UPDATE.)
  let passthrough: {
    user_id?: string;
    post_id?: string;
    kind?: string;
    lesson_id?: string;
    course_id?: string;
  } | null = null;
  try {
    passthrough = event.data?.passthrough ? JSON.parse(event.data.passthrough) : null;
  } catch {
    passthrough = null;
  }

  const kind = passthrough?.kind ?? 'community-post';

  // ==========================================================================
  // Plan 46-05: course-lesson branch — dispatches Mux asset events to
  // course_lessons (NOT community_posts).
  //
  // Critical: only the three real Mux webhook events handled here. Anti-skip
  // accounting is client-side accumulate per RESEARCH Pitfall 1; there is no
  // server-side per-playback-segment webhook from Mux.
  // ==========================================================================
  if (kind === 'course-lesson') {
    const lessonId = passthrough?.lesson_id ?? null;
    if (!lessonId) {
      console.warn('[mux-webhook] course-lesson missing lesson_id; skipping', {
        event_type: event.type,
        asset_id: event.data?.id,
      });
      return new Response('ok', { status: 200 });
    }

    if (event.type === 'video.asset.ready') {
      const playbackId = event.data.playback_ids?.[0]?.id ?? null;
      await (admin as SupabaseClient)
        .from('course_lessons')
        .update({
          mux_asset_id: event.data.id,
          mux_playback_id: playbackId,
          mux_status: 'ready',
        })
        .eq('id', lessonId);
    } else if (event.type === 'video.asset.errored') {
      await (admin as SupabaseClient)
        .from('course_lessons')
        .update({ mux_status: 'rejected' })
        .eq('id', lessonId);
    } else if (event.type === 'video.upload.asset_created') {
      await (admin as SupabaseClient)
        .from('course_lessons')
        .update({ mux_asset_id: event.data.id, mux_status: 'processing' })
        .eq('id', lessonId);
    } else {
      // Unknown event type for course-lesson — forward-compatible no-op
      console.log('[mux-webhook] course-lesson unhandled event type', event.type, 'lesson_id', lessonId);
    }
    return new Response('ok', { status: 200 });
  }
  // End course-lesson branch — existing community-post path continues below.

  const postId = passthrough?.post_id ?? null;
  if (!postId) {
    // Missing or malformed passthrough: log + return 200 (no retry loop)
    // These may be events from Mux assets not created by mux-create-upload.
    console.warn('[mux-webhook] missing/malformed passthrough; skipping UPDATE', {
      event_type: event.type,
      asset_id: event.data?.id,
    });
    return new Response('ok', { status: 200 });
  }

  // Event dispatch
  if (event.type === 'video.asset.ready') {
    // Extract the first public playback ID
    const playbackId = event.data.playback_ids?.[0]?.id ?? null;
    await (admin as SupabaseClient)
      .from('community_posts')
      .update({ video_status: 'ready', mux_playback_id: playbackId })
      .eq('id', postId);
  } else if (event.type === 'video.asset.errored') {
    await (admin as SupabaseClient)
      .from('community_posts')
      .update({ video_status: 'rejected' })
      .eq('id', postId);
  } else {
    // Unknown event type — idempotent ignore (forward-compatibility)
    console.log('[mux-webhook] unhandled event type', event.type, 'post_id', postId);
  }

  return new Response('ok', { status: 200 });
}

// ============================================================================
// Deno.serve guard — prevents top-level serve trap in deno test
// (per reference_deno_test_top_level_serve_trap)
// Using import.meta.main ensures that `deno test` importing this module
// does NOT spawn a dangling HTTP server.
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
