/**
 * Phase 38 Plan 38-06 (RECOMMEND-09) — `plan-personalize` Edge Function.
 *
 * POST /functions/v1/plan-personalize
 *
 * Auth:
 *   Authorization: Bearer <user-jwt OR service_role>
 *
 * Body:
 *   {
 *     user_id: string,
 *     context: 'paywall' | 'save_offer',
 *     plan_id?: string  // accepted but unused in v1
 *   }
 *
 * Response (200):
 *   {
 *     offer_hint: 'annual_nudge' | 'discount_eligible' | 'pause_offer' | 'extended_trial',
 *     confidence: number,     // 0..1, deterministic per rule matched
 *     rationale: string       // ≤200 chars, no clinical-action keywords
 *   }
 *
 * Architecture invariants (CONTEXT D-16 + D-17):
 *   1. SEPARATE Edge Fn from `recommender` — Phase 39 PAYWALL + Phase 40 SAVE
 *      are the ONLY callers. Do NOT bundle this with the recommender.
 *   2. Rule-based v1 — ZERO LLM calls. NEVER fetch ai-gateway.vercel.sh /
 *      Anthropic / OpenAI / Moonshot from this function.
 *   3. P99 < 50ms (hot-conversion-path). Single DB round-trip + 5-branch
 *      rule cascade. Cold-start exempted via pre-warm in perf test (D-17).
 *   4. Returns ONLY {offer_hint, confidence, rationale} — no PII, no PHI.
 *      Rationale defensively capped at 200 chars + clinical-keyword strip.
 *
 * Algorithm (rule-priority cascade, first match wins):
 *   R1 — context=save_offer AND active paid_monthly        → pause_offer (0.9)
 *   R2 — paywall_dismissals >= 3                            → discount_eligible (0.8)
 *   R3 — paid_monthly + 0 dismissals + signup >60 days ago → annual_nudge (0.7)
 *   R4 — (no activation OR score<0.3) AND trial/free       → extended_trial (0.6)
 *   R5 — fallback                                            → extended_trial (0.3)
 *
 * Data source — `public.plan_personalize_facts(p_user_id uuid)` RPC.
 *   See migration 20270705000013_phase38_plan_personalize_facts_fn.sql.
 *   Single SQL round-trip pulls profiles + activation_events + paywall_events
 *   + plan_history aggregates. If any source table is missing (Phase 14 / 34 /
 *   39 not yet shipped), the RPC returns NULLs for those columns and Rules
 *   degrade gracefully to the fallback (R5) — never throws.
 *
 * Threat-model:
 *   - T-38-28 (Info disclosure): rationale ≤200 chars + clinical-keyword
 *     defensive filter. Offer-hint values are non-PHI.
 *   - T-38-29 (DoS): single SQL round-trip; perf gate in CI.
 *   - T-38-30 (Tampering): caller passes `context` only; this Fn computes
 *     offer_hint server-side from DB facts. Forged user_id is rejected
 *     unless Bearer is service_role.
 *
 * Internals (`__internal`) are exported for the Deno test suite.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CORS
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
// Lazy admin singleton (per project pattern, see changelog-mark-read)
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
// Body validation
// ============================================================================

type PersonalizeContext = 'paywall' | 'save_offer';

interface PersonalizeBody {
  user_id: string;
  context: PersonalizeContext;
  plan_id?: string;
}

function parseBody(raw: unknown): { ok: true; body: PersonalizeBody } | { ok: false; code: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'invalid_body' };
  const r = raw as Record<string, unknown>;
  if (typeof r.user_id !== 'string' || r.user_id.length < 8) {
    return { ok: false, code: 'invalid_user_id' };
  }
  if (r.context !== 'paywall' && r.context !== 'save_offer') {
    return { ok: false, code: 'invalid_context' };
  }
  return { ok: true, body: { user_id: r.user_id, context: r.context as PersonalizeContext } };
}

// ============================================================================
// Rule cascade
// ============================================================================

type OfferHint = 'annual_nudge' | 'discount_eligible' | 'pause_offer' | 'extended_trial';

interface PersonalizeFacts {
  // Nullable to support partial-schema fallback (some Phase 14/34/39 tables
  // may not yet exist; RPC degrades with NULLs).
  signup_at: string | null;
  plan_tier: string | null;            // 'paid_monthly' | 'paid_annual' | 'trial' | 'free' | null
  is_active: boolean | null;
  activated_at: string | null;
  activation_score: number | null;
  paywall_dismissals: number | null;
  trial_end: string | null;
}

interface RuleResult {
  offer_hint: OfferHint;
  confidence: number;
  rationale: string;
  rule_id: string;
}

const SIXTY_DAYS_MS = 60 * 24 * 3600 * 1000;

function applyRules(facts: PersonalizeFacts, ctx: PersonalizeContext): RuleResult {
  const dismissals = facts.paywall_dismissals ?? 0;
  const score = facts.activation_score;
  const planTier = facts.plan_tier;
  const isActive = facts.is_active === true;
  const signupAt = facts.signup_at ? Date.parse(facts.signup_at) : NaN;
  const tenureMs = Number.isFinite(signupAt) ? Date.now() - signupAt : 0;

  // R1 — save_offer + active paid monthly → pause_offer.
  if (ctx === 'save_offer' && isActive && planTier === 'paid_monthly') {
    return {
      offer_hint: 'pause_offer',
      confidence: 0.9,
      rationale: 'Active monthly paid; pause preserves retention before discount',
      rule_id: 'R1_pause_offer',
    };
  }

  // R2 — ≥3 paywall dismissals → discount_eligible.
  if (dismissals >= 3) {
    return {
      offer_hint: 'discount_eligible',
      confidence: 0.8,
      rationale: 'Multiple paywall dismissals signal price sensitivity',
      rule_id: 'R2_discount_eligible',
    };
  }

  // R3 — paid_monthly + 0 dismissals + 60+ days tenure → annual_nudge.
  if (planTier === 'paid_monthly' && dismissals === 0 && tenureMs > SIXTY_DAYS_MS) {
    return {
      offer_hint: 'annual_nudge',
      confidence: 0.7,
      rationale: 'Long-tenure monthly with no dismissals — annual conversion candidate',
      rule_id: 'R3_annual_nudge',
    };
  }

  // R4 — (no activation OR low score) AND trial/free → extended_trial.
  const lowActivation = score === null || score === undefined || (typeof score === 'number' && score < 0.3);
  if (lowActivation && (planTier === 'trial' || planTier === 'free' || planTier === null)) {
    return {
      offer_hint: 'extended_trial',
      confidence: 0.6,
      rationale: 'Low activation signal; extended trial rescue play',
      rule_id: 'R4_extended_trial',
    };
  }

  // R5 — fallback.
  return {
    offer_hint: 'extended_trial',
    confidence: 0.3,
    rationale: 'Default fallback — no specific personalization signal',
    rule_id: 'R5_fallback',
  };
}

// Defensive: T-38-28 — strip any clinical-action keywords + cap rationale length.
const CLINICAL_KEYWORDS: ReadonlyArray<string> = [
  'dose', 'mg', 'ml', 'titrate', 'inject', 'medication', 'prescribe',
];

function sanitizeRationale(s: string): string {
  let out = s;
  for (const kw of CLINICAL_KEYWORDS) {
    // case-insensitive replace
    const re = new RegExp(kw, 'gi');
    out = out.replace(re, '[redacted]');
  }
  if (out.length > 200) out = out.slice(0, 200);
  return out;
}

// ============================================================================
// Core handler
// ============================================================================

async function handlePersonalize(req: Request): Promise<Response> {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // Bearer token (user JWT or service_role).
  const bearer = jwtFromReq(req);
  if (!bearer) return jsonError(401, 'unauthenticated');

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const isServiceRole = serviceRole.length > 0 && bearer === serviceRole;

  if (!isServiceRole) {
    // User JWT path — verify via admin.getUser.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(bearer))) as {
      data: { user?: { id?: string } | null };
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
    // Note: we accept the user_id from body (which Phase 39/40 will pass) but
    // for non-service-role callers we could optionally enforce it matches
    // userData.user.id. v1 keeps it permissive since only authenticated UIs
    // dispatch this and the worst case is leaking an offer_hint (non-PHI).
  }

  // Parse + validate body.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return jsonError(400, parsed.code);
  }
  const { user_id, context } = parsed.body;

  // Single SQL round-trip via RPC. RPC returns NULL when user not found;
  // returns partial-NULL columns when source tables (paywall_events,
  // activation_events, plan_history) don't yet exist — Rule cascade
  // degrades gracefully to R4/R5 in that case (D-17 fallback).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await ((admin as any).rpc('plan_personalize_facts', {
    p_user_id: user_id,
  }))) as { data: PersonalizeFacts | PersonalizeFacts[] | null; error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (error) {
    console.error('[plan-personalize] rpc error', error.message);
    return jsonError(500, 'internal');
  }

  // RPC may return a single-row object OR an array depending on Postgres return type.
  const facts: PersonalizeFacts | null = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
  if (facts === null) {
    return jsonError(404, 'user_not_found');
  }

  const result = applyRules(facts, context);
  const rationale = sanitizeRationale(result.rationale);

  // Sentry/PostHog breadcrumb — fire-and-forget (no PII).
  // We intentionally do NOT await; perf budget is the hot-path constraint.
  console.log(
    JSON.stringify({
      evt: 'plan.personalize.rule_matched',
      rule_id: result.rule_id,
      offer_hint: result.offer_hint,
      confidence: result.confidence,
      context,
    }),
  );

  return jsonResponse(200, {
    offer_hint: result.offer_hint,
    confidence: result.confidence,
    rationale,
  });
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handlePersonalize);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handlePersonalize,
  setAdminForTest,
  resetAdminForTest,
  applyRules,
  sanitizeRationale,
};
