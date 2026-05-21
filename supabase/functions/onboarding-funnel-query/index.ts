/**
 * Phase 34 Plan 34-09 ONBOARD-09 — `onboarding-funnel-query` Edge Function.
 *
 * Proxies two PostHog REST calls (browser cannot call PostHog directly because
 * the Personal API key MUST stay server-side per T-34-09-02):
 *
 *   POST { kind: 'step_funnel', flow_id: uuid, time_range_days: 1..90 }
 *     → HogQL Insights query against PostHog
 *     → returns { steps: [{ step_id, views, completions, drop_off_pct, avg_time_ms }] }
 *
 *   POST { kind: 'list_experiments' }
 *     → GET PostHog feature_flags?search=onboarding
 *     → returns { experiments: [{ id, key, name, current_rollout, variants }] }
 *
 * Auth: Bearer <user-jwt>. Caller must have profiles.admin_role IN
 * ('admin','superadmin').
 *
 * Vendor-gated startup health check (memory [[vendor-gated-send-via-health-check]]):
 * returns 503 BEFORE any outbound traffic when secrets are missing. Plan 34-10
 * owns the human checkpoint that sets the secrets.
 *
 * Cache (T-34-09-04 DoS mitigation):
 *   In-memory 60s TTL keyed by `${kind}:${flow_id ?? ''}:${time_range_days ?? ''}`.
 *   Prevents PostHog quota burn under 30s admin-tab polling.
 *
 * HogQL injection guard (T-34-09-03):
 *   `flow_id` is validated as RFC4122 UUID at the body-parse layer; the HogQL
 *   template then concatenates the validated string. Per design we accept the
 *   template-concat because the validator rejects everything except the
 *   8-4-4-4-12 hex shape.
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
// Lazy admin singleton + test override
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
// Vendor health check
// ============================================================================

function vendorHealthCheck(): Response | null {
  const apiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY');
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID');
  if (!apiKey || !projectId) {
    console.warn(
      '[onboarding-funnel-query] vendor_unconfigured: PostHog secrets missing — Plan 34-10 not yet run.',
    );
    return jsonResponse(503, { error: 'vendor_unconfigured', service: 'posthog' });
  }
  return null;
}

// ============================================================================
// Body validation (discriminated union)
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ParsedBody =
  | { kind: 'step_funnel'; flow_id: string; time_range_days: number }
  | { kind: 'list_experiments' };

function parseBody(raw: unknown): { ok: true; body: ParsedBody } | { ok: false; code: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'invalid_body' };
  const r = raw as Record<string, unknown>;
  if (r.kind === 'step_funnel') {
    if (typeof r.flow_id !== 'string' || !UUID_RE.test(r.flow_id)) {
      return { ok: false, code: 'invalid_body' };
    }
    if (typeof r.time_range_days !== 'number' || !Number.isFinite(r.time_range_days)) {
      return { ok: false, code: 'invalid_body' };
    }
    const days = Math.floor(r.time_range_days);
    if (days < 1 || days > 90) return { ok: false, code: 'invalid_body' };
    return { ok: true, body: { kind: 'step_funnel', flow_id: r.flow_id, time_range_days: days } };
  }
  if (r.kind === 'list_experiments') {
    return { ok: true, body: { kind: 'list_experiments' } };
  }
  return { ok: false, code: 'invalid_body' };
}

// ============================================================================
// In-memory cache (60s TTL)
// ============================================================================

interface CacheEntry {
  ts: number;
  payload: unknown;
}
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function cacheKeyFor(body: ParsedBody): string {
  if (body.kind === 'step_funnel') return `step_funnel:${body.flow_id}:${body.time_range_days}`;
  return 'list_experiments';
}

function clearCache(): void {
  CACHE.clear();
}

// ============================================================================
// PostHog calls
// ============================================================================

interface StepRow {
  step_id: string;
  views: number;
  completions: number;
  drop_off_pct: number;
  avg_time_ms: number;
}

async function callStepFunnel(
  flowId: string,
  days: number,
  apiKey: string,
  projectId: string,
): Promise<{ ok: true; steps: StepRow[] } | { ok: false; status: number }> {
  // HogQL — flowId is UUID-shape validated by parseBody; safe to concat.
  const hogQL = `
    SELECT
      properties.step_id AS step_id,
      countIf(event = 'onboarding.step.shown') AS views,
      countIf(event = 'onboarding.step.completed') AS completions,
      avg(toFloat(properties.time_on_step_ms)) AS avg_time_ms
    FROM events
    WHERE properties.flow_id = '${flowId}'
      AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY properties.step_id
    ORDER BY views DESC
  `;
  const url = `https://us.i.posthog.com/api/projects/${projectId}/query/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogQL } }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = (await res.json().catch(() => ({}))) as { results?: unknown[] };
  const rows = Array.isArray(json.results) ? json.results : [];
  const steps: StepRow[] = rows
    .filter((r): r is [string, number, number, number] =>
      Array.isArray(r) && r.length >= 4 && typeof r[0] === 'string',
    )
    .map(([step_id, views, completions, avg_time_ms]) => ({
      step_id,
      views: Number(views) || 0,
      completions: Number(completions) || 0,
      drop_off_pct: Number(views) > 0
        ? Math.round(((Number(views) - Number(completions)) / Number(views)) * 100)
        : 0,
      avg_time_ms: Math.round(Number(avg_time_ms) || 0),
    }));
  return { ok: true, steps };
}

interface Experiment {
  id: number;
  key: string;
  name: string;
  current_rollout: number;
  variants: string[];
}

async function callListExperiments(
  apiKey: string,
  projectId: string,
): Promise<{ ok: true; experiments: Experiment[] } | { ok: false; status: number }> {
  const url = `https://us.i.posthog.com/api/projects/${projectId}/feature_flags/?search=onboarding`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = (await res.json().catch(() => ({}))) as {
    results?: Array<{
      id?: number;
      key?: string;
      name?: string;
      rollout_percentage?: number;
      filters?: { multivariate?: { variants?: Array<{ key?: string }> } };
    }>;
  };
  const rows = Array.isArray(json.results) ? json.results : [];
  const experiments: Experiment[] = rows
    .filter((r) => typeof r.id === 'number' && typeof r.key === 'string')
    .map((r) => ({
      id: r.id as number,
      key: r.key as string,
      name: r.name ?? r.key ?? '',
      current_rollout: typeof r.rollout_percentage === 'number' ? r.rollout_percentage : 0,
      variants: Array.isArray(r.filters?.multivariate?.variants)
        ? r.filters!.multivariate!.variants!
            .map((v) => v.key)
            .filter((k): k is string => typeof k === 'string')
        : [],
    }));
  return { ok: true, experiments };
}

// ============================================================================
// Core handler
// ============================================================================

async function handleFunnelQuery(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  // Vendor health check — short-circuit before any outbound traffic.
  const health = vendorHealthCheck();
  if (health) return health;

  // Bearer JWT.
  const bearer = jwtFromReq(req);
  if (!bearer) return jsonError(401, 'unauthenticated');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(bearer))) as {
    data: { user?: { id?: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
  const callerUid = userData.user.id;

  // admin-or-higher gate.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: prof } = (await ((admin as any)
    .from('profiles')
    .select('admin_role')
    .eq('id', callerUid)
    .maybeSingle())) as { data: { admin_role?: string } | null; error: unknown };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const role = prof?.admin_role;
  if (role !== 'admin' && role !== 'superadmin') {
    return jsonError(403, 'forbidden');
  }

  // Body validation.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) return jsonError(400, parsed.code);

  // Cache lookup.
  const cacheKey = cacheKeyFor(parsed.body);
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return jsonResponse(200, cached.payload);
  }

  // Dispatch.
  const apiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY') ?? '';
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID') ?? '';

  if (parsed.body.kind === 'step_funnel') {
    const result = await callStepFunnel(
      parsed.body.flow_id,
      parsed.body.time_range_days,
      apiKey,
      projectId,
    );
    if (!result.ok) return jsonError(502, 'posthog_query_failed');
    const payload = { steps: result.steps };
    CACHE.set(cacheKey, { ts: Date.now(), payload });
    return jsonResponse(200, payload);
  }

  // list_experiments branch.
  const result = await callListExperiments(apiKey, projectId);
  if (!result.ok) return jsonError(502, 'posthog_query_failed');
  const payload = { experiments: result.experiments };
  CACHE.set(cacheKey, { ts: Date.now(), payload });
  return jsonResponse(200, payload);
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleFunnelQuery);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleFunnelQuery,
  setAdminForTest,
  resetAdminForTest,
  clearCache,
  parseBody,
  vendorHealthCheck,
};
