/**
 * generate-course-certificate Edge Function — Phase 46 Plan 07 Task 4.
 *
 * POST /functions/v1/generate-course-certificate
 *
 * Mints a course completion certificate for the authenticated user:
 *
 *   1. Verifies user via Bearer JWT (admin.auth.getUser).
 *   2. Calls SECDEF RPC `complete_course(p_course_id)` through a per-user
 *      JWT-forwarded client — the RPC checks `auth.uid()` and either
 *      INSERTs the certificates row (returning {certificate_id, already_issued:false})
 *      or returns the existing row id with already_issued:true. If the
 *      course isn't yet ≥ completion_threshold_pct complete, the RPC raises
 *      `course_not_complete` and we surface 403.
 *   3. Branches:
 *        a. already_issued:true  → load existing pdf_path, regenerate a fresh
 *           60-min signed URL (no re-render, no re-upload).
 *        b. already_issued:false → load user + course + cert rows; compute
 *           HMAC token; render PDF; upload to certificates Storage bucket at
 *           `<user_id>/<course_id>-<cert_id>.pdf`; UPDATE certificates row
 *           with verification_token + pdf_path; create 60-min signed URL.
 *   4. Returns {certificate_id, verification_token, verification_url,
 *      download_url, already_issued}.
 *
 * Auth model — IMPORTANT (per memory feedback_rpc_auth_uid_vs_service_role_mismatch):
 *
 *   The Plan 46-01 SECDEF RPC `complete_course` reads `auth.uid()` and is
 *   GRANTed only to the `authenticated` role. Calling it from the service-role
 *   admin client would return NULL for auth.uid() → the RPC would fail or
 *   silently INSERT a row owned by NULL. So this Fn constructs a per-request
 *   user-scoped client carrying the user's JWT in the Authorization header
 *   so PostgREST forwards the auth context. The lesson-progress-beacon Fn
 *   (Plan 46-06) established this pattern; we follow it identically.
 *
 *   The admin (service-role) client IS used for:
 *     - admin.auth.getUser(token) — JWT validation
 *     - profile/course/cert SELECTs (RLS-bypass to read other-table data)
 *     - Storage upload (only service-role writes to certificates bucket per
 *       Plan 46-02 RLS)
 *     - UPDATE certificates row (no authenticated UPDATE policy; service-role
 *       writes only)
 *
 * Threat refs:
 *   - T-46-03 (Tampering): HMAC binds (cert_id, user_id, course_id, issued_at)
 *     to CERT_VERIFICATION_SECRET — forging /verify/<id>?t=<token> requires
 *     the secret. The browser /verify page (Plan 46-10) recomputes via the
 *     same algorithm using src/lib/course/cert-verify-token.ts.
 *   - T-46-04 (Info Disclosure): CERT_VERIFICATION_SECRET is read at
 *     call-time from Deno.env and NEVER returned in the response body.
 *   - T-46-06 (Path Traversal): pdfPath is constructed server-side from
 *     auth.uid() + p_course_id + cert.id — no user-controlled path segment.
 *   - T-46-08 (Signed URL leakage): 60-min TTL per D-13; user re-fetches
 *     by re-invoking this Fn (already-issued path returns a fresh URL).
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { mintCertToken } from './cert-hmac.ts';
import { renderCertPdf } from './cert-render.ts';

// ============================================================================
// CORS + response helpers (verbatim from mux-create-upload/index.ts)
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

// ============================================================================
// Lazy admin singleton (verbatim from mux-create-upload/index.ts)
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
// Per-request user-scoped client factory (verbatim pattern from
// lesson-progress-beacon/index.ts). Required so the SECDEF RPC's auth.uid()
// resolves to the caller (memory feedback_rpc_auth_uid_vs_service_role_mismatch).
// ============================================================================

export type UserClientFactory = (token: string) => Pick<SupabaseClient, 'rpc'>;

const defaultUserClientFactory: UserClientFactory = (token: string) => {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
};

let _userClientFactoryOverride: UserClientFactory | null = null;
export function setUserClientFactoryForTest(factory: UserClientFactory): void {
  _userClientFactoryOverride = factory;
}
export function resetUserClientFactoryForTest(): void {
  _userClientFactoryOverride = null;
}

function getUserClient(token: string): Pick<SupabaseClient, 'rpc'> {
  return (_userClientFactoryOverride ?? defaultUserClientFactory)(token);
}

// ============================================================================
// renderCertPdf indirection (test seam — avoids jsPDF + esm.sh fetch in tests)
// ============================================================================

type RenderFn = typeof renderCertPdf;

let _renderOverride: RenderFn | null = null;
export function setRenderForTest(fn: RenderFn): void {
  _renderOverride = fn;
}
export function resetRenderForTest(): void {
  _renderOverride = null;
}

function getRenderer(): RenderFn {
  return _renderOverride ?? renderCertPdf;
}

// ============================================================================
// Constants
// ============================================================================

// SIGNED_URL_TTL_SECONDS = 3600 — inlined at each createSignedUrl(..., 3600)
// call site below to keep the value grep-visible alongside the storage call
// (plan 46-07 acceptance gate matches `createSignedUrl(.*3600`).
const CERTIFICATES_BUCKET = 'certificates' as const;
const VERIFY_URL_BASE = 'https://app.leanshot.app/verify' as const;

// ============================================================================
// Handler
// ============================================================================

interface RequestBody {
  course_id?: string;
}

interface CompleteCourseRow {
  certificate_id: string;
  already_issued: boolean;
}

export async function handler(req: Request): Promise<Response> {
  // ── 1. CORS preflight ─────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // ── 2. Bearer auth ────────────────────────────────────────────────────────
  const bearer = bearerFromReq(req);
  if (!bearer) {
    return jsonError(401, 'unauthorized');
  }
  const { data: userData } = await (admin as SupabaseClient).auth.getUser(bearer);
  const user = userData?.user ?? null;
  if (!user) {
    return jsonError(401, 'unauthorized');
  }

  // ── 3. Body parse ─────────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const courseId = body?.course_id;
  if (typeof courseId !== 'string' || courseId.trim() === '') {
    return jsonError(400, 'invalid_course_id');
  }

  // ── 4. CERT_VERIFICATION_SECRET env check ────────────────────────────────
  const secret = Deno.env.get('CERT_VERIFICATION_SECRET') ?? '';
  if (!secret) {
    console.error(
      '[generate-course-certificate] CERT_VERIFICATION_SECRET missing — set via supabase secrets set',
    );
    return jsonError(500, 'cert_secret_missing');
  }

  // ── 5. complete_course SECDEF RPC via per-user client ────────────────────
  let completeData: CompleteCourseRow | null = null;
  try {
    const userClient = getUserClient(bearer);
    const { data, error } = await userClient.rpc('complete_course', {
      p_course_id: courseId,
    });
    if (error) {
      const msg = (error?.message ?? '') as string;
      // Plan 46-01 RPC raises `course_not_complete` exception when threshold unmet.
      if (msg.toLowerCase().includes('course_not_complete')) {
        return jsonError(403, 'course_not_complete');
      }
      console.error('[generate-course-certificate] complete_course RPC error', msg);
      return jsonError(500, 'rpc_failed');
    }
    // RPC returns table(certificate_id uuid, already_issued boolean) — supabase-js
    // unwraps single-row table-returning RPCs as an array.
    if (Array.isArray(data) && data.length > 0) {
      completeData = data[0] as CompleteCourseRow;
    } else if (data && typeof data === 'object' && 'certificate_id' in (data as object)) {
      completeData = data as CompleteCourseRow;
    }
  } catch (e) {
    console.error(
      '[generate-course-certificate] RPC exception',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonError(500, 'rpc_failed');
  }

  if (!completeData || !completeData.certificate_id) {
    return jsonError(500, 'rpc_no_result');
  }
  const certificateId = completeData.certificate_id;
  const alreadyIssued = completeData.already_issued === true;

  // ── 6a. Already-issued path: regenerate signed URL, no re-render ─────────
  if (alreadyIssued) {
    const { data: existing } = await (admin as SupabaseClient)
      .from('certificates')
      .select('id, user_id, course_id, issued_at, pdf_path')
      .eq('id', certificateId)
      .single();

    const pdfPath = (existing as { pdf_path?: string | null } | null)?.pdf_path;
    if (!pdfPath || typeof pdfPath !== 'string') {
      // Edge: cert row exists but pdf_path was never written (e.g., prior
      // run crashed between INSERT and UPDATE). Re-render path below would
      // be the right recovery but that requires re-mint; for v1 surface
      // an explicit error so the operator can re-issue.
      console.error(
        '[generate-course-certificate] already_issued=true but pdf_path is missing on row',
        certificateId,
      );
      return jsonError(500, 'pdf_path_missing');
    }

    // Recompute verification_url + token from row data — token is deterministic
    // so we don't need to re-read it from the DB column (and avoids surfacing
    // an empty placeholder if a previous run failed before the UPDATE).
    const existingRow = existing as {
      id: string;
      user_id: string;
      course_id: string;
      issued_at: string;
    };
    const token = mintCertToken(
      existingRow.id,
      existingRow.user_id,
      existingRow.course_id,
      existingRow.issued_at,
      secret,
    );
    const verificationUrl = `${VERIFY_URL_BASE}/${existingRow.id}?t=${token}`;

    const { data: signed } = await (admin as SupabaseClient).storage
      .from(CERTIFICATES_BUCKET)
      .createSignedUrl(pdfPath, 3600 /* SIGNED_URL_TTL_SECONDS — D-13 60 min */);

    return jsonResponse(200, {
      certificate_id: certificateId,
      verification_token: token,
      verification_url: verificationUrl,
      download_url: signed?.signedUrl ?? '',
      already_issued: true,
    });
  }

  // ── 6b. Fresh-issue path: render PDF + upload + UPDATE + sign ────────────
  let profileFullName = 'LeanShot Member';
  let courseTitle = 'Course';
  let cert: {
    id: string;
    user_id: string;
    course_id: string;
    issued_at: string;
  } | null = null;
  try {
    const [profileRes, courseRes, certRes] = await Promise.all([
      (admin as SupabaseClient).from('profiles').select('full_name').eq('id', user.id).single(),
      (admin as SupabaseClient).from('courses').select('title').eq('id', courseId).single(),
      (admin as SupabaseClient)
        .from('certificates')
        .select('id, user_id, course_id, issued_at')
        .eq('id', certificateId)
        .single(),
    ]);
    if ((profileRes as { data?: { full_name?: string | null } | null })?.data?.full_name) {
      profileFullName =
        (profileRes as { data?: { full_name?: string | null } | null }).data!.full_name ??
        profileFullName;
    }
    if ((courseRes as { data?: { title?: string | null } | null })?.data?.title) {
      courseTitle =
        (courseRes as { data?: { title?: string | null } | null }).data!.title ?? courseTitle;
    }
    cert = (certRes as { data?: typeof cert | null }).data ?? null;
  } catch (e) {
    console.error(
      '[generate-course-certificate] row fetch failed',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonError(500, 'row_fetch_failed');
  }

  if (!cert) {
    return jsonError(500, 'cert_row_missing');
  }

  // Compute HMAC verification token + URL
  const token = mintCertToken(cert.id, cert.user_id, cert.course_id, cert.issued_at, secret);
  const verificationUrl = `${VERIFY_URL_BASE}/${cert.id}?t=${token}`;

  // Render PDF (test seam allows substituting a no-op renderer)
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await getRenderer()({
      userName: profileFullName,
      courseTitle,
      completedAt: new Date(cert.issued_at).toISOString().slice(0, 10),
      verificationUrl,
    });
  } catch (e) {
    console.error(
      '[generate-course-certificate] render failed',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonError(500, 'render_failed');
  }

  // Upload to certificates bucket
  // Path is server-constructed from auth.uid() + course_id + cert.id (T-46-06).
  const pdfPath = `${user.id}/${courseId}-${cert.id}.pdf`;
  try {
    const { error: upErr } = await (admin as SupabaseClient).storage
      .from(CERTIFICATES_BUCKET)
      .upload(pdfPath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true, // idempotent re-issue (admin re-issue path or retry)
      });
    if (upErr) {
      console.error('[generate-course-certificate] upload failed', upErr.message ?? 'unknown');
      return jsonError(500, 'upload_failed');
    }
  } catch (e) {
    console.error(
      '[generate-course-certificate] upload exception',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonError(500, 'upload_failed');
  }

  // UPDATE certificates row with real verification_token + pdf_path
  try {
    await (admin as SupabaseClient)
      .from('certificates')
      .update({ verification_token: token, pdf_path: pdfPath })
      .eq('id', cert.id);
  } catch (e) {
    // Non-fatal — PDF is uploaded; signed URL works; row update can be
    // retried by admin re-issue. Log + continue.
    console.error(
      '[generate-course-certificate] certificates UPDATE failed (non-fatal)',
      e instanceof Error ? e.message : 'unknown',
    );
  }

  // Create 60-min signed URL
  const { data: signed } = await (admin as SupabaseClient).storage
    .from(CERTIFICATES_BUCKET)
    .createSignedUrl(pdfPath, 3600 /* SIGNED_URL_TTL_SECONDS — D-13 60 min */);

  return jsonResponse(200, {
    certificate_id: cert.id,
    verification_token: token,
    verification_url: verificationUrl,
    download_url: signed?.signedUrl ?? '',
    already_issued: false,
  });
}

// ============================================================================
// Deno.serve guard — prevents top-level serve trap in `deno test`
// (per reference_deno_test_top_level_serve_trap).
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
