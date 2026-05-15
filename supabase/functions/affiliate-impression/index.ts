/**
 * `affiliate-impression` Edge Function — Phase 19 Plan 19-08 (BL-9 / D-38).
 *
 * Public POST endpoint that records a single landing-page impression for an
 * affiliate. Fired from `/r/{code}/landing` via the client wrapper in
 * `leanshot/src/lib/affiliate/impression.ts` as a fire-and-forget ping
 * (NEVER awaited, NEVER user-blocking).
 *
 *   POST /functions/v1/affiliate-impression    (verify_jwt = false — public)
 *
 * Body shape:
 *   { affiliate_id: uuid,                // required
 *     ua_hash: 64-char hex (SHA-256),    // required — computed client-side
 *     referer:  string up to 500 chars } // required — `document.referrer`
 *
 * Architecture (locked):
 *   Client → POST here → admin.rpc('insert_affiliate_impression', ...) →
 *   SQL helper does `set_masklen(p_ip::inet, 24)` + INSERT into
 *   public.affiliate_impressions. The raw IP arrives here in
 *   `x-forwarded-for`; this function passes it RAW to the SQL helper, which
 *   truncates server-side. The client never holds an IP. The SQL helper is
 *   defined in Plan 19-01 migration 20270101000004a per BL-10.
 *
 * Spam / abuse posture:
 *   1. Method gate: POST only; OPTIONS preflight is permitted.
 *   2. Per-IPv4-/24 in-memory rate limit (10 per 60s). 11th request → 429.
 *      Same pattern as `affiliate-apply` and `lead-capture`.
 *   3. Body validation: affiliate_id must match UUID v4-ish regex; ua_hash
 *      must be exactly 64 hex chars; referer truncated to ≤500 chars before
 *      handoff (defense-in-depth — the SQL helper also truncates with LEFT).
 *   4. Existence check: SELECT id FROM affiliates WHERE id = $1 AND
 *      status='approved'. If no row → return 200 silent (no enumeration —
 *      can't tell if affiliate_id is invalid or just non-approved).
 *   5. NEVER reveal which validation failed in 4XX bodies — same opaque
 *      `{ error: 'bad_request' }` for all client errors.
 *
 * Test seam: `__internal.setAdminClient(fake)` + `__internal.resetRateLimit()`
 * mirror the affiliate-apply test pattern.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Service-role admin client. RPC call to `insert_affiliate_impression`
// bypasses RLS via the SQL helper's SECURITY DEFINER.
// eslint-disable-next-line prefer-const
let admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

// UUID v4-ish — accept any 8-4-4-4-12 lowercase-hex (we lowercase before match).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UA_HASH_RE = /^[0-9a-f]{64}$/;
const RATE_LIMIT_THRESHOLD = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds — tighter than affiliate-apply

interface ImpressionBody {
  affiliate_id?: unknown;
  ua_hash?: unknown;
  referer?: unknown;
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

function clientIpFromReq(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  if (first) return first;
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return '';
}

/** Truncate IPv4 to /24. IPv6 + unknown pass through unchanged. */
function ipv4Slash24(ip: string): string {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return ip;
  return `${m[1]}.${m[2]}.${m[3]}.0`;
}

// In-memory rate-limit map keyed by /24.
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(req: Request): boolean {
  const ip = clientIpFromReq(req);
  const key = ipv4Slash24(ip || 'unknown');
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = (rateLimitMap.get(key) ?? []).filter((ts) => ts > cutoff);
  if (existing.length >= RATE_LIMIT_THRESHOLD) {
    rateLimitMap.set(key, existing);
    return false;
  }
  existing.push(now);
  rateLimitMap.set(key, existing);
  return true;
}

function asTrimmedString(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, maxLen);
}

// ============================================================================
// /impression (POST, public)
// ============================================================================

async function handleImpression(req: Request): Promise<Response> {
  // 1. Parse JSON body.
  let body: ImpressionBody;
  try {
    body = (await req.json()) as ImpressionBody;
    if (!body || typeof body !== 'object') {
      return jsonResponse(400, { error: 'bad_request' });
    }
  } catch {
    return jsonResponse(400, { error: 'bad_request' });
  }

  // 2. Rate limit (cheap — apply BEFORE any DB / RPC call).
  if (!checkRateLimit(req)) {
    return jsonResponse(429, { error: 'rate_limited' });
  }

  // 3. Validate fields.
  const affiliateId = asTrimmedString(body.affiliate_id, 64).toLowerCase();
  const uaHash = asTrimmedString(body.ua_hash, 128).toLowerCase();
  const referer = asTrimmedString(body.referer, 500);

  if (!UUID_RE.test(affiliateId)) {
    return jsonResponse(400, { error: 'bad_request' });
  }
  if (!UA_HASH_RE.test(uaHash)) {
    return jsonResponse(400, { error: 'bad_request' });
  }
  // Referer is allowed to be empty (visitor hit the URL directly).

  // 4. Existence + status check. Silent 200 if non-approved or missing —
  //    can't reveal which affiliates exist.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const lookup = (await (admin
      .from('affiliates')
      .select('id, status')
      .eq('id', affiliateId)
      .maybeSingle() as any)) as { data: { id?: string; status?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!lookup?.data?.id || lookup.data.status !== 'approved') {
      return jsonResponse(200, { ok: true });
    }
  } catch (e) {
    // Fail-open on lookup failure — the SQL helper's FK + RLS are the
    // durable defense. We still return 200 because the client is
    // fire-and-forget and we MUST NOT block the landing render.
    console.error(
      '[affiliate-impression] lookup threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return jsonResponse(200, { ok: true });
  }

  // 5. RPC: SQL helper truncates IP server-side via set_masklen.
  const rawIp = clientIpFromReq(req) || '0.0.0.0';
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const rpc = (await (admin.rpc('insert_affiliate_impression', {
      p_affiliate_id: affiliateId,
      p_ip: rawIp,
      p_ua_hash: uaHash,
      p_referer: referer,
    }) as any)) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (rpc?.error) {
      console.error(
        '[affiliate-impression] rpc error',
        rpc.error.message ?? 'unknown',
      );
      // Still 200 — client never sees this; impression-loss is non-fatal.
      return jsonResponse(200, { ok: true });
    }
  } catch (e) {
    console.error(
      '[affiliate-impression] rpc threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(200, { ok: true });
}

// ============================================================================
// Dispatcher
// ============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }
  try {
    return await handleImpression(req);
  } catch (e) {
    console.error(
      '[affiliate-impression] unhandled',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonResponse(500, { error: 'internal' });
  }
});

// ============================================================================
// Internal exports for Deno tests
// ============================================================================

export const __internal = {
  handleImpression,
  clientIpFromReq,
  ipv4Slash24,
  /** Override the module-level admin client for tests. */
  setAdminClient(client: unknown): void {
    admin = client as SupabaseClient;
  },
  /** Reset the per-IP rate-limit map between tests. */
  resetRateLimit(): void {
    rateLimitMap.clear();
  },
};
