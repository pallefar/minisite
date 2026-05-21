# Phase 51: Full Traffic + Conversion Tracking System + Unified Dashboard — Research

**Researched:** 2026-05-21
**Domain:** Multi-channel acquisition + funnel intelligence + admin dashboard (sibling of Phase 33 ad-spend module)
**Confidence:** HIGH (existing in-tree precedent for every load-bearing pattern; one OPEN QUESTION on landing-page server route owner — see Q1)

## Summary

Phase 51 is **almost entirely a sibling-clone exercise** on top of Phase 33 (`growth/cac`) + Phase 27 (`events_mirror` + `funnel-anomaly-cron`) + Phase 30 (matview + SECDEF accessor pattern). Every required infrastructure pattern already ships on `main`: vendor-gated capture (P24 `captureServer()`), local mirror table (`events_mirror` P27), matview-with-SECDEF-accessor (P30), pg_cron via vault key (P30/P33), org-scoped SECDEF (`_is_org_clinician` P31), funnel-anomaly cron extension target (`funnel-anomaly-cron` P27), admin module manifest entry shape (P33 `growth-cac`), card→drawer dashboard chrome (P33 `CACDashboardPage`), and PostHog server-side alias (`aliasServerSide` in `_shared/posthog-server.ts` from P34 plan 34-05).

**The one architecturally novel surface** is the `lt_anon_id` HttpOnly cookie set BEFORE React boots. The current app is a Vite-built **static SPA** served from Vercel (per `leanshot/CLAUDE.md` — "Static SPA — output of `vite build` (no Vite-emitted server)"). There is no Vite SSR, no Vercel rewrites to Supabase Fns at the landing route, and no Vercel Edge Middleware in tree. **A Vercel Edge Middleware (`leanshot/middleware.ts`) is the lowest-cost net-add** that can set HttpOnly cookies before the SPA HTML response leaves the edge — see Q1 below. This is the ONE place in the plan where the planner cannot pattern-match; everything else has a copy-and-modify reference.

**Primary recommendation:** Plan as **8–10 plans**: (1) migration foundations — taxonomy tables + `user_traffic_attribution` + 4 matviews + retention helper + cron extension + RLS; (2) `captureServer.recordTouch()` helper + events.ts additive events; (3) `traffic-attribution-recorder` Edge Fn (called by middleware + signup hooks); (4) **Vercel Edge Middleware** for `lt_anon_id` / `lt_org_id` cookie set + first-touch fire-and-forget; (5) signup-hook PostHog `alias()` integration (extend existing `merge-anon-session` Edge Fn rather than add new); (6) `get_realtime_traffic_summary()` SECDEF RPC; (7) `funnel-anomaly-cron` extension (per-channel-stage scan); (8) `growth/traffic` admin module shell + Channels tab; (9) Funnels + Landing Pages tabs; (10) Real-time tab + Taxonomy admin sub-page. Plans 8–10 can wave-parallel; 1–4 are serial backend; 5 + 7 depend on 1.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Channel taxonomy + attribution model** (D-01 → D-04)
- **D-01** Full UTM granularity captured verbatim + operator-configurable `channel_groups` table seeded with 8 defaults (Direct, Organic Search, Organic Social, Paid Search, Paid Social, Email, Referral, Affiliate). Each row carries a `match_rule_jsonb` (e.g., `{utm_medium: ['cpc','ppc'], utm_source: ['google','bing']}` → Paid Search). Operator edits via admin UI; takes effect at next matview refresh.
- **D-02** First-touch AND last-touch attribution stored per user; multi-touch deferred to v1.4. Dashboard toggle.
- **D-03** Curated `referrer_channel_rules` admin table seeded with ~80 well-known domains.
- **D-04** Anonymous tracking via `lt_anon_id` HttpOnly cookie (UUIDv4; `Secure`; `SameSite=Lax`; TTL 90d) + PostHog `alias()` stitch on signup.

**Funnel shape + conversion definition** (D-05 → D-08)
- **D-05** Three parallel funnels: Consumer (visit→signup→activation(P34)→paid(P14)); Clinic-org (visit→clinic-signup→first-patient-added→first-paid-seat(P29)); Affiliate (visit→affiliate-signup→first-referral-conversion(P26)).
- **D-06** Activation event (P34 ONBOARD locked event) is the north-star CAC; paid secondary. **Creates Phase 51 → Phase 34 dependency.**
- **D-07** 30-day default attribution window per channel-group; operator-overridable on `channel_groups.attribution_window_days`. Cookie TTL 90d.
- **D-08** Extend P24 `funnel-anomaly-cron` with per-channel funnel-stage alerts; no new cron. Dedup key = (channel_group, audience, funnel, stage_pair, date).

**Dashboard surface granularity** (D-09 → D-12)
- **D-09** New `growth/traffic` ADMIN_MODULES entry, sibling of `growth/cac` under shared 'Growth' nav. 4 tabs: Channels, Funnels, Landing Pages, Real-time. Channel rows deep-link to `growth/cac` for paid.
- **D-10** Real-time tab: 5-min poll against `events_mirror` direct query via `get_realtime_traffic_summary()` admin RPC.
- **D-11** Landing Pages tab joins `page_variant_id` from PAGEAB (P15). **[ASSUMED] PAGEAB has not yet shipped a `page_variants` table on main** — see Q2.
- **D-12** Per-clinic-org dashboard view (BIG SCOPE ADD). `org_id` dimension on `user_traffic_attribution` + all 4 matviews. RLS: `is_admin()` sees all; `_is_org_clinician(org_id)` sees org-scoped.

**Attribution storage + cross-channel rollup** (D-13 → D-16)
- **D-13** `user_traffic_attribution` SQL table (authoritative) + PostHog person-properties mirror via `captureServer()`. Columns enumerated in CONTEXT.
- **D-14** Family of 4 focused matviews refreshed by single sequenced pg_cron piggy-backed AFTER P33's `ad_revenue_refresh` cron. Concurrent refresh + unique indexes.
- **D-15** Paid ad-spend join by `(channel_group, day)` aggregate. Fixed network → channel_group mapping: Meta→'Paid Social', Google→'Paid Search', TikTok→'Paid Social'.
- **D-16** Full cohort retention curves per channel (D1/D7/D14/D30/D60) on `traffic_channel_rollup`. Per-audience retention semantics.

### Claude's Discretion

- Edge Fn / RPC file layout: `supabase/functions/traffic-attribution-recorder/` + `supabase/functions/_shared/traffic-attribution.ts`. Real-time RPC `get_realtime_traffic_summary()` as Postgres function (not Edge Fn) for latency.
- Migration timestamp window: `20270704000001..N_*.sql` (CONTEXT proposes 20270704; **VERIFIED current tail is `20270709000008`** — see "Migration timestamp" section below; planner must use `20270710000001+`).
- Partition strategy for `user_traffic_attribution`: un-partitioned (defer until >1M rows).
- RLS posture per CONTEXT.
- Bundle impact: respect v1.3 30 kB admin chunk ceiling. Charts reuse `BaseChart`.
- PHI containment: `user_traffic_attribution` has no PHI columns; add ESLint zone rule preventing PHI tables JOIN-importing INTO attribution table.

### Deferred Ideas (OUT OF SCOPE)

Multi-touch attribution (v1.4); per-funnel-stage attribution-window override; operator funnel-builder UI; supabase-realtime live push for Real-time tab; per-campaign CAC in growth/traffic (stays in growth/cac); click-ID exact-match (`fbclid`/`gclid`/`ttclid`); cross-device user-stitch beyond PostHog default; anonymous bot/spam filtering; per-clinic-org landing-page rollup beyond org_id slicing; CSV/PDF export from dashboard.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRAFFIC-01 | Capture verbatim UTM + referrer at every landing into `user_traffic_attribution` (first-touch immutable; last-touch updated each visit) | D-01, D-02; existing `captureServer()` + `events_mirror` patterns |
| TRAFFIC-02 | `lt_anon_id` HttpOnly cookie (`Secure; SameSite=Lax; Max-Age=7776000`) set server-side before SPA hydration; refreshed on each visit | D-04; net-new Vercel Edge Middleware (Q1) |
| TRAFFIC-03 | PostHog `alias()` on signup merges anon distinct_id → supabase auth.uid | D-04; existing `aliasServerSide()` in `_shared/posthog-server.ts` + `merge-anon-session` Edge Fn |
| TRAFFIC-04 | Operator-configurable `channel_groups` admin table (8 default rows; rule-based JSON matcher; priority order) editable via admin UI without code deploy | D-01; new migration + Taxonomy admin sub-page |
| TRAFFIC-05 | Operator-configurable `referrer_channel_rules` admin table seeded with ~80 well-known referrer domains; editable via admin UI | D-03; Snowplow `referer-parser` JSON list is canonical source |
| TRAFFIC-06 | Three parallel conversion funnels (Consumer, Clinic-org, Affiliate) with per-audience stage definitions wired to existing events | D-05; events_mirror existing + new `traffic_*` event names |
| TRAFFIC-07 | Activation event (P34 ONBOARD) is north-star CAC; matviews join `ad_spend_facts` (P33) at `(channel_group, day)` to activations | D-06, D-15; existing `ad_spend_facts` + `ad_revenue_normalized` join pattern |
| TRAFFIC-08 | Family of 4 matviews (`traffic_channel_rollup`, `traffic_funnel_rollup`, `traffic_landing_page_rollup`) + 1 regular VIEW (`traffic_realtime_v`) refreshed CONCURRENTLY with UNIQUE indexes; refresh sequenced AFTER P33's `ad_revenue_refresh` cron in a single pg_cron job | D-14; P30/P33 matview + cron pattern |
| TRAFFIC-09 | Per-channel retention curves (D1/D7/D14/D30/D60) on `traffic_channel_rollup` with per-audience retained semantics via SECDEF helper `is_retained(user_id, audience, window_days)` | D-16; SECDEF helper pattern |
| TRAFFIC-10 | `user_traffic_attribution` + all 4 matviews + 2 taxonomy tables RLS-scoped: `is_admin()` all; `_is_org_clinician(org_id)` org-scoped; cross-tenant deny test required | D-12; P30 SECDEF accessor pattern |
| TRAFFIC-11 | Per-channel-stage funnel-drop alerts via extension of `funnel-anomaly-cron`; writes to existing `admin_notifications` surface; dedup key = (channel_group, audience, funnel, stage_pair, date) | D-08; existing Edge Fn extension only |
| TRAFFIC-12 | `growth/traffic` admin module renders 4 tabs + Taxonomy sub-page; 4 sizes / 2 weights typography ceiling; Pill-segmented tabs; Sheet drill-in | UI-SPEC; CACDashboardPage sibling |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Server-side cookie set + first-touch capture | Vercel Edge (Middleware) | Supabase Edge Fn (`traffic-attribution-recorder`) | Cookie MUST be set before SPA boots; only edge/server response can do it. Middleware fires fire-and-forget to recorder Fn. |
| Anonymous→identified stitch (PostHog alias) | Supabase Edge Fn (`merge-anon-session` extension) | — | PostHog server-side alias already lives here (P34 plan 34-05); add lt_anon_id propagation |
| Authoritative attribution storage | Supabase Postgres (`user_traffic_attribution` SQL table) | PostHog person-properties mirror (best-effort) | SQL is RLS-scopeable, matview-joinable, queryable; PostHog is convenience |
| Channel classification at write time | Supabase Postgres (read taxonomy tables in matview refresh SQL) | — | Operator edits in admin → next refresh picks up; deterministic + auditable |
| Aggregations (channel rollup / funnel / landing page) | Supabase Postgres matviews (refreshed via pg_cron) | — | Read cost O(1) per dashboard load |
| Real-time tab | Supabase Postgres (`get_realtime_traffic_summary` SECDEF RPC) | Browser (TanStack-Query 5min poll — overridden by UI-SPEC to native `useEffect` poll) | Direct query over `events_mirror` last 60min; no matview |
| Funnel-anomaly alerts | Supabase Edge Fn (`funnel-anomaly-cron` extension) | `admin_notifications` table | No new cron; one diff against existing Fn |
| Admin module UI | Browser SPA (lazy chunk under admin shell) | Supabase RPCs for data | Reuse `CACDashboardPage` chrome verbatim |
| Per-clinic-org scope | Postgres RLS on matviews + tables | Same UI components, RLS-driven data slice | `is_admin()` OR `_is_org_clinician(org_id)` |

## Standard Stack

### Core (already in tree — zero installs needed for backend)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| posthog-node | `5.10.4` (already pinned in `_shared/posthog-server.ts`) | Server-side capture + `alias()` | Already wired; `aliasServerSide()` helper exists |
| @supabase/supabase-js | `npm:@supabase/supabase-js@2` (Deno isolate) | Service-role + JWT clients in Edge Fns | Canonical project pattern |
| pg_cron | Postgres extension (already on project) | Scheduled matview refresh | P30/P33 precedent |
| pgvault (`vault.decrypted_secrets`) | extension | `service_role_key` for `net.http_post` from cron | P33 cron precedent — see `reference_supabase_pg_cron_vault_service_role_pattern` |

### Frontend (already in tree)

| Library | Version | Purpose |
|---------|---------|---------|
| React | `^19.0.0` | SPA |
| chart.js | `^4.4.6` via `BaseChart.tsx` | Funnel + retention curve rendering |
| lucide-react | `^0.460.0` | Icons (`Activity`, `Filter`, `Map`, `LayoutList`, `Settings2`, `RefreshCw`) |
| zustand | `^5.0.1` | Existing role + theme state |

### Net-add (planner MUST verify these exact picks at iter-1)

| Library | Version | Purpose | Where it lives |
|---------|---------|---------|----------------|
| Vercel Edge Middleware (zero-dep) | n/a — built into Vercel | `lt_anon_id` cookie set + fire-and-forget call to recorder Fn | `leanshot/middleware.ts` (new file at SPA root, Vercel auto-detects) |
| Snowplow `referer-parser` JSON | latest snapshot from `https://s3-eu-west-1.amazonaws.com/snowplow-hosted-assets/third-party/referer-parser/referers-latest.json` | Seed data for `referrer_channel_rules` | Static fixture committed to migration as INSERT seed; ~80 rows |

### Verified package versions (via tree inspection)

- `posthog-node@5.10.4` (verified in `_shared/posthog-server.ts:33`)
- `posthog-node alias() arg shape: { distinctId, alias }` (verified — see `aliasServerSide` lines 358–369; CITED: https://posthog.com/docs/references/posthog-node)
- Current migration tail: `20270709000008_p40_roi_view.sql` (verified via `ls -lt supabase/migrations/`) — **Phase 51 must use timestamps ≥ `20270710000001`**, NOT CONTEXT's `20270704000001` (CONTEXT was written before P35/P37/P40 landed). Planner must pre-merge `ls supabase/migrations/20270710*.sql | wc -l` collision check per `reference_migration_timestamp_collision_precheck`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vercel Edge Middleware | Supabase Edge Fn called via Vercel rewrite at `/` | Adds extra hop + must rewrite every landing path; middleware is the canonical pattern |
| TanStack Query for real-time poll | Native `useState + useEffect + setInterval` (UI-SPEC override) | UI-SPEC explicitly forbids TanStack Query (not in codebase); use CAC's pattern |
| Roll-our-own referrer parser | Snowplow `referer-parser` JSON | Snowplow updated daily; ~80 domains covers our channels; deferred parser-of-parser layer to v1.4 |

**Installation:** None for backend. Snowplow JSON is a one-time fetch committed as a migration seed.

**Version verification:** `npm view posthog-node version` → 5.x current. Project pins 5.10.4 — leave pinned (no upgrade needed for `alias()` per docs `>=5.25.0`; **WAIT — this is a HIGH-confidence trap. Project pin is 5.10.4 but PostHog docs say alias requires `>=5.25.0`**. The fact that `aliasServerSide()` is already in tree and tests pass means either (a) project actually runs a newer version Deno resolves at runtime, or (b) docs cite the wrong minimum. Planner must verify at iter-1 by running `supabase/functions/_shared/posthog-server.test.ts` against the alias path — if test passes, leave; if not, bump deno.json import map.

## Architecture Patterns

### System Architecture Diagram

```text
                         ┌─────────────────────────────────────────────────┐
                         │              VISITOR (browser)                  │
                         │  GET /pricing?utm_source=google&utm_medium=cpc  │
                         └────────────────────┬────────────────────────────┘
                                              ↓
                ┌─────────────────────────────────────────────────────┐
                │       Vercel Edge Middleware (leanshot/middleware.ts) │  ← NEW (Q1)
                │   1. If no lt_anon_id cookie → mint UUIDv4           │
                │   2. Set-Cookie: lt_anon_id=<uuid>; HttpOnly; Secure;│
                │      SameSite=Lax; Max-Age=7776000; Path=/           │
                │   3. If path matches /share/clinic-{slug} → also     │
                │      set lt_org_id cookie (slug→org_id at edge)      │
                │   4. fetch(traffic-attribution-recorder, fire-forget)│
                │      with { anon_id, org_id?, url, referer, ua, utm }│
                │   5. Continue to SPA HTML                            │
                └────────────────────┬────────────────────────────────┘
                                     ↓
                         ┌────────────────────────────┐
                         │   Vite-built SPA boots     │
                         │   (no SSR; static HTML)    │
                         └────────────────────────────┘
                                     ↓ (user navigates, signs up)
                ┌─────────────────────────────────────────────────────┐
                │       Supabase Edge Fn: merge-anon-session          │  ← EXTEND
                │   On signup: reads lt_anon_id cookie + body         │
                │     - calls aliasServerSide(supabaseUid, anonId)    │
                │     - upserts user_traffic_attribution.user_id      │  ← NEW
                │     - applies last_touch update                     │
                └────────────────────┬────────────────────────────────┘
                                     ↓
        ┌────────────────────────────────────────────────────────────────┐
        │                                                                │
        │  ┌─────────────────────────┐   ┌──────────────────────────┐  │
        │  │ traffic-attribution-    │   │ captureServer().recordTouch│ ← NEW │
        │  │ recorder (Edge Fn)      │──▶│  helper in _shared/        │  │
        │  │ (called by middleware + │   │  traffic-attribution.ts    │  │
        │  │  signup hooks)          │   │  - UPSERT user_traffic_attr│  │
        │  └─────────────────────────┘   │  - PostHog person-prop set │  │
        │                                 │  - captureServer('traffic_*│  │
        │                                 │     visit') → events_mirror│  │
        │                                 └──────────────────────────┘  │
        └────────────────────────────────────────────────────────────────┘
                                              ↓
                ┌─────────────────────────────────────────────────────┐
                │                  Postgres                            │
                │  ├─ user_traffic_attribution (1 row/user; RLS)      │  ← NEW
                │  ├─ channel_groups (8 seed rows; admin CRUD)        │  ← NEW
                │  ├─ referrer_channel_rules (~80 seed rows)          │  ← NEW
                │  ├─ events_mirror (existing P27; +traffic_* events) │
                │  ├─ ad_spend_facts (existing P33; LEFT JOIN target) │
                │  └─ Matviews refreshed sequentially by pg_cron:     │  ← NEW
                │     P33 ad_revenue_refresh (existing)               │
                │       ↓                                              │
                │     traffic_channel_rollup                          │
                │       ↓                                              │
                │     traffic_funnel_rollup                           │
                │       ↓                                              │
                │     traffic_landing_page_rollup                     │
                │     traffic_realtime_v (VIEW — not refreshed)       │
                └────────────────────┬────────────────────────────────┘
                                     ↓
                ┌─────────────────────────────────────────────────────┐
                │       Admin Dashboard: /admin/growth/traffic         │  ← NEW
                │   Sibling of /admin/growth/cac                       │
                │   Tabs: Channels / Funnels / Landing Pages / Real-time│
                │   + /admin/growth/traffic/taxonomy admin sub-page    │
                └─────────────────────────────────────────────────────┘

                ┌─────────────────────────────────────────────────────┐
                │  funnel-anomaly-cron (P27 existing; EXTEND)         │
                │  - Add per-channel-stage anomaly scan               │  ← EXTEND
                │  - Dedup: (channel_group, audience, funnel,         │
                │           stage_pair, date)                          │
                │  - Write to existing admin_notifications surface    │
                └─────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
leanshot/
├── middleware.ts                                            ← NEW (Vercel Edge Middleware)
├── src/
│   ├── components/admin/growth/
│   │   ├── CACDashboardPage.tsx                            ← reference (Phase 33)
│   │   ├── TrafficDashboardPage.tsx                        ← NEW (entry component)
│   │   ├── TrafficChannelsTab.tsx                          ← NEW
│   │   ├── TrafficFunnelsTab.tsx                           ← NEW
│   │   ├── TrafficLandingPagesTab.tsx                      ← NEW
│   │   ├── TrafficRealtimeTab.tsx                          ← NEW
│   │   └── TrafficTaxonomyPage.tsx                         ← NEW (sub-page)
│   ├── lib/admin/modules.ts                                ← EDIT (add growth-traffic entry)
│   └── lib/analytics/events.ts                             ← EDIT (add traffic_* events)
supabase/
├── functions/
│   ├── _shared/
│   │   ├── posthog-server.ts                              ← EDIT (add recordTouch helper)
│   │   └── traffic-attribution.ts                          ← NEW
│   ├── merge-anon-session/index.ts                         ← EDIT (read lt_anon_id, upsert attribution)
│   ├── traffic-attribution-recorder/                       ← NEW
│   │   ├── index.ts
│   │   ├── traffic-attribution-recorder.test.ts
│   │   └── deno.json
│   └── funnel-anomaly-cron/index.ts                        ← EDIT (per-channel-stage scan)
└── migrations/                                              ← NEW (≥ 20270710000001_*)
    ├── 20270710000001_user_traffic_attribution.sql
    ├── 20270710000002_channel_groups.sql
    ├── 20270710000003_referrer_channel_rules_seed.sql
    ├── 20270710000004_traffic_channel_rollup_matview.sql
    ├── 20270710000005_traffic_funnel_rollup_matview.sql
    ├── 20270710000006_traffic_landing_page_rollup_matview.sql
    ├── 20270710000007_traffic_realtime_view_and_rpc.sql
    ├── 20270710000008_is_retained_secdef_helper.sql
    ├── 20270710000009_traffic_matview_refresh_cron.sql
    ├── 20270710000010_traffic_rls_policies.sql
    └── 20270710000011_traffic_rls_deny_tests.sql
```

### Pattern 1: Vercel Edge Middleware for HttpOnly Cookie

**What:** Vercel Edge Middleware runs at the edge BEFORE any static asset is served. Setting `Set-Cookie` headers in middleware response is the only way to set an HttpOnly cookie on a static SPA without server-side rendering.

**When to use:** Always — this is the only valid place to set `lt_anon_id` before SPA boot. **[VERIFIED: project is static SPA per `leanshot/CLAUDE.md`; no Vite SSR, no Vercel rewrites in tree]**.

**Example:**
```typescript
// leanshot/middleware.ts
// Source: Vercel docs — https://vercel.com/docs/functions/edge-middleware
import { NextResponse } from 'next/server';  // works under Vercel even for Vite; the runtime is Edge
// NOTE: Vercel docs are Next-centric but middleware.ts contract is framework-agnostic;
// research SHOULD verify this works for a Vite SPA project at plan-iter-1.
// CITED: https://vercel.com/docs/functions/edge-middleware
import type { NextRequest } from 'next/server';

export const config = {
  matcher: ['/((?!_next|api|favicon.ico).*)'],  // every page except _next + api
};

export default function middleware(req: NextRequest) {
  const response = NextResponse.next();
  const existingAnon = req.cookies.get('lt_anon_id')?.value;
  const anonId = existingAnon ?? crypto.randomUUID();

  // Always (re)set to refresh sliding 90d window
  response.cookies.set('lt_anon_id', anonId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 90,
    path: '/',
  });

  // /share/clinic-{slug} → resolve org_id at the edge and set lt_org_id
  const url = req.nextUrl;
  const clinicMatch = url.pathname.match(/^\/share\/clinic-([a-z0-9-]+)/);
  if (clinicMatch) {
    // Async fire-and-forget: call recorder to resolve slug → org_id
    // OR set a transient flag and let recorder resolve via RPC
    response.cookies.set('lt_clinic_slug_seen', clinicMatch[1], {
      httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: 60 * 5,  // 5min — slug → org_id resolution happens server-side, lt_org_id replaces it
    });
  }

  // Fire-and-forget: recorder receives the touch
  // Use ctx.waitUntil if available; otherwise let response return and let recorder be polled by SPA
  // For v1.3: SPA's first React-mount POSTs to recorder via /functions/v1/traffic-attribution-recorder
  return response;
}
```

**Caveats** [ASSUMED — verify with project-specific Vercel deploy test]:
- A Vercel project NOT using Next.js may need `middleware.ts` at the project root with explicit edge runtime config. Vite + Vercel + middleware.ts works in current Vercel docs but **planner must add a verify-deploy task to confirm against `karstenhaldan-5548/leanshot-marketing`** (see project memory `reference_vercel_project`).
- If middleware.ts route at root doesn't trigger (Vite project root vs. monorepo root mismatch), fallback is **a Supabase Edge Fn at a Vercel-rewritten path `/api/traffic-touch` and have the SPA call it on first React mount**. This loses the "before SPA boot" guarantee but still captures first-touch with a 1-tick delay. Plan-checker should accept either path.

### Pattern 2: Sequenced pg_cron matview refresh (D-14)

**What:** Single pg_cron job that refreshes P33's existing matview AND Phase 51's 4 net-new matviews in a deterministic dependency order.

**When to use:** Always for cross-phase matview dependencies; avoids "stale ad_spend at refresh time" race.

**Example** (combines P33's existing schedule + Phase 51 extension):
```sql
-- supabase/migrations/20270710000009_traffic_matview_refresh_cron.sql
-- Source: Phase 33 plan 01 migration 11 + Phase 30 plan 00 matview pattern
-- ─────────────────────────────────────────────────────────────────────────
-- IDEMPOTENT: unschedule old + reschedule
select cron.unschedule('ad_revenue_refresh')
  where exists (select 1 from cron.job where jobname = 'ad_revenue_refresh');

-- Sequenced refresh: P33 ad_revenue → P51 channel → funnel → landing
select cron.schedule(
  'ad_revenue_and_traffic_refresh',
  '10 * * * *',  -- inherits P33's :10 slot
  $body$
    select public.refresh_ad_revenue_normalized();
    refresh materialized view concurrently public.traffic_channel_rollup;
    refresh materialized view concurrently public.traffic_funnel_rollup;
    refresh materialized view concurrently public.traffic_landing_page_rollup;
  $body$
);
```

**Caveat** (Postgres `$$` nesting per `reference_postgres_dollar_quote_nesting_in_cron_body`): use named tag `$body$...$body$` since inner `$$` would close prematurely. Validated against P33 cron migration.

### Pattern 3: Channel-group match algorithm (D-01)

**What:** Operator-editable `match_rule_jsonb` evaluated in priority order at matview refresh time. Each rule is `{ utm_source?: string[], utm_medium?: string[], utm_campaign?: string[] }`. Match semantics: **all specified keys must hit (AND across keys); within a key value must be in the array (OR within key)**.

**SQL helper:**
```sql
-- supabase/migrations/20270710000002_channel_groups.sql
create table public.channel_groups (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,                       -- 'Paid Search', 'Organic Social', ...
  priority int not null,                            -- lower = checked first
  match_rule_jsonb jsonb not null,                  -- { utm_medium: [...], utm_source: [...] }
  attribution_window_days int not null default 30 check (attribution_window_days between 1 and 90),
  is_default_fallback boolean not null default false, -- exactly one row true ('Direct')
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Match function — IMMUTABLE, used inside matview refresh
create or replace function public.classify_channel_group(
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text
) returns text
language sql
stable
set search_path = pg_catalog, public, extensions
as $$
  select cg.label
  from public.channel_groups cg
  where
    (cg.match_rule_jsonb->'utm_medium' is null
      or p_utm_medium = any(array(select jsonb_array_elements_text(cg.match_rule_jsonb->'utm_medium'))))
  and (cg.match_rule_jsonb->'utm_source' is null
      or p_utm_source = any(array(select jsonb_array_elements_text(cg.match_rule_jsonb->'utm_source'))))
  and (cg.match_rule_jsonb->'utm_campaign' is null
      or p_utm_campaign = any(array(select jsonb_array_elements_text(cg.match_rule_jsonb->'utm_campaign'))))
  order by cg.priority asc
  limit 1;
$$;

-- Fallback: classify_channel_group_with_referrer (next migration) wraps this and
-- falls through to referrer_channel_rules + finally 'Direct' if all miss.
```

**Seed (8 default rows):**
```sql
insert into public.channel_groups (label, priority, match_rule_jsonb, is_default_fallback) values
  ('Paid Search',    10, '{"utm_medium": ["cpc","ppc","paidsearch"], "utm_source": ["google","bing","duckduckgo"]}', false),
  ('Paid Social',    11, '{"utm_medium": ["paid","paidsocial","cpc"], "utm_source": ["facebook","instagram","tiktok","meta"]}', false),
  ('Email',          20, '{"utm_medium": ["email","newsletter"]}', false),
  ('Affiliate',      30, '{"utm_medium": ["affiliate","partner"]}', false),
  ('Organic Search', 40, '{"utm_medium": ["organic"], "utm_source": ["google","bing","duckduckgo"]}', false),
  ('Organic Social', 41, '{"utm_medium": ["social","organicsocial"], "utm_source": ["facebook","instagram","tiktok","linkedin","x","twitter"]}', false),
  ('Referral',       50, '{"utm_medium": ["referral"]}', false),
  ('Direct',         99, '{}', true);
```

### Pattern 4: PostHog server-side alias (already exists)

**What:** `aliasServerSide(supabaseUid, anonDistinctId)` in `_shared/posthog-server.ts:358–369` is wired and tested. Phase 51 just needs to call it from `merge-anon-session` with the `lt_anon_id` cookie value AS the anon distinct_id.

**Verified existing call site:** `supabase/functions/merge-anon-session/index.ts` already calls `aliasServerSide` for the posthog-js distinct_id; Phase 51 extension adds a second call with `lt_anon_id` as the alias.

```typescript
// Inside merge-anon-session handler (extension):
const ltAnonId = parseCookie(req.headers.get('cookie'), 'lt_anon_id');
if (ltAnonId) {
  aliasServerSide(supabaseUid, ltAnonId);
  // Then: upsert user_traffic_attribution.user_id = supabaseUid where anon_id = ltAnonId
  await admin.rpc('claim_traffic_attribution', { p_anon_id: ltAnonId, p_user_id: supabaseUid });
}
```

### Pattern 5: SECDEF accessor for matview RLS (P30/P33 precedent)

**What:** Postgres does NOT support RLS on materialized views. The canonical workaround: `REVOKE all on matview from public/authenticated`, then expose via SECURITY DEFINER accessor function that gates on `is_admin()` OR `_is_org_clinician(org_id)`.

**When to use:** All 4 Phase 51 matviews. Mirror migration `20270601300004_p30_matviews_and_cron.sql` lines 73–124 exactly.

**Example** (compress for brevity; full pattern is well-established):
```sql
revoke all on public.traffic_channel_rollup from public, authenticated;

create or replace function public.get_traffic_channel_rollup(
  p_org_id uuid default null,    -- null = all orgs (admin only)
  p_start_date date default null,
  p_end_date date default null
) returns table (
  channel_group text, audience text, day date, org_id uuid,
  visits bigint, signups bigint, activations bigint, paids bigint,
  ad_spend_usd numeric, d1_retained_count bigint, d7_retained_count bigint,
  d14_retained_count bigint, d30_retained_count bigint, d60_retained_count bigint,
  cac_to_activation numeric, cac_to_paid numeric
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  -- Admin sees all orgs; clinician sees only their org
  if public.is_admin() then
    return query
    select * from public.traffic_channel_rollup tcr
    where (p_org_id is null or tcr.org_id = p_org_id)
      and (p_start_date is null or tcr.day >= p_start_date)
      and (p_end_date is null or tcr.day <= p_end_date);
  elsif p_org_id is not null and public._is_org_clinician(p_org_id, v_uid) then
    return query
    select * from public.traffic_channel_rollup tcr
    where tcr.org_id = p_org_id
      and (p_start_date is null or tcr.day >= p_start_date)
      and (p_end_date is null or tcr.day <= p_end_date);
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;
```

### Anti-Patterns to Avoid

- **Hand-rolling UUID generation in middleware** — use Edge runtime's `crypto.randomUUID()`. Don't bundle `uuid` npm package; doubles edge cold-start.
- **Setting `Domain=.leanshot.app` on the cookie** — leave domain unset so it scopes to the request host. Per `reference_supabase_auth_traps`, hash-route SPAs and cookie domains have weird interactions.
- **Calling `auth.uid()` inside Phase 51 SECDEF RPCs from cron/service-role caller** — per `feedback_rpc_auth_uid_vs_service_role_mismatch`, the cron-driven matview refresh path must NOT pass through SECDEF RPCs that call `auth.uid()`. Refresh runs as table-owner; cron user has no JWT.
- **Writing matview SELECTs with `now()`** — frozen at matview creation time (P30 PITFALL 1). Use date-trunc against event timestamps instead.
- **Forgetting `IMMUTABLE` on partial-index predicates** — per `reference_supabase_migration_gotchas`. The partial index `(user_id) WHERE user_id is not null` is safe; any predicate using `now()` is not.
- **TanStack Query for Real-time tab** — UI-SPEC explicitly forbids. Use CAC's `useState + useEffect + setInterval` pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Referrer domain → channel classification | Custom regex on `referer` header | Snowplow `referer-parser` JSON seeded into `referrer_channel_rules` | Snowplow is daily-updated and covers Apple News, Yandex, Yahoo Japan edges we'd miss |
| UUID generation in edge runtime | `crypto.getRandomValues` + manual byte assembly | `crypto.randomUUID()` (built-in to Edge runtime) | Native, zero-dep, RFC-compliant |
| HMAC cookie signing | bring `@noble/hashes` etc. | Use Postgres `auth.uid()` + service-role tampering check at recorder Fn | The cookie is opaque UUID; tampering = a new visitor, not impersonation |
| Multi-touch attribution model | Implement linear/position/time-decay | DEFERRED to v1.4 per CONTEXT | Multi-touch needs touchpoints table + 4× matview cost; first+last covers 90% of decisions |
| Click-ID exact match (`fbclid`/`gclid`) | Build a parser + ad-network reconciliation | DEFERRED to v1.4 per CONTEXT | Each ad network has own ID format + matching window; v1.4 parity work |
| Bot/spam filtering | User-Agent regex | DEFERRED to v1.4 per CONTEXT (start naive) | Real bot detection wants reCAPTCHA Enterprise + behavioral signals |
| Per-org real-time push | supabase-realtime subscription | 5-min poll (D-10) | UI-SPEC + CONTEXT both lock 5-min poll |
| Cohort analysis library | Build retention bucketing | SECDEF helper `is_retained(user_id, audience, window_days)` (D-16) | One SQL function; pure data; reused across matview rows |

**Key insight:** Phase 51 is overwhelmingly a **stitch-together** of existing patterns. The single non-trivial design call is "where does the HttpOnly cookie get set?" — and the answer is "Vercel Edge Middleware, with Supabase Edge Fn fallback if middleware deploy fails."

## Runtime State Inventory

This is **not** a rename / refactor / migration phase — it is greenfield additive. Skipping detailed inventory; no existing runtime state needs migration. Three small notes for the planner:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 51 creates new tables only | None |
| Live service config | PostHog person properties get new keys (`first_touch_channel_group`, etc.) | None — PostHog person-property schema is additive |
| OS-registered state | None | None |
| Secrets/env vars | None new — reuses `SUPABASE_SERVICE_ROLE_KEY`, `POSTHOG_PROJECT_KEY` already in Function Secrets | None |
| Build artifacts | None | None — no package.json changes for backend; frontend zero-install |

## Project Constraints (from CLAUDE.md)

| Directive | Phase 51 impact |
|-----------|------------------|
| React 19 + Vite + TS strict + Tailwind v4 beta + Zustand — **locked** | Frontend components use these primitives; no new client framework |
| Local-first must continue to work offline | Phase 51 is admin-only / server-side; does not touch consumer offline path |
| Not yet a HIPAA covered entity; avoid pushing into that bucket | `user_traffic_attribution` carries NO PHI by construction (UTM + referrer + landing_path are non-PHI; D-13 invariant). Add ESLint zone rule per CONTEXT discretion item. |
| AI dependency: Anthropic outage = degraded coach UX, not full-app outage | Phase 51 has no Anthropic dependency |
| Bundle size: code-split aggressively | New admin module loads lazily via `ADMIN_MODULES.lazy()` — chunk budget 30 kB per UI-SPEC |
| Accessibility: keyboard nav, screen-reader labels, contrast, reduced-motion | UI-SPEC mirrors CAC's a11y posture; Pill `aria-pressed`, Sheet `role="dialog"`, `useReducedMotion` already wired |
| `data-theme` set pre-mount; design tokens in `src/index.css` | Phase 51 admin module reuses `var(--color-*)` tokens; no new CSS variables |
| **GSD Workflow Enforcement:** start work through GSD command | Phase 51 is in GSD plan-phase flow already |

## Common Pitfalls

### Pitfall 1: Static SPA vs Edge Middleware mismatch

**What goes wrong:** Project is a static Vite SPA (`leanshot/CLAUDE.md`: "Static SPA — output of `vite build` (no Vite-emitted server)"). Vercel middleware.ts at SPA root may not be auto-wired the same way it is for Next.js. Result: cookie never gets set, first-touch attribution always misses.

**Why it happens:** Vercel middleware docs are Next-centric; Vite + Vercel + middleware.ts is supported but less documented.

**How to avoid:** Plan a **deploy-time verify task**: after middleware.ts lands, hit a fresh `curl -I https://app.leanshot.app/?utm_source=test` and assert `Set-Cookie: lt_anon_id=...; HttpOnly` is in the response. If absent, fallback to Supabase Edge Fn behind a Vercel rewrite at `/api/touch` + SPA-mount-time POST.

**Warning signs:** Local `vercel dev` doesn't run middleware → check vercel.json + middleware.ts placement.

### Pitfall 2: `auth.uid()` inside cron-driven path

**What goes wrong:** Per `feedback_rpc_auth_uid_vs_service_role_mismatch`, any SECDEF RPC called from the matview refresh cron path that calls `auth.uid()` returns null and breaks. Phase 51's matview refresh SHOULD NOT pass through `get_*_rollup` accessor functions; it refreshes the matview directly. Accessor functions are dashboard-read-time only.

**Why it happens:** Easy mistake to call accessor function from cron "for symmetry."

**How to avoid:** Cron body uses only `refresh materialized view concurrently public.<name>;` — no function calls. Plan-checker should grep cron migration body for any `get_traffic_*(` or `_is_org_clinician(` calls.

**Warning signs:** Matview refresh logs show `auth.uid() is null` errors.

### Pitfall 3: Migration timestamp collision

**What goes wrong:** CONTEXT specifies `20270704000001+` but the actual remote tail is `20270709000008`. Local migration older than remote's last applied → CLI refuses to push ANYTHING (per `reference_supabase_back_dated_migration_blocks_push`).

**Why it happens:** CONTEXT.md was written 2026-05-18 before P35/P37/P40 landed (P40 closed 2026-05-21).

**How to avoid:** Planner uses timestamps `≥ 20270710000001` and pre-merge runs `ls supabase/migrations/20270710*.sql | wc -l` per `reference_migration_timestamp_collision_precheck`.

**Warning signs:** `supabase db push` errors `migration X is older than Y`.

### Pitfall 4: PAGEAB `page_variants` table doesn't exist on main

**What goes wrong:** D-11 + UI-SPEC reference `page_variant_id` from PAGEAB (P15). **VERIFIED via `grep`: no `page_variants` table exists in `supabase/migrations/`**; P15 page-builder migrations are `landing_pages` + `landing_page_revisions` only. PAGEAB-01..07 REQ-IDs are **unchecked** in REQUIREMENTS.md (P14 / P15 deferred or future work). `traffic_landing_page_rollup.page_variant_id` will reference a table that doesn't exist.

**Why it happens:** Cross-phase dependency on un-shipped work.

**How to avoid:** Phase 51 ships `page_variant_id text` as a NULLABLE column on `traffic_landing_page_rollup` AND on `user_traffic_attribution.first_touch_page_variant_id` (etc). Source the value from `properties.page_variant_id` on the `traffic_visit` event if present; null otherwise. PAGEAB phase (whenever it ships) wires the value into events without schema changes here. Plan-checker should confirm no FK to `page_variants` exists.

**Warning signs:** Migration fails with `relation "page_variants" does not exist`.

### Pitfall 5: posthog-node alias() requires >=5.25.0

**What goes wrong:** Project pins `posthog-node@5.10.4` but PostHog docs (CITED: https://posthog.com/docs/references/posthog-node) say `alias` requires `>=5.25.0`. Existing `aliasServerSide` may be silently no-op.

**Why it happens:** Either (a) the project actually resolves a newer version via Deno's npm: specifier (npm: registry resolves to latest matching), or (b) the docs are wrong / alias works in 5.10.

**How to avoid:** Planner adds a Wave 0 validation task: run `supabase/functions/_shared/posthog-server.test.ts` with focus on `aliasServerSide`; if it doesn't actually fire, bump the import map to `npm:posthog-node@^5.25.0`.

**Warning signs:** PostHog Identify dashboard shows two distinct users for the same person post-signup.

### Pitfall 6: Matview `now()` freeze

**What goes wrong:** `traffic_realtime_v` uses `WHERE created_at > now() - interval '60 minutes'`. **This is fine because it's a regular VIEW (not matview)** — `now()` re-evaluates per query. The other 3 matviews must NOT use `now()` in their SELECT.

**Why it happens:** P30 PITFALL 1 — easy to drift to matview from view or vice versa.

**How to avoid:** Plan-checker greps each matview migration for `now()` / `current_timestamp` / `current_date` in the SELECT body. Matviews use parameterless windows ("last 90d") materialized into the row via day-bucket; the dashboard query filters by `day >= current_date - 7` at read time inside the SECDEF accessor.

## Code Examples

### `recordTouch()` helper (D-13)

```typescript
// supabase/functions/_shared/traffic-attribution.ts
// Source: extension of _shared/posthog-server.ts captureServer + posthog-node person properties API
// CITED: https://posthog.com/docs/references/posthog-node (capture + setPersonProperties)
import { captureServer, shutdownPostHog } from './posthog-server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return _admin;
}

export interface RecordTouchArgs {
  anonId: string;
  userId?: string;        // present once signup happens
  orgId?: string;         // present on /share/clinic-{slug}
  utm: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  referrer?: string;
  landingPath: string;
  pageVariantId?: string; // PAGEAB if present (Pitfall 4 — nullable)
  channelGroupHint?: string;  // optional pre-classified (else null at write; matview reclassifies)
}

export async function recordTouch(args: RecordTouchArgs): Promise<void> {
  const now = new Date().toISOString();
  const distinctId = args.userId ?? args.anonId;

  // 1. PostHog event (traffic_visit) — dual-writes to events_mirror automatically
  captureServer({
    userId: distinctId,
    event: 'traffic_visit',
    properties: {
      anon_id: args.anonId,
      org_id: args.orgId,
      utm_source: args.utm.source,
      utm_medium: args.utm.medium,
      utm_campaign: args.utm.campaign,
      utm_term: args.utm.term,
      utm_content: args.utm.content,
      referrer: args.referrer,
      landing_path: args.landingPath,
      page_variant_id: args.pageVariantId,
    },
  });

  // 2. Authoritative SQL UPSERT via SECDEF RPC (service-role bypasses RLS;
  //    RPC handles first-touch immutability via ON CONFLICT DO UPDATE that
  //    only sets last_touch_*, never overwrites first_touch_*)
  await admin().rpc('upsert_traffic_attribution', {
    p_anon_id: args.anonId,
    p_user_id: args.userId ?? null,
    p_org_id: args.orgId ?? null,
    p_source: args.utm.source ?? null,
    p_medium: args.utm.medium ?? null,
    p_campaign: args.utm.campaign ?? null,
    p_referrer: args.referrer ?? null,
    p_landing_path: args.landingPath,
    p_touch_at: now,
  });

  // 3. PostHog person properties mirror (best-effort)
  // posthog-node 5.25+ supports client.identify({ distinctId, properties })
  // Skipped here for brevity — copy pattern from posthog-server.ts
}
```

### Funnel-anomaly-cron extension (D-08)

```typescript
// supabase/functions/funnel-anomaly-cron/index.ts (additions only)
// Source: existing handleRun() in lines 143–333; ADD a second pass after the
// per-funnel pass below
// ... existing funnel scan continues
//
// NEW: per-channel-stage scan
const channelStages: Array<{ from: string; to: string; audience: string }> = [
  { from: 'traffic_visit',   to: 'signup_completed',     audience: 'consumer' },
  { from: 'signup_completed', to: 'activation_completed', audience: 'consumer' },
  { from: 'activation_completed', to: 'payment_completed', audience: 'consumer' },
  // ... clinic-org + affiliate stages
];

const { data: groups } = await admin.rpc('list_active_channel_groups');  // 8 rows

for (const stage of channelStages) {
  for (const group of groups ?? []) {
    const { data: rates } = await admin.rpc('compute_channel_stage_rate', {
      p_channel_group: group.label,
      p_audience: stage.audience,
      p_from: stage.from,
      p_to: stage.to,
      p_window_days: 7,
    });
    if (rates && rates.observed_rate < rates.expected_rate - 2 * rates.expected_stddev) {
      const dedupKey = `${group.label}|${stage.audience}|${stage.from}->${stage.to}|${todayISO()}`;
      await admin.from('admin_notifications').upsert({
        kind: 'traffic_funnel_drop',
        dedup_key: dedupKey,
        payload: { channel_group: group.label, audience: stage.audience, stage_pair: stage, rates },
        fired_at: new Date().toISOString(),
      }, { onConflict: 'dedup_key', ignoreDuplicates: true });
    }
  }
}
```

### Admin module manifest entry

```typescript
// leanshot/src/lib/admin/modules.ts — add adjacent to growth-cac (line ~294)
{
  key: 'growth-traffic',
  label: 'Traffic',
  route: 'growth/traffic',
  icon: ActivityIcon,  // import { Activity as ActivityIcon } from 'lucide-react'
  lazy: () =>
    import('@/components/admin/growth/TrafficDashboardPage').then((m) => ({
      default: m.TrafficDashboardPage,
    })),
  flagKey: 'admin.growth.traffic.enabled',
  minRole: 'admin' as AdminRole,
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Browser-side pixel emission (`fbq`, `gtag`) | Server-side `captureServer()` to events_mirror + Meta CAPI relay | Phase 24 + Phase 33 (2026-05) | Adblocker / ITP resilient; Phase 51 builds on top |
| posthog-js `alias()` from browser | `aliasServerSide()` server-side | Phase 34 plan 34-05 (2026-05) | Adblocker resistant; Phase 51 just calls it from merge-anon-session |
| Single per-table cron refresh | Sequenced multi-matview pg_cron with dependency order | Phase 30 plan 00 (2027-06 timestamp) | Phase 51's 4 matviews chain after P33's |
| Matview RLS via `alter materialized view ... enable rls` | REVOKE + SECDEF accessor | Phase 30 (Postgres limitation) | Phase 51 mirrors P30 exactly |

**Deprecated/outdated:**
- Direct `pg_cron` body with bare `$$...$$` when nested inside `cron.schedule(..., $$...$$)` → use named tag `$body$...$body$` per `reference_postgres_dollar_quote_nesting_in_cron_body`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vercel Edge Middleware (`middleware.ts` at project root) works for Vite + Vercel deploy in this project's setup | Architecture / Pattern 1 | Cookie never sets; fallback to SPA-mount POST adds 1 client roundtrip and loses "before SPA boot" guarantee. **Mitigation: add deploy-verify task to plan.** |
| A2 | posthog-node 5.10.4 supports `alias()` despite docs citing ≥5.25.0 minimum | Stack / Pitfall 5 | Anonymous→identified stitch silently breaks. **Mitigation: Wave 0 test runs aliasServerSide path; bump version if needed.** |
| A3 | PAGEAB has not yet shipped `page_variants` table | Pitfall 4 | If table DOES land before Phase 51 (unlikely; P14/P15 unchecked in REQUIREMENTS), Phase 51 misses FK opportunity. **Mitigation: keep nullable text column; PAGEAB plan adds FK when it ships.** |
| A4 | Snowplow `referer-parser` JSON URL is stable enough to fetch once and seed | Stack | If URL is gone at plan-execution time, planner re-fetches latest snapshot from `https://github.com/snowplow-referer-parser/referer-parser`. |
| A5 | `admin_notifications` table accepts a `kind='traffic_funnel_drop'` value without enum widening | Code Examples / Pattern | If `admin_notifications.kind` is an enum, Phase 51 needs same-plan widening migration (per `feedback_planner_missed_status_enum_widening`). **Mitigation: Wave 0 task `\d admin_notifications` to verify.** |
| A6 | `merge-anon-session` Edge Fn body schema accepts new `lt_anon_id` field without breaking existing callers | Pattern 4 | Existing browser callers expect old shape. **Mitigation: keep `lt_anon_id` as optional cookie-read, not body-field.** |
| A7 | Cookie set via `response.cookies.set()` in middleware survives the SPA HTML response | Pattern 1 | Vercel quirks. **Mitigation: deploy-verify task per A1.** |
| A8 | `traffic_realtime_v` regular VIEW (not matview) over last-60min `events_mirror` performs well enough for 5-min polling | D-10 / Architecture | If `events_mirror` is huge by Phase 51 launch and the index `(event_name, created_at desc)` doesn't cover, query latency may spike. **Mitigation: planner adds composite index on `(created_at desc) where created_at > now() - interval '1 hour'` — wait, partial-index predicates must be IMMUTABLE per `reference_supabase_migration_gotchas`. Use plain `(created_at desc)` instead.** |

## Open Questions

### Q1. Where does the landing-page initial response come from, and can Vercel Edge Middleware set HttpOnly cookies on a Vite static SPA?

**What we know:** Project is a static Vite SPA per `CLAUDE.md`; deployed via Vercel (`reference_vercel_project`). No SSR, no Vercel rewrites in tree, no Vercel middleware in tree. The Vite SPA's index.html is served as a static asset by Vercel's edge.

**What's unclear:** Whether `middleware.ts` at `leanshot/` (or monorepo root `/Users/karstenhaldan/minisite/`) is auto-detected by Vercel when the project's framework preset is "Vite" instead of "Next.js." Vercel's middleware docs are Next-centric but the contract is framework-agnostic — **verified at the platform level, but not confirmed for this specific deploy preset**.

**Recommendation:** Plan as if middleware.ts works (it almost certainly does per Vercel's framework-agnostic middleware support). Add a **deploy-verify task as the LAST task of the Edge Middleware plan**: `curl -I https://app.leanshot.app/?utm_source=research_smoke` and assert `Set-Cookie: lt_anon_id=` is in headers. If fails, fall back to Supabase Edge Fn at `/api/touch` called from React mount in `main.tsx` (loses "before boot" but acceptable for v1.3 first-touch).

### Q2. Does the planner need to ship a `page_variants` table to satisfy D-11?

**What we know:** PAGEAB-01..07 are unchecked in REQUIREMENTS.md. P15 (Page Builder) shipped `landing_pages` + `landing_page_revisions` but no `page_variants` table.

**What's unclear:** Whether PAGEAB will eventually ship a `page_variants` table, or if variants will live as columns on `landing_page_revisions`.

**Recommendation:** Phase 51 stores `page_variant_id` as a NULLABLE `text` column on `traffic_landing_page_rollup` and `user_traffic_attribution`. PAGEAB (whenever it ships) populates the value via event property on `traffic_visit`. No FK constraint. Plan-checker should explicitly note: "page_variant_id is text-typed for future PAGEAB compatibility; no FK to page_variants table (which does not exist on main)."

### Q3. Should `lt_org_id` cookie be set at the edge or resolved server-side via slug→org_id lookup?

**What we know:** CONTEXT D-12 says `/share/clinic-{slug}` landings populate `org_id` on `user_traffic_attribution`. P28 ships `resolve_clinic_slug(slug)` SECDEF RPC (anti-enumeration protected) but it requires `auth.uid()` context (authenticated only).

**What's unclear:** Anti-enumeration on the slug — should the middleware leak "this slug exists" by setting `lt_org_id` only when valid? Or set `lt_clinic_slug_seen` transient cookie and have the recorder Fn (service-role) resolve via direct query?

**Recommendation:** Middleware sets `lt_clinic_slug_seen={slug}` (5min TTL) WITHOUT resolution. Recorder Edge Fn (service-role) does the resolution and writes `lt_org_id` cookie on a subsequent visit (after recorder is hit). Anti-enumeration preserved because slug-existence is never exposed to the unauthenticated client.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase project (`ytnsipxxmzgaebkqmokp`) | All matviews + Edge Fns | ✓ | linked | — |
| Vercel project (`leanshot-marketing`) | Edge Middleware | ✓ | per `reference_vercel_project` | — |
| Vercel Edge runtime | `middleware.ts` | ✓ | built-in | Supabase Edge Fn at `/api/touch` |
| pg_cron extension | Matview refresh | ✓ | already enabled per P30/P33 | — |
| vault.decrypted_secrets `service_role_key` | Cron HTTP-post auth | ✓ | already seeded per P33 | — |
| POSTHOG_PROJECT_KEY | captureServer (no-op without) | ✓ | already configured | Vendor-gated no-op (acceptable) |
| posthog-node | aliasServerSide | ✓ | `5.10.4` (may need ≥5.25.0 per docs) | Bump version |
| Supabase Edge Fns runtime (Deno) | All net-new Fns | ✓ | per project | — |
| Snowplow `referer-parser` JSON | Seed referrer_channel_rules | external URL | fetched once at plan-time | committed in migration |

**Missing dependencies with no fallback:** None — all infrastructure exists.

**Missing dependencies with fallback:**
- If Vercel middleware.ts doesn't auto-wire for the Vite preset → Supabase Edge Fn `/api/touch` called from SPA `main.tsx` first React mount.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (frontend, per `reference_vitest_skip_fixme`) + Deno test (Edge Fns) |
| Config file | `leanshot/vitest.config.ts` (existing for frontend RLS suites + component tests); `supabase/functions/<fn>/deno.json` per-Fn |
| Quick run command | `cd leanshot && npm test -- src/components/admin/growth/TrafficDashboardPage.test.tsx --run` |
| Full suite command | `cd leanshot && npm test -- --run` + per-Fn Deno tests via `$HOME/.deno/bin/deno test --no-check supabase/functions/traffic-attribution-recorder/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRAFFIC-01 | UTM + referrer captured into user_traffic_attribution | integration (Deno + supabase) | `deno test --no-check supabase/functions/traffic-attribution-recorder/index.test.ts` | ❌ Wave 0 |
| TRAFFIC-02 | lt_anon_id cookie set on first landing; refreshed each visit | integration (middleware fetch test) | `vitest run leanshot/test/middleware-cookie.test.ts` | ❌ Wave 0 |
| TRAFFIC-03 | PostHog alias() called on signup with lt_anon_id | unit (Deno) | `deno test --no-check supabase/functions/merge-anon-session/merge-anon-session-traffic.test.ts` | ❌ Wave 0 |
| TRAFFIC-04 | channel_groups CRUD + match algorithm correctness | unit (SQL via pgtap) + integration | `pg_prove supabase/tests/channel_groups.sql` | ❌ Wave 0 |
| TRAFFIC-05 | referrer_channel_rules seeded with ≥80 rows; classification correct for known domains | unit (SQL) | `pg_prove supabase/tests/referrer_channel_rules.sql` | ❌ Wave 0 |
| TRAFFIC-06 | 3 funnels: row counts in traffic_funnel_rollup after seeded events | integration | `vitest run leanshot/test/rls-traffic-funnels.test.ts` | ❌ Wave 0 |
| TRAFFIC-07 | ad_spend_facts join produces non-null cac_to_activation for paid groups | integration (SQL) | `pg_prove supabase/tests/traffic_channel_rollup_cac.sql` | ❌ Wave 0 |
| TRAFFIC-08 | Matviews refresh CONCURRENTLY; cron schedule active; ordered after P33 | integration (SQL via supabase db query --linked) | manual — see HUMAN-UAT checklist | ❌ Wave 0 (validate via `select * from cron.job where jobname = 'ad_revenue_and_traffic_refresh'`) |
| TRAFFIC-09 | is_retained() helper returns correct values for each audience | unit (SQL) | `pg_prove supabase/tests/is_retained.sql` | ❌ Wave 0 |
| TRAFFIC-10 | RLS deny: anon role + cross-tenant clinician get 0 rows / 42501 | integration (vitest with two JWTs) | `vitest run leanshot/test/rls-traffic-attribution.test.ts` (mirror Phase 33 pattern) | ❌ Wave 0 |
| TRAFFIC-11 | funnel-anomaly-cron writes admin_notifications row when stage rate < baseline-2σ | unit (Deno) | `deno test --no-check supabase/functions/funnel-anomaly-cron/funnel-anomaly-cron-traffic.test.ts` | ❌ Wave 0 |
| TRAFFIC-12 | Dashboard module renders 4 tabs; segmented control; CACDashboardPage chrome reused | component (vitest + React Testing Library) | `vitest run leanshot/src/components/admin/growth/TrafficDashboardPage.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** quick run (single test file) per commit
- **Per wave merge:** full suite (`cd leanshot && npm test -- --run` + cross-Fn `$HOME/.deno/bin/deno test --no-check supabase/functions/{recorder,merge-anon-session,funnel-anomaly-cron}/`)
- **Phase gate:** Full suite green + `supabase db query --linked` smoke for cron schedule + matview row counts; HUMAN-UAT walkthrough of dashboard with seeded data

### Wave 0 Gaps
- [ ] `supabase/functions/traffic-attribution-recorder/index.test.ts` — covers TRAFFIC-01
- [ ] `leanshot/test/middleware-cookie.test.ts` — covers TRAFFIC-02
- [ ] `supabase/functions/merge-anon-session/merge-anon-session-traffic.test.ts` — covers TRAFFIC-03
- [ ] `supabase/tests/channel_groups.sql` + `referrer_channel_rules.sql` + `is_retained.sql` + `traffic_channel_rollup_cac.sql` — covers TRAFFIC-04/05/07/09 (NB: pgtap may not be installed on remote; planner verifies + falls back to vitest+supabase-js if absent)
- [ ] `leanshot/test/rls-traffic-funnels.test.ts` + `rls-traffic-attribution.test.ts` — covers TRAFFIC-06/10
- [ ] `supabase/functions/funnel-anomaly-cron/funnel-anomaly-cron-traffic.test.ts` — covers TRAFFIC-11
- [ ] `leanshot/src/components/admin/growth/TrafficDashboardPage.test.tsx` (and per-tab .test.tsx) — covers TRAFFIC-12
- [ ] **HUMAN-UAT** for TRAFFIC-08 — cron-driven matview refresh state validated post-deploy via `supabase db query --linked`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth + service-role bearer on Edge Fns (existing) |
| V3 Session Management | yes | `lt_anon_id` HttpOnly + Secure + SameSite=Lax; 90d TTL with sliding refresh |
| V4 Access Control | yes | RLS on all 7 Phase 51 tables + matview SECDEF accessors |
| V5 Input Validation | yes | utm/referrer/landing_path are user-controlled strings — validate length (≤2048 bytes) + ASCII-only at recorder Fn; reject otherwise |
| V6 Cryptography | partial | UUIDv4 via `crypto.randomUUID()` (native); no app-level encryption needed |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant data read (clinician peeking at another org's funnels) | Information Disclosure | `_is_org_clinician(org_id, auth.uid())` gate in SECDEF accessor + explicit deny test per `reference_supabase_project` |
| Anonymous user CSRF-forging utm to skew taxonomy | Tampering | utm is informational only; no auth boundary. Skew detection deferred to v1.4. |
| Attribution cookie stuffing (a competitor sets `lt_anon_id` to known user UUID) | Tampering | `lt_anon_id` is opaque random UUID; collision = ~0. Even on collision, only first-touch row gets shared — no PHI exposure. |
| utm injection (e.g., utm_source containing SQL or HTML) | Injection | Parameterized inserts at recorder Fn (supabase-js client uses prepared statements); dashboard renders utm via React (escaped). Validate length only. |
| Referrer header spoof (bot sets a "Paid Search" referrer to inflate paid CAC) | Tampering / Repudiation | Defense deferred to v1.4 bot filtering. First-touch is "honest by construction" — the visitor's browser sends what it sends. |
| PHI leak through utm/referrer (clinic shares a /patient/123 deep link with utm) | Information Disclosure | utm/referrer/landing_path on `user_traffic_attribution` MUST NOT carry PHI; recorder Fn's input validation must redact `/patient/`, `/clinic/*/patient/`, `/dose-log/` paths to e.g. `/<redacted-phi-path>` before write. New ESLint zone rule per CONTEXT discretion. |
| Cron-replay attack on recorder Fn | Spoofing | Service-role bearer check at Fn head via `checkServiceRoleBearer` from `_shared/lifecycle-utils.ts` (already canonical) |
| Anti-enumeration on `/share/clinic-{slug}` | Information Disclosure | Use `resolve_clinic_slug()` SECDEF RPC (existing P28 anti-enum); middleware never exposes slug-existence to client (Q3) |

## Sources

### Primary (HIGH confidence)
- In-tree code (verified via Read/grep):
  - `supabase/functions/_shared/posthog-server.ts` — captureServer, aliasServerSide, events_mirror dual-write
  - `supabase/functions/funnel-anomaly-cron/index.ts` — anomaly Fn extension target
  - `supabase/migrations/20260601000030_events_mirror.sql` — events_mirror schema
  - `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — matview + SECDEF accessor + cron pattern
  - `supabase/migrations/20270703000008_ad_revenue_normalized_matview.sql` — P33 matview pattern
  - `supabase/migrations/20270703000011_ad_etl_cron_schedules.sql` — P33 cron schedule
  - `supabase/migrations/20270601000035_funnel_anomaly_cron_schedule.sql` — funnel cron schedule
  - `supabase/migrations/20270601300100_p31_00_enum_rename_and_secdef_ripple.sql` — `_is_org_clinician(uuid, uuid)` SECDEF
  - `supabase/migrations/20270601100011_resolve_clinic_slug_rpc.sql` — anti-enum clinic slug resolver
  - `leanshot/src/lib/admin/modules.ts` — ADMIN_MODULES manifest pattern
  - `leanshot/src/components/admin/growth/CACDashboardPage.tsx` — sibling page chrome
  - `leanshot/src/lib/analytics/events.ts` — EventDef shape (additive-only ESLint rule)
  - `supabase/functions/merge-anon-session/index.ts` — existing alias call site
  - `supabase/functions/create-anon-session/index.ts` — anon-cookie pattern reference
- Project memory (verified): `reference_supabase_pg_cron_vault_service_role_pattern`, `reference_postgres_dollar_quote_nesting_in_cron_body`, `reference_supabase_migration_filename_regex`, `reference_migration_timestamp_collision_precheck`, `reference_supabase_back_dated_migration_blocks_push`, `reference_supabase_migration_gotchas`, `feedback_rpc_auth_uid_vs_service_role_mismatch`, `reference_supabase_project`, `feedback_admin_module_manifest_vs_router_branch_drift`, `reference_vercel_project`, `feedback_planner_missed_status_enum_widening`

### Secondary (MEDIUM confidence)
- [PostHog Node.js SDK Docs — alias](https://posthog.com/docs/references/posthog-node) — verified alias signature `{distinctId, alias}` matches in-tree `aliasServerSide`
- [PostHog Identify users docs](https://posthog.com/docs/product-analytics/identify) — alias semantics for anonymous→identified merge
- [Snowplow referer-parser GitHub](https://github.com/snowplow-referer-parser/referer-parser) — canonical seed source for ~80 well-known referrer domains
- [Snowplow referer-parser JSON snapshot](https://s3-eu-west-1.amazonaws.com/snowplow-hosted-assets/third-party/referer-parser/referers-latest.json) — daily-updated database
- [Snowplow referrer parser enrichment docs](https://docs.snowplow.io/docs/pipeline/enrichments/available-enrichments/referrer-parser-enrichment/) — schema reference

### Tertiary (LOW confidence — flag for plan-checker iter-1 validation)
- Vercel Edge Middleware works for Vite static SPA preset at `karstenhaldan-5548/leanshot-marketing` — **needs deploy-verify task**
- posthog-node 5.10.4 actually supports `alias()` despite docs citing ≥5.25.0 minimum — **needs Wave 0 test**
- `admin_notifications.kind` is text-typed (not enum) so `'traffic_funnel_drop'` does not need enum widening — **needs Wave 0 `\d admin_notifications` check**
- Migration timestamp `20270710000001+` is collision-free — **needs pre-merge `ls supabase/migrations/20270710*.sql | wc -l`**

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all major patterns verified in-tree with file:line references
- Architecture: HIGH for backend (sibling-clone of P33/P27/P30); MEDIUM for Vercel Edge Middleware (cited but not project-verified)
- Pitfalls: HIGH — all 6 pitfalls map to documented project-memory entries or in-tree code findings
- Validation: HIGH — every TRAFFIC-NN has an automatable test path

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (30 days; stable patterns; one external dep (Snowplow JSON URL) re-verify if older than 30 days at plan-execute time)

---

*Researcher: gsd-phase-researcher • Generated: 2026-05-21 • Phase 51 ready for planning.*
