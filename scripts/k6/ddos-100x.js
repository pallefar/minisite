/**
 * Phase 67 Plan 67-02 (OPS-02) — k6 100× breaking-point scenario.
 *
 * 100× the steady-state baseline VU load. Designed to FIND the breaking
 * point (DB pool exhaustion, Edge Fn cold-start cascade, Vercel CDN
 * origin shield saturation, etc.) so we know where to add capacity
 * before launch.
 *
 * Targets: same 5 endpoints as ddos-baseline.js.
 *
 * Usage (operator runs against staging — NEVER against prod):
 *   k6 run scripts/k6/ddos-100x.js \
 *     --env BASE_URL=https://staging.leanshot.app \
 *     --env SUPABASE_URL=https://ytnsipxxmzgaebkqmokp.supabase.co \
 *     --env SUPABASE_ANON_KEY=<anon-key> \
 *     --out json=100x-results.json
 *
 * Thresholds: NONE. This scenario is exploratory — k6 emits metrics to
 * --out json= but does not fail. Operator analyzes the JSON output to
 * locate the breaking point and records findings in
 * `leanshot/.planning/runbooks/load-test-baseline.md`.
 *
 * SAFETY:
 *   - DO NOT RUN AGAINST PRODUCTION.
 *   - Confirm staging Supabase project ref before launch:
 *     `echo $SUPABASE_URL | grep staging`
 *   - This scenario WILL likely trip our PostHog DDoS alerts; coordinate
 *     with on-call before running.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5173';
const SUPABASE_URL = __ENV.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';

// Hard-stop safety: refuse to run against any URL containing "leanshot.app"
// without an explicit OVERRIDE flag. Forces operator to consciously target
// staging-only.
if (
  BASE_URL.includes('leanshot.app') &&
  !BASE_URL.includes('staging') &&
  __ENV.ALLOW_PROD !== 'true'
) {
  throw new Error(
    'ddos-100x.js: refusing to run against production. ' +
      'Set BASE_URL to staging or pass --env ALLOW_PROD=true to override.',
  );
}

const OG_SLUGS = new SharedArray('og_slugs', () => [
  'level-up?token=k6-sample-1',
  'level-up?token=k6-sample-2',
  'level-up?token=k6-sample-3',
]);

const PAGE_SLUGS = new SharedArray('page_slugs', () => [
  'glp-1-injection-site-rotation',
  'semaglutide-week-1-side-effects',
  'tirzepatide-vs-semaglutide',
]);

export const options = {
  scenarios: {
    og_render: {
      executor: 'constant-vus',
      vus: 200,
      duration: '60s',
      exec: 'hitOg',
      tags: { endpoint: 'og' },
    },
    lead_capture: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
      exec: 'hitLeadCapture',
      tags: { endpoint: 'lead-capture' },
    },
    affiliate_impression: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
      exec: 'hitAffiliateImpression',
      tags: { endpoint: 'affiliate-impression' },
    },
    traffic_attribution: {
      executor: 'constant-vus',
      vus: 50,
      duration: '60s',
      exec: 'hitTrafficAttribution',
      tags: { endpoint: 'traffic-attribution' },
    },
    page_render: {
      executor: 'constant-vus',
      vus: 50,
      duration: '60s',
      exec: 'hitPageRender',
      tags: { endpoint: 'page-render' },
    },
  },
  // Thresholds captured-but-allowed — k6 records them in the summary so the
  // operator can SEE how badly they were violated, but the run never "fails".
  thresholds: {
    'http_req_duration{endpoint:og}': [
      { threshold: 'p(95)<5000', abortOnFail: false },
    ],
    'http_req_duration{endpoint:lead-capture}': [
      { threshold: 'p(95)<5000', abortOnFail: false },
    ],
    'http_req_duration{endpoint:affiliate-impression}': [
      { threshold: 'p(95)<5000', abortOnFail: false },
    ],
    'http_req_duration{endpoint:traffic-attribution}': [
      { threshold: 'p(95)<5000', abortOnFail: false },
    ],
    'http_req_duration{endpoint:page-render}': [
      { threshold: 'p(95)<5000', abortOnFail: false },
    ],
  },
};

export function hitOg() {
  const slug = OG_SLUGS[Math.floor(Math.random() * OG_SLUGS.length)];
  http.get(`${BASE_URL}/api/og/${slug}`);
  // No sleep — saturate.
}

export function hitLeadCapture() {
  const payload = JSON.stringify({
    email: `k6-100x-${__VU}-${__ITER}@k6.test`,
    source: 'k6-100x',
  });
  http.post(`${BASE_URL}/api/lead-capture`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  sleep(0.1);
}

export function hitAffiliateImpression() {
  http.get(`${BASE_URL}/api/affiliate-impression?code=k6-100x&campaign=k6`);
  sleep(0.1);
}

export function hitTrafficAttribution() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  const payload = JSON.stringify({
    anon_id: `k6-vu-${__VU}-${__ITER}`,
    landing_path: '/',
    referrer: 'k6-100x',
  });
  http.post(
    `${SUPABASE_URL}/functions/v1/traffic-attribution-recorder`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );
  sleep(0.2);
}

export function hitPageRender() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  const slug = PAGE_SLUGS[Math.floor(Math.random() * PAGE_SLUGS.length)];
  http.get(`${SUPABASE_URL}/functions/v1/page-render?slug=${slug}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  sleep(0.3);
}

export function handleSummary(data) {
  // Emit the full JSON summary for offline analysis. The CLI default text
  // summary still prints to stdout (return key 'stdout' is omitted to
  // preserve the default).
  return {
    'stdout': textSummary(data),
    [`./100x-summary-${Date.now()}.json`]: JSON.stringify(data, null, 2),
  };
}

// Minimal text summary helper — avoids depending on k6's
// `index.js` exported textSummary which may not exist in older k6 builds.
function textSummary(data) {
  const m = data.metrics;
  const dur = m.http_req_duration?.values ?? {};
  const failed = m.http_req_failed?.values ?? {};
  return [
    '\n=== ddos-100x summary ===',
    `iterations: ${m.iterations?.values?.count ?? 'n/a'}`,
    `http_req_duration p50/p95/p99: ${dur['med']?.toFixed(0)}ms / ${dur['p(95)']?.toFixed(0)}ms / ${dur['p(99)']?.toFixed(0)}ms`,
    `http_req_failed rate: ${(failed.rate * 100)?.toFixed(2)}%`,
    `vus_max: ${m.vus_max?.values?.value ?? 'n/a'}`,
    'See JSON output for per-endpoint breakdown.',
    '',
  ].join('\n');
}
