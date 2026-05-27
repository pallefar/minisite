/**
 * Phase 67 Plan 67-02 (OPS-02) — k6 10× load scenario.
 *
 * 10× the steady-state baseline VU load. Confirms the system can
 * absorb a moderate traffic surge (viral post, paid campaign spike,
 * crawler burst) without dropping requests or breaching SLO.
 *
 * Targets: same 5 endpoints as ddos-baseline.js.
 *
 * Usage (operator runs against staging):
 *   k6 run scripts/k6/ddos-10x.js \
 *     --env BASE_URL=https://staging.leanshot.app \
 *     --env SUPABASE_URL=https://ytnsipxxmzgaebkqmokp.supabase.co \
 *     --env SUPABASE_ANON_KEY=<anon-key> \
 *     --out json=10x-results.json
 *
 * Thresholds (loosened from baseline — surge is allowed to be slower):
 *   - http_req_duration p95 < 2000ms
 *   - http_req_failed   rate < 5%
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5173';
const SUPABASE_URL = __ENV.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';

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
      vus: 20,
      duration: '60s',
      exec: 'hitOg',
      tags: { endpoint: 'og' },
    },
    lead_capture: {
      executor: 'constant-vus',
      vus: 10,
      duration: '60s',
      exec: 'hitLeadCapture',
      tags: { endpoint: 'lead-capture' },
    },
    affiliate_impression: {
      executor: 'constant-vus',
      vus: 10,
      duration: '60s',
      exec: 'hitAffiliateImpression',
      tags: { endpoint: 'affiliate-impression' },
    },
    traffic_attribution: {
      executor: 'constant-vus',
      vus: 5,
      duration: '60s',
      exec: 'hitTrafficAttribution',
      tags: { endpoint: 'traffic-attribution' },
    },
    page_render: {
      executor: 'constant-vus',
      vus: 5,
      duration: '60s',
      exec: 'hitPageRender',
      tags: { endpoint: 'page-render' },
    },
  },
  thresholds: {
    'http_req_duration{endpoint:og}': ['p(95)<2000'],
    'http_req_duration{endpoint:lead-capture}': ['p(95)<2000'],
    'http_req_duration{endpoint:affiliate-impression}': ['p(95)<2000'],
    'http_req_duration{endpoint:traffic-attribution}': ['p(95)<2000'],
    'http_req_duration{endpoint:page-render}': ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

export function hitOg() {
  const slug = OG_SLUGS[Math.floor(Math.random() * OG_SLUGS.length)];
  const res = http.get(`${BASE_URL}/api/og/${slug}`);
  // 429 (rate-limit) is acceptable under 10× — that's the rate-limiter working.
  check(res, {
    'og 2xx or 429': (r) => (r.status >= 200 && r.status < 300) || r.status === 429,
  });
  sleep(0.5);
}

export function hitLeadCapture() {
  const payload = JSON.stringify({
    email: `k6-10x-${__VU}-${__ITER}@k6.test`,
    source: 'k6-10x',
  });
  const res = http.post(`${BASE_URL}/api/lead-capture`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, {
    'lead-capture 2xx or 429': (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 429,
  });
  sleep(1);
}

export function hitAffiliateImpression() {
  const res = http.get(
    `${BASE_URL}/api/affiliate-impression?code=k6-10x&campaign=k6`,
  );
  check(res, {
    'affiliate 2xx or 429': (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 429,
  });
  sleep(1);
}

export function hitTrafficAttribution() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  const payload = JSON.stringify({
    anon_id: `k6-vu-${__VU}-${__ITER}`,
    landing_path: '/',
    referrer: 'k6-10x',
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
  check(res, {
    'attribution 2xx or 429': (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 429,
  });
  sleep(1);
}

export function hitPageRender() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
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
  check(res, {
    'page-render 2xx or 429': (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 429,
  });
  sleep(1.5);
}
