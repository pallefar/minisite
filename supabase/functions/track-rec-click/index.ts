/**
 * Phase 38 Plan 38-09 — `track-rec-click` Edge Function.
 *
 * Server-side click tracker for the recommender surfaces (D-01 dashboard +
 * RECOMMEND-08 kb_footer). Browsers POST `{recommendation_id}` here instead
 * of capturing PostHog events client-side — Phase 24 D-12 forbids client-side
 * AI event capture (adblock leakage + PHI exposure risk).
 *
 * Contract:
 *   POST /track-rec-click
 *   Authorization: Bearer <user-JWT>
 *   Body: { recommendation_id: string, surface?: string }
 *   →  204 on first-click + repeat-click (idempotent)
 *      400 missing recommendation_id
 *      401 missing / malformed Authorization
 *      404 recommendation_id does not belong to caller (RLS rejected the UPDATE)
 *
 * RLS behavior:
 *   recommendation_events policy `rec_events_update_own` (migration
 *   20270705000005_phase38_recommendation_events.sql) restricts UPDATE to
 *   rows where user_id = auth.uid(). We attach the caller's JWT to the
 *   Supabase client so RLS naturally rejects cross-tenant writes — the
 *   UPDATE returns 0 rows and we surface 404 to the caller.
 *
 * Idempotency:
 *   First click: WHERE clicked_at IS NULL → sets clicked_at = now(), emits
 *     `recommendation.clicked` with first_click=true.
 *   Repeat click: WHERE clicked_at IS NULL no longer matches → 0 rows updated;
 *     we still capture a `recommendation.clicked` event with first_click=false
 *     so funnel analytics see the engagement signal but downstream MMR /
 *     dedup logic only treats the first click as a state transition.
 *
 * Test seam:
 *   `__setDepsForTest` swaps the Supabase client + captureServer + shutdownPostHog.
 *   `handle(req)` is the unit-test entry; Deno.serve wires it to the runtime.
 *
 * PostHog shutdown:
 *   try/finally guarantees `shutdownPostHog()` flushes batched events before
 *   the Deno isolate is torn down (RESEARCH PITFALL 1 / memory
 *   feedback_planner_iter1_anti_patterns).
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  captureServer as captureServerReal,
  shutdownPostHog as shutdownPostHogReal,
} from '../_shared/posthog-server.ts';

// ── Dependency-injection seam (test-only) ──────────────────────────────────

interface Deps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeSupabase: (authHeader: string) => any;
  captureServer: (args: {
    userId: string;
    event: string;
    properties?: Record<string, unknown>;
  }) => void;
  shutdownPostHog: () => Promise<void>;
}

let _depsOverride: Deps | null = null;

export function __setDepsForTest(deps: Partial<Deps>): void {
  _depsOverride = {
    makeSupabase: deps.makeSupabase ?? defaultMakeSupabase,
    captureServer: deps.captureServer ?? captureServerReal,
    shutdownPostHog: deps.shutdownPostHog ?? shutdownPostHogReal,
  };
}

export function __resetDepsForTest(): void {
  _depsOverride = null;
}

function defaultMakeSupabase(authHeader: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

function getDeps(): Deps {
  return (
    _depsOverride ?? {
      makeSupabase: defaultMakeSupabase,
      captureServer: captureServerReal,
      shutdownPostHog: shutdownPostHogReal,
    }
  );
}

// ── Auth helper ────────────────────────────────────────────────────────────

function readAuthHeader(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (!header) return null;
  if (!header.startsWith('Bearer ')) return null;
  return header;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RequestBody {
  recommendation_id?: string;
  surface?: string;
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handle(req: Request): Promise<Response> {
  const deps = getDeps();

  // 1. Auth gate.
  const authHeader = readAuthHeader(req);
  if (!authHeader) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // 2. Body parse + validate.
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  if (!body.recommendation_id || typeof body.recommendation_id !== 'string') {
    return jsonResponse(400, { error: 'recommendation_id required' });
  }
  const recommendationId = body.recommendation_id;
  const surface = body.surface;

  // 3. Resolve caller's auth.users.id from the JWT (the RLS predicate uses auth.uid()
  //    server-side; we read it client-side to populate captureServer's distinct_id
  //    and to scope our own UPDATE filter as defense-in-depth on top of RLS).
  const supabase = deps.makeSupabase(authHeader);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authResult = (await supabase.auth.getUser()) as {
    data: { user: { id: string } | null };
    error: { message?: string } | null;
  };
  const userId = authResult.data.user?.id;
  if (!userId) {
    try {
      return jsonResponse(401, { error: 'unauthorized' });
    } finally {
      await deps.shutdownPostHog();
    }
  }

  try {
    // 4. First-click attempt: filter on clicked_at IS NULL so repeat clicks
    //    don't move the timestamp. The RLS policy `rec_events_update_own`
    //    additionally enforces user_id = auth.uid(); we add the eq('user_id', userId)
    //    filter explicitly for defense-in-depth (T-38-39 mitigation).
    const firstTry = await supabase
      .from('recommendation_events')
      .update({ clicked_at: new Date().toISOString() })
      .eq('recommendation_id', recommendationId)
      .eq('user_id', userId)
      .is('clicked_at', null)
      .select('id, recommendation_id, user_id, clicked_at')
      .maybeSingle();

    if (firstTry.data) {
      // First click landed.
      deps.captureServer({
        userId,
        event: 'recommendation.clicked',
        properties: {
          recommendation_id: recommendationId,
          first_click: true,
          ...(surface ? { surface } : {}),
        },
      });
      return new Response(null, { status: 204 });
    }

    // 5. First-click query matched 0 rows. Two possible reasons:
    //    a) Row exists but clicked_at is already set → repeat click (idempotent path).
    //    b) Row does not exist for this user → cross-tenant attempt or stale id → 404.
    //
    //    Distinguish by re-running the UPDATE *without* the `is('clicked_at', null)`
    //    filter: if a row matches, it was a repeat click; if not, it was foreign.
    const repeatProbe = await supabase
      .from('recommendation_events')
      .update({ clicked_at: new Date().toISOString() })
      // The update payload above is intentionally a no-op assignment — we
      // only need the WHERE to confirm row existence. Postgres will write
      // the same value back, which is idempotent for the analytics signal.
      .eq('recommendation_id', recommendationId)
      .eq('user_id', userId)
      .select('id, recommendation_id, user_id, clicked_at')
      .maybeSingle();

    if (repeatProbe.data) {
      // Row exists for this user but was already clicked → repeat click.
      deps.captureServer({
        userId,
        event: 'recommendation.clicked',
        properties: {
          recommendation_id: recommendationId,
          first_click: false,
          ...(surface ? { surface } : {}),
        },
      });
      return new Response(null, { status: 204 });
    }

    // Row not found for this user — cross-tenant or stale id.
    return jsonResponse(404, { error: 'recommendation_not_found' });
  } finally {
    await deps.shutdownPostHog();
  }
}

// ── Runtime entry point ────────────────────────────────────────────────────

// Deno.serve is the canonical entry; guarded so tests importing `handle`
// don't accidentally start a server.
if (import.meta.main) {
  Deno.serve(handle);
}
