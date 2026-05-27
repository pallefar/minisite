/**
 * Phase 67 Plan 67-02 (OPS-02) — k6 baseline load-test scenario.
 *
 * Establishes the steady-state production-traffic baseline against five
 * public endpoints. Captures p50/p95/p99 latency + error rate so the
 * 10×/100× scenarios in ddos-10x.js / ddos-100x.js have something to
 * compare against.
 *
 * Targets (weighted to mirror expected production traffic mix):
 *   - /api/og/*                                       (40%)  static-ish OG render
 *   - /api/lead-capture                               (10%)  POST form
 *   - /api/affiliate-impression                       (15%)  GET pixel
 *   - /functions/v1/traffic-attribution-recorder      (20%)  POST attribution
 *   - /functions/v1/page-render                       (15%)  GET SSR render
 *
 * Usage (operator runs against staging — DO NOT run from autonomous session):
 *   k6 run scripts/k6/ddos-baseline.js \
 *     --env BASE_URL=https://staging.leanshot.app \
 *     --env SUPABASE_URL=https://ytnsipxxmzgaebkqmokp.supabase.co \
 *     --env SUPABASE_ANON_KEY=<anon-key> \
 *     --out json=baseline-results.json
 *
 * Dry-run validation (no real traffic):
 *   k6 inspect scripts/k6/ddos-baseline.js
 *
 * Thresholds (FAIL if violated — baseline must be healthy):
 *   - http_req_duration p95 < 500ms
 *   - http_req_failed   rate < 1%
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Operator-supplied via --env. No hard-coded prod URLs.
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5173';
const SUPABASE_URL = __ENV.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';

// Sample OG payloads — keep small + deterministic so the cache-hit ratio
// across VUs is representative of real traffic (not 100% cache-miss).
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
      vus: 2,
      duration: '60s',
      exec: 'hitOg',
      tags: { endpoint: 'og' },
    },
    lead_capture: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
      exec: 'hitLeadCapture',
      tags: { endpoint: 'lead-capture' },
    },
    affiliate_impression: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
      exec: 'hitAffiliateImpression',
      tags: { endpoint: 'affiliate-impression' },
    },
    traffic_attribution: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
      exec: 'hitTrafficAttribution',
      tags: { endpoint: 'traffic-attribution' },
    },
    page_render: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
      exec: 'hitPageRender',
      tags: { endpoint: 'page-render' },
    },
  },
  thresholds: {
    'http_req_duration{endpoint:og}': ['p(95)<500'],
    'http_req_duration{endpoint:lead-capture}': ['p(95)<500'],
    'http_req_duration{endpoint:affiliate-impression}': ['p(95)<500'],
    'http_req_duration{endpoint:traffic-attribution}': ['p(95)<500'],
    'http_req_duration{endpoint:page-render}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function hitOg() {
  const slug = OG_SLUGS[Math.floor(Math.random() * OG_SLUGS.length)];
  const res = http.get(`${BASE_URL}/api/og/${slug}`);
  check(res, { 'og 200': (r) => r.status === 200 });
  sleep(1);
}

export function hitLeadCapture() {
  const payload = JSON.stringify({
    email: `k6-baseline-${__VU}-${__ITER}@k6.test`,
    source: 'k6-baseline',
  });
  const res = http.post(`${BASE_URL}/api/lead-capture`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'lead-capture 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(2);
}

export function hitAffiliateImpression() {
  const res = http.get(
    `${BASE_URL}/api/affiliate-impression?code=k6-baseline&campaign=k6`,
  );
  check(res, { 'affiliate 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(2);
}

export function hitTrafficAttribution() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Skip when env not set (dry-run / inspect mode).
    return;
  }
  const payload = JSON.stringify({
    anon_id: `k6-vu-${__VU}-${__ITER}`,
    landing_path: '/',
    referrer: 'k6-baseline',
  });
  const res = http.post(
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
  check(res, { 'attribution 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(2);
}

export function hitPageRender() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return;
  }
  const slug = PAGE_SLUGS[Math.floor(Math.random() * PAGE_SLUGS.length)];
  const res = http.get(
    `${SUPABASE_URL}/functions/v1/page-render?slug=${slug}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );
  check(res, { 'page-render 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(3);
}
