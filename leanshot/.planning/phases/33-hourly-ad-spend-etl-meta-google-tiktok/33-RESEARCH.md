---
phase: 33
phase_name: "Hourly Ad-Spend ETL (Meta + Google + TikTok)"
status: researched
researched: 2026-05-18
---

# Phase 33: Hourly Ad-Spend ETL (Meta + Google + TikTok) — Research

**Researched:** 2026-05-18
**Domain:** Ad-network ETL, Meta Marketing API, Google Ads API, TikTok Business API, Meta CAPI, ECB FX, PostgreSQL partitions, materialized views
**Confidence:** MEDIUM-HIGH — Meta and Google APIs verified via Context7; TikTok API structure verified via SDK docs + web search; ECB API URL verified; some TikTok rate-limit specifics remain LOW

---

## Summary

Phase 33 adds six new Edge Functions (three hourly ad-spend ETL crons, one Meta CAPI relay, one daily CAC alert cron, one daily ECB FX cron), seven new Postgres tables (partitioned `ad_spend_facts`, `ad_network_config`, `fx_rates`, `ad_etl_health`, `ad_etl_gaps`, `growth_targets`, `cac_alerts`), one materialized view (`ad_revenue_normalized`), AEM priority register fields on `EventDef`, an ESLint rule extension, and a CAC admin module. All locked decisions are in 33-CONTEXT.md; this document covers the API-level and implementation specifics the planner needs.

The most critical planning risk is Meta App Review's 2-4 week lead time (D-01 already addresses this with vendor-gated health checks). The most complex integration is Meta CAPI relay, which requires event_id coordination with a browser-side pixel that is out-of-scope for Phase 33. TikTok's API is the most fragile of the three networks — hand-rolled fetch with aggressive retry/backoff is the correct posture (confirmed by PITFALLS V13-5 and CONTEXT D-03). The ECB FX endpoint is public, free, and XML-only; the ETL must parse XML and handle weekend/holiday gaps with a "last known rate + NULL spend_usd" fallback.

**Primary recommendation:** Each ETL function should be a thin, vendor-gated fetch wrapper modeled on `funnel-anomaly-cron`. Use no SDK for TikTok (hand-rolled fetch). For Meta and Google, use direct `fetch()` to the Graph API REST and Google Ads REST endpoints rather than attempting to import the Node.js SDKs into Deno via `npm:` — those SDKs carry significant Node-isms that break in Deno isolates (fs, http modules). The ECB daily XML endpoint is the canonical FX source.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** — Vendor-gated health-check for all 3 ETL Edge Fns (Pattern S4). ETL functions boot with `if (!credentials) { logWarning(); writeHealthRow({credentials_present: false}); return ok }`.
- **D-02** — `ad_etl_health` table (one row per network): `last_success_at`, `credentials_present`, `last_error`, `last_attempt_at`. Admin CAC module renders credential-missing / last-sync-failed badges.
- **D-03** — Credentials in Function Secrets: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`. Single ad account per network for v1.3.
- **D-04** — Meta + Google re-sync last 72h on each hourly tick. TikTok re-syncs last 168h. `INSERT ... ON CONFLICT (network, ad_account_id, ad_id, hour_bucket) DO UPDATE`.
- **D-05** — `aem_priority?: 1|2|3|4|5|6|7|8` + `aem_dropped?: true` added as optional fields on `EventDef` in `src/lib/analytics/events.ts`.
- **D-06** — Planner picks initial top-8 from REQs + funnel analysis; reviewed in plan-checker iter-1.
- **D-07** — New Edge Function `meta-capi-relay` reads `events_mirror` rows for AEM events, posts to Meta CAPI, dedupes via `event_id`. Schedule: every 5 min.
- **D-08** — PHI guardrail: import-zone (`import-x/no-restricted-paths`) + runtime `if (eventDef.phi) throw` + ESLint rule extension blocking `aem_priority` on `phi: true` events.
- **D-09** — `ad_network_config` table: `(meta, 7d, click)`, `(google, 30d, click)`, `(tiktok, 7d, click)` as seeds. Admin UPDATE for override.
- **D-10** — `ad_revenue_normalized` is a MATERIALIZED VIEW. Hourly CONCURRENTLY refresh via pg_cron after ETL completion. Requires unique index on (network, ad_account_id, ad_id, spend_date).
- **D-11** — FX normalized at ETL time. `spend_usd_at_spend_date` stored on facts. Missing fx_rates row → NULL + gap flag.
- **D-12** — Gap-detection cron writes `ad_etl_gaps`. Admin "Backfill" button POSTs to ETL Edge Fn with `?backfill_date=&backfill_window=24h`. Human-in-the-loop.
- **D-13** — `growth_targets` table. Seeded with placeholder `(source='all', target_ltv_usd=200, cac_multiplier=0.5)`. Flagged in plan-checker iter-1.
- **D-14** — `cac-alert-cron` reuses funnel-anomaly admin notification + emits `cac_target_breached` via `captureServer()`.
- **D-15** — Alert cadence: daily 00:30 UTC. Dedup keyed on `(source, date)` via UPSERT.
- **D-16** — Single `ADMIN_MODULES` entry `growth/cac`. Default view: per-source CAC cards. Row click: inline drawer for per-campaign, then per-creative (top-5 / bottom-5). CSV export.

### Claude's Discretion

- Edge Function file layout: `supabase/functions/ad-spend-cron-meta/`, `ad-spend-cron-google/`, `ad-spend-cron-tiktok/`, `meta-capi-relay/`, `cac-alert-cron/`, `fx-rates-ecb-cron/`. Shared helpers in `_shared/ad-etl-utils.ts`.
- Migration timestamp window: `20270703000001..N_*.sql` (no collisions confirmed — zero files in that window as of research date).
- Partition strategy: monthly partitions on `spend_date`. 12-month retention. Monthly pg_cron drops partitions older than 13 months.
- RLS posture: all 7 new tables are admin-only (`is_admin()` SECDEF). No public reads. 51-deny test per cross-tenant proof rule.
- Bundle impact: zero (all server-side).

### Deferred Ideas (OUT OF SCOPE)

- Multi-ad-account-per-network credential rotation (v1.4+).
- TikTok Events API + Google Enhanced Conversions server-side relays (v1.4 parity).
- Admin UI to drag-reorder AEM top-8.
- Per-campaign attribution-window override.
- Auto-backfill cron with circuit-breaker.
- Hybrid VIEW + matview split.
- Conversion-day FX rate.
- Dedicated `/admin/creatives` page.
- Browser-side `fbq` pixel emission.
- Email digest / Slack alert delivery.
- Computing LTV from Phase 14 tier pricing.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADETL-01 | Hourly cron Edge Fn pulls spend + click + impression + conversion from Meta Marketing API into `ad_spend_facts` (partitioned by month) | Meta Graph API `GET /act_{AD_ACCOUNT_ID}/insights` with `breakdowns=hourly_stats_aggregated_by_advertiser_time_zone`, `time_range={since,until}`, `level=ad`. Parse `x-business-use-case-usage` header for throttle detection. |
| ADETL-02 | Hourly cron Edge Fn pulls same metrics from Google Ads API | Google Ads REST `POST /customers/{customerId}/googleAds:searchStream` with GAQL `SELECT metrics.clicks, metrics.cost_micros, metrics.impressions, metrics.conversions, segments.date, segments.hour FROM campaign WHERE segments.date BETWEEN X AND Y`. Requires `developer-token`, `login-customer-id`, `Authorization: Bearer` headers from OAuth2 refresh token flow. |
| ADETL-03 | Hourly cron Edge Fn pulls same metrics from TikTok Business API (most-fragile API; hand-rolled fetch client) | TikTok `GET /open_api/v1.3/report/integrated/get/` with `dimensions=["ad_id","stat_time_hour"]`, `metrics=["spend","impressions","clicks","conversions"]`. Access-Token header. Hand-rolled fetch + exponential backoff + 15s timeout per request. |
| ADETL-04 | `ad_revenue_normalized` view joins facts to PostHog conversion events using normalized attribution window | Matview joins `ad_spend_facts` to `events_mirror` on `(user_id, created_at WITHIN attribution_window_seconds)` per `ad_network_config` row. CONCURRENTLY refresh requires unique index on composite key. |
| ADETL-05 | Daily gap-detection cron compares facts-row-count to expected and inserts `ad_etl_gaps` row + admin notification | Daily pg_cron SQL: `COUNT(*) WHERE spend_date = yesterday GROUP BY network` vs `expected = 24`. Insert `ad_etl_gaps` + write to `admin_notifications`. |
| ADETL-06 | Idempotent re-sync covers last-72h on each run; INSERT … ON CONFLICT replays without dupes | UNIQUE constraint on `(network, ad_account_id, ad_id, hour_bucket)`. TikTok uses 168h window per D-04. |
| ADETL-07 | Admin views CAC dashboard with cost-per-acquisition by source/campaign/creative; alert fires when 7-day-rolling CAC > target LTV × 0.5 | `ad_revenue_normalized` matview provides aggregates. `cac-alert-cron` reads 7d-rolling CAC. `growth_targets` table provides threshold. |
| ADETL-08 | Creative-level attribution joins ad-creative-id → conversion-user-id | `ad_spend_facts` stores `ad_id` (which maps to creative). Drill-down drawer in CAC module shows top-5 / bottom-5 CAC creatives per campaign. |
| ADETL-09 | `fx_rates` table + daily ECB fetch + USD-normalization view | ECB XML endpoint `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`. Parse `<Cube currency="USD" rate="1.08"/>` nodes. Store `(currency, rate_date, rate_eur_to_currency)`. Weekend: use last known rate, write `spend_usd_at_spend_date = NULL` on facts rows if FX gap. |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ad-spend ETL (Meta/Google/TikTok) | API / Backend (Edge Functions) | Database | All fetch + upsert is server-side only; no browser involvement |
| FX rate fetch + storage | API / Backend (Edge Function cron) | Database | ECB pull is server-side scheduled; rate stored in `fx_rates` table |
| Meta CAPI relay | API / Backend (Edge Function cron) | — | PHI guardrail requires server-only execution; reads `events_mirror` |
| CAC alert evaluation + delivery | API / Backend (Edge Function cron) | Database | Reads matview, writes `cac_alerts`, reuses admin notification surface |
| `ad_revenue_normalized` matview | Database | — | Owned entirely by Postgres pg_cron; no app-layer logic |
| Gap detection | Database (pg_cron pure SQL) | API / Backend (admin Backfill button) | Detection is SQL; remediation is user-triggered HTTP to ETL Edge Fn |
| CAC dashboard UI | Frontend (admin SPA) | API / Backend (matview RPC) | React component in admin shell; reads via SECDEF accessor function |
| AEM priority register | Frontend (events.ts) + API / Backend | — | EventDef lives in `src/lib/analytics/events.ts`; meta-capi-relay reads it server-side |
| ESLint PHI+AEM cross-check | Build (ESLint rule) | — | Compile-time enforcement; no runtime involvement |

---

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| Meta Marketing API (Graph API REST) | v25.0 | Ad-spend pull (insights), CAPI relay | Official Meta endpoint; no SDK needed for Deno |
| Google Ads API (REST/searchStream) | v24 | Ad-spend pull | REST variant works in Deno; no Node.js SDK needed |
| TikTok Business API | v1.3 | Ad-spend pull | Hand-rolled fetch per CONTEXT D-03 + V13-5 prescription |
| ECB eurofxref XML | daily | FX rates | Free, official, no rate limit documented for daily pull |
| `npm:@supabase/supabase-js@2` | 2.x | DB admin client in Edge Fns | Project standard |
| `npm:posthog-node@5.10.4` | 5.10.4 | `captureServer()` via existing `_shared/posthog-server.ts` | Project standard; already deployed |

[VERIFIED: Context7 /websites/developers_facebook_marketing-api]
[VERIFIED: Context7 /websites/developers_google_google-ads_api]
[VERIFIED: Context7 /tiktok/tiktok-business-api-sdk]
[VERIFIED: npm view facebook-nodejs-business-sdk → 24.0.1 (Node-only; not used in Deno)]
[VERIFIED: npm view google-ads-api → 23.0.0 (Node-only; not used in Deno)]

### Deliberately NOT Used

| Package | Why Excluded |
|---------|-------------|
| `facebook-nodejs-business-sdk` (npm v24.0.1) | Node.js-only (uses `fs`, `http` modules). Import via `npm:` in Deno fails. Use direct `fetch()` to `https://graph.facebook.com/v25.0/` instead. |
| `google-ads-api` (npm v23.0.0) | Node.js-only (uses gRPC + protobuf C bindings). Use REST `searchStream` endpoint instead. |
| Any TikTok SDK | Community SDKs are fragile per V13-5. Hand-roll a thin fetch wrapper. |

[VERIFIED: Context7 — ESM import guide for Deno Edge Functions; esm.sh pattern confirmed from project memory `reference_supabase_edge_function_deploy.md`]

### Supporting

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `https://esm.sh/stripe@19?target=denonext` | Pattern reference only | NOT used in Phase 33; shows correct esm.sh format for Deno |
| DOMParser / XML parsing | ECB XML → JS object | Built-in Deno `DOMParser` or manual string parse of `eurofxref-daily.xml` |

---

## Architecture Patterns

### System Architecture Diagram

```
pg_cron (hourly)
  ├─► ad-spend-cron-meta  (Edge Fn)
  │     ├─ vendor-gate check META_ACCESS_TOKEN
  │     ├─ fetch Graph API /act_{ID}/insights?breakdowns=hourly&time_range=last_72h
  │     ├─ FX lookup: fx_rates JOIN spend_currency/spend_date
  │     └─ UPSERT ad_spend_facts ON CONFLICT(network,ad_account_id,ad_id,hour_bucket)
  │
  ├─► ad-spend-cron-google  (Edge Fn)
  │     ├─ vendor-gate check GOOGLE_ADS_DEVELOPER_TOKEN
  │     ├─ fetch REST searchStream /customers/{id}/googleAds:searchStream
  │     │    GAQL: SELECT cost_micros,clicks,impressions,conversions,segments.hour
  │     │           FROM campaign WHERE date BETWEEN today-3d AND today
  │     ├─ FX lookup (cost_micros is always USD for Google; store raw)
  │     └─ UPSERT ad_spend_facts ON CONFLICT
  │
  └─► ad-spend-cron-tiktok  (Edge Fn)
        ├─ vendor-gate check TIKTOK_ACCESS_TOKEN
        ├─ fetch /open_api/v1.3/report/integrated/get/?dimensions=ad_id,stat_time_hour
        │    window: last 168h (7d restate window per D-04)
        ├─ FX lookup
        └─ UPSERT ad_spend_facts ON CONFLICT

pg_cron (hourly, after ETL)
  └─► REFRESH MATERIALIZED VIEW CONCURRENTLY ad_revenue_normalized
        (reads ad_spend_facts JOIN events_mirror JOIN ad_network_config)

pg_cron (every 5 min)
  └─► meta-capi-relay  (Edge Fn)
        ├─ SELECT from events_mirror WHERE event_name IN aem-priority-list
        │    AND id > last_cursor_value (from meta_capi_relay_cursor)
        ├─ hash user_data: SHA-256(email), SHA-256(phone)
        ├─ POST https://graph.facebook.com/v25.0/{PIXEL_ID}/events
        │    {data:[{event_name, event_time, event_id, user_data, action_source}]}
        └─ update meta_capi_relay_cursor

pg_cron (daily 00:30 UTC)
  └─► cac-alert-cron  (Edge Fn)
        ├─ SELECT 7d-rolling CAC from ad_revenue_normalized per source
        ├─ JOIN growth_targets for threshold
        ├─ UPSERT cac_alerts ON CONFLICT(source, date) DO NOTHING
        ├─ write admin_notifications (reusing P27 surface)
        └─ captureServer('cac_target_breached', {...})

pg_cron (daily, around 17:00 UTC — after ECB publishes at ~16:00 CET)
  └─► fx-rates-ecb-cron  (Edge Fn)
        ├─ fetch https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
        ├─ parse <Cube currency="USD" rate="..."/> nodes (base: EUR)
        └─ UPSERT fx_rates(currency, rate_date, rate_eur_to_currency)
             ON CONFLICT(currency, rate_date) DO NOTHING

Admin SPA (React / admin shell)
  └─► /admin/growth/cac  (ADMIN_MODULES entry)
        ├─ CAC cards per source (reads from matview via SECDEF RPC)
        ├─ ad_etl_health badges (credentials_present, last_success_at)
        ├─ ad_etl_gaps badge + Backfill button
        └─ Drill-down drawer: per-campaign → per-creative (top-5/bottom-5)
```

### Recommended Project Structure

```
supabase/
├── functions/
│   ├── ad-spend-cron-meta/
│   │   ├── index.ts          # vendor-gate + Meta insights fetch + upsert
│   │   └── index.test.ts     # Deno test (reference_deno_test_discovery.md)
│   ├── ad-spend-cron-google/
│   │   ├── index.ts          # vendor-gate + Google Ads REST searchStream + upsert
│   │   └── index.test.ts
│   ├── ad-spend-cron-tiktok/
│   │   ├── index.ts          # vendor-gate + TikTok hand-rolled fetch + upsert
│   │   └── index.test.ts
│   ├── meta-capi-relay/
│   │   ├── index.ts          # reads events_mirror, POSTs to CAPI, updates cursor
│   │   └── index.test.ts
│   ├── cac-alert-cron/
│   │   ├── index.ts          # CAC threshold eval + alert upsert + captureServer
│   │   └── index.test.ts
│   ├── fx-rates-ecb-cron/
│   │   ├── index.ts          # ECB XML fetch + fx_rates upsert
│   │   └── index.test.ts
│   └── _shared/
│       └── ad-etl-utils.ts   # idempotent upsert helper, FX lookup, health upsert
supabase/migrations/
│   ├── 20270703000001_ad_spend_facts_partition.sql
│   ├── 20270703000002_ad_network_config.sql
│   ├── 20270703000003_fx_rates.sql
│   ├── 20270703000004_ad_etl_health.sql
│   ├── 20270703000005_ad_etl_gaps.sql
│   ├── 20270703000006_growth_targets.sql
│   ├── 20270703000007_cac_alerts.sql
│   ├── 20270703000008_ad_revenue_normalized_matview.sql
│   ├── 20270703000009_meta_capi_relay_cursor.sql
│   ├── 20270703000010_rls_deny_ad_tables.sql
│   └── 20270703000011_ad_etl_cron_schedules.sql
leanshot/src/
├── lib/analytics/events.ts          # add aem_priority? + aem_dropped? to EventDef
├── lib/admin/modules.ts             # add growth/cac ADMIN_MODULES entry
├── components/admin/growth/
│   └── CACDashboardPage.tsx         # CAC module page with drawer
└── eslint-rules/
    └── additive-only-events.cjs     # extend with phi+aem cross-check
```

### Pattern 1: Vendor-Gated ETL Edge Function

**What:** Every ETL function checks for credentials at boot. If absent, writes a health row and returns 200 OK. Cron always succeeds; health badge reflects credential status.
**When to use:** All 6 new Edge Functions. Critical for Meta (2-4wk App Review lead time) and TikTok (manual credential approval).

```typescript
// Source: CONTEXT D-01 + reference_vendor_gated_send_health_check
// Pattern cloned from supabase/functions/funnel-anomaly-cron/index.ts

const network = 'meta' as const;

async function writeHealth(admin: SupabaseClient, status: {
  credentials_present: boolean;
  last_error?: string;
  last_success_at?: string;
}): Promise<void> {
  await admin.from('ad_etl_health').upsert({
    network,
    ...status,
    last_attempt_at: new Date().toISOString(),
  }, { onConflict: 'network' });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const accessToken = Deno.env.get('META_ACCESS_TOKEN');
  const adAccountId = Deno.env.get('META_AD_ACCOUNT_ID');

  if (!accessToken || !adAccountId) {
    await writeHealth(admin, { credentials_present: false, last_error: 'credentials_missing' });
    return jsonResponse(200, { ok: true, skipped: 'credentials_missing' });
  }

  try {
    const result = await runMetaETL(admin, accessToken, adAccountId);
    await writeHealth(admin, {
      credentials_present: true,
      last_success_at: new Date().toISOString(),
    });
    return jsonResponse(200, { ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    await writeHealth(admin, { credentials_present: true, last_error: msg });
    return jsonError(500, 'internal');
  }
});
```

[VERIFIED: supabase/functions/funnel-anomaly-cron/index.ts — pattern match confirmed]

### Pattern 2: Meta Marketing API — Ad Insights Pull

**What:** Pull hourly spend/clicks/impressions/conversions per ad for the last 72h using the Graph API insights endpoint.
**Quirks:** 
- Use `breakdowns=hourly_stats_aggregated_by_advertiser_time_zone` for hourly rows.
- `time_increment=1` is NOT the right param for hourly — use `breakdowns=hourly_stats_aggregated_by_advertiser_time_zone`.
- `level=ad` to get ad-level rows.
- `action_attribution_windows=["7d_click"]` for Meta's 7-day click window.
- Unique fields (`reach`, `frequency`) NOT supported with hourly breakdowns — do not request them.
- Parse `x-business-use-case-usage` header; if `total_cputime > 80` or `total_time > 80`, sleep until next clock minute.

```typescript
// Source: Context7 /websites/developers_facebook_marketing-api (insights + rate-limiting docs)
// [VERIFIED: Context7]

const base = `https://graph.facebook.com/v25.0/act_${adAccountId}/insights`;
const since = toDateStr(Date.now() - 72 * 3600 * 1000);
const until = toDateStr(Date.now());

const url = new URL(base);
url.searchParams.set('access_token', accessToken);
url.searchParams.set('level', 'ad');
url.searchParams.set('breakdowns', 'hourly_stats_aggregated_by_advertiser_time_zone');
url.searchParams.set('fields', 'ad_id,ad_name,campaign_id,adset_id,spend,clicks,impressions,actions');
url.searchParams.set('action_attribution_windows', '["7d_click"]');
url.searchParams.set('time_range', JSON.stringify({ since, until }));
url.searchParams.set('limit', '500');

const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });

// Rate-limit check BEFORE processing
const bucHeader = resp.headers.get('x-business-use-case-usage');
if (bucHeader) {
  const buc = JSON.parse(bucHeader);
  // buc is keyed by ad_account_id; check total_cputime and total_time
  const usage = Object.values(buc)[0] as Array<{total_cputime: number; total_time: number}>;
  if (usage?.[0]?.total_cputime > 80 || usage?.[0]?.total_time > 80) {
    console.warn('[meta-etl] rate-limit >80% — writing throttle log');
    // Do not throw; return partial success + let next cron tick handle remainder
  }
}

// Paginate via data.paging.cursors.after / data.paging.next
```

### Pattern 3: Google Ads API — REST searchStream

**What:** POST GAQL query to the searchStream endpoint, parse NDJSON response.
**Auth:** OAuth2 refresh token flow (NOT service accounts — Google Ads API service account support has restrictions; refresh token stored as Function Secret is simpler and standard for single-account ETL). Exchange `GOOGLE_ADS_REFRESH_TOKEN + CLIENT_ID + CLIENT_SECRET` for access token via `https://oauth2.googleapis.com/token`.
**Note:** `metrics.cost_micros` is always in the account's base currency (usually USD for US accounts); divide by 1,000,000 for actual cost.
**Note:** `segments.hour` provides 0-23 hour-of-day in the account's time zone.

```typescript
// Source: Context7 /websites/developers_google_google-ads_api + official docs
// [VERIFIED: Context7]

// Step 1: exchange refresh token for access token
const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: Deno.env.get('GOOGLE_ADS_CLIENT_ID')!,
    client_secret: Deno.env.get('GOOGLE_ADS_CLIENT_SECRET')!,
    refresh_token: Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN')!,
    grant_type: 'refresh_token',
  }),
});
const { access_token } = await tokenResp.json();

// Step 2: GAQL query
const gaql = `
  SELECT
    ad_group_ad.ad.id,
    campaign.id,
    ad_group.id,
    metrics.clicks,
    metrics.cost_micros,
    metrics.impressions,
    metrics.conversions,
    segments.date,
    segments.hour
  FROM ad_group_ad
  WHERE segments.date BETWEEN '${sinceDateStr}' AND '${untilDateStr}'
`;

const customerId = Deno.env.get('GOOGLE_ADS_CUSTOMER_ID')!;
const resp = await fetch(
  `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:searchStream`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${access_token}`,
      'developer-token': Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')!,
      'login-customer-id': Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')!,
    },
    body: JSON.stringify({ query: gaql }),
    signal: AbortSignal.timeout(30_000),
  },
);
// Response is NDJSON stream; parse each line as JSON
```

**Additional secrets required (not in CONTEXT D-03 but implied by OAuth2 refresh flow):**
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`

[ASSUMED] D-03 lists `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — the planner must add the three OAuth2 secrets listed above to the Function Secrets list. This is a gap in D-03 that plan-checker iter-1 should flag.

### Pattern 4: TikTok Business API — Hand-Rolled Fetch Client

**What:** GET `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/` with query params.
**Auth:** Bearer `Access-Token` header (NOT Authorization header — TikTok uses `Access-Token` specifically).
**Hourly granularity:** Include `"stat_time_hour"` in the `dimensions` array.
**Retry:** Exponential backoff on 429 + 5xx. Max 3 retries. Per-request timeout: 15s.
**Rate limits:** [LOW confidence — TikTok developer docs behind auth wall] Expected ~1000 requests/day per advertiser ID per community research; actual limit should be validated when credentials are available.

```typescript
// Source: Context7 /tiktok/tiktok-business-api-sdk (endpoint shape confirmed)
// [VERIFIED: Context7 for endpoint shape; rate limit details [ASSUMED]]

async function tiktokReportFetch(
  accessToken: string,
  advertiserId: string,
  startDate: string,  // YYYY-MM-DD
  endDate: string,    // YYYY-MM-DD
  page: number = 1,
): Promise<unknown> {
  const url = new URL('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/');
  url.searchParams.set('advertiser_id', advertiserId);
  url.searchParams.set('report_type', 'BASIC');
  url.searchParams.set('data_level', 'AUCTION_AD');
  url.searchParams.set('dimensions', JSON.stringify(['ad_id', 'stat_time_hour']));
  url.searchParams.set('metrics', JSON.stringify(['spend', 'impressions', 'clicks', 'conversions', 'cost_per_conversion']));
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', '100');

  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(url.toString(), {
      headers: { 'Access-Token': accessToken },
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.status === 429 || resp.status >= 500) {
      const backoff = 1000 * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }
    return resp.json();
  }
  throw new Error('tiktok_max_retries_exceeded');
}
```

### Pattern 5: Meta CAPI Relay — events_mirror cursor pattern

**What:** Each 5-min tick reads new `events_mirror` rows for AEM-priority events, posts to Meta CAPI. Dedupes via `event_id` matching browser `fbq` `eventID`.
**PHI guardrail:** Import `events.ts` EventDef, check `phi: false` before processing any event. Throw if `phi: true` slips through.
**Hashing:** SHA-256 of email/phone using `crypto.subtle.digest()` (Web Crypto, available in Deno).
**Dedup window:** Meta deduplicates server events matching `(event_id, event_name)` within 48h of a browser pixel event with matching `eventID`. [VERIFIED: Context7 /websites/developers_facebook_marketing-api CAPI dedup docs]

```typescript
// Source: Context7 /websites/developers_facebook_marketing-api — CAPI POST /events
// [VERIFIED: Context7]

// Cursor tracking: store last processed events_mirror.id in a config row
// e.g.: SELECT value FROM etl_cursors WHERE name = 'meta_capi_relay'
// After batch POST: UPDATE etl_cursors SET value = max_processed_id

async function hashField(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.toLowerCase().trim()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST to CAPI (batch up to 1000 events per request — CAPI limit)
const capiResp = await fetch(
  `https://graph.facebook.com/v25.0/${pixelId}/events?access_token=${accessToken}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: events.map(ev => ({
        event_name: ev.event_name,      // must match browser fbq 'event'
        event_time: Math.floor(new Date(ev.created_at).getTime() / 1000),
        event_id: ev.properties.event_id, // must match browser fbq 4th arg eventID
        action_source: 'website',
        user_data: {
          em: [await hashField(ev.properties.email ?? '')],
          // ph, fbc, fbp if available in properties
        },
        custom_data: {
          value: ev.properties.value ?? undefined,
          currency: 'USD',
        },
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  },
);
```

### Pattern 6: ECB FX Rates — XML Parse

**What:** Daily fetch + parse of ECB eurofxref XML. Base is EUR; all rates are units-of-foreign-per-EUR.
**Weekend/holiday gap:** ECB publishes only on working days. On a gap day, the ETL should find no new rows (same `rate_date` already exists if previously fetched, or just no new publication). The FX lookup at ETL time already handles NULL via D-11: write `spend_usd_at_spend_date = NULL` and let gap-detection pick it up.

```typescript
// Source: WebFetch of https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
// [VERIFIED: directly fetched XML from ECB — structure confirmed]

const xmlResp = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', {
  signal: AbortSignal.timeout(15_000),
});
const xml = await xmlResp.text();

// Parse date: <Cube time="2026-05-16">
const dateMatch = xml.match(/time="(\d{4}-\d{2}-\d{2})"/);
const rateDate = dateMatch?.[1];
if (!rateDate) throw new Error('ecb_xml_date_parse_failed');

// Parse rates: <Cube currency="USD" rate="1.0848"/>
const rateMatches = [...xml.matchAll(/currency="([A-Z]+)"\s+rate="([\d.]+)"/g)];
const rows = rateMatches.map(([, currency, rate]) => ({
  currency,
  rate_date: rateDate,
  rate_eur_to_currency: parseFloat(rate),
}));

// Upsert: ON CONFLICT (currency, rate_date) DO NOTHING
await admin.from('fx_rates').upsert(rows, { onConflict: 'currency,rate_date', ignoreDuplicates: true });
```

### Pattern 7: Matview with CONCURRENTLY Refresh (admin-only access)

Postgres does NOT support RLS on materialized views. The pattern from P30 applies: REVOKE all public access + expose via SECURITY DEFINER accessor function.

```sql
-- Source: supabase/migrations/20270601300004_p30_matviews_and_cron.sql
-- [VERIFIED: direct file read]

CREATE MATERIALIZED VIEW public.ad_revenue_normalized AS
SELECT
  asf.network,
  asf.ad_account_id,
  asf.ad_id,
  asf.spend_date,
  asf.campaign_id,
  asf.spend_usd_at_spend_date,
  asf.clicks,
  asf.impressions,
  anc.default_attribution_window_seconds,
  COUNT(em.id) AS attributed_conversions,
  CASE WHEN COUNT(em.id) > 0 THEN asf.spend_usd_at_spend_date / COUNT(em.id) ELSE NULL END AS cac_usd
FROM public.ad_spend_facts asf
LEFT JOIN public.ad_network_config anc ON anc.network = asf.network
LEFT JOIN public.events_mirror em
  ON em.user_id IS NOT NULL
  AND em.event_name IN ('payment_completed')  -- or any aem_priority=1 event
  AND em.created_at BETWEEN asf.hour_bucket AND asf.hour_bucket + (anc.default_attribution_window_seconds * INTERVAL '1 second')
WHERE asf.spend_usd_at_spend_date IS NOT NULL
GROUP BY asf.network, asf.ad_account_id, asf.ad_id, asf.spend_date, asf.campaign_id,
         asf.spend_usd_at_spend_date, asf.clicks, asf.impressions, anc.default_attribution_window_seconds;

-- REQUIRED before CONCURRENTLY refresh
CREATE UNIQUE INDEX ad_revenue_normalized_uq
  ON public.ad_revenue_normalized (network, ad_account_id, ad_id, spend_date);

-- Access control (matviews don't support RLS)
REVOKE ALL ON public.ad_revenue_normalized FROM public;
REVOKE ALL ON public.ad_revenue_normalized FROM authenticated;

-- SECURITY DEFINER accessor — admin-only
CREATE OR REPLACE FUNCTION public.get_cac_summary(p_source text DEFAULT NULL)
RETURNS TABLE (...) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
-- is_admin() check + return query
$$;
```

### Pattern 8: AEM Priority Register Addition to EventDef

**What:** Add two optional fields to the `EventDef` type and relevant events.
**ESLint compatibility:** Adding optional fields to the type itself is allowed by the additive-only rule (only `payload` field changes are tracked by the rule's AST visitor — the type declaration change is safe). Adding optional top-level EventDef properties passes as-is.
**New ESLint check needed:** Extend `additive-only-events.cjs` with a second visitor that checks any event with `aem_priority` also has `phi: false`.

```typescript
// Source: leanshot/src/lib/analytics/events.ts current shape — [VERIFIED: direct file read]
// Phase 24 D-10 confirmed optional fields are allowed

export type EventDef = {
  readonly name: string;
  readonly version: 1;
  readonly payload: z.ZodObject<z.ZodRawShape>;
  readonly phi: false;
  readonly description: string;
  readonly owner: 'growth' | 'product' | 'platform' | 'billing' | 'admin';
  readonly server_only?: true;
  // Phase 33 D-05 additions:
  readonly aem_priority?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly aem_dropped?: true;
};

// Example usage on payment_completed (likely aem_priority: 1):
payment_completed: {
  name: 'payment_completed',
  version: 1,
  phi: false,
  owner: 'billing',
  aem_priority: 1,  // Phase 33 D-05
  // ... rest unchanged
}
```

### Pattern 9: ADMIN_MODULES Entry Shape

**What:** Add a `growth/cac` entry to `src/lib/admin/modules.ts`.
**Confirmed shape** from direct file read of `src/lib/admin/modules.ts`:

```typescript
// Source: leanshot/src/lib/admin/modules.ts — [VERIFIED: direct file read]
{
  key: 'growth',          // or 'cac' — check for collisions with existing keys
  label: 'Ad Spend / CAC',
  route: 'growth/cac',   // maps to /admin/growth/cac
  icon: TrendingUpIcon,  // from lucide-react
  lazy: () => import('@/components/admin/growth/CACDashboardPage').then(m => ({ default: m.CACDashboardPage })),
  flagKey: 'admin.growth.cac.enabled',
  minRole: 'admin' as AdminRole,
}
```

### Anti-Patterns to Avoid

- **Fetching only the last 1 hour:** Meta backfills 24-48h; TikTok restates attribution up to 7 days. Always use the full replay window (D-04).
- **Using `REFRESH MATERIALIZED VIEW` without CONCURRENTLY:** Locks the matview during refresh (up to several seconds on large datasets). Always use CONCURRENTLY once the unique index exists.
- **Creating the UNIQUE index after first CONCURRENTLY refresh:** Postgres throws an error if CONCURRENTLY is attempted without a unique index. The index MUST be in the same migration that creates the matview, before any initial REFRESH.
- **Requesting `reach` or `frequency` with hourly Meta breakdown:** These unique-user metrics are not supported with hourly aggregation and will cause API errors.
- **Sending PHI events to Meta CAPI:** `meta-capi-relay` MUST check `eventDef.phi === false` and throw at runtime if this invariant is violated. Also blocked at ESLint time.
- **Using `total_cputime`/`total_time` from BUC header as if they are per-call:** They are cumulative rolling scores for the ad account across the hour. Parse `Object.values(buc)[0][0].total_cputime`.
- **Assuming `event_id` in `events_mirror.properties` exists:** The browser pixel must set `eventID` in the fbq call AND the server capture must echo it as `properties.event_id`. If the browser pixel is not yet configured, CAPI dedup will not work (this is a known gap flagged in CONTEXT code_context).
- **Hardcoding cron schedule strings without checking existing slots:** Phase 33 needs distinct slots. Proposed: hourly ETL at `5 * * * *`, matview refresh at `10 * * * *`, meta-capi-relay at `*/5 * * * *`, ECB at `30 17 * * *`, CAC alert at `30 0 * * *`, gap detection at `0 5 * * *`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Meta CAPI hashing | Custom SHA-256 | `crypto.subtle.digest('SHA-256', ...)` (Web Crypto built-in) | Web Crypto is available in Deno and browsers; no library needed |
| FX rate source | Scraping forex sites / paid API | ECB `eurofxref-daily.xml` | Free, official, 28 currencies, no rate limits documented |
| Meta rate-limit detection | Poll until 429 | Parse `x-business-use-case-usage` header proactively | BUC header gives real-time quota %; act at 80% not 100% |
| Matview access control | RLS on matviews | REVOKE + SECURITY DEFINER accessor function | Postgres does not support RLS on materialized views (confirmed by P30 migration pattern) |
| ETL cursor tracking | External Redis / local file | `etl_cursors` table row in Postgres | Supabase is already the source of truth; row-level UPSERT is atomic |

---

## Common Pitfalls

### Pitfall 1: Meta Attribution Restatement — 24-48h Window

**What goes wrong:** Pulling only the last hour captures Meta's reported spend, but Meta can revise conversion counts for an ad for up to 48h as late-attributed events are processed.
**Why it happens:** Meta's attribution model allows events occurring up to 7 days after a click to be attributed back to that click. Hourly snapshots undercount until the window closes.
**How to avoid:** Always pull last 72h (D-04). `INSERT ... ON CONFLICT ... DO UPDATE` replaces stale rows. Each hourly tick corrects the previous 72h of data.
**Warning signs:** CAC appears artificially high on same-day pulls vs 3-day-old data for the same campaign.

### Pitfall 2: TikTok Attribution Restatement — 7-Day Window (V13-5)

**What goes wrong:** TikTok restates attribution data for up to 7 days after a click. Pulling only 72h means the CAC dashboard systematically underattributes TikTok conversions.
**Why it happens:** TikTok's view-through and click-through attribution models allow late-arriving signal from their attribution system.
**How to avoid:** D-04 mandates 168h (7d) replay window for TikTok. This doubles write volume but is non-negotiable.
**Warning signs:** TikTok CAC appears 2-3x higher than Meta/Google for same campaign objectives — suggests underattribution rather than genuine performance gap.

### Pitfall 3: CONCURRENTLY Refresh Without Unique Index

**What goes wrong:** Migration creates matview, schedules cron, first CONCURRENTLY refresh throws `ERROR: cannot refresh materialized view "ad_revenue_normalized" concurrently — no unique index`.
**Why it happens:** Postgres requires at least one unique index on the matview before any CONCURRENTLY operation.
**How to avoid:** Create the UNIQUE index in the same migration transaction that creates the matview, before the initial non-concurrent REFRESH.
**Warning signs:** First matview refresh succeeds (non-concurrent); second fails (concurrent cron).

### Pitfall 4: Google Ads NDJSON Stream Parsing

**What goes wrong:** `searchStream` returns newline-delimited JSON, not a single JSON array. Calling `resp.json()` throws.
**Why it happens:** `googleAds:searchStream` is a streaming RPC endpoint that returns one JSON object per line.
**How to avoid:** Read `resp.text()`, split on `\n`, parse each non-empty line individually. Filter lines that start with `[` (batch wrappers) separately from lines that start with `{` (result rows).
**Warning signs:** `JSON.parse` throws `SyntaxError: Unexpected token` on the response body.

### Pitfall 5: ECB XML Not Published on Weekends/Holidays

**What goes wrong:** `fx-rates-ecb-cron` runs on a weekend, fetches the same XML (ECB caches the last-published date), and tries to upsert a row for a date that matches the most recent business day — or gets an empty/stale response.
**Why it happens:** ECB publishes around 16:00 CET on business days only. On Saturday/Sunday/public holidays, the XML date field is the last business day.
**How to avoid:** The `ON CONFLICT DO NOTHING` on `(currency, rate_date)` means re-inserting Friday's rate on Saturday is a no-op. At ETL time, the FX lookup searches for the nearest prior row: `SELECT rate_eur_to_currency FROM fx_rates WHERE currency = $1 AND rate_date <= $spend_date ORDER BY rate_date DESC LIMIT 1`. A missing row writes `spend_usd_at_spend_date = NULL`.
**Warning signs:** `ad_etl_gaps` shows NULL USD rows clustered on Monday mornings (Friday spend had no Saturday/Sunday FX row).

### Pitfall 6: Meta System User Token vs. Personal Access Token

**What goes wrong:** Using a personal (developer) access token from the App Dashboard for production. Personal tokens expire in 60 days; system user tokens can be permanent or 60-day-optional.
**Why it happens:** During development, the quickest token to grab is a personal access token from the Graph API Explorer. These are short-lived.
**How to avoid:** Generate a **system user** access token via Business Manager → System Users → Generate Token. Store as `META_ACCESS_TOKEN` Function Secret. Document renewal procedure in ops runbook. If `set_token_expires_in_60_days=true` is used, add a reminder to `ad_etl_health.last_error` when a 190 (invalid OAuth token) error is returned.
**Warning signs:** Meta ETL silently fails 60 days after setup; `ad_etl_health.last_error = 'invalid_oauth_access_token'`.

### Pitfall 7: Meta CAPI event_id Dependency on Browser Pixel

**What goes wrong:** `meta-capi-relay` sends events to CAPI, but no browser `fbq` pixel is configured. Deduplication does not work (events are counted twice in Meta Events Manager — once from CAPI, once from any future pixel). More critically: `events_mirror.properties.event_id` is empty because the server-side capture never set it.
**Why it happens:** Browser pixel emission is out-of-scope for Phase 33 (CONTEXT, deferred). The relay assumes `event_id` is present in `properties`.
**How to avoid:** The relay must check `if (!ev.properties.event_id)` and either skip the event (with a console.warn) or generate a deterministic ID from `(user_id, event_name, event_time)`. Document this constraint in the relay's source header.
**Warning signs:** Meta Events Manager shows deduplication score < 80% or `events_received` 2× `events_matched`.

### Pitfall 8: Migration Timestamp Collision

**What goes wrong:** Phase 33 migrations use a timestamp prefix that collides with another phase running in parallel.
**Why it happens:** Concurrent phase development; Supabase silently skips files with unrecognized timestamp patterns.
**How to avoid:** Run the pre-check before pushing: `ls supabase/migrations/20270703*.sql | wc -l` — must return 0. Phase 33 owns the `20270703*` window (no other phase migrations found there as of 2026-05-18).
**Warning signs:** `supabase db push` shows fewer "Applied" migrations than expected. Check for `^Skipping` in push output (memory: `reference_supabase_migration_filename_regex`).

---

## Code Examples

### events_mirror Schema (Phase 27 plan 27-04)

Confirmed columns from `supabase/migrations/20260601000030_events_mirror.sql`:

```sql
-- [VERIFIED: direct file read]
public.events_mirror (
  id          bigserial PRIMARY KEY,
  event_name  text NOT NULL,
  user_id     uuid,            -- nullable (pre-signup events)
  properties  jsonb DEFAULT '{}'::jsonb,
  distinct_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
)
-- Index: (event_name, created_at DESC)
-- RLS: ENABLED with NO policies — service_role write + SECDEF read only
```

The `meta-capi-relay` reads this table. Relevant join: `WHERE event_name IN (aem_priority_list) AND id > last_cursor_id`.

### Proposed `ad_spend_facts` Schema

```sql
-- [ASSUMED — no existing migration; planned for 20270703000001]
CREATE TABLE public.ad_spend_facts (
  id                      bigserial,
  network                 text NOT NULL,           -- 'meta', 'google', 'tiktok'
  ad_account_id           text NOT NULL,
  ad_id                   text NOT NULL,
  campaign_id             text,
  adset_id                text,
  hour_bucket             timestamptz NOT NULL,    -- UTC start of hour
  spend_date              date NOT NULL,           -- GENERATED ALWAYS AS (hour_bucket::date)
  spend_local             numeric(12,4),           -- raw currency
  spend_currency          text,                    -- ISO 4217
  spend_usd_at_spend_date numeric(12,4),           -- NULL if fx_rates gap
  clicks                  integer,
  impressions             integer,
  conversions             integer,                 -- as reported by network
  raw_response            jsonb,                   -- full API row for debugging
  fetched_at              timestamptz DEFAULT now(),
  PRIMARY KEY (id, spend_date)
) PARTITION BY RANGE (spend_date);

-- Monthly partitions (planner generates initial set for 2026-05 onward)
CREATE TABLE public.ad_spend_facts_y2026m05
  PARTITION OF public.ad_spend_facts
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- Idempotency constraint (D-04 / D-06)
CREATE UNIQUE INDEX ad_spend_facts_uq
  ON public.ad_spend_facts (network, ad_account_id, ad_id, hour_bucket);
```

### pg_cron Schedule Map (Phase 33 — No Collisions)

Existing slots occupied (from migration scan):
- `*/5 * * * *` — funnel-anomaly-cron
- `*/15 * * * *` — lifecycle-behavior-triggered
- `*/20 * * * *` — p30_clinician_alert_deliver
- `0 */4 * * *` — lifecycle-welcome-series
- `0 6 * * *` — lifecycle-retention
- `30 3 * * *` — p30_clinician_alert_detect
- `15 4 * * *` — p30_clinician_alert_auto_resolve
- `2,17,32,47 * * * *` — p30_clinic_matview_refresh

Phase 33 proposed slots (no conflicts):

| Job | Schedule | Notes |
|-----|----------|-------|
| `p33_ad_etl_meta` | `5 * * * *` | On-the-5 hourly, after lifecycle-behavior-triggered completes |
| `p33_ad_etl_google` | `6 * * * *` | On-the-6, immediately after Meta |
| `p33_ad_etl_tiktok` | `7 * * * *` | On-the-7, after Google |
| `p33_matview_refresh` | `10 * * * *` | On-the-10, after all 3 ETLs complete |
| `p33_meta_capi_relay` | `*/5 * * * *` | Shares slot with funnel-anomaly (both are 5-min; acceptable per pg_cron) |
| `p33_fx_ecb_cron` | `0 17 * * *` | 17:00 UTC = after ECB ~16:00 CET publication |
| `p33_cac_alert_cron` | `30 0 * * *` | D-15: daily 00:30 UTC |
| `p33_gap_detection` | `0 5 * * *` | Daily 05:00 UTC (after p30_clinician_alert_auto_resolve at 04:15) |

**Note on `meta-capi-relay` sharing `*/5` slot with `funnel-anomaly-cron`:** pg_cron schedules run independently; sharing the same cron expression is fine as each has a distinct job name. Each fires a different Edge Function URL.

[VERIFIED: direct migration file scan confirmed no P33-proposed slots are occupied]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Meta SDK (Node.js `facebook-nodejs-business-sdk`) | Direct `fetch()` to Graph API REST | When Deno Edge Functions became standard | SDK requires Node.js fs/http modules; not compatible with Deno |
| Meta CAPI: FBP/external_id dedup only | event_id + event_name dedup (recommended) | Meta added event_id in ~2021 | More precise dedup; requires browser pixel cooperation |
| Google Ads API gRPC + protobuf | Google Ads REST `searchStream` | Always available; gRPC requires compiled C bindings | REST works in any HTTP client; Deno-compatible |
| Meta action_attribution_windows `28d_click` default | `7d_click` default (Meta changed in 2021-01) | 2021-01 | Must explicitly request `action_attribution_windows=["7d_click"]` |
| `REFRESH MATERIALIZED VIEW` (blocking) | `REFRESH MATERIALIZED VIEW CONCURRENTLY` | Standard since Postgres 9.4 | Concurrent refresh requires unique index; non-blocking reads during refresh |

**Deprecated:**
- `legacy usage_records.create` (Stripe) — already removed per project memory; irrelevant to Phase 33 but noted for completeness.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Google Ads OAuth2 refresh token requires 3 additional Function Secrets not listed in D-03 (`GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`) | Standard Stack / Pattern 3 | Google ETL cannot authenticate; plan must add these secrets to D-03 supplement |
| A2 | TikTok API rate limits are ~1000 req/day per advertiser; specific quotas not publicly documented | Pattern 4 | Actual rate limit may be tighter; plan must validate when TikTok credentials arrive |
| A3 | ECB XML endpoint has no documented rate limit; daily polling at 17:00 UTC is safe | Pattern 6 | If ECB adds rate limits, must add backoff; LOW risk as single daily fetch |
| A4 | `meta-capi-relay` cursor stored as a row in `etl_cursors` table | Pattern 5 | Alternative: dedicated `meta_capi_relay_cursor` table column. Either works; planner picks |
| A5 | Proposed cron schedule slots (5/6/7/10 past the hour) are clean | Pattern 8 / Code Examples | If another phase ships between now and Phase 33 execution and claims these slots, collision; timestamp pre-check required |
| A6 | Initial AEM top-8 events are: `payment_completed`(1), `signup_completed`(2), `activation_first_log`(3), `payment_initiated`(4), `rag_newsletter_subscribed`(5), `rag_hub_pageview`(6), `rag_tip_clicked`(7), `feature_flag_evaluated`(8) | AEM Priority Register section | User reviews and locks in plan-checker iter-1 per D-06 |

---

## AEM Priority Register — Proposed Initial Top-8

Based on reading all events in `events.ts` and ranking by conversion value (D-06):

| Priority | Event Name | Owner | Rationale |
|----------|-----------|-------|-----------|
| 1 | `payment_completed` | billing | Direct revenue conversion — highest Meta CAPI value |
| 2 | `signup_completed` | growth | Top-of-funnel; enables lookalike audiences |
| 3 | `activation_first_log` | product | Key activation moment; correlates with retention |
| 4 | `payment_initiated` | billing | Intent signal; enables cart-abandonment recovery |
| 5 | `rag_newsletter_subscribed` | growth | Content engagement + retargeting |
| 6 | `rag_hub_pageview` | growth | Content reach signal |
| 7 | `rag_tip_clicked` | growth | Engagement depth signal |
| 8 | `rag_citation_clicked` | growth | Research engagement |

Events NOT eligible (not in `events.ts` as of research date, or `phi: true` / `server_only: true`):
- All `rag_*` server_only events: `rag_topic_created`, `rag_scrape_run`, `rag_chunk_reviewed`, etc. — server_only=true, must NOT have aem_priority.
- `admin_action` — admin-only surface, not relevant for ad attribution.
- `refund_issued` — revenue negative; not an AEM conversion event.

[ASSUMED — A6: User must validate and lock in plan-checker iter-1 per D-06]

---

## Open Questions

1. **Google Ads OAuth2 Secrets Gap (BLOCKER)**
   - What we know: D-03 lists `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
   - What's unclear: OAuth2 refresh token flow also needs `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`. Service Account alternative avoids client_id/secret but requires a JSON key file (can be stored as a multi-line secret, but more complex).
   - Recommendation: Plan-checker iter-1 must flag D-03 for supplement with these three secrets. Refresh token flow is simpler than service account for single-customer ETL.

2. **`meta-capi-relay` cursor persistence**
   - What we know: The relay needs to track the last-processed `events_mirror.id` to avoid reprocessing.
   - What's unclear: Whether to use a dedicated `etl_cursors` table (simple key-value: `name, value`) or a column on `ad_etl_health`.
   - Recommendation: Use a separate `etl_cursors` table (generic key-value, reusable). Planner adds this as migration `20270703000009`.

3. **TikTok `stat_time_hour` vs `stat_time_day` + attribution_type**
   - What we know: The endpoint supports `stat_time_hour` as a dimension for hourly granularity.
   - What's unclear: Whether hourly granularity is available for all attribution types (click + view). Some TikTok API endpoints have dimension incompatibility constraints.
   - Recommendation: Plan should include a Wave 0 smoke test that calls the endpoint with `stat_time_hour` and verifies the response code is not 40002 (invalid dimension combination).

4. **AEM Event Priority Lock (D-06)**
   - What we know: Planner picks initial top-8 from this research + funnel analysis.
   - What's unclear: Whether the user wants to confirm the top-8 list in plan-checker iter-1 before locking.
   - Recommendation: Present the proposed top-8 above in the PLAN. Flag as "Pending user confirmation in plan-checker iter-1."

5. **`ad_spend_facts` partition pruning cron**
   - What we know: Monthly partitions; 12-month retention; pg_cron drops partitions older than 13 months.
   - What's unclear: The exact pg_cron SQL to DETACH and DROP a partition safely.
   - Recommendation: Mirror the P30 pattern. Use `ALTER TABLE ad_spend_facts DETACH PARTITION ad_spend_facts_y{year}m{month}; DROP TABLE ad_spend_facts_y{year}m{month};` in a monthly pg_cron job.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI + linked project | Migration push | ✓ | Linked (ytnsipxxmzgaebkqmokp) | — |
| pg_cron extension | Cron scheduling | ✓ | Confirmed (used by existing migrations) | — |
| `pg_net` extension | Edge Fn HTTP from cron | ✓ | Confirmed (p30 migration uses `net.http_post`) | — |
| ECB XML endpoint | fx-rates-ecb-cron | ✓ | Public, no auth | — |
| Meta App Access Token | ad-spend-cron-meta | ✗ | Meta App Review pending (2-4wk) | Vendor-gated D-01 no-op |
| Google Ads Developer Token | ad-spend-cron-google | ✗ | Manual setup required | Vendor-gated D-01 no-op |
| TikTok Advertiser Access | ad-spend-cron-tiktok | ✗ | Approval required | Vendor-gated D-01 no-op |
| Meta Pixel (browser) | meta-capi-relay (event_id dedup) | ✗ | Out-of-scope Phase 33 | Relay works; dedup degrades without pixel |

**Missing dependencies with no fallback:** None — all three ad network credentials use D-01 vendor-gate.

**Missing dependencies with fallback:**
- Meta browser pixel for event_id dedup: CAPI still sends events; Meta dedup quality degrades but does not fail. Document this in relay source header.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Deno test (built-in) |
| Config file | none — Deno test is runner-discovery based |
| Quick run command | `deno test supabase/functions/ad-spend-cron-meta/index.test.ts --allow-env --allow-net=none` |
| Full suite command | `deno test supabase/functions/ --allow-env --allow-net=none` |

**Note:** Per `reference_deno_test_discovery.md` — test files MUST be named `index.test.ts` (NOT `*-test.ts`). Deno test discovery matches `{*_,*.,}test.*` only.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADETL-01 | Meta ETL upserts `ad_spend_facts` rows correctly | unit | `deno test supabase/functions/ad-spend-cron-meta/index.test.ts` | ❌ Wave 0 |
| ADETL-02 | Google ETL upserts rows; NDJSON parse; cost_micros / 1e6 | unit | `deno test supabase/functions/ad-spend-cron-google/index.test.ts` | ❌ Wave 0 |
| ADETL-03 | TikTok ETL upserts; retry-on-429; 168h window | unit | `deno test supabase/functions/ad-spend-cron-tiktok/index.test.ts` | ❌ Wave 0 |
| ADETL-04 | ad_revenue_normalized matview returns non-null CAC for seeded test rows | integration | `supabase db query --linked "SELECT COUNT(*) FROM ad_revenue_normalized"` | ❌ Wave 0 |
| ADETL-05 | gap-detection cron inserts ad_etl_gaps when hour count < 24 | unit (pure SQL) | migration rollup test | ❌ Wave 0 |
| ADETL-06 | ON CONFLICT upsert does not duplicate rows on re-run | unit | `deno test supabase/functions/ad-spend-cron-meta/index.test.ts -- dedup` | ❌ Wave 0 |
| ADETL-07 | cac-alert-cron writes cac_alerts row when CAC > threshold | unit | `deno test supabase/functions/cac-alert-cron/index.test.ts` | ❌ Wave 0 |
| ADETL-08 | CAC admin module renders per-source cards + drill-down | manual-only | Admin UI smoke (deploy-gated) | — |
| ADETL-09 | fx-rates-ecb-cron parses ECB XML, upserts fx_rates | unit | `deno test supabase/functions/fx-rates-ecb-cron/index.test.ts` | ❌ Wave 0 |
| D-08 | PHI event blocked from meta-capi-relay at runtime | unit | `deno test supabase/functions/meta-capi-relay/index.test.ts -- phi-guard` | ❌ Wave 0 |
| D-08 | ESLint blocks aem_priority on phi:true events | lint | `npm run lint` | ❌ Wave 0 (rule extension) |
| ADETL-01/02/03 | vendor-gate: missing credential returns 200 ok + health row | unit | All ETL test files | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `deno test supabase/functions/{function-name}/index.test.ts --allow-env`
- **Per wave merge:** `deno test supabase/functions/ --allow-env` + `npm run lint`
- **Phase gate:** Full Deno test suite green + ESLint green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `supabase/functions/ad-spend-cron-meta/index.test.ts` — covers ADETL-01 + vendor-gate + dedup
- [ ] `supabase/functions/ad-spend-cron-google/index.test.ts` — covers ADETL-02 + NDJSON parse
- [ ] `supabase/functions/ad-spend-cron-tiktok/index.test.ts` — covers ADETL-03 + retry logic
- [ ] `supabase/functions/meta-capi-relay/index.test.ts` — covers D-07 + D-08 PHI guard + cursor
- [ ] `supabase/functions/cac-alert-cron/index.test.ts` — covers ADETL-07 + D-14 + D-15 dedup
- [ ] `supabase/functions/fx-rates-ecb-cron/index.test.ts` — covers ADETL-09 + weekend-gap handling
- [ ] ESLint rule extension in `eslint-rules/additive-only-events.cjs` (phi+aem cross-check)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Service-role bearer for Edge Fn crons (no user auth path) |
| V3 Session Management | No | Cron functions; no sessions |
| V4 Access Control | Yes | `is_admin()` SECDEF on all 7 new tables; RLS deny for non-admin roles; 51-deny cross-tenant test |
| V5 Input Validation | Yes | `?backfill_date=YYYY-MM-DD` param on Backfill button: validate with regex before DB query |
| V6 Cryptography | Yes | `crypto.subtle.digest('SHA-256')` for Meta CAPI user_data hashing — Web Crypto, not hand-rolled |
| V7 Errors and Logging | Yes | `ad_etl_health.last_error` stores error codes, not raw API responses (avoid credential leak in logs) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PHI data leaking to Meta CAPI | Information Disclosure | D-08: import-zone + runtime phi check + ESLint rule |
| Credential exposure in error logs | Information Disclosure | Log error codes only; never log `access_token` or raw API error bodies |
| Backfill button abuse (SSRF-like) | Tampering | Validate `backfill_date` param with `/^\d{4}-\d{2}-\d{2}$/`; bind to service_role context only |
| Cross-tenant admin data leak | Information Disclosure | SECDEF accessor enforces `is_admin()` gate; no `user_id` foreign key on ad data tables |
| Meta CAPI event dedup failure (double-count) | Tampering (measurement) | `event_id` field in properties; document browser pixel dependency |
| Stale Meta access token (60-day) | Elevation of Privilege | `ad_etl_health.last_error = 'invalid_oauth'` badge visible in admin UI immediately |

---

## Sources

### Primary (HIGH confidence)

- Context7 `/websites/developers_facebook_marketing-api` — Meta Marketing API insights endpoint shape, rate-limiting headers, CAPI payload format, system user tokens, event_id dedup mechanics
- Context7 `/websites/developers_google_google-ads_api` — Google Ads REST searchStream endpoint, GAQL syntax, required headers (developer-token, login-customer-id)
- Context7 `/tiktok/tiktok-business-api-sdk` — `/report/integrated/get/` endpoint shape, dimension params (stat_time_hour, ad_id), metrics list
- `supabase/functions/funnel-anomaly-cron/index.ts` — cron Edge Fn pattern (direct file read)
- `supabase/functions/_shared/posthog-server.ts` — captureServer + shutdownPostHog pattern (direct file read)
- `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — matview + CONCURRENTLY refresh + REVOKE + SECDEF accessor pattern (direct file read)
- `supabase/migrations/20260601000030_events_mirror.sql` — events_mirror schema (direct file read)
- `leanshot/src/lib/analytics/events.ts` — EventDef shape + existing events (direct file read)
- `leanshot/eslint-rules/additive-only-events.cjs` — ESLint rule extension point (direct file read)
- `leanshot/src/lib/admin/modules.ts` — ADMIN_MODULES manifest shape (direct file read)
- ECB eurofxref XML: `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` — structure confirmed via WebFetch

### Secondary (MEDIUM confidence)

- WebSearch + WebFetch: Google Ads API service account vs. refresh token — confirmed refresh token is standard for single-account ETL; service account has 20-account limit
- WebSearch: Meta `x-business-use-case-usage` header BUC structure — confirmed `total_cputime` / `total_time` keys
- WebSearch: ECB publication schedule (working days, ~16:00 CET) — common knowledge confirmed by XML date field

### Tertiary (LOW confidence)

- TikTok API rate limits (~1000 req/day per advertiser) — community reported; not from official docs
- ECB API rate limits — not documented; assumed safe for daily single fetch

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — API endpoints verified via Context7 and direct calls
- Architecture: HIGH — patterns cloned from verified existing Edge Functions
- Meta CAPI: HIGH — payload shape verified via Context7
- TikTok rate limits: LOW — not publicly documented
- ECB rate limits: LOW — not documented, assumed safe
- AEM top-8 initial selection: MEDIUM — based on event taxonomy analysis; user confirms at plan-checker iter-1

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (30 days — Google Ads REST v24, Meta Graph API v25.0, TikTok v1.3 are stable; TikTok may deprecate v1.3 on their own schedule)
