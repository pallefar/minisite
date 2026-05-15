/**
 * `page-publish` Edge Function — Phase 15 Plan 15-04.
 *
 * Re-point `landing_pages.published_revision_id` to a chosen revision, mark
 * the page `is_published = true`, then fire a best-effort
 * `x-prerender-revalidate` HEAD to the page's public URL so Vercel's edge
 * cache returns the freshly-published HTML on the next visitor request
 * (D-09 "Publish feels instant").
 *
 * Invariants (mirror Plan 15-04 page-save):
 *
 *   1. JWT → admin.auth.getUser → 401 unauthenticated if missing/invalid.
 *   2. profiles.is_staff = true gate (T-15-04-01). Non-staff → 403 forbidden.
 *   3. Revision belongs to page — SELECT id,page_id FROM landing_page_revisions
 *      WHERE id = revisionId; if missing or page_id !== pageId → 400
 *      revision_mismatch.
 *   4. UPDATE landing_pages SET published_revision_id = revisionId,
 *      is_published = true, updated_at = now() WHERE id = pageId.
 *   5. Best-effort revalidation HEAD wrapped in try/catch (T-15-04-06).
 *      A failed/hung Vercel endpoint must NOT change the 200 response or
 *      delay publish — DB pointer move is the source of truth.
 *   6. No upstream error echo (T-15-04-05). Opaque codes only.
 *
 * Required Supabase Function secrets (downstream user_setup):
 *   - VERCEL_BYPASS_TOKEN — value of Vercel's deployment-protection bypass
 *     token; used as the `x-prerender-revalidate` header.
 *   - SITE_ORIGIN — defaults to `https://leanshot.app`; the public origin the
 *     revalidation HEAD targets (`<origin>/<slug>`).
 *
 * Both env vars are read defensively (`?? ''` / `?? 'https://leanshot.app'`)
 * so a missing secret cannot crash the function or the Deno test suite.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

// =============================================================================
// Env helpers (lazy)
// =============================================================================

function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

const getSupabaseUrl = () => env('SUPABASE_URL');
const getSupabaseServiceRoleKey = () => env('SUPABASE_SERVICE_ROLE_KEY');
const getVercelBypassToken = () => env('VERCEL_BYPASS_TOKEN');
const getSiteOrigin = () => env('SITE_ORIGIN', 'https://leanshot.app');

// =============================================================================
// Admin Supabase client (lazy singleton + test-injectable)
// =============================================================================

// deno-lint-ignore no-explicit-any
let _adminInstance: any = null;

// deno-lint-ignore no-explicit-any
function getAdmin(): any {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

const adminInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin();
    const val = a[prop];
    return typeof val === 'function' ? val.bind(a) : val;
  },
});

export function __setAdminForTest(fakeAdmin: unknown): void {
  _adminInstance = fakeAdmin;
}

// =============================================================================
// Helpers
// =============================================================================

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

interface PublishBody {
  pageId?: string;
  revisionId?: string;
}

// =============================================================================
// handlePublish
// =============================================================================

export async function handlePublish(req: Request): Promise<Response> {
  // 1. JWT
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  // 2. Resolve user
  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user as { id: string };

  // 3. is_staff gate
  const { data: profile } = await adminInstance
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  if (!profile || !(profile as any).is_staff) {
    return jsonError(403, 'forbidden');
  }

  // 4. Parse body
  let body: PublishBody;
  try {
    body = (await req.json()) as PublishBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const pageId = typeof body.pageId === 'string' ? body.pageId : '';
  const revisionId = typeof body.revisionId === 'string' ? body.revisionId : '';
  if (!pageId || !revisionId) {
    return jsonError(400, 'invalid_body');
  }

  // 5. Verify revision belongs to page
  const { data: rev, error: revErr } = await adminInstance
    .from('landing_page_revisions')
    .select('id, page_id')
    .eq('id', revisionId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  if (revErr || !rev || (rev as any).page_id !== pageId) {
    return jsonError(400, 'revision_mismatch');
  }

  // 6. Re-point published_revision_id (the actual publish action).
  const { error: updateErr } = await adminInstance
    .from('landing_pages')
    .update({
      published_revision_id: revisionId,
      is_published: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pageId);
  if (updateErr) {
    console.error(
      '[page-publish] landing_pages update failed',
      // deno-lint-ignore no-explicit-any
      (updateErr as any).message ?? 'unknown',
    );
    return jsonError(500, 'internal_error');
  }

  // 7. Read back slug for the revalidation URL.
  const { data: pageRow } = await adminInstance
    .from('landing_pages')
    .select('slug')
    .eq('id', pageId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const slug = (pageRow as any)?.slug ?? '';

  // 8. Best-effort revalidation HEAD. Wrapped in try/catch — failure does NOT
  //    change the 200 response (T-15-04-06). The DB pointer move is committed.
  if (slug) {
    try {
      const origin = getSiteOrigin();
      const url = `${origin}/${slug}`;
      const token = getVercelBypassToken();
      await fetch(url, {
        method: 'HEAD',
        headers: { 'x-prerender-revalidate': token },
      });
    } catch (err) {
      console.warn(
        '[page-publish] revalidation HEAD failed',
        err instanceof Error ? err.message : 'unknown',
      );
    }
  }

  return jsonResponse(200, { ok: true, slug });
}

// =============================================================================
// Deno.serve dispatcher
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    if (req.method !== 'POST') {
      return jsonError(405, 'method_not_allowed');
    }
    return await handlePublish(req);
  } catch (e) {
    console.error('[page-publish] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================

export const __internal = {
  handlePublish,
  __setAdminForTest,
};
