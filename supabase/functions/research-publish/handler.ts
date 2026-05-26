/**
 * handler.ts — Core logic for research-publish Edge Function.
 *
 * Phase 62 Plan 03. Handler/index.ts split per [[reference_deno_test_top_level_serve_trap]].
 *
 * This file MUST NOT import Deno.* or any npm:* packages that use Deno.* at
 * module level. The seam allows Vitest to unit-test the handler without
 * triggering Deno.serve or Deno.env resolution.
 *
 * All external dependencies (Supabase, Slack) are injected via HandlerDeps
 * for test isolation.
 *
 * index.ts owns: Deno.env wiring, createClient, import of _shared/* helpers,
 * and the `if (import.meta.main) Deno.serve(...)` guard.
 *
 * Purpose:
 *   - Validates publication_id (UUID) + actor_id inputs.
 *   - Enforces 2-person review rule (defense-in-depth — DB also enforces via SELF_REVIEW_REJECTED).
 *   - Calls supabase.rpc('publish_research') to transition state machine.
 *   - Optionally renders markdown_content via injected markdownRenderer dep.
 *   - Returns { ok: true, slug, published_at, html? } on success.
 *
 * Placeholder runtime guard per [[feedback_placeholder_string_runtime_guard_pattern]]:
 *   If SUPABASE_SERVICE_ROLE_KEY is missing or starts with placeholder pattern →
 *   return 503 + Slack P1 alert (NOT a TODO comment — actual runtime guard).
 *
 * THREAT: T-62-03-01 (XSS via markdown) — markdownRenderer uses html:false
 * THREAT: T-62-03-02 (unauthenticated POST) — auth checked in index.ts before calling handler
 * THREAT: T-62-03-03 (placeholder key) — 503 + Slack P1 guard below
 * THREAT: T-62-03-04 (stacktrace leak) — generic 500 error message; full detail in server logs
 */

// ──────────────────────────────────────────────────────────────────────────────
// Constants (no imports needed — all deps injected via HandlerDeps)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Placeholder runtime guard pattern per [[feedback_placeholder_string_runtime_guard_pattern]].
 * Match: 'placeholder*', 'TODO*', 'REPLACE_ME*' (case-insensitive).
 */
const PLACEHOLDER_KEY_PATTERN = /^(placeholder|TODO|REPLACE_ME)/i;

/** UUID v4 format for input validation. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────────────────────────────────────────
// Duck-typed interfaces for injected dependencies (avoids npm: imports in tests)
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal Supabase client shape for publication fetch + RPC call. */
export interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  rpc(
    fn: string,
    params?: Record<string, unknown>,
  ): Promise<{
    data: Record<string, unknown> | null;
    error: { message?: string } | null;
  }>;
}

// ──────────────────────────────────────────────────────────────────────────────
// HandlerDeps — full injection surface
// ──────────────────────────────────────────────────────────────────────────────

export interface HandlerDeps {
  supabaseUrl: string;
  supabaseServiceKey: string;
  slackWebhookUrl?: string;
  // Injectable for tests (production deps wired in index.ts):
  fetchImpl?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;
  supabaseClient?: SupabaseLike;
  sendSlackAlertFn?: (level: 'P1' | 'P2' | 'P3', message: string) => Promise<void>;
  markdownRenderer?: (markdown: string) => string;
  now?: () => Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Request / response types
// ──────────────────────────────────────────────────────────────────────────────

export interface HandlerRequest {
  publication_id: string;
  actor_id: string;
}

export interface HandlerResponse {
  status: 200 | 400 | 403 | 404 | 409 | 500 | 503;
  body: {
    ok: boolean;
    html?: string;
    slug?: string;
    published_at?: string;
    error?: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary handler
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Handle a research-publish request.
 *
 * Exported for Vitest unit-test injection. index.ts calls this with production deps.
 * MUST NOT import or call Deno.* anywhere in this file.
 */
export async function handleResearchPublish(
  req: HandlerRequest,
  deps: HandlerDeps,
): Promise<HandlerResponse> {
  // ── Step 1: Placeholder runtime guard ────────────────────────────────────────
  // Per [[feedback_placeholder_string_runtime_guard_pattern]]: 503 + Slack P1 at request time
  if (!deps.supabaseServiceKey || PLACEHOLDER_KEY_PATTERN.test(deps.supabaseServiceKey)) {
    // Best-effort Slack P1 alert — swallow errors (non-blocking)
    if (deps.sendSlackAlertFn) {
      try {
        await deps.sendSlackAlertFn(
          'P1',
          'research-publish: placeholder SUPABASE_SERVICE_ROLE_KEY — all publish requests will fail',
        );
      } catch {
        // best-effort — do not let Slack failure block the 503 response
      }
    }
    return {
      status: 503,
      body: {
        ok: false,
        error: 'service unavailable: placeholder key — contact platform admin',
      },
    };
  }

  // ── Step 2: Input validation ──────────────────────────────────────────────────
  if (!req.publication_id || !UUID_PATTERN.test(req.publication_id)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'publication_id is required and must be a valid UUID',
      },
    };
  }

  if (!req.actor_id || !UUID_PATTERN.test(req.actor_id)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'actor_id is required and must be a valid UUID',
      },
    };
  }

  // ── Step 3: Get Supabase client ───────────────────────────────────────────────
  // In production: injected by index.ts via createClient(Deno.env...)
  // In tests: provided by test via deps.supabaseClient mock
  const sb = deps.supabaseClient!;

  // ── Step 4: Load publication row ─────────────────────────────────────────────
  const { data: publication, error: fetchErr } = await sb
    .from('research_publications')
    .select('id, slug, created_by, status, published_at, markdown_content')
    .eq('id', req.publication_id)
    .maybeSingle();

  if (fetchErr) {
    // Log full error server-side; return generic error to client (T-62-03-04)
    console.error('[research-publish] fetch publication error:', fetchErr);
    return {
      status: 500,
      body: { ok: false, error: 'internal error fetching publication' },
    };
  }

  if (!publication) {
    return {
      status: 404,
      body: { ok: false, error: 'publication not found' },
    };
  }

  // ── Step 5: 2-person review check (defense-in-depth) ─────────────────────────
  // DB-side publish_research RPC also raises SELF_REVIEW_REJECTED — this is Layer 2.
  if (publication.created_by === req.actor_id) {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'SELF_REVIEW_REJECTED: author cannot review their own publication',
      },
    };
  }

  // ── Step 6: Call publish_research RPC ────────────────────────────────────────
  // State machine: transitions status → 'published', sets published_at, reviewer_id
  const { data: rpcData, error: rpcErr } = await sb.rpc('publish_research', {
    p_publication_id: req.publication_id,
  });

  if (rpcErr) {
    const msg = rpcErr.message ?? '';
    if (msg.includes('SELF_REVIEW_REJECTED')) {
      return {
        status: 403,
        body: {
          ok: false,
          error: 'SELF_REVIEW_REJECTED: DB-side 2-person rule rejected publish',
        },
      };
    }
    // FK or unique constraint violations → 409
    if (msg.includes('unique') || msg.includes('foreign key') || msg.includes('23')) {
      return {
        status: 409,
        body: { ok: false, error: 'conflict: publication already published or invalid state' },
      };
    }
    // Generic server error (T-62-03-04: log full detail, return generic to client)
    console.error('[research-publish] RPC error:', rpcErr);
    return {
      status: 500,
      body: { ok: false, error: 'internal error during publish' },
    };
  }

  // ── Step 7: Optional markdown render ─────────────────────────────────────────
  // If publication has markdown_content column AND a markdownRenderer is injected,
  // render and return HTML. Otherwise just confirm state transition completed.
  // NOTE: markdown files at content/research/*.md are read at build/deploy time by
  // the public /research/<slug> page (Phase 62-06) — not loaded here by the Fn.
  let html: string | undefined;
  if (deps.markdownRenderer && publication.markdown_content) {
    try {
      html = deps.markdownRenderer(publication.markdown_content as string);
    } catch (renderErr) {
      // Non-fatal: publish succeeded, just return without HTML
      console.error('[research-publish] markdown render error (non-fatal):', renderErr);
    }
  }

  // ── Step 8: Return success ────────────────────────────────────────────────────
  const slug = (rpcData?.slug ?? publication.slug) as string;
  const publishedAt = (rpcData?.published_at ?? publication.published_at) as string;

  const responseBody: HandlerResponse['body'] = {
    ok: true,
    slug,
    published_at: publishedAt,
  };
  if (html !== undefined) {
    responseBody.html = html;
  }

  return {
    status: 200,
    body: responseBody,
  };
}
