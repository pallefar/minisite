# Load-Test Baseline (k6 DDoS Scenarios)

**Phase:** 67-02 (OPS-02)
**Owner:** Operator (DevOps)
**Last updated:** _template — fill in after staging run_

## Purpose

Capture pre-launch latency + error-rate baselines for the five most-hit public
endpoints, plus 10× / 100× surge behavior so we know where the system breaks
before real users discover it.

## Scripts

| Script | VUs (total) | Duration | Threshold posture | Output |
|---|---|---|---|---|
| `scripts/k6/ddos-baseline.js` | 6 | 60s | **strict** — p95 < 500ms, error < 1% | summary text |
| `scripts/k6/ddos-10x.js` | 50 | 60s | **loose** — p95 < 2s, error < 5%; 429 OK | summary text |
| `scripts/k6/ddos-100x.js` | 500 | 60s | **captured-but-allowed** — p95 < 5s logged, never fails | JSON |

## How to run

Prerequisite: `k6` installed locally (`brew install k6` on macOS, or
[other install methods](https://k6.io/docs/getting-started/installation/)).

Get staging anon key:

```bash
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp
# Anon key is also the publishable_key in:
supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp
```

### Baseline (always run first)

```bash
k6 run scripts/k6/ddos-baseline.js \
  --env BASE_URL=https://staging.leanshot.app \
  --env SUPABASE_URL=https://ytnsipxxmzgaebkqmokp.supabase.co \
  --env SUPABASE_ANON_KEY=<staging-anon-key> \
  --summary-export=baseline-summary.json
```

Expected outcome: all thresholds **PASS**. If any fail at baseline, do not
proceed to 10× — fix the underlying perf issue first.

### 10× surge

```bash
k6 run scripts/k6/ddos-10x.js \
  --env BASE_URL=https://staging.leanshot.app \
  --env SUPABASE_URL=https://ytnsipxxmzgaebkqmokp.supabase.co \
  --env SUPABASE_ANON_KEY=<staging-anon-key> \
  --summary-export=10x-summary.json
```

Expected outcome: thresholds **PASS** with some 429s on `/api/lead-capture`,
`/api/og/*`, `/api/affiliate-impression` from middleware rate-limiter. 429s
on those routes are *expected behavior*, not failures.

### 100× breaking-point

```bash
# Coordinate with on-call before running — this WILL trip alerts.
k6 run scripts/k6/ddos-100x.js \
  --env BASE_URL=https://staging.leanshot.app \
  --env SUPABASE_URL=https://ytnsipxxmzgaebkqmokp.supabase.co \
  --env SUPABASE_ANON_KEY=<staging-anon-key> \
  --out json=100x-results.json
```

Expected outcome: at least one endpoint shows degradation (p95 > 5s, error
rate > 10%, or sustained 5xx). Identify the breaking point + capacity-add
required.

### Dry-run validation (no traffic)

```bash
k6 inspect scripts/k6/ddos-baseline.js
k6 inspect scripts/k6/ddos-10x.js
k6 inspect scripts/k6/ddos-100x.js
```

Confirms script syntax + scenario shape without firing any requests.

## Results — baseline

_Fill in after the first staging run._

| Endpoint | p50 | p95 | p99 | error rate | Notes |
|---|---|---|---|---|---|
| `/api/og/*` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/api/lead-capture` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/api/affiliate-impression` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/functions/v1/traffic-attribution-recorder` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/functions/v1/page-render` | _ms_ | _ms_ | _ms_ | _%_ | |

## Results — 10×

_Fill in after the first staging run._

| Endpoint | p50 | p95 | p99 | error rate | 429 rate | Notes |
|---|---|---|---|---|---|---|
| `/api/og/*` | _ms_ | _ms_ | _ms_ | _%_ | _%_ | |
| `/api/lead-capture` | _ms_ | _ms_ | _ms_ | _%_ | _%_ | |
| `/api/affiliate-impression` | _ms_ | _ms_ | _ms_ | _%_ | _%_ | |
| `/functions/v1/traffic-attribution-recorder` | _ms_ | _ms_ | _ms_ | _%_ | _%_ | |
| `/functions/v1/page-render` | _ms_ | _ms_ | _ms_ | _%_ | _%_ | |

## Results — 100×

_Fill in after the first staging run._

| Endpoint | p50 | p95 | p99 | error rate | Notes |
|---|---|---|---|---|---|
| `/api/og/*` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/api/lead-capture` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/api/affiliate-impression` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/functions/v1/traffic-attribution-recorder` | _ms_ | _ms_ | _ms_ | _%_ | |
| `/functions/v1/page-render` | _ms_ | _ms_ | _ms_ | _%_ | |

### Breaking point

_Document where the system started to degrade under 100×._

- **First endpoint to degrade:** _e.g. `/functions/v1/page-render` at VU 35 / ~7 RPS_
- **Limiting resource:** _e.g. Supabase Edge Fn cold-start cascade / DB connection pool / etc._
- **Symptom:** _e.g. 504 Gateway Timeout / 5xx error spike / p95 > 10s_

## If breaking point detected

1. Capture the JSON output (`100x-results.json`) in shared drive / GitHub
   release asset for record-keeping.
2. Open an incident — see `leanshot/.planning/runbooks/hbnr-incident-response.md`
   for incident-response workflow.
3. Identify capacity-add: usually one of:
   - **Edge Fn** → bump compute (Supabase paid tier) or refactor cold start
     (see `leanshot/.planning/runbooks/edge-fn-cold-starts.md` once available).
   - **DB** → bump connection pool, add read replica, or move offending query
     off the hot path.
   - **Vercel** → upgrade plan tier for Origin Shield, or move to Cloudflare
     in front of Vercel.
4. Re-run the offending scenario after fix; confirm threshold improvement.
5. Update the relevant Results table above with the new numbers + a "Fixed"
   note pointing at the remediation PR.

## Cadence

- **Pre-launch:** run all three scenarios once against staging. Record
  numbers above. Block launch if 100× reveals an immediate scaling cliff
  (p95 > 10s) on any path serving authenticated user requests.
- **Monthly:** re-run baseline + 10× against staging on the first Monday
  of each month. Diff the numbers vs the previous month's run — a >50%
  regression on any p95 column triggers an investigation.
- **Pre-release:** re-run baseline before each marketing campaign launch
  that's expected to drive >10× traffic (paid ad burst, podcast mention,
  influencer post).

## Cross-references

- Rate-limit policy: `leanshot/vercel.json` + `leanshot/middleware.ts`
  (Phase 67-02 OPS-03)
- Incident response: `leanshot/.planning/runbooks/hbnr-incident-response.md`
- Edge Fn cold-start data: `leanshot/.planning/runbooks/edge-fn-cold-starts.md`
  (Phase 67-08, OPS-09 — pending)
- Secrets rotation: `leanshot/.planning/runbooks/secrets-rotation.md`
  (Phase 67-01, OPS-01 — pending / sibling plan)
