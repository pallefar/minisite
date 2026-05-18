/**
 * `branding-asset-upload-url` Edge Function — Phase 31 Plan 31-02
 *
 * Returns a presigned Storage upload URL for a clinic owner to upload
 * branding assets (logo, favicon, intro_card image) directly from the
 * browser, without granting the client direct storage write permissions
 * via the service-role key.
 *
 * Security flow (T-31-02-04):
 *   1. Extract + verify Authorization JWT (missing → 401).
 *   2. Parse + validate { org_id, kind, ext } body (invalid → 400).
 *   3. Resolve caller role via JWT-scoped RPC get_caller_role(org_id).
 *   4. Assert has_permission(role, 'branding.edit') via JWT-scoped RPC (→ 403 on fail).
 *   5. Mint presigned upload URL via SERVICE-ROLE client (after auth gate).
 *   6. Return { upload_url, path, token, bucket }.
 *
 * RESEARCH Finding 5 compliance: presigned URL generation CANNOT come from
 * a Postgres SECDEF. This Edge Fn uses _createServiceRoleClientUnsafe() ONLY
 * after the has_permission gate passes.
 *
 * Phase 28 D-29c compliance: no raw createClient(url, SERVICE_ROLE_KEY) call.
 * Service-role client is constructed via _createServiceRoleClientUnsafe() from
 * supabase/functions/_shared/supabase-server.ts.
 *
 * Invariants:
 *   - CORS allows * origin, no credentials.
 *   - Only POST method accepted (plus OPTIONS preflight).
 *   - All responses are JSON.
 *   - Error detail is never leaked in 500 responses.
 */

import { createClient } from '@supabase/supabase-js';
import { _createServiceRoleClientUnsafe } from '../_shared/supabase-server.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const VALID_KINDS = ['logo', 'favicon', 'intro_card'] as const;
type Kind = typeof VALID_KINDS[number];

// Allowed file extensions per bucket:
//   org-branding: PNG, JPG/JPEG, SVG, ICO (SVG allowed for vector logos)
//   org-onboarding-assets: PNG, JPG/JPEG only (SVG excluded per T-09-09 XSS concern)
const BRANDING_EXTS = ['png', 'jpg', 'jpeg', 'svg', 'ico'] as const;
const ONBOARDING_EXTS = ['png', 'jpg', 'jpeg'] as const;

// ---------------------------------------------------------------------------
// CORS headers — allow all origins, no credentials.
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Request body shape
// ---------------------------------------------------------------------------

interface UploadUrlBody {
  org_id?: string;
  kind?: string;
  ext?: string;
}

// ---------------------------------------------------------------------------
// Named handler export for unit-testability.
// Accepts optional dependency injection for JWT and service-role client factories
// (used by index.test.ts to mock the Supabase clients).
// ---------------------------------------------------------------------------

export interface HandlerDeps {
  jwtClientFactory?: (jwt: string) => ReturnType<typeof createClient>;
  serviceClientFactory?: () => ReturnType<typeof createClient>;
}

export async function handler(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // 1. Extract JWT.
  const jwt = jwtFromReq(req);
  if (!jwt) {
    return jsonResponse(401, { error: 'missing_jwt' });
  }

  // 2. Parse + validate body.
  let body: UploadUrlBody;
  try {
    body = (await req.json()) as UploadUrlBody;
  } catch {
    return jsonResponse(400, { error: 'bad_json' });
  }

  const orgId = (body.org_id ?? '').trim();
  const kind = (body.kind ?? '').trim() as Kind;
  const ext = (body.ext ?? '').trim().toLowerCase();

  if (!orgId) {
    return jsonResponse(400, { error: 'missing_org_id' });
  }

  // Validate kind.
  if (!(VALID_KINDS as readonly string[]).includes(kind)) {
    return jsonResponse(400, { error: 'invalid_kind' });
  }

  // Validate ext per bucket. intro_card goes to org-onboarding-assets (PNG/JPG only).
  const isOnboarding = kind === 'intro_card';
  const allowedExts: readonly string[] = isOnboarding ? ONBOARDING_EXTS : BRANDING_EXTS;
  if (!allowedExts.includes(ext)) {
    return jsonResponse(400, { error: 'invalid_ext' });
  }

  // 3. Build JWT-bearing Supabase client to resolve caller role + permission.
  const jwtClientFactory =
    deps.jwtClientFactory ??
    ((t: string) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${t}` } },
      }));
  const jwtClient = jwtClientFactory(jwt);

  try {
    // 4. Resolve caller role for this org (JWT-scoped — RLS applies).
    const { data: roleData, error: roleErr } = await jwtClient.rpc('get_caller_role', {
      p_org_id: orgId,
    });

    if (roleErr) {
      console.error('[branding-asset-upload-url] get_caller_role error', roleErr.message);
      return jsonResponse(500, { error: 'internal' });
    }

    // 5. Check permission.
    const { data: hasPerm, error: permErr } = await jwtClient.rpc('has_permission', {
      p_role: roleData,
      p_perm: 'branding.edit',
    });

    if (permErr) {
      console.error('[branding-asset-upload-url] has_permission error', permErr.message);
      return jsonResponse(500, { error: 'internal' });
    }

    if (!hasPerm) {
      return jsonResponse(403, { error: 'insufficient_privilege' });
    }

    // 6. Determine bucket + build path.
    const bucket = isOnboarding ? 'org-onboarding-assets' : 'org-branding';
    const path = `${orgId}/${kind}.${ext}`;

    // 7. Mint presigned upload URL via service-role client (AFTER auth gate).
    //    Service-role client is the only caller that can generate presigned URLs
    //    (per RESEARCH Finding 5 — Postgres SECDEF cannot generate them).
    const serviceClientFactory =
      deps.serviceClientFactory ??
      // deno-lint-ignore no-explicit-any
      (() => _createServiceRoleClientUnsafe() as any);
    const serviceClient = serviceClientFactory();

    const { data, error: urlErr } = await serviceClient.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (urlErr || !data) {
      console.error('[branding-asset-upload-url] createSignedUploadUrl error', urlErr?.message);
      return jsonResponse(500, { error: 'internal' });
    }

    return jsonResponse(200, {
      upload_url: data.signedUrl,
      path,
      token: data.token,
      bucket,
    });
  } catch (e) {
    console.error(
      '[branding-asset-upload-url] unhandled',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonResponse(500, { error: 'internal' });
  }
}

// ---------------------------------------------------------------------------
// Deno Edge Function entrypoint.
// ---------------------------------------------------------------------------

Deno.serve((req: Request) => handler(req));
