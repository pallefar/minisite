/**
 * Phase 36 Plan 36-02 REVIEW-03/04/06 — `nps-trigger-decide` Edge Function.
 *
 * POST /functions/v1/nps-trigger-decide
 *
 * Server-side fire decision for an admissible NPS trigger event. Enforces:
 *   - Lifetime cap (5 prompts ever per user) — D-05/D-07
 *   - Global cooldown (60d normal, 90d if a detractor rating sits in trailing 90d) — D-05/D-06 + W7 sliding window
 *   - Per-rule 30d cooldown — D-05
 *   - active=true rule filter (Pitfall 9) — D-02
 *   - Cohort-targeted CTA resolution via profiles.primary_org_id (W3) + review_cta_catalog server-side url_pattern embed (W9) — D-13/D-14/D-16
 *   - PostHog variant resolution → copy_variant written to review_prompt_history (B2)
 *
 * Auth:
 *   Authorization: Bearer <user-jwt>   (user.id derived from JWT — never from body, per T-36-07)
 *
 * Body:
 *   { event_name: string }
 *
 * Response (200):
 *   { fire: false, reason: 'lifetime_cap'|'global_cooldown'|'no_rule'|'per_rule_cooldown' }
 *   | { fire: true, copy_variant: string, cta_set: Array<{slug,url_pattern}>, rule_id: string }
 *
 * Error responses:
 *   401 unauthenticated   — bearer missing or invalid
 *   400 invalid_body      — event_name missing/invalid
 *
 * Per [[reference_rpc_auth_uid_vs_service_role_mismatch]]: nps-trigger-decide does NOT
 * call any auth.uid()-referencing RPC — all reads are service-role keyed by JWT-derived
 * user.id, so service-role admin client is appropriate (anon-key forwarding only required
 * for nps-feedback-submit's create_ticket_with_first_message call).
 *
 * Per [[feedback_phase_close_out_db_push_verification]]: schema (review_prompt_history +
 * copy_variant column, review_cta_catalog) ships in Plan 36-01. Verified at phase close-out.
 *
 * Per project memory [[reference_deno_test_discovery]]: tests live at `index.test.ts`.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

// ============================================================================
// Types
// ============================================================================

export type CtaSlug = 'trustpilot' | 'g2' | 'capterra';
export type CtaItem = { slug: CtaSlug; url_pattern: string };

export type DecideResponse =
  | { fire: false; reason: 'lifetime_cap' | 'global_cooldown' | 'no_rule' | 'per_rule_cooldown' }
  | { fire: true; copy_variant: string; cta_set: CtaItem[]; rule_id: string };

interface HistoryRow {
  fired_at: string;
  rule_id: string | null;
  rating_value: number | null;
}

interface RuleRow {
  id: string;
  trigger_event: string;
  active: boolean;
  created_at: string;
}

interface ProfileRow {
  primary_org_id: string | null;
}

interface CtaRow {
  slug: CtaSlug;
  url_pattern: string;
}

// ============================================================================
// CORS + helpers (copied verbatim from ship-winner-flag/index.ts lines 53-74)
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

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Lazy admin singleton + test override (copied from ship-winner-flag)
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
function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
function resetAdminForTest(): void {
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
// PostHog variant resolution seam (test-injectable)
// ============================================================================

type VariantResolver = (userId: string) => Promise<string>;

const defaultVariantResolver: VariantResolver = async (userId: string): Promise<string> => {
  // posthog-node getAllFlags resolution per RESEARCH + CONTEXT D-19.
  // Wrapped at the call site in try/catch — this function may throw; caller
  // falls back to 'control'. Keeping the resolver pluggable so Deno tests can
  // assert both happy-path (returns variant string) and throw (defaults to
  // 'control') without spinning up a real posthog-node client.
  try {
    const { PostHog } = await import('npm:posthog-node@5.10.4');
    const key = Deno.env.get('POSTHOG_PROJECT_KEY');
    if (!key) return 'control';
    const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
    const client = new PostHog(key, { host });
    try {
      // deno-lint-ignore no-explicit-any
      const flags = (await (client as any).getAllFlags(userId)) as Record<string, string | boolean> | null;
      const v = flags?.['nps_prompt_copy'];
      return typeof v === 'string' && v.length > 0 ? v : 'control';
    } finally {
      // Best-effort shutdown of this local client. Note: the shared
      // posthog-server's shutdownPostHog() handles the captureServer client
      // separately in the outer finally block.
      try {
        // deno-lint-ignore no-explicit-any
        await (client as any).shutdown();
      } catch (_e) {
        // ignore
      }
    }
  } catch (_e) {
    return 'control';
  }
};

let _variantResolver: VariantResolver = defaultVariantResolver;
function setVariantResolverForTest(fn: VariantResolver): void {
  _variantResolver = fn;
}
function resetVariantResolverForTest(): void {
  _variantResolver = defaultVariantResolver;
}

// ============================================================================
// Cooldown helpers — exported pure functions for unit-level test coverage
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * W7 sliding-window detractor flag.
 *
 * The flag is active ONLY while there exists a history row with rating_value
 * <= 2 fired within the trailing 90 days. A user who rated 2 at day -100
 * reverts to the 60d global cooldown (the lifetime detractor mark expired).
 *
 * Per CONTEXT D-06 clarified by W7 plan-checker note.
 */
export function detractorFlag(history: HistoryRow[], now: number = Date.now()): boolean {
  const cutoff = now - 90 * DAY_MS;
  return history.some((h) => {
    if (h.rating_value === null || h.rating_value === undefined) return false;
    if (h.rating_value > 2) return false;
    const t = Date.parse(h.fired_at);
    return Number.isFinite(t) && t > cutoff;
  });
}

/** D-05 lifetime cap. */
export function isLifetimeCapped(history: HistoryRow[]): boolean {
  return history.length >= 5;
}

/**
 * Global cooldown gate. Returns true when the user is INSIDE the cooldown
 * window (i.e. should NOT fire). Uses detractorFlag() to pick 60d vs 90d.
 */
export function isGlobalCooldown(history: HistoryRow[], now: number = Date.now()): boolean {
  if (history.length === 0) return false;
  const lastFired = Date.parse(history[0].fired_at);
  if (!Number.isFinite(lastFired)) return false;
  const minDays = detractorFlag(history, now) ? 90 : 60;
  return now - lastFired < minDays * DAY_MS;
}

/** Per-rule 30d cooldown. Returns true when rule is INSIDE its cooldown window. */
export function isPerRuleCooldown(history: HistoryRow[], ruleId: string, now: number = Date.now()): boolean {
  const lastForRule = history.find((h) => h.rule_id === ruleId);
  if (!lastForRule) return false;
  const t = Date.parse(lastForRule.fired_at);
  if (!Number.isFinite(t)) return false;
  return now - t < 30 * DAY_MS;
}

// ============================================================================
// Core handler
// ============================================================================

async function handleDecide(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // 1. Bearer JWT.
  const bearer = jwtFromReq(req);
  if (!bearer) return jsonError(401, 'unauthenticated');

  // 2. Validate bearer against GoTrue → JWT-derived user.id (T-36-07).
  let callerUid: string;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(bearer))) as {
      data: { user?: { id?: string } | null };
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
    callerUid = userData.user.id;
  } catch (_e) {
    return jsonError(401, 'unauthenticated');
  }

  // 3. Parse body.
  let body: { event_name?: unknown };
  try {
    body = (await req.json()) as { event_name?: unknown };
  } catch {
    return jsonError(400, 'invalid_body');
  }
  if (typeof body.event_name !== 'string' || body.event_name.length === 0) {
    return jsonError(400, 'invalid_body');
  }
  const eventName = body.event_name;

  try {
    // 4. Read user's prompt history (cooldown source-of-truth).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const historyRes = (await ((admin as any)
      .from('review_prompt_history')
      .select('fired_at, rule_id, rating_value')
      .eq('user_id', callerUid)
      .order('fired_at', { ascending: false }))) as { data: HistoryRow[] | null; error: unknown };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const history: HistoryRow[] = historyRes.data ?? [];

    // 5a. Lifetime cap — D-07 absolute, never reset.
    if (isLifetimeCapped(history)) {
      return jsonResponse(200, { fire: false, reason: 'lifetime_cap' } as DecideResponse);
    }

    // 5b. Global cooldown (60d default, 90d if detractor flag active per W7 sliding window).
    if (isGlobalCooldown(history)) {
      return jsonResponse(200, { fire: false, reason: 'global_cooldown' } as DecideResponse);
    }

    // 6. Active rule lookup (Pitfall 9 — .eq('active', true) is mandatory).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const rulesRes = (await ((admin as any)
      .from('review_prompt_rules')
      .select('id, trigger_event, active, created_at')
      .eq('trigger_event', eventName)
      .eq('active', true)
      .order('created_at', { ascending: true }))) as { data: RuleRow[] | null; error: unknown };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const rules: RuleRow[] = rulesRes.data ?? [];
    if (rules.length === 0) {
      return jsonResponse(200, { fire: false, reason: 'no_rule' } as DecideResponse);
    }

    // 7. Per-rule 30d cooldown — first eligible rule wins.
    const eligibleRule = rules.find((r) => !isPerRuleCooldown(history, r.id));
    if (!eligibleRule) {
      return jsonResponse(200, { fire: false, reason: 'per_rule_cooldown' } as DecideResponse);
    }

    // 8. CTA resolution per W3 + W9 (D-13/D-14/D-16).
    //    - primary_org_id null → consumer cohort → ['trustpilot']
    //    - primary_org_id non-null → clinic cohort → ['g2','capterra']
    //    - filter on requires_mobile_shell=false AND claimed=true
    //    - embed url_pattern from review_cta_catalog server-side (W9)
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const profileRes = (await ((admin as any)
      .from('profiles')
      .select('primary_org_id')
      .eq('id', callerUid)
      .maybeSingle())) as { data: ProfileRow | null; error: unknown };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const cohort: 'consumer' | 'clinic' = profileRes.data?.primary_org_id ? 'clinic' : 'consumer';
    const candidateSlugs: CtaSlug[] = cohort === 'consumer' ? ['trustpilot'] : ['g2', 'capterra'];

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ctaRes = (await ((admin as any)
      .from('review_cta_catalog')
      .select('slug, url_pattern')
      .in('slug', candidateSlugs)
      .eq('requires_mobile_shell', false)
      .eq('claimed', true))) as { data: CtaRow[] | null; error: unknown };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const cta_set: CtaItem[] = (ctaRes.data ?? []).map((r) => ({
      slug: r.slug,
      url_pattern: r.url_pattern,
    }));

    // 9. PostHog variant resolution — graceful fallback to 'control' on any error.
    let copy_variant = 'control';
    try {
      copy_variant = await _variantResolver(callerUid);
      if (typeof copy_variant !== 'string' || copy_variant.length === 0) copy_variant = 'control';
    } catch (_e) {
      copy_variant = 'control';
    }

    // 10. INSERT review_prompt_history BEFORE returning fire=true (idempotency
    //     anchor + B2 copy_variant column write).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const insertRes = (await ((admin as any)
      .from('review_prompt_history')
      .insert({
        user_id: callerUid,
        rule_id: eligibleRule.id,
        fired_at: new Date().toISOString(),
        copy_variant,
      }))) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (insertRes.error) {
      console.error(
        '[nps-trigger-decide] history INSERT failed (treating as fire=false to avoid double-issue):',
        insertRes.error.message,
      );
      // If we cannot anchor idempotency, refuse to fire to avoid double-showing
      // the prompt across devices on retry. Return a synthetic per_rule_cooldown
      // so the client treats this as a non-fire (rather than a 500 the modal
      // would surface to the user).
      return jsonResponse(200, { fire: false, reason: 'per_rule_cooldown' } as DecideResponse);
    }

    // 11. Server-side event emission (Pitfall 10 dual-write via captureServer).
    try {
      captureServer({
        event: 'nps_prompt_shown',
        userId: callerUid,
        properties: { rule_id: eligibleRule.id, copy_variant },
      });
    } catch (e) {
      console.warn('[nps-trigger-decide] captureServer threw (non-fatal):', (e as Error).message);
    }

    // 12. Fire response with W9-shaped cta_set.
    return jsonResponse(200, {
      fire: true,
      copy_variant,
      cta_set,
      rule_id: eligibleRule.id,
    } as DecideResponse);
  } finally {
    // 13. Deno isolate teardown — MUST flush captureServer batched events.
    await shutdownPostHog();
  }
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleDecide);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleDecide,
  setAdminForTest,
  resetAdminForTest,
  setVariantResolverForTest,
  resetVariantResolverForTest,
};
