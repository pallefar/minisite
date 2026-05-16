/**
 * `dsar-export` Edge Function — Phase 22 Plan 22-04 (GDPR-03).
 *
 * Orchestrates the D-06 DSAR (GDPR Article 15 right of access) export cascade.
 * Caller: service_role bearer (cron OR admin invocation). NOT user-facing —
 * users INSERT a `pending` row via `public.create_dsar_request()` RPC (plan
 * 22-04 Task 1) and this Fn picks it up.
 *
 * 9-step orchestrator (mirrors `supabase/functions/account-delete/index.ts`):
 *
 *   1. Parse {request_id} from body. Validate UUID_RE.
 *   2. SELECT dsar_requests row; if status != 'pending' return 200 (idempotent).
 *      Otherwise UPDATE status='in_progress'.
 *   3. Assemble bundle (profile + subscriptions + 9 health-log tables +
 *      photos + shares + affiliate clicks/conversions/payouts + ai_messages
 *      user-side + optional posthog_events). Converter emails on
 *      affiliate_conversions are SHA-256-hashed (D-06 redaction contract).
 *   4. Render JSON blob.
 *   5. Render PDF blob via renderDsarPdf (jsPDF + jspdf-autotable from esm.sh).
 *   6. ZIP (deno-zipjs streaming) the JSON + PDF + downloaded photo files.
 *   7. Upload to dsar-exports/{user_id}/{request_id}.zip (service-role).
 *   8. Sign 7-day URL via storage.createSignedUrl.
 *   9. Invoke lifecycle-transactional {template:'dsar_ready', user_id, data}.
 *      Then UPDATE dsar_requests.status='completed', completed_at, export_path.
 *
 * Per-step try/catch: on error, UPDATE dsar_requests.status='rejected' with
 * a sanitized rejection_reason (no Stripe/Resend/email PII).
 *
 * Authorization (T-22-29): service_role bearer ONLY. No user JWT path.
 *
 * PDF delivery (T-22-29 + Pitfall 10): NEVER returned inline. Supabase Gateway
 * overrides response Content-Type to text/plain + injects CSP: sandbox. The
 * 7-day signed Storage URL is the only download path.
 *
 * Hash-pseudonymization (T-22-26 + D-06): converter emails on
 * affiliate_conversions surface as `converter_email_sha256` (Deno-side
 * crypto.subtle.digest). Plaintext emails NEVER ride in the bundle. Test T4
 * asserts this invariant by string-scanning the serialized bundle.
 *
 * PostHog branch (D-03 vendor-pass pattern): if POSTHOG_PERSONAL_API_KEY is set,
 * pull events via REST API. If unset, set bundle.posthog_events = null +
 * console.warn — the export still completes (vendor-gated send pattern from
 * reference_vendor_gated_send_health_check.md).
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { renderDsarPdf } from './pdf-render.ts';
import type { DsarBundle } from './pdf-render.ts';

// ============================================================================
// Constants
// ============================================================================

const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCHEMA_VERSION = 'phase22-v1';
const SIGNED_URL_TTL_SECONDS = 7 * 86400;

// 9 health-log tables (Phase 6 sync surface + injections).
const HEALTH_LOG_TABLES = [
  'injections',
  'weights',
  'meals',
  'workouts',
  'supplements',
  'mood',
  'sleep',
  'symptoms',
  'vials',
] as const;

// ============================================================================
// Lazy admin singleton (test-injectable via __internal)
// ============================================================================

let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin() as unknown as Record<string | symbol, unknown>;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// Test injection seam — pdf renderer + bundle spy + posthog stub
type RenderPdfFn = (bundle: DsarBundle) => Promise<Blob>;
type BundleSpy = (bundle: DsarBundle) => void;
type PosthogFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ results?: unknown[]; next?: string | null }>;

let _renderPdf: RenderPdfFn = renderDsarPdf;
let _bundleSpy: BundleSpy | null = null;
let _posthogFetch: PosthogFetchFn | null = null;

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

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

/** Constant-time-ish compare against SUPABASE_SERVICE_ROLE_KEY. */
function isServiceRoleBearer(bearer: string | null): boolean {
  if (!bearer) return false;
  const key = getSupabaseServiceRoleKey();
  if (!key || key.length === 0) return false;
  if (bearer.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < bearer.length; i++) {
    diff |= bearer.charCodeAt(i) ^ key.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Minimal ZIP writer using the STORE method (no compression) — pure-Deno,
 * deterministic, no external deps. JSON+PDF compress well only marginally over
 * the wire; the gateway will gzip the HTTPS response anyway. STORE keeps the
 * Edge Fn memory bounded and avoids pulling a heavy native CRC32 polyfill.
 *
 * Spec: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (sections
 * 4.3.7 STORE = method 0; 4.4.5 CRC-32 IEEE 802.3 polynomial 0xEDB88320).
 */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;
    // Local file header: 30 bytes + name
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true); // signature
    dv.setUint16(4, 20, true); // version
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 0, true); // method = STORE
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true); // compressed size
    dv.setUint32(22, size, true); // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra length
    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(entry.bytes);

    // Central directory entry: 46 bytes + name
    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true); // version made by
    cdv.setUint16(6, 20, true); // version needed
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true); // STORE
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralRecords.push(central);

    offset += localHeader.length + entry.bytes.length;
    centralSize += central.length;
  }

  // End of central directory: 22 bytes
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  for (const c of centralRecords) {
    out.set(c, cursor);
    cursor += c.length;
  }
  out.set(eocd, cursor);
  return out;
}

async function blobToUint8(b: Blob): Promise<Uint8Array> {
  const ab = await b.arrayBuffer();
  return new Uint8Array(ab);
}

// ============================================================================
// PostHog REST fetch (optional, vendor-gated per D-03)
// ============================================================================

async function fetchPosthogEvents(userId: string): Promise<unknown[] | null> {
  const apiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY');
  if (!apiKey) {
    console.warn(
      '[dsar-export] POSTHOG_PERSONAL_API_KEY not set — bundle.posthog_events=null (vendor-gated)',
    );
    return null;
  }
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID') ?? '';
  if (!projectId) {
    console.warn('[dsar-export] POSTHOG_PROJECT_ID not set — bundle.posthog_events=null');
    return null;
  }
  if (apiKey === 'test-stub') {
    // Used by tests to avoid hitting the real API; T9 also injects via __internal
    if (_posthogFetch) {
      const out = await _posthogFetch('https://app.posthog.com/api/events/?distinct_id=' + userId, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return out.results ?? [];
    }
    return [];
  }
  try {
    const all: unknown[] = [];
    let url: string | null =
      `https://app.posthog.com/api/projects/${encodeURIComponent(projectId)}/events/?distinct_id=${encodeURIComponent(userId)}&limit=1000`;
    let pages = 0;
    while (url && pages < 10) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 429) {
        console.warn('[dsar-export] PostHog 429 rate limit — stopping pagination at', all.length);
        break;
      }
      if (!res.ok) {
        console.error('[dsar-export] PostHog non-2xx', res.status);
        break;
      }
      const j = (await res.json()) as { results?: unknown[]; next?: string | null };
      if (Array.isArray(j.results)) all.push(...j.results);
      url = j.next ?? null;
      pages++;
    }
    return all;
  } catch (e) {
    console.error('[dsar-export] PostHog fetch threw', e instanceof Error ? e.name : 'unknown');
    return null;
  }
}

// ============================================================================
// Bundle assembly
// ============================================================================

interface AffiliateConversionRow {
  id?: unknown;
  affiliate_id?: unknown;
  user_id?: unknown; // converter (DO NOT include in bundle as-is)
  commission_cents?: unknown;
  status?: unknown;
  created_at?: unknown;
}

async function assembleBundle(userId: string): Promise<DsarBundle> {
  const a = admin as any;

  // Profile (auth.users + public.profiles)
  let profile: Record<string, unknown> | null = null;
  try {
    const userRes = await a.auth.admin.getUserById(userId);
    const u = userRes?.data?.user ?? null;
    const { data: p } = await a.from('profiles').select('*').eq('id', userId).maybeSingle();
    profile = {
      id: userId,
      email: u?.email ?? null,
      created_at: u?.created_at ?? null,
      last_sign_in_at: u?.last_sign_in_at ?? null,
      is_staff: p?.is_staff ?? false,
    };
  } catch (e) {
    console.error('[dsar-export] profile fetch failed', e instanceof Error ? e.name : 'unknown');
  }

  // Subscriptions
  let subscriptions: unknown[] = [];
  try {
    const { data } = await a.from('subscriptions').select('*').eq('user_id', userId);
    if (Array.isArray(data)) subscriptions = data;
  } catch (e) {
    console.error('[dsar-export] subs fetch failed', e instanceof Error ? e.name : 'unknown');
  }

  // Health log (9 sync tables)
  const health_log: Record<string, unknown[]> = {};
  for (const t of HEALTH_LOG_TABLES) {
    try {
      const { data } = await a.from(t).select('*').eq('user_id', userId);
      health_log[t] = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error(
        `[dsar-export] health_log[${t}] failed`,
        e instanceof Error ? e.name : 'unknown',
      );
      health_log[t] = [];
    }
  }
  // Settings is singleton (PK = user_id); query as maybeSingle.
  try {
    const { data } = await a.from('settings').select('*').eq('user_id', userId).maybeSingle();
    health_log.settings = data ? [data] : [];
  } catch {
    health_log.settings = [];
  }

  // Photos manifest (file list — bytes go in ZIP separately)
  let photos: Array<{ photo_id?: string; storage_path?: string; created_at?: string }> = [];
  try {
    const { data } = await a
      .from('photos')
      .select('photo_id, storage_path, created_at, date, weight, mime_type, size_bytes')
      .eq('user_id', userId);
    if (Array.isArray(data)) photos = data;
  } catch (e) {
    console.error('[dsar-export] photos fetch failed', e instanceof Error ? e.name : 'unknown');
  }

  // Sharing history — D-06: tokens metadata only, not recipient PII
  let sharing_history: unknown[] = [];
  try {
    const { data } = await a
      .from('shares')
      .select('id, label, expires_at, revoked_at, created_at')
      .eq('user_id', userId);
    if (Array.isArray(data)) sharing_history = data;
  } catch (e) {
    console.error('[dsar-export] shares fetch failed', e instanceof Error ? e.name : 'unknown');
  }

  // Affiliate activity — when the requester IS an affiliate, the converter
  // user_ids on affiliate_conversions point to OTHER users; per D-06 we
  // include `converter_email_sha256` only (Deno-side SHA-256).
  let affClicks: unknown[] = [];
  let affConversionsRaw: AffiliateConversionRow[] = [];
  let affPayouts: unknown[] = [];
  let affiliateId: string | null = null;
  try {
    const { data: aff } = await a
      .from('affiliates')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    affiliateId = (aff?.id as string | undefined) ?? null;
  } catch {
    affiliateId = null;
  }
  if (affiliateId) {
    try {
      const { data } = await a.from('affiliate_clicks').select('*').eq('affiliate_id', affiliateId);
      if (Array.isArray(data)) affClicks = data;
    } catch {
      // ignore
    }
    try {
      const { data } = await a
        .from('affiliate_conversions')
        .select('*')
        .eq('affiliate_id', affiliateId);
      if (Array.isArray(data)) affConversionsRaw = data as AffiliateConversionRow[];
    } catch {
      // ignore
    }
    try {
      const { data } = await a.from('payouts').select('*').eq('affiliate_id', affiliateId);
      if (Array.isArray(data)) affPayouts = data;
    } catch {
      // ignore
    }
  }
  // Hash converter emails per D-06. Fetch emails via auth.admin.getUserById,
  // then SHA-256 hex. NEVER include plaintext email or the raw converter
  // user_id (the user_id IS the join key against auth.users; hashing only
  // the email is sufficient pseudonymization per D-06).
  const conversions: Array<Record<string, unknown>> = [];
  for (const row of affConversionsRaw) {
    const converterId =
      typeof row.user_id === 'string' && UUID_RE.test(row.user_id) ? row.user_id : null;
    let converter_email_sha256 = '';
    if (converterId) {
      try {
        const { data: cu } = await a.auth.admin.getUserById(converterId);
        const email = (cu?.user?.email as string | null) ?? null;
        if (email) converter_email_sha256 = await sha256Hex(email.toLowerCase());
      } catch {
        // leave empty
      }
    }
    // Redacted row — drop user_id, drop any raw email; include hash only.
    conversions.push({
      id: row.id,
      affiliate_id: row.affiliate_id,
      converter_email_sha256,
      commission_cents: row.commission_cents,
      status: row.status,
      created_at: row.created_at,
    });
  }

  // Communications — user-side ai_messages only (D-06: never the model's
  // generated replies, since those are derivative of the user's content but
  // may include other-user PII if context-leaked).
  let communications: unknown[] = [];
  try {
    const { data } = await a
      .from('ai_messages')
      .select('id, created_at, role, content')
      .eq('user_id', userId)
      .eq('role', 'user');
    if (Array.isArray(data)) communications = data;
  } catch (e) {
    console.error('[dsar-export] ai_messages fetch failed', e instanceof Error ? e.name : 'unknown');
  }

  // PostHog (optional, vendor-gated)
  const posthog_events = await fetchPosthogEvents(userId);

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    user_id: userId,
    profile,
    subscriptions,
    health_log,
    photos,
    sharing_history,
    affiliate_activity: { clicks: affClicks, conversions, payouts: affPayouts },
    communications,
    posthog_events,
  };
}

// ============================================================================
// Core handler
// ============================================================================

interface ExportBody {
  request_id?: unknown;
}

async function updateDsarStatus(
  requestId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const a = admin as any;
  try {
    await a.from('dsar_requests').update(patch).eq('id', requestId);
  } catch (e) {
    console.error(
      '[dsar-export] failed to UPDATE dsar_requests',
      e instanceof Error ? e.message : 'unknown',
    );
  }
}

async function logAudit(
  userId: string,
  action: 'dsar_completed' | 'dsar_requested',
  requestId: string,
): Promise<void> {
  const a = admin as any;
  try {
    await a.from('audit_logs').insert({
      user_id: userId,
      user_id_hash: await sha256Hex(userId),
      table_name: 'dsar_requests',
      row_id: requestId,
      action,
      target_user_id: userId,
    });
  } catch (e) {
    console.error(
      '[dsar-export] audit log insert failed',
      e instanceof Error ? e.message : 'unknown',
    );
  }
}

async function handleExport(req: Request): Promise<Response> {
  // ---- AUTHENTICATE ----
  const bearer = bearerFromReq(req);
  if (!isServiceRoleBearer(bearer)) return jsonError(401, 'unauthenticated');

  // ---- PARSE BODY ----
  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const requestId =
    typeof body.request_id === 'string' && UUID_RE.test(body.request_id) ? body.request_id : null;
  if (!requestId) return jsonError(400, 'invalid_request_id');

  // ---- STEP 1: SELECT dsar_requests ----
  const a = admin as any;
  let row: { id: string; user_id: string; status: string } | null = null;
  try {
    const { data } = await a
      .from('dsar_requests')
      .select('id, user_id, status')
      .eq('id', requestId)
      .maybeSingle();
    row = data as typeof row;
  } catch (e) {
    console.error('[dsar-export] dsar_requests fetch failed', e instanceof Error ? e.name : 'x');
    return jsonError(500, 'internal');
  }
  if (!row) return jsonError(404, 'not_found');

  // ---- STEP 2: idempotency — only act on 'pending' ----
  if (row.status !== 'pending') {
    return jsonResponse(200, { ok: true, idempotent: true, status: row.status });
  }
  await updateDsarStatus(requestId, { status: 'in_progress' });

  const userId = row.user_id;

  // From here, any failure → status='rejected' with sanitized reason.
  try {
    // ---- STEP 3: assemble bundle ----
    const bundle = await assembleBundle(userId);
    if (_bundleSpy) {
      try {
        _bundleSpy(bundle);
      } catch {
        // test seam swallow
      }
    }

    // ---- STEP 4: JSON blob ----
    const jsonBytes = new TextEncoder().encode(JSON.stringify(bundle, null, 2));

    // ---- STEP 5: PDF blob ----
    const pdfBlob = await _renderPdf(bundle);
    const pdfBytes = await blobToUint8(pdfBlob);

    // ---- STEP 6: download photos + ZIP ----
    const zipEntries: Array<{ name: string; bytes: Uint8Array }> = [
      { name: 'data.json', bytes: jsonBytes },
      { name: 'data.pdf', bytes: pdfBytes },
    ];
    for (const photo of bundle.photos) {
      const path = photo.storage_path;
      if (!path || typeof path !== 'string') continue;
      try {
        const { data: dl } = await (admin as any).storage.from('photos').download(path);
        if (dl) {
          const bytes = await blobToUint8(dl as Blob);
          const safeName = (photo.photo_id ?? 'photo').toString().replace(/[^a-zA-Z0-9_.-]/g, '_');
          // Preserve extension from the path tail if present
          const tail = path.split('/').pop() ?? safeName;
          const ext = tail.includes('.') ? tail.slice(tail.lastIndexOf('.')) : '.bin';
          zipEntries.push({ name: `photos/${safeName}${ext}`, bytes });
        }
      } catch (e) {
        console.error(
          `[dsar-export] photo download failed (${path})`,
          e instanceof Error ? e.message : 'unknown',
        );
      }
    }
    const zipBytes = buildZip(zipEntries);
    const zipBlob = new Blob([zipBytes], { type: 'application/zip' });

    // ---- STEP 7: upload to dsar-exports ----
    const exportPath = `${userId}/${requestId}.zip`;
    const { error: upErr } = await (admin as any).storage
      .from('dsar-exports')
      .upload(exportPath, zipBlob, { contentType: 'application/zip', upsert: true });
    if (upErr) {
      throw new Error(`upload_failed:${upErr.message ?? 'unknown'}`);
    }

    // ---- STEP 8: sign 7-day URL ----
    const { data: signed, error: signErr } = await (admin as any).storage
      .from('dsar-exports')
      .createSignedUrl(exportPath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      throw new Error('sign_failed');
    }
    const signedUrl = signed.signedUrl as string;
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

    // ---- STEP 9: invoke lifecycle-transactional ----
    try {
      await (admin as any).functions.invoke('lifecycle-transactional', {
        body: {
          template: 'dsar_ready',
          user_id: userId,
          data: { signed_url: signedUrl, expires_at: expiresAt },
        },
      });
    } catch (e) {
      // Email delivery failure does NOT roll back the export. Log + continue.
      console.error(
        '[dsar-export] lifecycle invoke failed',
        e instanceof Error ? e.message : 'unknown',
      );
    }

    // ---- FINAL: mark completed ----
    await updateDsarStatus(requestId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      export_path: exportPath,
      export_signed_url_expires_at: expiresAt,
    });
    await logAudit(userId, 'dsar_completed', requestId);

    return jsonResponse(200, { ok: true, request_id: requestId, signed_url_expires_at: expiresAt });
  } catch (e) {
    // ---- error path: status=rejected ----
    const msg = e instanceof Error ? e.message : 'unknown_error';
    const sanitized = msg.replace(/[^a-zA-Z0-9_:\- ]/g, '').slice(0, 200);
    await updateDsarStatus(requestId, {
      status: 'rejected',
      rejection_reason: `export_failed:${sanitized}`,
      completed_at: new Date().toISOString(),
    });
    console.error('[dsar-export] cascade failed', msg);
    return jsonError(500, 'export_failed');
  }
}

// ============================================================================
// Dispatcher
// ============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try {
    return await handleExport(req);
  } catch (e) {
    console.error('[dsar-export] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// ============================================================================
// Test seam
// ============================================================================

export const __internal = {
  handleExport,
  sha256Hex,
  buildZip,
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient;
  },
  setRenderPdfForTest(fn: RenderPdfFn): void {
    _renderPdf = fn;
  },
  setBundleSpyForTest(fn: BundleSpy | null): void {
    _bundleSpy = fn;
  },
  setPosthogFetchForTest(fn: PosthogFetchFn | null): void {
    _posthogFetch = fn;
  },
  resetForTest(): void {
    _adminInstance = null;
    _renderPdf = renderDsarPdf;
    _bundleSpy = null;
    _posthogFetch = null;
  },
};
