---
phase: 51
phase_name: "Full Traffic + Conversion Tracking System + Unified Dashboard"
status: ready-for-research
gathered: 2026-05-18
---

# Phase 51: Full Traffic + Conversion Tracking System + Unified Dashboard - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 51 ships the complement to Phase 33 (paid ad-spend ROI): a complete traffic + conversion intelligence layer covering **all acquisition channels** (organic search, organic social, direct, referral, email, affiliate, paid) with an operator-facing admin dashboard answering *"where did today's visits come from, which funnel did they enter, where did they drop, which channel is converting?"*.

Net-new owned by Phase 51:
- **UTM + referrer capture pipeline** — landing-page `lt_anon_id` HttpOnly cookie + server-side `captureServer()` event with full UTM verbatim + referrer-based channel classification.
- **Operator-configurable channel taxonomy** — `channel_groups` admin table (rule-based grouping over raw UTM, default 8 channels) + `referrer_channel_rules` admin table (~80 seeded well-known domains).
- **Per-user attribution storage** — `user_traffic_attribution` SQL table (authoritative) with first-touch + last-touch columns, plus PostHog person-properties mirror via `captureServer()`. Anonymous→identified stitch via PostHog `alias()` on signup.
- **Three parallel conversion funnels** — Consumer (visit→signup→activation(P34)→paid(P14)), Clinic-org (visit→clinic-signup→first-patient-added→first-paid-seat(P29)), Affiliate (visit→affiliate-signup→first-referral-conversion(P26)).
- **Family of 4 focused matviews** (`traffic_channel_rollup`, `traffic_funnel_rollup`, `traffic_landing_page_rollup`) refreshed by single sequenced pg_cron piggy-backed after P33's matview refresh; `traffic_realtime_v` regular VIEW over last-60min for the real-time tab.
- **`growth/traffic` admin module** — sibling of P33's `growth/cac` under a shared 'Growth' nav group; 4 tabs (Channels, Funnels, Landing Pages, Real-time).
- **Per-clinic-org dashboard view** — `org_id` dimension carried through every matview + `user_traffic_attribution`; clinic_owner role sees org-scoped subset via RLS.
- **Full cohort retention curves per channel** (D1/D7/D14/D30/D60) on `traffic_channel_rollup` to grade channel LTV quality.
- **Per-channel-stage funnel-drop alerts** — extends P24's `funnel-anomaly-cron` (no new cron); writes to existing `admin_notifications` surface; dedup key = (channel_group, funnel, stage_pair, date).

REQ coverage: NEW TRAFFIC-NN REQ-IDs to be drafted by planner (Phase 51 was added to ROADMAP without pre-existing REQs); planner shall derive ~10-12 REQs from the 16 decisions below and propose them to user at plan-checker iter-1.

Phase 51 does NOT own:
- Per-campaign / per-creative CAC drilldown (stays in P33 `growth/cac`).
- Multi-touch attribution beyond first+last (linear / position-based / data-driven → v1.4).
- Per-funnel-stage attribution window override (channel-group level only in v1.3).
- Operator-configurable funnel builder UI (PostHog Funnels covers; not rebuilding).
- supabase-realtime live-pushed Real-time tab (5-min poll is sufficient in v1.3).
- Click-ID exact-match attribution (fbclid/gclid/ttclid) — v1.4 parity with ad-network-side attribution.
- Browser-side pixel emission (`fbq`, `gtag`, `ttq`) — orthogonal marketing-HTML work, not this phase.
- Cross-device user-stitch beyond PostHog's default cookie-based identification.

</domain>

<decisions>
## Implementation Decisions

### Channel taxonomy + attribution model

- **D-01 — Full UTM granularity captured verbatim + operator-configurable `channel_groups` admin table.** Persist raw `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` on every visit/event. Seed `channel_groups` migration with 8 defaults (Direct, Organic Search, Organic Social, Paid Search, Paid Social, Email, Referral, Affiliate). Each row carries a `match_rule_jsonb` (e.g., `{utm_medium: ['cpc','ppc'], utm_source: ['google','bing']}` → Paid Search). Operator edits via admin UI; new groupings take effect at next matview refresh — no code deploy. Matches user's aggressive-foundations preference for analytics platforms.
- **D-02 — Both first-touch AND last-touch attribution stored per user; multi-touch deferred to v1.4.** `user_traffic_attribution` carries `first_touch_*` columns (set ONCE at first anon session) AND `last_touch_*` columns (updated on every new visit pre-conversion). Dashboard offers a toggle. Reconciles PAYWALL-07's first-touch implication with operator-conventional last-touch reporting.
- **D-03 — Curated `referrer_channel_rules` admin table seeded with ~80 well-known domains.** When utm absent, classify channel via referrer-domain lookup (google.com / bing.com / duckduckgo.com → Organic Search; facebook.com / instagram.com / tiktok.com / linkedin.com / x.com / t.co → Organic Social; mail.google.com / outlook.com / yahoo.com mail / mail.ru → Email; etc.). Unmatched referrer + empty utm → Direct. Operator edits rules via admin UI without deploy. Migration ships seed list; planner derives full list from research/SUMMARY.md or open-source `referer-parser` data.
- **D-04 — Anonymous tracking via `lt_anon_id` HttpOnly cookie + PostHog `alias()` stitch on signup.** Landing-page server-side route sets `lt_anon_id` cookie (UUIDv4) with `HttpOnly`, `Secure`, `SameSite=Lax`, TTL 90d. Pre-signup `captureServer()` calls use `lt_anon_id` as PostHog `distinct_id`. On signup, server-side route calls PostHog `alias(anon_id, user_id)` AND upserts `user_traffic_attribution` row joining anon_id→user_id. PHI-safe (anon_id is opaque UUID).

### Funnel shape + conversion definition

- **D-05 — Three parallel conversion funnels keyed by audience.** (a) **Consumer:** visit → signup → activation (P34 ONBOARD locked event) → paid (P14 PAYMENT). (b) **Clinic-org:** visit → clinic-signup → first-patient-added → first-paid-seat (P29 metered billing). (c) **Affiliate:** visit → affiliate-signup → first-referral-conversion (P26 AFFTIER). Each funnel has its own row family in `traffic_funnel_rollup`. Dashboard Funnels tab filters by audience.
- **D-06 — Activation event (P34 ONBOARD) is the north-star conversion for CAC rollup; paid is secondary.** The cross-channel rollup matview joins `ad_spend_facts` (P33) to activations rather than to paid conversions. Rationale: activation happens days post-signup (vs trial-length post-payment); faster ad-spend feedback loop. Dashboard surfaces both `CAC_to_activation` (primary alert) and `CAC_to_paid` (secondary). **Creates Phase 51 → Phase 34 dependency** — ROADMAP `Depends on:` must be updated from `Phase 50` to `Phase 33, Phase 34`.
- **D-07 — 30-day default attribution window per channel-group, operator-overridable.** `channel_groups` gets an `attribution_window_days` column (default 30). Operator can set Paid Social to 7d (Meta default; aligns with P33 D-09 per-network window), Organic Search to 60d, etc. `lt_anon_id` cookie TTL = 90d so the longest plausible window always fits within cookie life.
- **D-08 — Extend P24 `funnel-anomaly-cron` with per-channel funnel-stage alerts; no new cron.** TAXO-05 already ships funnel-anomaly-cron (rolling 7-day baseline, alert when conv < baseline-2σ on tracked funnels). Phase 51 extends its query to evaluate EACH funnel-stage-pair per `channel_group` per `audience`. Writes to existing `admin_notifications` surface (P27). Dedup key = `(channel_group, audience, funnel, stage_pair, date)`. Zero new infra; one diff against the existing Edge Fn.

### Dashboard surface granularity

- **D-09 — New `growth/traffic` ADMIN_MODULES entry, sibling of `growth/cac` under a shared 'Growth' nav group.** Two ADMIN_MODULES entries rendered under a 'Growth' nav heading: `growth/cac` (P33, paid ROI focus, unchanged) and `growth/traffic` (P51, multi-channel + funnels). `growth/traffic` has 4 tabs: **Channels** (channel_group × day × audience matrix with visits / signups / activations / paids / paid-d30-retained / cac_to_activation), **Funnels** (per-audience funnel-stage rates with drop-off heatmap; channel-group filter), **Landing Pages** (top N landing_path × page_variant_id with conversion rates per audience), **Real-time** (last-60min activity by channel_group). Channel rows deep-link to `growth/cac`'s per-campaign drilldown when the channel is paid. Reuses P33 D-16 cards → detail-drawer pattern.
- **D-10 — Real-time tab: 5-min TanStack-Query poll against `events_mirror` direct query.** Server-side admin RPC `get_realtime_traffic_summary(p_minutes int default 60)` runs `SELECT channel_group, count(*) ... WHERE created_at > now() - interval '60 minutes' GROUP BY channel_group`. TanStack Query `refetchInterval: 5 * 60 * 1000`. Admin-only RLS deny test. No supabase-realtime subscription complexity (deferred to v1.4 if 5-min cadence feels stale).
- **D-11 — Landing Pages tab joins `page_variant_id` from PAGEAB (P15) for variant breakdown.** `traffic_landing_page_rollup` columns: `landing_path`, `page_variant_id` (nullable for non-PAGEAB pages), `audience`, `day`, `org_id` (nullable), `visits`, `signups`, `activations`, `paids`. Closes the page-A/B feedback loop — operator can answer "is /pricing-bold outperforming /pricing-minimal?" without leaving the dashboard. Aligns with PAGEAB-05 'Ship Winner' workflow.
- **D-12 — Per-clinic-org dashboard view in v1.3 (BIG SCOPE ADD).** `org_id` dimension carried through `user_traffic_attribution` + all 4 matviews. Three new wiring slabs: (i) `org_id` populated on `/share/clinic-{slug}` landings (parse slug → `organizations.id`); (ii) clinic-invite signup flow sets `user_traffic_attribution.org_id` at user-stitch time; (iii) RLS policies on all 4 matviews: `is_admin()` sees all rows; `_is_org_clinician(org_id)` (from P30-05 SECDEF pattern) sees only their org's rows. Dashboard renders org-filter dropdown for admins; clinic-owner UI auto-scoped. **Adds ~+2-3 plans estimated.** Requires P28+P29 multi-tenant prereqs (both shipped in v1.3).

### Attribution storage + cross-channel rollup

- **D-13 — `user_traffic_attribution` SQL table (authoritative) + PostHog person-properties mirror via `captureServer()`.** SQL is the source of truth (queryable in matviews, SECDEF-joinable, RLS-scopeable per-org). PostHog mirror keeps the standard person-property axes available for PostHog UI cohort filtering. **Columns:** `anon_id text not null`, `user_id uuid` (nullable until stitch), `org_id uuid` (nullable; populated on /share/clinic-X landings), `first_touch_source text`, `first_touch_medium text`, `first_touch_campaign text`, `first_touch_referrer text`, `first_touch_landing_path text`, `first_touch_at timestamptz not null`, `first_touch_channel_group text`, `last_touch_*` (same shape as first_touch_*), `last_touch_at timestamptz not null`, `updated_at timestamptz default now()`. **Indexes:** `(user_id) WHERE user_id is not null`, `(anon_id)` (UNIQUE), `(org_id, last_touch_at)` partial WHERE `org_id is not null`. **Write path:** `captureServer()` helper extended with a `recordTouch({anon_id, user_id?, org_id?, utm, referrer, landing_path})` method that UPSERTs into the SQL table AND mirrors to PostHog person properties in one atomic helper call. PHI-safe (no PHI fields).
- **D-14 — Family of 4 focused matviews refreshed by single sequenced pg_cron, piggy-backed after P33's matview refresh.** (a) `traffic_channel_rollup` (channel_group × audience × day × org_id_nullable: visits, signups, activations, paids, ad_spend_usd LEFT JOIN from P33 ad_spend_facts, d1/d7/d14/d30/d60 retained, cac_to_activation, cac_to_paid). (b) `traffic_funnel_rollup` (audience × channel_group × funnel_stage_pair × day × org_id_nullable: stage_in_count, stage_out_count, rate). (c) `traffic_landing_page_rollup` (landing_path × page_variant_id × audience × day × org_id_nullable: visits, signups, activations, paids). (d) `traffic_realtime_v` regular VIEW (not matview) over last-60min for the real-time tab. **Single pg_cron job** `traffic_matview_refresh_cron` schedules: P33's existing matview refresh → P51's 3 matviews in dependency order (channel_rollup → funnel_rollup → landing_page_rollup). Concurrent refresh + unique indexes per P33 D-10. Read cost on dashboard = O(1) per matview.
- **D-15 — Paid ad-spend join by `(channel_group, day)` aggregate.** `ad_spend_facts` rows aggregated to channel_group via fixed mapping (Meta network → 'Paid Social', Google network → 'Paid Search', TikTok network → 'Paid Social'). `traffic_channel_rollup` left-joins this aggregate at the `(channel_group, day)` grain. Operator gets per-channel-group CAC for paid channels; per-campaign / per-creative CAC stays in P33's `growth/cac` module (where it belongs). Click-ID exact-match attribution deferred to v1.4.
- **D-16 — Full cohort retention curves per channel (D1/D7/D14/D30/D60) on `traffic_channel_rollup` (BIG SCOPE ADD).** 5 retention-day columns per row: `d1_retained_count`, `d7_retained_count`, `d14_retained_count`, `d30_retained_count`, `d60_retained_count`. Retention defined per audience: Consumer = still has activity event in window; Clinic-org = still has ≥1 paid seat; Affiliate = still has ≥1 paid referral attributable. Adds +1 plan for retention-computation logic (helper SQL function consumed by matview). Enables LTV-quality channel grading; aligns with P14 PAYWALL-03 composite-goal pattern (paid + retained 30d).

### Claude's Discretion

- **Edge Fn / RPC file layout:** new server-side surfaces in `supabase/functions/traffic-attribution-recorder/` (called from landing-page route + signup hooks), `supabase/functions/_shared/traffic-attribution.ts` (extends posthog-server.ts with `recordTouch()` helper). Real-time RPC `get_realtime_traffic_summary()` lives in a migration (Postgres function, not Edge Fn — keeps dashboard latency tight).
- **Migration timestamp window:** new migrations in `20270704000001..N_*.sql` (Phase 33 reserved `20270703*`; pre-merge `ls supabase/migrations/20270704*.sql | wc -l` collision check per `reference_migration_timestamp_collision_precheck`).
- **Partition strategy for `user_traffic_attribution`:** start un-partitioned (1 row per user; v1.3 user volume far below partition threshold). Partition by `org_id` modulo or `last_touch_at` monthly only if/when row count exceeds 1M (defer to v1.4).
- **RLS posture:** `user_traffic_attribution` + all 4 matviews + `channel_groups` + `referrer_channel_rules` get RLS policies: `is_admin()` reads all; `_is_org_clinician(org_id)` reads org-scoped rows on matviews + own org's attribution rows; anon role denied; explicit 51-deny RLS test per `reference_supabase_project` cross-tenant proof rule. `channel_groups` + `referrer_channel_rules` are admin-only (no clinic reads).
- **Bundle impact:** dashboard module respects v1.3 admin-shell 30 kB chunk ceiling (P24). Charts reuse `BaseChart` (chart.js) from v1.1; no new client charting library. TanStack Query already in v1.3 stack (per `.planning/research/STACK.md`).
- **PHI containment:** `user_traffic_attribution` carries no PHI columns (utm + referrer + landing_path are non-PHI). Add ESLint zone rule preventing this table from being JOIN-imported into PHI-tagged Edge Functions. PostHog session-replay continues to mask PHI per HIPAA-17 (already covers `/clinic/*`, `/patient/*`, `/admin/users/*`, `/dose-log/*`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements
- `.planning/ROADMAP.md` §Phase 51 (line 606) — Phase 51 entry; `Depends on:` must be updated to `Phase 33, Phase 34` at write-context commit time.
- `.planning/ROADMAP.md` §Phase 33 (lines 268–281) — sibling ad-spend ETL goals; Phase 51 reads `ad_spend_facts` and piggy-backs the matview refresh cron.
- `.planning/ROADMAP.md` §Phase 34 (lines 283+) — locks the activation event; Phase 51's CAC north-star (D-06) consumes it.
- `.planning/ROADMAP.md` §Phase 26 (Affiliate tiers) — defines `first-referral-conversion` for the Affiliate funnel (D-05c).
- `.planning/ROADMAP.md` §Phase 29 (Org subscriptions, metered billing) — defines `first-paid-seat` for the Clinic-org funnel (D-05b).
- `.planning/REQUIREMENTS.md` lines 29–35 — TAXO block: events.ts, captureServer, session-replay masking; D-08 extends TAXO-05.
- `.planning/REQUIREMENTS.md` lines 49–55 — PAYWALL-01..07; **PAYWALL-07** (line 55) is the existing utm→variant mapping hook Phase 51 generalizes via `user_traffic_attribution`.
- `.planning/REQUIREMENTS.md` lines 40–44 — AFFTIER block; D-05c funnel consumes `tier_at_conversion_time`.
- `.planning/REQUIREMENTS.md` line 172 — ONBOARD-09 (per-step funnel analytics); D-05a / D-06 consume the locked activation event.
- `.planning/REQUIREMENTS.md` lines 59–65 — PAGEAB block; D-11 Landing Pages tab joins `page_variant_id`.
- `.planning/REQUIREMENTS.md` line 197 — REVIEW-07 (per-funnel review-rate dashboard) — does NOT overlap with Phase 51; review-rate stays in Phase 36 module.
- `.planning/REQUIREMENTS.md` lines 67–77 — ADETL-01..09; Phase 51 cross-joins `ad_spend_facts` produced here.

### Locked upstream phase context
- `.planning/phases/33-hourly-ad-spend-etl-meta-google-tiktok/33-CONTEXT.md` — D-01 vendor-gated health pattern; D-09 per-network attribution-window override; D-10 matview-refresh sequenced pg_cron pattern (Phase 51 piggy-backs); D-16 cards → detail-drawer pattern (Phase 51 reuses); `events_mirror` join shape; `ad_spend_facts` columns.
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — D-10 (additive-only events.ts + ESLint rule); D-11 (canonical event taxonomy); D-12 (PHI client-side gate); D-13 (Edge Fn distinct_id pattern); ADMIN_MODULES manifest shape.
- `.planning/phases/27-modular-admin-shell-extensions/27-CONTEXT.md` — D-11 admin module index sources; plan 27-04 `events_mirror` dual-write extension; `admin_notifications` surface used by D-08 alerts.

### Reusable backend assets (paths absolute from monorepo root `/Users/karstenhaldan/minisite/`)
- `supabase/functions/_shared/posthog-server.ts` — `captureServer()` with `events_mirror` dual-write + mandatory `shutdownPostHog()`. D-13 extends this with `recordTouch()` helper.
- `supabase/functions/_shared/supabase-server.ts` — service-role admin client factory.
- `supabase/functions/_shared/with-org-scope.ts` — pattern reference for org_id propagation (D-12 reuses).
- `supabase/functions/funnel-anomaly-cron/` — D-08 extends this Edge Fn with per-channel-stage evaluation; do NOT clone.
- `supabase/functions/affiliate-anomaly-sla-reminder/` — admin notification delivery template.
- `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — partitioned-table + matview-refresh pg_cron + concurrent-refresh + unique-index pattern (D-14 mirrors).
- `supabase/migrations/20260512000002_anon_cleanup_pg_cron.sql` — minimal pg_cron schedule reference.

### Reusable frontend assets
- `src/lib/analytics/events.ts` — `EventDef` shape; Phase 51 adds `traffic_visit`, `traffic_signup`, `traffic_activation`, `traffic_paid` event defs (one per funnel-stage event) following Phase 33 D-05 additive-only rule.
- `src/components/dashboard/charts/BaseChart.tsx` — chart.js wrapper; reuse for funnel + retention curves; no new charting library.
- `eslint-rules/additive-only-events.js` — extend with a `traffic_*` family rule if needed (or rely on the existing additive-only check).

### Project memory worth flagging to planner
- `feedback_aggressive_foundations` — user picked the aggressive option on every gray area; planner should NOT trim the per-clinic-org axis or retention curves at iter-1.
- `feedback_regulator_vs_user_audience_pattern` — operator dashboard is END-USER for the growth team; invest in UX, don't trim.
- `reference_vendor_gated_send_health_check` — no new vendor in Phase 51 but pattern available if Google Search Console or similar gets added.
- `reference_supabase_migration_filename_regex` + `reference_migration_timestamp_collision_precheck` — pre-merge `ls supabase/migrations/20270704*.sql | wc -l` check.
- `reference_supabase_migration_gotchas` — SECURITY DEFINER `search_path = extensions` for the new RPC + `_is_org_clinician`-style functions; partial-index expressions must be IMMUTABLE.
- `reference_hipaa_baa_vendor_matrix` — `user_traffic_attribution` carries no PHI by construction; PostHog mirror via Boost add-on (HIPAA-06) acceptable.
- `reference_supabase_project` — RLS deny test required for every new admin/org-scoped surface.
- `feedback_status_machine_transition_owner` — funnel stages are status transitions; every stage_pair needs an owning event emission point. Plan-checker should audit.

### Codebase maps (still relevant; some details stale from 2026-05-10 — trust Phase 33/27/24 CONTEXTs over INTEGRATIONS.md)
- `.planning/codebase/INTEGRATIONS.md` — note: dated 2026-05-10; PostHog/Supabase/Resend NOW present (added across v1.1–v1.3).
- `.planning/codebase/STACK.md`, `STRUCTURE.md`, `ARCHITECTURE.md`, `CONVENTIONS.md` — admin shell + backend layout reference.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/_shared/posthog-server.ts` — `captureServer()` already dual-writes to `events_mirror`. D-13's `recordTouch()` helper is a one-function addition; the SQL table UPSERT + PostHog person-properties mirror happen in the same helper call.
- `supabase/functions/funnel-anomaly-cron/` — D-08 extends this Edge Fn; one query addition + dedup key extension. No new cron.
- `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — D-14 matview shape + concurrent-refresh + unique-index follow this pattern exactly.
- `eslint-rules/additive-only-events.js` — `traffic_*` family events added under existing additive-only rule; no new rule file.
- `BaseChart` (chart.js wrapper, `src/components/dashboard/charts/BaseChart.tsx`) — retention curves + funnel-stage bars reuse this; no new client charting lib.
- TanStack Query is already in v1.3 stack (per `.planning/research/STACK.md`) — D-10 Real-time tab uses it directly.

### Established Patterns
- **Vendor-gated health-check pattern (P33 D-01)** — not strictly needed in Phase 51 (no new vendor APIs), but available if Google Search Console or similar lands later.
- **`events_mirror` for server-readable event counts** — avoids PostHog REST rate limits. All 4 matviews + the Real-time RPC read from here.
- **Additive-only events.ts** — adding optional fields and new event defs passes; deletions or breaking-type changes fail.
- **`ADMIN_MODULES` manifest** — `growth/traffic` becomes a new entry under a 'Growth' nav group (P24 D-?); admin shell auto-renders nav + route. `growth/cac` (P33) stays as the sibling.
- **pg_cron sequenced refresh** — D-14 piggy-backs on Phase 33's `ad_spend_etl_refresh_cron`; one job, ordered statements, atomic from cron's view.
- **`is_admin()` SECDEF function (P24)** + `_is_org_clinician(org_id)` SECDEF (P30-05) — D-12 RLS policies use both.
- **`admin_notifications` surface (P27)** — D-08 anomaly extensions write here; no new notification channel.
- **Cards → detail-drawer pattern (v1.1 P10 + P33 D-16)** — Dashboard surfaces reuse.

### Integration Points
- **`ad_spend_facts` (P33)** — D-14's `traffic_channel_rollup` LEFT JOINs aggregated `(network → channel_group)` rows at `(channel_group, day)` grain.
- **`events_mirror` (P24 + P27)** — all matviews + the Real-time RPC source from here.
- **`funnel-anomaly-cron` (P24)** — D-08 extends.
- **`admin_notifications` (P27)** — D-08 anomaly extensions write here.
- **`organizations` + `org_members` + `_is_org_clinician()` (P28–P30)** — D-12 RLS policies + `org_id` dimension on matviews.
- **`page_variants` table from PAGEAB (P15)** — D-11 LEFT JOINs to expose `page_variant_id` × `landing_path` on Landing Pages tab.
- **`activation_event` definition (P34 ONBOARD)** — D-05a + D-06 consume; **HARD UPSTREAM DEPENDENCY** — Phase 51 cannot ship matviews referencing this event def until P34 lands.
- **`captureServer()` helper** — D-13's `recordTouch()` extends this; landing-page route + signup-route hooks call it.
- **`channel_groups` + `referrer_channel_rules` admin tables (new in P51)** — refresh logic of matviews reads these at refresh time to compute `channel_group_first` / `channel_group_last`. Operator edits trigger next matview refresh to pick up.

</code_context>

<specifics>
## Specific Ideas

- **`lt_anon_id` cookie spec:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000` (90d). Set server-side at first landing-page response. Refresh `Max-Age` on every visit to keep the 90d sliding window. No client-side JS access (HttpOnly).
- **Channel-group default seed:** Direct, Organic Search, Organic Social, Paid Search, Paid Social, Email, Referral, Affiliate. Match rules JSON shape: `{utm_medium: ['cpc','ppc','paidsearch'], utm_source: ['google','bing','duckduckgo']} → Paid Search`. Operator can add/remove rows + edit match_rule_jsonb via admin UI.
- **Referrer-channel seed list:** ~80 well-known domains. Planner sources from open-source `referer-parser` data (https://github.com/snowplow-referer-parser) OR an in-house curated list — research-phase decides.
- **Retention semantics per audience:** Consumer retained = `last_active_event_at` within window. Clinic-org retained = `org_seats_active_count > 0` at end of window. Affiliate retained = `last_paid_referral_conversion_at` within window. Planner consolidates these into a single `is_retained(user_id, audience, window_days)` SECDEF helper SQL function.
- **PHI ESLint zone rule:** add `user_traffic_attribution` to `eslint.config.js` `import-x/no-restricted-paths` as a non-PHI table that PHI Edge Fns can read freely (no PHI flow concern), but block any reverse join from PHI tables into the attribution table that could leak PHI through utm/referrer enrichment.
- **Org_id propagation on /share/clinic-X:** landing-page server route parses the slug → `select id from organizations where slug = $1`; if found, set `lt_org_id` cookie alongside `lt_anon_id` (same flags). `captureServer.recordTouch()` reads both cookies and writes `org_id` into `user_traffic_attribution`.
- **Real-time RPC SQL hint:** `get_realtime_traffic_summary(p_minutes int default 60)` returns `(channel_group text, visits bigint, signups bigint, activations bigint, paids bigint)` sorted by visits desc; STABLE; SECURITY DEFINER; `search_path = extensions, public`; explicit `is_admin()` OR `_is_org_clinician()` gate at function head.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-touch attribution** (linear / position-based / data-driven) — v1.4. Would require new `traffic_touchpoints` table (1 row per touchpoint per user, ordered) + matview recomputation per attribution model.
- **Per-funnel-stage attribution window override** — channel-group level is enough in v1.3.
- **Operator-configurable funnel builder UI** — PostHog Funnels covers; don't rebuild.
- **supabase-realtime live-pushed Real-time tab** — v1.4 if 5-min poll feels stale.
- **Per-campaign / per-creative CAC in `growth/traffic`** — stays in P33 `growth/cac`; cross-link via deep-link from the Channels tab.
- **Click-ID exact-match attribution** (`fbclid` / `gclid` / `ttclid` → ad_spend_facts row) — v1.4 parity with ad-network-side attribution.
- **Cross-device user-stitch beyond PostHog default** — defer indefinitely; needs hashed identifier or device-graph vendor.
- **Anonymous bot/spam filtering** — start naive (User-Agent regex against well-known bot list at landing-page recordTouch); revisit with reCAPTCHA Enterprise integration in v1.4 if dashboard noise becomes a problem.
- **Per-clinic-org `traffic_landing_page_rollup` for clinic's own /share/clinic-X subpaths** — covered minimally via D-12 org_id dimension; richer per-clinic content-performance view → v1.4 B2B feature.
- **CSV/PDF export from dashboard** — would extend the existing report-export pattern; add in plan-phase if user requests; otherwise v1.4.

</deferred>

---

*Phase: 51-Full Traffic + Conversion Tracking System + Unified Dashboard*
*Context gathered: 2026-05-18*
