/**
 * `page-save` Edge Function — Phase 15 Plan 15-04.
 *
 * Append a `landing_page_revisions` row for a draft or existing landing_page.
 *
 * Invariants:
 *
 *   1. **JWT auth via admin.auth.getUser.** Every request must carry
 *      `Authorization: Bearer <jwt>`. The admin client resolves the JWT to a
 *      real user before any database write.
 *
 *   2. **Server-side is_staff gate (T-15-04-01).** The client `/admin/pages/*`
 *      route guard is defense-in-depth only. THIS function is the real gate:
 *      after JWT→user resolution, query `profiles.is_staff` via the service-
 *      role client; non-staff → 403 forbidden.
 *
 *   3. **Append-only landing_page_revisions (T-15-04-04 / D-07).** This
 *      function only ever `.insert()`s into `landing_page_revisions`. It MUST
 *      NOT `.update()` or `.delete()` rows — Plan 15-01 has DB-level triggers
 *      enforcing this for defense-in-depth.
 *
 *   4. **Reserved-slug denylist (T-15-04-03).** For NEW pages, the slug is
 *      checked against `RESERVED_SLUGS` (mirrored from
 *      `leanshot/src/lib/page-builder/block-schema.ts` — see Pitfall 8 below).
 *      Reserved → 400 reserved_slug, no write.
 *
 *   5. **Slug format regex.** All slugs (new + edits) must match
 *      `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Malformed → 400 invalid_slug, no write.
 *
 *   6. **No upstream error echo (T-15-04-05).** All error paths return a
 *      short opaque code. Top-level try/catch logs `console.error('[page-save] …', err.message)`
 *      server-side only — never the raw exception text in the response body.
 *
 *   7. **CORS posture.** Mirrors `stripe-checkout/cors.ts` verbatim (authed
 *      POST, Bearer-only). `Access-Control-Allow-Origin: *` is intentional
 *      because the JWT is the auth gate, not a cookie.
 *
 *   8. **Pitfall 8 — RESERVED_SLUGS mirror.** The Deno function bundler cannot
 *      resolve the Vite `@/` alias used by the browser. `RESERVED_SLUGS` is
 *      duplicated here from `block-schema.ts` and MUST stay in lockstep — if
 *      the browser-side list ever gains an entry, this file must too (and
 *      vice-versa). The block-schema.ts version is the SSOT for the browser.
 *
 *   9. **D-10 cross-plan contract.** The 6 leading entries
 *      (`clinic|admin|share|api|auth|assets`) MUST also match the negative-
 *      lookahead in `leanshot/vercel.json`'s `/{slug}` rewrite (15-02).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

// =============================================================================
// Reserved-slug mirror (MIRROR of src/lib/page-builder/block-schema.ts)
// =============================================================================

/**
 * MIRROR of `leanshot/src/lib/page-builder/block-schema.ts` `RESERVED_SLUGS`.
 *
 * Keep byte-equal with the browser-side list. The Deno bundler cannot resolve
 * the Vite `@/` alias, so we duplicate the array here intentionally. This is
 * the only allowed duplication for the block-schema contract.
 *
 * D-10 cross-plan contract: the first 6 entries mirror `vercel.json`'s
 * negative-lookahead `(?!clinic|clinic-invite|admin|share|api|auth|assets|...)`.
 */
const RESERVED_SLUGS: readonly string[] = [
  'clinic',
  'admin',
  'share',
  'api',
  'auth',
  'assets',
  'sitemap.xml',
  'robots.txt',
] as const;

function isReservedSlug(slug: string): boolean {
  const n = slug.trim().toLowerCase();
  for (const r of RESERVED_SLUGS) {
    if (r === n) return true;
  }
  return false;
}

// =============================================================================
// Env helpers — lazy reads so tests can Deno.env.set() before import
// =============================================================================

function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

const getSupabaseUrl = () => env('SUPABASE_URL');
const getSupabaseServiceRoleKey = () => env('SUPABASE_SERVICE_ROLE_KEY');

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

// Proxy: lazy reads of _adminInstance so __setAdminForTest works post-import.
const adminInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_target: any, prop: string | symbol): unknown {
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

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SaveBody {
  pageId?: string;
  slug?: string;
  title?: string;
  blocks?: unknown;
}

// =============================================================================
// handleSave
// =============================================================================

export async function handleSave(req: Request): Promise<Response> {
  // 1. JWT
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  // 2. Resolve user
  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user as { id: string; email?: string };

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
  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const title = typeof body.title === 'string' ? body.title : '';
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const pageId = typeof body.pageId === 'string' && body.pageId.length > 0
    ? body.pageId
    : undefined;

  // 5. Slug format
  if (!SLUG_RE.test(slug)) {
    return jsonError(400, 'invalid_slug');
  }

  // 6. Reserved-slug denylist for NEW pages
  if (!pageId && isReservedSlug(slug)) {
    return jsonError(400, 'reserved_slug');
  }

  // 7. Write path
  let resolvedPageId: string;
  if (pageId) {
    // Confirm the page exists (defense-in-depth; RLS / service-role lets us see it).
    const { data: existing, error: existingErr } = await adminInstance
      .from('landing_pages')
      .select('id')
      .eq('id', pageId)
      .maybeSingle();
    if (existingErr || !existing) {
      return jsonError(404, 'page_not_found');
    }
    // deno-lint-ignore no-explicit-any
    resolvedPageId = (existing as any).id as string;
  } else {
    // NEW page: insert landing_pages first, then revision.
    const insertPage = adminInstance
      .from('landing_pages')
      .insert({ slug, title, created_by: user.id });
    // deno-lint-ignore no-explicit-any
    const pageResult: any = await (insertPage as any).select('id').single();
    if (pageResult.error || !pageResult.data) {
      console.error(
        '[page-save] landing_pages insert failed',
        pageResult.error?.message ?? 'unknown',
      );
      return jsonError(500, 'internal_error');
    }
    resolvedPageId = pageResult.data.id as string;
  }

  // 8. INSERT revision — APPEND-ONLY (never UPDATE/DELETE).
  const insertRev = adminInstance
    .from('landing_page_revisions')
    .insert({ page_id: resolvedPageId, blocks, created_by: user.id });
  // deno-lint-ignore no-explicit-any
  const revResult: any = await (insertRev as any).select('id').single();
  if (revResult.error || !revResult.data) {
    console.error(
      '[page-save] landing_page_revisions insert failed',
      revResult.error?.message ?? 'unknown',
    );
    return jsonError(500, 'internal_error');
  }
  const revisionId = revResult.data.id as string;

  return jsonResponse(200, { pageId: resolvedPageId, revisionId });
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
    return await handleSave(req);
  } catch (e) {
    console.error('[page-save] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================

export const __internal = {
  handleSave,
  __setAdminForTest,
};
