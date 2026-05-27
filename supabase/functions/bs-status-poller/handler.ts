/**
 * bs-status-poller — handler.ts
 *
 * Phase 67 Plan 67-04 (OPS-10) — Better Stack status-page polling.
 *
 * === Behavior ===
 * 1. Poll 3 upstream status APIs (Sentry / Supabase / Vercel) via Statuspage.io
 *    v2 schema (status.indicator: none | minor | major | critical).
 * 2. For each vendor whose indicator != 'none', POST an incident to
 *    Better Stack uptime.betterstack.com /api/v2/incidents.
 * 3. Dedupe-per-call: Better Stack's incident table handles ongoing-incident
 *    merge via summary uniqueness; this poller emits one incident per
 *    (vendor, indicator) per invocation. pg_cron at 5-min interval keeps
 *    incident counts manageable.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: 'bs-status-poller' }
 * POST / → service-role bearer required → run one poll cycle
 *
 * === Auth ===
 * Service-role bearer (constant-time compare). GET /healthz is exempt.
 *
 * === Runtime guards ===
 * - BETTER_STACK_API_KEY missing or placeholder ([…], TODO, REPLACE_ME) →
 *   503 + Slack P1 alert (per [[feedback_placeholder_string_runtime_guard_pattern]]).
 *
 * === Test seam ===
 * Deps injection lets tests mock fetch + bearer in-process. index.ts builds
 * production deps from env. Deno.serve is gated by import.meta.main in index.ts.
 */

import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StatusIndicator = 'none' | 'minor' | 'major' | 'critical';

export interface VendorStatusEndpoint {
  vendor: string;
  url: string;
}

export interface VendorStatusResult {
  vendor: string;
  indicator: StatusIndicator;
  description: string;
  raw_status_code: number;
}

export interface IncidentCreatedResult {
  vendor: string;
  indicator: StatusIndicator;
  incident_id: string | null;
  ok: boolean;
}

export interface BsStatusPollerDeps {
  /** Fetch implementation (allows mocking in tests). */
  fetchImpl: typeof fetch;
  /** Service-role key for bearer auth check. */
  serviceRoleKey: string;
  /** Better Stack uptime API key — 'REPLACE_ME' or empty triggers 503 guard. */
  betterStackApiKey: string;
  /** Email to set as `requester_email` on Better Stack incidents. */
  requesterEmail: string;
  /** Override list of upstream endpoints (defaults to Sentry/Supabase/Vercel). */
  endpoints?: VendorStatusEndpoint[];
}

// Default endpoints (Statuspage.io v2 summary shape).
export const DEFAULT_ENDPOINTS: VendorStatusEndpoint[] = [
  { vendor: 'Sentry', url: 'https://status.sentry.io/api/v2/status.json' },
  { vendor: 'Supabase', url: 'https://status.supabase.com/api/v2/status.json' },
  { vendor: 'Vercel', url: 'https://www.vercel-status.com/api/v2/status.json' },
];

const VALID_INDICATORS: ReadonlySet<StatusIndicator> = new Set([
  'none',
  'minor',
  'major',
  'critical',
]);

// ─── Constant-time bearer compare ────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Placeholder guard ──────────────────────────────────────────────────────

function isPlaceholder(val: string | undefined | null): boolean {
  if (!val) return true;
  return /\[|TODO|REPLACE_ME/i.test(val);
}

// ─── Upstream poll ──────────────────────────────────────────────────────────

async function pollVendor(
  fetchImpl: typeof fetch,
  endpoint: VendorStatusEndpoint,
): Promise<VendorStatusResult> {
  try {
    const res = await fetchImpl(endpoint.url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {
        vendor: endpoint.vendor,
        // Treat upstream-fetch failure as 'minor' so it surfaces as an incident
        // but does not page on-call (major/critical).
        indicator: 'minor',
        description: `Status fetch failed: HTTP ${res.status}`,
        raw_status_code: res.status,
      };
    }

    const body = (await res.json()) as {
      status?: { indicator?: string; description?: string };
    };
    const rawIndicator = body?.status?.indicator ?? 'none';
    const indicator = (VALID_INDICATORS.has(rawIndicator as StatusIndicator)
      ? rawIndicator
      : 'minor') as StatusIndicator;
    const description = body?.status?.description ?? '';

    return {
      vendor: endpoint.vendor,
      indicator,
      description,
      raw_status_code: res.status,
    };
  } catch (err) {
    console.warn(
      `[bs-status-poller] poll error for ${endpoint.vendor}:`,
      err instanceof Error ? err.message : err,
    );
    return {
      vendor: endpoint.vendor,
      indicator: 'minor',
      description: `Status fetch threw: ${err instanceof Error ? err.message : 'unknown'}`,
      raw_status_code: 0,
    };
  }
}

// ─── Better Stack incident create ───────────────────────────────────────────

async function createIncident(
  fetchImpl: typeof fetch,
  apiKey: string,
  requesterEmail: string,
  status: VendorStatusResult,
): Promise<IncidentCreatedResult> {
  const summary = `Upstream incident: ${status.vendor} — ${status.indicator}`;
  const description = status.description
    ? `${status.vendor} status indicator = ${status.indicator}. Upstream message: ${status.description}`
    : `${status.vendor} status indicator = ${status.indicator}.`;

  try {
    const res = await fetchImpl('https://uptime.betterstack.com/api/v2/incidents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary,
        description,
        requester_email: requesterEmail,
        call: false,
        sms: false,
        email: true,
        push: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
      console.warn(
        `[bs-status-poller] Better Stack POST failed status=${res.status} body=${body.slice(0, 200)}`,
      );
      return {
        vendor: status.vendor,
        indicator: status.indicator,
        incident_id: null,
        ok: false,
      };
    }

    let incidentId: string | null = null;
    try {
      const body = (await res.json()) as { data?: { id?: string } };
      incidentId = body?.data?.id ?? null;
    } catch {
      /* best-effort */
    }
    return {
      vendor: status.vendor,
      indicator: status.indicator,
      incident_id: incidentId,
      ok: true,
    };
  } catch (err) {
    console.warn(
      `[bs-status-poller] Better Stack POST threw for ${status.vendor}:`,
      err instanceof Error ? err.message : err,
    );
    return {
      vendor: status.vendor,
      indicator: status.indicator,
      incident_id: null,
      ok: false,
    };
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handle(
  req: Request,
  deps?: Partial<BsStatusPollerDeps>,
): Promise<Response> {
  const url = new URL(req.url);

  // GET /healthz (exempt from auth)
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'bs-status-poller' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Bearer auth
  const serviceRoleKey =
    deps?.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';
  if (!serviceRoleKey || !constantTimeEqual(bearer, serviceRoleKey)) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Deps + env
  const betterStackApiKey =
    deps?.betterStackApiKey ?? Deno.env.get('BETTER_STACK_API_KEY') ?? '';
  const requesterEmail =
    deps?.requesterEmail ?? Deno.env.get('BETTER_STACK_REQUESTER_EMAIL') ?? '';
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const endpoints = deps?.endpoints ?? DEFAULT_ENDPOINTS;

  // Placeholder-string guard for BETTER_STACK_API_KEY.
  // Per [[feedback_placeholder_string_runtime_guard_pattern]]: never let a
  // literal [placeholder]/TODO/REPLACE_ME flow to a production HTTP call.
  if (isPlaceholder(betterStackApiKey)) {
    console.error(
      '[bs-status-poller] BLOCKED: BETTER_STACK_API_KEY missing or placeholder',
    );
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'bs-status-poller BLOCKED — BETTER_STACK_API_KEY not configured',
      text:
        'Set BETTER_STACK_API_KEY as a Supabase Function Secret before invoking. ' +
        'Status-page polling is disabled until configured.',
    }).catch(() => {});
    return new Response(
      JSON.stringify({ error: 'better_stack_api_key_not_configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!requesterEmail) {
    console.warn(
      '[bs-status-poller] BETTER_STACK_REQUESTER_EMAIL not set; defaulting to noreply@leanshot.app',
    );
  }
  const effectiveRequester = requesterEmail || 'noreply@leanshot.app';

  // Poll all vendors in parallel
  const statuses: VendorStatusResult[] = await Promise.all(
    endpoints.map((ep) => pollVendor(fetchImpl, ep)),
  );

  // For each vendor with indicator != 'none', create an incident
  const incidents: IncidentCreatedResult[] = [];
  for (const status of statuses) {
    if (status.indicator === 'none') continue;
    const result = await createIncident(
      fetchImpl,
      betterStackApiKey,
      effectiveRequester,
      status,
    );
    incidents.push(result);
  }

  return new Response(
    JSON.stringify({
      polled: statuses.length,
      incidents_created: incidents.filter((i) => i.ok).length,
      incidents_failed: incidents.filter((i) => !i.ok).length,
      statuses,
      incidents,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
