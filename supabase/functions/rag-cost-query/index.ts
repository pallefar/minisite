/**
 * Phase 60 Plan 60-14 — rag-cost-query Edge Function.
 *
 *   POST /functions/v1/rag-cost-query   (admin-gated — Supabase JWT required)
 *   GET  /functions/v1/rag-cost-query/healthz
 *
 * Aggregates PostHog $ai_generation events into per-vendor MTD spend + 7-day
 * sparkline series for the RagCostPage cost dashboard.
 *
 * Security:
 *   - Auth: extract Supabase JWT from Authorization header; verify via admin
 *     client getUser(); then is_staff() check via profiles table (T-60-14-INFO-1)
 *   - Vendor allowlist: ALLOWED_VENDORS const — any out-of-list vendor → 400
 *     (T-60-14-SPOOF-1 defense-in-depth even though HogQL is parameterized)
 *   - PII strip: only { day, cost } columns from PostHog reach the browser
 *     (T-60-14-PII-1 mitigation)
 *
 * PostHog Query API:
 *   POST https://app.posthog.com/api/projects/<id>/query/
 *   Auth: Bearer POSTHOG_PERSONAL_API_KEY (vault-stored, scope query:read)
 *   HogQL parameterized — no injection risk via vendor param (server-side allowlist
 *   is defense-in-depth)
 *
 * Deployment: NOT deployed in this plan — 60-15 BLOCKING owns all Fn deploys
 * per [[feedback_fn_deploy_before_cron_db_push]].
 *
 * Test seam: `handle(req, stubAdmin, stubFetch)` — injected via 3rd/4th params.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { captureRagEvent } from '../_shared/posthog-server.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_VENDORS = [
  'firecrawl',
  'openai_embed',
  'anthropic_summarize',
  'cohere_rerank',
  'jina_rerank',
  'federated_fetch',
] as const;

type Vendor = typeof ALLOWED_VENDORS[number];

const TRACE_ROLLUP_MAP: Record<string, { label: string; prefix: string }> = {
  coach_synthesis: {
    label: 'coach_synthesis_per_day',
    prefix: 'coach_query_',
  },
  tip_of_day: {
    label: 'tip_of_day_per_day',
    prefix: 'tip_of_day_cron_',
  },
  newsletter: {
    label: 'newsletter_per_week',
    prefix: 'newsletter_cron_',
  },
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, error: string): Response {
  return jsonResponse({ error }, status);
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Lazy admin singleton (injectable for tests)
// ---------------------------------------------------------------------------

const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

// ---------------------------------------------------------------------------
// PostHog HogQL helpers
// ---------------------------------------------------------------------------

function buildVendorQuery(vendor: string, rangeDays: number): string {
  return `
SELECT toDate(timestamp) as day, sum(toFloat(coalesce(properties.$ai_generation_usage_total_cost, '0'))) as cost
FROM events
WHERE event = '$ai_generation'
  AND properties.vendor = {vendor:String}
  AND timestamp >= now() - INTERVAL {days:Int64} DAY
GROUP BY day
ORDER BY day
`.trim();
}

function buildTraceQuery(tracePrefix: string, rangeDays: number): string {
  return `
SELECT toDate(timestamp) as day, sum(toFloat(coalesce(properties.$ai_generation_usage_total_cost, '0'))) as cost
FROM events
WHERE event = '$ai_generation'
  AND startsWith(properties.trace_id, {prefix:String})
  AND timestamp >= now() - INTERVAL {days:Int64} DAY
GROUP BY day
ORDER BY day
`.trim();
}

async function queryPostHog(
  query: string,
  values: Record<string, string | number>,
  fetchFn: typeof fetch,
): Promise<{ results: Array<[string, string]>; columns: string[]; status: number }> {
  const apiKey = Deno.env.get('POSTHOG_PERSONAL_API_KEY') ?? '';
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID') ?? '';
  const url = `https://app.posthog.com/api/projects/${projectId}/query/`;

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: { kind: 'HogQLQuery', query, values },
    }),
  });

  const status = res.status;
  if (status !== 200) {
    return { results: [], columns: [], status };
  }

  const json = await res.json() as { results: Array<[string, string]>; columns: string[] };
  return { results: json.results ?? [], columns: json.columns ?? [], status: 200 };
}

/**
 * Aggregate PostHog results into MTD total + 7-day sparkline.
 * T-60-14-PII-1: only day + cost columns are used — any extra columns (user_id etc.)
 * are ignored by positional index access, never forwarded to caller.
 */
function aggregateResults(
  results: Array<[string, string]>,
  rangeDays: number,
): { mtd_usd: number; sparkline_7d: number[]; last_day_with_data: string | null } {
  let mtd_usd = 0;
  let last_day_with_data: string | null = null;

  // Build a day → cost map using only columns[0] (day) and columns[1] (cost)
  // Extra columns at index 2+ are deliberately ignored (T-60-14-PII-1)
  const dayMap = new Map<string, number>();
  for (const row of results) {
    const day = row[0];  // positional — col 0 = day
    const costStr = row[1]; // positional — col 1 = cost; extra cols ignored
    if (!day || costStr === undefined) continue;
    const cost = parseFloat(costStr) || 0;
    dayMap.set(day, (dayMap.get(day) ?? 0) + cost);
    mtd_usd += cost;
    if (!last_day_with_data || day > last_day_with_data) {
      last_day_with_data = day;
    }
  }

  // Build 7-day sparkline (last 7 days; right-padded with 0 if fewer days with data)
  const sparkline_7d: number[] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    sparkline_7d.push(dayMap.get(key) ?? 0);
  }

  return { mtd_usd: Math.round(mtd_usd * 100) / 100, sparkline_7d, last_day_with_data };
}

// ---------------------------------------------------------------------------
// Core handler (exported for test injection)
// ---------------------------------------------------------------------------

export async function handle(
  req: Request,
  adminOverride?: SupabaseClient,
  fetchOverride?: typeof fetch,
): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Health check
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return jsonResponse({ ok: true });
  }

  const admin = adminOverride ?? getAdmin();
  const fetchFn = fetchOverride ?? fetch;

  // ---------------------------------------------------------------------------
  // Auth: extract + verify JWT
  // ---------------------------------------------------------------------------
  const bearer = extractBearer(req);
  if (!bearer) {
    return jsonError(401, 'unauthorized');
  }

  // Verify JWT via admin client getUser
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userData, error: userErr } = await (admin as any).auth.getUser(bearer) as {
    data: { user: { id: string } | null };
    error: { message: string } | null;
  };
  if (userErr || !userData?.user) {
    return jsonError(401, 'unauthorized');
  }
  const callerId = userData.user.id;

  // is_staff check via profiles table (T-60-14-INFO-1 mitigation)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile, error: profileErr } = await (admin as any)
    .from('profiles')
    .select('is_staff')
    .eq('id', callerId)
    .single() as { data: { is_staff?: boolean } | null; error: unknown };

  if (profileErr || !profile?.is_staff) {
    return jsonError(403, 'forbidden');
  }

  // ---------------------------------------------------------------------------
  // Parse request body
  // ---------------------------------------------------------------------------
  let body: {
    vendors?: string[];
    traceRollups?: string[];
    rangeDays?: number;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const rangeDays = Math.min(Math.max(body.rangeDays ?? 30, 1), 90);
  const requestedVendors = body.vendors ?? [];
  const requestedTraceRollups = body.traceRollups ?? [];

  // ---------------------------------------------------------------------------
  // Validate vendor allowlist (T-60-14-SPOOF-1 mitigation)
  // ---------------------------------------------------------------------------
  for (const v of requestedVendors) {
    if (!(ALLOWED_VENDORS as readonly string[]).includes(v)) {
      return jsonError(400, 'invalid_vendor');
    }
  }

  // ---------------------------------------------------------------------------
  // Query PostHog for each requested vendor and trace rollup
  // ---------------------------------------------------------------------------
  const results: Array<{
    vendor: string;
    mtd_usd: number;
    sparkline_7d: number[];
    last_day_with_data: string | null;
  }> = [];

  // Vendor queries
  for (const vendor of requestedVendors as Vendor[]) {
    const query = buildVendorQuery(vendor, rangeDays);
    const { results: rows, status } = await queryPostHog(
      query,
      { vendor, days: rangeDays },
      fetchFn,
    );
    if (status === 429) {
      return jsonError(429, 'upstream_rate_limited');
    }
    if (status !== 200) {
      return jsonError(502, 'upstream_error');
    }
    const agg = aggregateResults(rows as Array<[string, string]>, rangeDays);
    results.push({ vendor, ...agg });
  }

  // Trace rollup queries
  for (const rollup of requestedTraceRollups) {
    const rollupConfig = TRACE_ROLLUP_MAP[rollup];
    if (!rollupConfig) continue;
    const query = buildTraceQuery(rollupConfig.prefix, rangeDays);
    const { results: rows, status } = await queryPostHog(
      query,
      { prefix: rollupConfig.prefix, days: rangeDays },
      fetchFn,
    );
    if (status === 429) {
      return jsonError(429, 'upstream_rate_limited');
    }
    if (status !== 200) {
      return jsonError(502, 'upstream_error');
    }
    const agg = aggregateResults(rows as Array<[string, string]>, rangeDays);
    results.push({ vendor: rollupConfig.label, ...agg });
  }

  // ---------------------------------------------------------------------------
  // Audit event (fire-and-forget — do NOT await)
  // ---------------------------------------------------------------------------
  void captureRagEvent('admin', 'rag_cost_query_executed', {
    actor_id: callerId,
    range_days: rangeDays,
    vendor_count: requestedVendors.length + requestedTraceRollups.length,
  });

  return jsonResponse({ results });
}

// ---------------------------------------------------------------------------
// Deno.serve entry point — guarded by import.meta.main to avoid triggering
// a live HTTP server on `deno test` import ([[reference_deno_test_top_level_serve_trap]])
// ---------------------------------------------------------------------------

if (import.meta.main) {
  Deno.serve(handle);
}
