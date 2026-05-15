/**
 * `affiliate-apply` Edge Function — Phase 19 Plan 19-05 (D-05 + AFF-05).
 *
 * Public POST endpoint serving the `/affiliate` apply form.
 *
 *   POST /functions/v1/affiliate-apply    (verify_jwt = false — public)
 *
 * Body shape (V5 field-level validation enforced server-side):
 *   { email: string,                   // required, RFC-light regex, max 254
 *     name: string,                    // required, max 80
 *     audience_size: number,           // required integer 0..50_000_000
 *     audience_type: string,           // required, one of 6 D-05 values
 *     why_us: string,                  // required, max 500 chars (D-05)
 *     honeypot?: string,               // MUST be empty/absent
 *     fingerprint?: string }           // optional ThumbmarkJS fingerprint
 *
 * Responses:
 *   200 { ok: true }                   — fresh successful application
 *   200 { ok: true, already_applied: true }
 *                                      — idempotent: same email already in DB
 *                                        (silent same-response across
 *                                         pending/approved/rejected — V11)
 *   200 { ok: true, email_warning: true }
 *                                      — DB inserted but Resend dispatch
 *                                        failed (user-visible flow still
 *                                         succeeds)
 *   200 { ok: true }                   — honeypot filled (silent — bots
 *                                        learn nothing)
 *   400 { error: 'bad_json' | 'missing_field' | 'invalid_email' |
 *               'invalid_audience_type' | 'invalid_audience_size' |
 *               'why_us_too_long' | 'name_too_long' }
 *   429 { error: 'rate_limited' }
 *   500 { error: 'internal' }
 *
 * Invariants:
 *   1. Honeypot check FIRST (cheap, before any DB I/O).
 *   2. Per-IP /24 rate limit (5 per 15 min) via in-memory map.
 *   3. Service-role admin client INSERT bypasses RLS (Plan 19-01 policies
 *      permit staff-only SELECT; INSERT routes through this Edge Fn).
 *   4. Resend dispatch is OPTIONAL — failure MUST NOT block the 200 (the
 *      DB row is the durable artifact).
 *   5. CORS preflight responds with `*` origin and NO credentials.
 *
 * Test seam: `__internal.setAdminClient(fakeAdmin)` overrides the
 * module-level admin client so the Deno test suite can inject a fake.
 * `__internal.resetRateLimitState()` resets the per-IP map between tests.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendApplicationReceivedEmail } from './resend.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Service-role admin client. INSERTs bypass RLS; SELECT remains gated by
// Plan 19-01 `pol_affiliates_staff_all`.
// eslint-disable-next-line prefer-const
let admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const ALLOWED_AUDIENCE_TYPES = [
  'Instagram',
  'TikTok',
  'YouTube',
  'Newsletter',
  'Coaching',
  'Other',
] as const;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RATE_LIMIT_THRESHOLD = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface ApplyBody {
  email?: unknown;
  name?: unknown;
  audience_size?: unknown;
  audience_type?: unknown;
  why_us?: unknown;
  honeypot?: unknown;
  fingerprint?: unknown;
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

function clientIpFromReq(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  if (first) return first;
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/** Truncate IPv4 to /24 (e.g. `203.0.113.5` → `203.0.113.0`). IPv6 + unknown
 *  pass through unchanged — a single legit IPv6 client still effectively
 *  has a unique key per address. */
function ipv4Slash24(ip: string): string {
  // Match a dotted-quad; allow only canonical decimal octets.
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return ip;
  return `${m[1]}.${m[2]}.${m[3]}.0`;
}

// In-memory rate-limit map keyed by /24. Map of key → array of timestamps
// (ms epoch). The map is module-scoped (warm-isolate lifetime). On cold
// start the slate is clean; this is acceptable for a spam-defense gate
// (cold-starts are infrequent enough that an attacker can't reliably
// reset the window).
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(req: Request): boolean {
  const ip = clientIpFromReq(req);
  const key = ipv4Slash24(ip);
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = (rateLimitMap.get(key) ?? []).filter((ts) => ts > cutoff);
  if (existing.length >= RATE_LIMIT_THRESHOLD) {
    rateLimitMap.set(key, existing); // prune-only, no insert
    return false;
  }
  existing.push(now);
  rateLimitMap.set(key, existing);
  return true;
}

function asTrimmedString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// ============================================================================
// /apply (POST, public)
// ============================================================================

async function handleApply(req: Request): Promise<Response> {
  // 1. Parse JSON body — `bad_json` is the cheapest gate.
  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
    if (!body || typeof body !== 'object') {
      return jsonError(400, 'bad_json');
    }
  } catch {
    return jsonError(400, 'bad_json');
  }

  // 2. HONEYPOT CHECK FIRST. A non-empty `honeypot` value means a bot
  //    (real humans don't see the offscreen field). Silent 200 — body
  //    byte-identical to success path. No DB write, no email. Bots
  //    learn nothing.
  const honeypotRaw = asTrimmedString(body.honeypot);
  if (honeypotRaw !== '') {
    return jsonResponse(200, { ok: true });
  }

  // 3. Field validation (V5 — server-side checks even though client also
  //    validates; the form is public so we MUST NOT trust the client).
  const email = asTrimmedString(body.email).toLowerCase();
  const name = asTrimmedString(body.name);
  const audienceType = asTrimmedString(body.audience_type);
  const whyUs = asTrimmedString(body.why_us);
  const audienceSizeRaw = body.audience_size;

  if (!email) return jsonError(400, 'missing_field');
  if (email.length > 254) return jsonError(400, 'invalid_email');
  if (!EMAIL_RE.test(email)) return jsonError(400, 'invalid_email');

  if (!name) return jsonError(400, 'missing_field');
  if (name.length > 80) return jsonError(400, 'name_too_long');

  if (
    !(ALLOWED_AUDIENCE_TYPES as readonly string[]).includes(audienceType)
  ) {
    return jsonError(400, 'invalid_audience_type');
  }

  if (
    typeof audienceSizeRaw !== 'number' ||
    !Number.isFinite(audienceSizeRaw) ||
    !Number.isInteger(audienceSizeRaw) ||
    audienceSizeRaw < 0 ||
    audienceSizeRaw > 50_000_000
  ) {
    return jsonError(400, 'invalid_audience_size');
  }
  const audienceSize: number = audienceSizeRaw;

  if (!whyUs) return jsonError(400, 'missing_field');
  if (whyUs.length > 500) return jsonError(400, 'why_us_too_long');

  // 4. Rate limit (5 / 15 min per IPv4 /24). Returns 429 if exceeded.
  if (!checkRateLimit(req)) {
    return jsonError(429, 'rate_limited');
  }

  // 5. Capture ip_signup + fingerprint_signup for T-19-05-R audit.
  const ipSignup = clientIpFromReq(req);
  const fingerprintSignup =
    typeof body.fingerprint === 'string' && body.fingerprint.trim()
      ? body.fingerprint.trim().slice(0, 200)
      : null;

  // 6. Idempotency: SELECT existing row by email. Same response across
  //    pending/approved/rejected/suspended — V11: don't reveal rejection.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const existingQ = (await (admin
      .from('affiliates')
      .select('id, status')
      .eq('email', email)
      .maybeSingle() as any)) as { data: { id?: string; status?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (existingQ?.data && existingQ.data.id) {
      return jsonResponse(200, { ok: true, already_applied: true });
    }
  } catch (e) {
    // Fail-OPEN on idempotency-lookup failure — the unique constraint on
    // affiliates.email (Plan 19-01) is the durable defense; we just lose
    // the silent-skip optimization.
    console.error(
      '[affiliate-apply] idempotency lookup threw',
      e instanceof Error ? e.name : 'unknown',
    );
  }

  // 7. INSERT into affiliates. Service-role bypasses RLS.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const insertRes = (await (admin.from('affiliates').insert({
      email,
      display_name: name,
      audience_type: audienceType,
      audience_size: audienceSize,
      why_us: whyUs,
      status: 'pending',
      ip_signup: ipSignup,
      fingerprint_signup: fingerprintSignup,
    }) as any)) as { error: { message?: string; code?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (insertRes?.error) {
      // 23505 = unique-constraint collision on email — treat as
      // "already_applied" (a race with the idempotency lookup above).
      if (insertRes.error.code === '23505') {
        return jsonResponse(200, { ok: true, already_applied: true });
      }
      console.error(
        '[affiliate-apply] insert error',
        insertRes.error.message ?? 'unknown',
      );
      return jsonError(500, 'internal');
    }
  } catch (e) {
    console.error(
      '[affiliate-apply] insert threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return jsonError(500, 'internal');
  }

  // 8. Resend dispatch — optional. Failure MUST NOT block the 200.
  try {
    const dispatch = await sendApplicationReceivedEmail({ to: email, name });
    if (!dispatch.ok) {
      console.error('[affiliate-apply] resend dispatch failed', dispatch.error ?? 'unknown');
      return jsonResponse(200, { ok: true, email_warning: true });
    }
  } catch (e) {
    console.error(
      '[affiliate-apply] resend dispatch threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return jsonResponse(200, { ok: true, email_warning: true });
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

  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  try {
    return await handleApply(req);
  } catch (e) {
    console.error('[affiliate-apply] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// ============================================================================
// Internal exports for the Deno test suite
// ============================================================================

export const __internal = {
  handleApply,
  clientIpFromReq,
  ipv4Slash24,
  /** Override the module-level admin client for tests. */
  setAdminClient(client: unknown): void {
    admin = client as SupabaseClient;
  },
  /** Reset the per-IP rate-limit map between tests. */
  resetRateLimitState(): void {
    rateLimitMap.clear();
  },
};
