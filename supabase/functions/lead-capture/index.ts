/**
 * `lead-capture` Edge Function — Phase 15 Plan 15-07 (D-12).
 *
 * Single Deno.serve dispatcher serving one endpoint:
 *
 *   POST /functions/v1/lead-capture/submit    (verify_jwt = false — public)
 *
 * Body:
 *   { email: string,
 *     name?: string,
 *     page_slug?: string,
 *     website?: string }       // HONEYPOT — must be absent/empty
 *
 * Responses:
 *   200 { ok: true }            — success OR honeypot-filled (identical body)
 *   400 { error: "bad_json" | "missing_email" | "invalid_email" }
 *   429 { error: "rate_limited" }
 *   500 { error: "internal_error" }
 *
 * Invariants:
 *   1. Honeypot check FIRST (cheap, before any DB I/O). A non-empty
 *      `website` value returns 200 byte-identical to the success path,
 *      writes a `honeypot_flagged: true` row for staff spam analytics, and
 *      skips the Resend notification. Bots learn nothing from the response.
 *   2. Per-IP rate limit (5 per 15 min, fail-open) via a Postgres count on
 *      `public.leads` keyed on `ip_hash` (T-15-LF-02). The 6th submission
 *      returns 429.
 *   3. Service-role admin client INSERT into `public.leads` — the Edge
 *      Function bypasses RLS for inserts; SELECT remains is_staff-only
 *      (migration 20261101000007). All DB access is parameterized via the
 *      supabase-js client (T-15-LF-05).
 *   4. Resend dispatch is OPTIONAL (D-12) — a missing recipient or a
 *      Resend failure MUST NOT block the universal 200 response.
 *   5. CORS preflight responds with `*` origin and NO credentials header
 *      (the form POST is fully public; no cookies are read).
 *
 * Test seam: `__internal.setAdminClient(fakeAdmin)` overrides the
 * module-level admin client so the Deno test suite can inject a fake.
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { checkLeadRateLimit } from './rate-limit.ts';
import { sendLeadNotification } from './resend.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Service-role admin client. INSERTs into `leads` bypass RLS; the public
// SELECT denial is enforced by the table's RLS policy from migration 07.
//
// Module-level handle (mutable via `__internal.setAdminClient` for tests).
// eslint-disable-next-line prefer-const
let admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface SubmitBody {
  email?: string;
  name?: string;
  page_slug?: string;
  website?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function clientIpFromReq(req: Request): string {
  // Supabase Edge Runtime sets `x-forwarded-for`. Take the leftmost entry
  // (the original client) — the platform appends edge hops on the right.
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  if (first) return first;
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
// /submit (POST, public)
// ============================================================================

async function handleSubmit(req: Request): Promise<Response> {
  // 1. Parse JSON body — `bad_json` is the cheapest gate.
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
    if (!body || typeof body !== 'object') {
      return jsonError(400, 'bad_json');
    }
  } catch {
    return jsonError(400, 'bad_json');
  }

  // 2. HONEYPOT CHECK FIRST (T-15-LF-03). A non-empty `website` value means
  //    a bot (real humans don't see the offscreen field). Write a flagged
  //    row for analytics, skip Resend, and return the universal 200 — body
  //    byte-identical to the success path.
  const honeypotRaw = typeof body.website === 'string' ? body.website.trim() : '';
  if (honeypotRaw !== '') {
    const honeypotEmail =
      typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 320) : 'honeypot';
    try {
      const ipHash = await sha256Hex(clientIpFromReq(req));
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await (admin.from('leads').insert({
        page_id: null,
        email: honeypotEmail,
        name: null,
        ip_hash: ipHash,
        honeypot_flagged: true,
        extra_fields: { honeypot_value_present: true },
      }) as any);
      /* eslint-enable @typescript-eslint/no-explicit-any */
    } catch (e) {
      // Best-effort — never let the spam-analytics insert break the
      // visible response. Log a stable string.
      console.error('[lead-capture] honeypot insert failed', e instanceof Error ? e.name : 'unknown');
    }
    return jsonResponse(200, { ok: true });
  }

  // 3. Validate email.
  const emailRaw = typeof body.email === 'string' ? body.email : '';
  const email = emailRaw.trim().toLowerCase();
  if (!email) return jsonError(400, 'missing_email');
  if (!EMAIL_RE.test(email)) return jsonError(400, 'invalid_email');

  // 4. Compute the SHA-256 IP hash (T-15-LF-07 — never store raw IP).
  const ipHash = await sha256Hex(clientIpFromReq(req));

  // 5. Rate-limit. Fail-OPEN inside the helper.
  const allowed = await checkLeadRateLimit(admin, ipHash);
  if (!allowed) return jsonError(429, 'rate_limited');

  // 6. Optionally resolve `page_id` from `page_slug`. Missing/unknown slug
  //    → null (the leads row is still recorded for global staff review).
  let pageId: string | null = null;
  const pageSlug =
    typeof body.page_slug === 'string' && body.page_slug.trim() ? body.page_slug.trim() : '';
  if (pageSlug) {
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data: pageRow } = await (admin
        .from('landing_pages')
        .select('id')
        .eq('slug', pageSlug) as any).maybeSingle();
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (pageRow?.id) pageId = pageRow.id as string;
    } catch (e) {
      console.error(
        '[lead-capture] page_slug lookup failed',
        e instanceof Error ? e.name : 'unknown',
      );
      // pageId stays null — non-blocking.
    }
  }

  // 7. Insert. Parameterized via the supabase-js client (T-15-LF-05 — no
  //    string-concatenated SQL anywhere).
  const referer = req.headers.get('referer') ?? '';
  const extraFields: Record<string, unknown> = {};
  if (referer) extraFields.source_url = referer;

  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error: insertErr } = (await (admin.from('leads').insert({
      page_id: pageId,
      email,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null,
      ip_hash: ipHash,
      honeypot_flagged: false,
      extra_fields: extraFields,
    }) as any)) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (insertErr) {
      console.error('[lead-capture] leads insert error', insertErr.message ?? 'unknown');
      return jsonError(500, 'internal_error');
    }
  } catch (e) {
    console.error('[lead-capture] leads insert threw', e instanceof Error ? e.name : 'unknown');
    return jsonError(500, 'internal_error');
  }

  // 8. Optional Resend notification. Failure MUST NOT block the 200.
  try {
    const dispatch = await sendLeadNotification({
      to: '', // resolved server-side from LEAD_NOTIFY_TO inside the helper
      leadEmail: email,
      leadName: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
      pageSlug: pageSlug || undefined,
    });
    if (!dispatch.ok) {
      console.error('[lead-capture] resend dispatch failed', dispatch.error ?? 'unknown');
    }
  } catch (e) {
    console.error('[lead-capture] resend dispatch threw', e instanceof Error ? e.name : 'unknown');
  }

  return jsonResponse(200, { ok: true });
}

// ============================================================================
// Dispatcher
// ============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const fnIdx = segments.indexOf('lead-capture');
  const action = fnIdx >= 0 ? (segments[fnIdx + 1] ?? '') : (segments[segments.length - 1] ?? '');

  try {
    if (action === 'submit') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleSubmit(req);
    }
    return jsonError(404, 'unknown_action');
  } catch (e) {
    console.error('[lead-capture] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});

// ============================================================================
// Internal exports for the Deno test suite
// ============================================================================

export const __internal = {
  handleSubmit,
  clientIpFromReq,
  sha256Hex,
  /** Override the module-level admin client for tests. */
  setAdminClient(client: unknown): void {
    admin = client as SupabaseClient;
  },
};
