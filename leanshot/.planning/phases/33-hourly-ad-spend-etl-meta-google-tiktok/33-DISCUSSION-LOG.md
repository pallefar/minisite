# Phase 33: Hourly Ad-Spend ETL (Meta + Google + TikTok) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 33-hourly-ad-spend-etl-meta-google-tiktok
**Areas discussed:** Vendor-credential gating posture, AEM priority register shape + ownership, Attribution-window config + view freshness, CAC alert threshold source + delivery

---

## Vendor-credential gating posture

### Q1 — Vendor-credential lag handling

| Option | Description | Selected |
|--------|-------------|----------|
| Vendor-gated health-check | Ship all 3 ETL Edge Fns now with no-op-with-warning when secrets absent | ✓ |
| Hard-gate phase merge on App Review | Block all 9 REQs until Meta Standard + TikTok credentials live | |
| Split: Google now, Meta+TikTok deferred | Google full path; Meta/TikTok stubs + follow-up plan | |

### Q2 — Warning surface aggressiveness

| Option | Description | Selected |
|--------|-------------|----------|
| Log + admin dashboard status badge | ad_etl_health row; admin badge surfaces missing credentials | ✓ |
| Log-only (warn once per Deno isolate) | Matches v1.2 pattern exactly | |
| PostHog event + Slack/email page-out | Most aggressive; alert-fatigue risk | |

### Q3 — Credential storage

| Option | Description | Selected |
|--------|-------------|----------|
| Function Secrets, single account per network | Simplest; matches Resend/Stripe pattern | ✓ |
| Supabase Vault encrypted (per-ad-account) | Future-proof multi-account; vault overhead per cron tick | |
| Function Secrets now, DB-backed later | Phase 33 ships secrets; defer migration | |

### Q4 — Idempotency replay window

| Option | Description | Selected |
|--------|-------------|----------|
| TikTok 168h, Meta+Google 72h | Per-network override; catches TikTok 7d restate | ✓ |
| All networks 72h (strict REQ-06) | Easier REQ traceability; TikTok silent-drop risk | |
| All networks 168h (uniform) | 2.3× row writes uniformly; operationally simplest | |

---

## AEM priority register shape + ownership

### Q1 — EventDef extension

| Option | Description | Selected |
|--------|-------------|----------|
| Add `aem_priority: 1..8` + `aem_dropped: true` optional fields | Matches PITFALLS prescription; single source of truth | ✓ |
| Separate `aem-register.ts` ordering file | Second source of truth; drift risk | |
| DB-driven (admin-tunable from day one) | Most flexible; scope creep + Meta CAPI needs build-time names | |

### Q2 — Initial top-8 ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Planner picks from REQs + funnel analysis | researcher proposes; user reviews in plan-checker iter-1 | ✓ |
| User specifies top-8 now | Locks before researcher sees funnel data | |
| Static placeholder + admin UI same phase | Scope creep | |

### Q3 — Meta CAPI consumer

| Option | Description | Selected |
|--------|-------------|----------|
| New Edge Fn `meta-capi-relay` | Reads events_mirror, posts to Meta CAPI with hashed user_data | ✓ |
| Browser-side fbq pixel only | Loses iOS ATT signal recovery; REQ-08 harder | |
| Defer CAPI relay to follow-up phase | Register sits dormant until then | |

### Q4 — PHI guardrail for CAPI relay

| Option | Description | Selected |
|--------|-------------|----------|
| Hard whitelist + phi:false gate + lint | Belt+suspenders; matches Phase 25 HIPAA posture | ✓ |
| Runtime PHI assertion only (no lint) | Relies on dev not silencing the throw | |
| Document the rule, no enforcement | Doesn't match v1.3 enforcement standard | |

---

## Attribution-window config + view freshness

### Q1 — Per-network attribution-window defaults + override

| Option | Description | Selected |
|--------|-------------|----------|
| `ad_network_config` table | Admin UPDATE for override; matview reads at refresh time | ✓ |
| Code constants in `src/lib/analytics/attribution.ts` | Cheapest; redeploy to tune | |
| Per-campaign in ad_spend_facts row | Most granular; view becomes CASE-WHEN | |

### Q2 — `ad_revenue_normalized` view shape

| Option | Description | Selected |
|--------|-------------|----------|
| Materialized view, refreshed hourly via pg_cron | O(1) reads; up to 1h stale | ✓ |
| Live VIEW (no matview) | Always-fresh; query cost on every load | |
| Hybrid: live recent + matview history | Two surfaces; defer until measured | |

### Q3 — FX normalization storage

| Option | Description | Selected |
|--------|-------------|----------|
| Spend-day rate at ETL time + USD column on facts | Matview joins USD directly; matches REQ-09 literal | ✓ |
| Lookup at view-time | Risk: missing fx_rates → NULL spend → silent drop | |
| Dual rates: spend-day AND conversion-day | More accurate; REQ-09 doesn't require | |

### Q4 — Gap-detection cron response

| Option | Description | Selected |
|--------|-------------|----------|
| Alert + admin 'Backfill' button | Human-in-the-loop; ad_etl_gaps row + admin badge | ✓ |
| Auto-backfill with circuit breaker | Faster recovery; hot-loop risk on persistent failure | |
| Alert only (manual functions invoke) | Cheapest; least operationally friendly | |

---

## CAC alert threshold source + delivery

### Q1 — `target LTV` source

| Option | Description | Selected |
|--------|-------------|----------|
| Admin-tunable `growth_targets` table | Decouples from code deploys; matures with cohort data | ✓ |
| Pull from Phase 14 pricing tiers | Brittle retention constant | |
| Hardcoded per-source constants | Loses configurability | |

### Q2 — Delivery channel

| Option | Description | Selected |
|--------|-------------|----------|
| Funnel-anomaly admin in-app notification + PostHog event | Zero new infra; admins already check this surface | ✓ |
| Email digest via lifecycle-transactional | Stronger nudge; slower (daily) | |
| Slack webhook to #growth-alerts | Real-time; first Slack dependency | |

### Q3 — Evaluation cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Daily 00:30 UTC + dedup per (source, date) | Avoids hourly alert-fatigue | ✓ |
| Hourly after each matview refresh | Faster signal; intra-day dedup complexity | |
| On-demand only | Defeats REQ-07 'alert fires' phrasing | |

### Q4 — Creative-level surface (REQ-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Same CAC dashboard, expandable drill-down panel | Single admin module; matches v1.1 P10 drawer pattern | ✓ |
| Separate `/admin/creatives` page | Cleaner top-level nav; may orphan | |
| CSV export only (defer UI to v1.4) | Cheapest; REQ-08 implies in-app filtering | |

---

## Claude's Discretion

- Edge Function file layout under `supabase/functions/` (per-network ETL directories + shared helpers).
- Migration timestamp window `20270703000001..N_*.sql`.
- Monthly partition strategy for `ad_spend_facts`.
- RLS posture: admin-only across all 7 new tables with 51-deny tests.
- Bundle impact: zero (all server-side).

## Deferred Ideas

- Multi-ad-account-per-network credential support (v1.4 with Vault encryption).
- TikTok Events API + Google Enhanced Conversions server-side relays (v1.4).
- Admin UI to drag-reorder AEM top-8.
- Per-campaign attribution-window override.
- Auto-backfill cron with circuit-breaker.
- Hybrid VIEW + matview split.
- Conversion-day FX rate.
- Dedicated `/admin/creatives` page.
