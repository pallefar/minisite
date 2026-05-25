---
phase: 33
phase_name: "Hourly Ad-Spend ETL (Meta + Google + TikTok)"
status: ready-for-research
gathered: 2026-05-18
---

# Phase 33: Hourly Ad-Spend ETL (Meta + Google + TikTok) - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Three hourly Edge-Function ETLs (Meta Marketing API, Google Ads API, TikTok Business API) populate a partitioned `ad_spend_facts` table; a daily ECB FX cron normalizes spend to USD at spend-day rate; an hourly-refreshed `ad_revenue_normalized` materialized view joins facts to PostHog conversion events (via the existing `events_mirror` table from P27 plan 27-04 extension) using per-network attribution windows configured in a new `ad_network_config` table; a daily gap-detection cron writes `ad_etl_gaps` rows when actual fact-row counts undercount expected; an admin CAC dashboard surfaces per-source/per-campaign/per-creative cost-per-acquisition with a daily-evaluated alert when 7-day rolling CAC exceeds `growth_targets.target_ltv_usd × cac_multiplier (default 0.5)`. The AEM priority register lives in `events.ts` via additive `aem_priority?: 1..8` + `aem_dropped?: true` fields on `EventDef`, and a new server-side `meta-capi-relay` Edge Function publishes those prioritized events to Meta CAPI with hashed user_data, dedup by `event_id`, and runtime-enforced PHI=false guardrails.

REQ coverage: ADETL-01, ADETL-02, ADETL-03, ADETL-04, ADETL-05, ADETL-06, ADETL-07, ADETL-08, ADETL-09.

Phase 33 does NOT own: multi-ad-account-per-network credential rotation (v1.4+), Google Enhanced Conversions / TikTok Events API relays (v1.4 parity work), admin UI for AEM ordering (planner picks initial top-8 from REQs + funnel analysis; Meta Events Manager dashboard is the manual-edit surface in v1.3), per-campaign attribution-window override (network-level defaults only in v1.3), auto-backfill (manual `Backfill` button in v1.3).

</domain>

<decisions>
## Implementation Decisions

### Vendor-credential gating posture

- **D-01 — Vendor-gated health-check pattern for all 3 ETL Edge Fns.** Each of `ad-spend-cron-meta`, `ad-spend-cron-google`, `ad-spend-cron-tiktok` boots with `if (!credentials) { logWarning(); writeHealthRow({credentials_present: false}); return ok }`. Phase 33 merges and deploys before Meta App Review (2-4wk lead time) or TikTok credential approval lands. No vendor-circular-dependency anti-pattern. Matches v1.2 `reference_vendor_gated_send_health_check` pattern (Resend, Stripe).
- **D-02 — Health surface is row + admin badge, not log-only.** A new `ad_etl_health` table (one row per network) carries `last_success_at`, `credentials_present`, `last_error`, `last_attempt_at`. Each cron upserts on every tick. The admin CAC dashboard renders a "Meta credentials missing" / "TikTok last sync failed 14h ago" badge in the module header. Reuses admin-module-status convention from P27. Cheap to wire; impossible to forget.
- **D-03 — Credentials in Function Secrets, single ad account per network for v1.3.** `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` via `supabase secrets set`. Multi-account migration deferred to v1.4 with Vault-encrypted `ad_account_credentials` table when scale demands.
- **D-04 — Idempotency replay window is per-network override.** Meta + Google re-sync last 72h on each hourly tick (matches REQ-06 baseline). TikTok re-syncs last 168h (7d) to catch TikTok's known 7-day attribution-restate behavior — the V13-5 silent-drop mode flagged in `research/PITFALLS.md`. INSERT ... ON CONFLICT (network, ad_account_id, ad_id, hour_bucket) DO UPDATE means no row duplication despite ~2.3× write volume on TikTok.

### AEM priority register shape + ownership

- **D-05 — `aem_priority?: 1|2|3|4|5|6|7|8` + `aem_dropped?: true` added as optional fields on `EventDef`.** Lives in `src/lib/analytics/events.ts`. Single source of truth — no separate `aem-register.ts` file. Phase 24 D-10 additive-only ESLint rule already permits adding optional fields, so lint stays green. PITFALLS.md prescription matched exactly.
- **D-06 — Planner picks the initial top-8 from REQs + funnel analysis.** `gsd-phase-researcher` reads existing `events.ts`, `funnel-anomaly-cron`, signup/activation/payment events, and proposes a top-8 ordering ranked by conversion value (matches Meta CAPI `value` weighting). User reviews in plan-checker iter-1 before lock. No admin reorder UI in v1.3 — Meta Events Manager dashboard is the manual-edit surface if priorities need tweaking post-ship.
- **D-07 — New server-side Edge Function `meta-capi-relay` is the AEM consumer.** Reads `events_mirror` rows where `event_name IN (aem-priority-list)`, posts to Meta Conversions API with hashed user_data (SHA-256 of email + phone + Meta-spec fields), dedupes against browser-side `fbq` pixel via Meta-spec `event_id` matching. Without this Edge Fn the AEM register accomplishes nothing — registration without delivery is not REQ-compliant. Cron schedule: every 5 min (matches funnel-anomaly cadence); processes events_mirror tail since last successful `meta_capi_relay_cursor`.
- **D-08 — PHI guardrail is belt + suspenders: import-zone + runtime + ESLint.** (a) `meta-capi-relay` may only `import` from `events.ts` (`events.phi.ts` blocked via existing `import-x/no-restricted-paths` config). (b) Runtime `if (eventDef.phi) throw new Error('PHI event cannot be sent to Meta CAPI')` inside the relay loop. (c) New ESLint rule (extension of `eslint-rules/additive-only-events.js`) blocks adding `aem_priority` to any event with `phi: true`. Aligns with Phase 25 HIPAA posture (compile-time + runtime double-enforcement) and `reference_hipaa_baa_vendor_matrix.md` Meta-never-BAA constraint.

### Attribution-window config + view freshness

- **D-09 — Per-network defaults in `ad_network_config` table; admin UPDATE for override.** Migration seeds 3 rows: `(meta, 7d, click)`, `(google, 30d, click)`, `(tiktok, 7d, click)`. Columns: `network`, `default_attribution_window_seconds`, `default_attribution_model`, `updated_at`, `updated_by_admin_id`. `ad_revenue_normalized` matview reads from this table at refresh time. Override via admin CAC dashboard settings panel — no code deploy required. Per-campaign override deferred to v1.4.
- **D-10 — `ad_revenue_normalized` is a MATERIALIZED VIEW, refreshed hourly via pg_cron piggy-backed on each ETL completion.** Single cron schedule (`ad_spend_etl_refresh_cron`) sequences: (1) Meta ETL → (2) Google ETL → (3) TikTok ETL → (4) `REFRESH MATERIALIZED VIEW CONCURRENTLY ad_revenue_normalized`. Read cost on CAC dashboard becomes O(1). Up to 1h stale — acceptable for ad-ROI signals (not real-time). Matches `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` pattern. Concurrent refresh requires unique index on the matview (composite of (network, ad_account_id, ad_id, spend_date)).
- **D-11 — FX normalized at ETL time, stored as USD column on facts.** `ad_spend_facts` columns: `spend_local`, `spend_currency` (ISO 4217), `spend_usd_at_spend_date`. ETL fetches ECB spot rate for the spend date from `fx_rates` table (populated by `fx-rates-ecb-cron` daily Edge Fn), computes USD at write time. Matview joins USD directly. Spend-day rate per REQ-09. Conversion-day rate deferred (Stripe conversions are mostly USD). Missing fx_rates row → ETL logs warning + writes `spend_usd_at_spend_date = NULL`; gap-detection cron treats NULL USD as a gap.
- **D-12 — Gap-detection cron writes `ad_etl_gaps` + surfaces admin "Backfill" button.** Daily cron compares `count(*) WHERE spend_date = yesterday` to expected (`active_ad_accounts × 24`); inserts an `ad_etl_gaps` row when actual < expected. Admin CAC dashboard renders a per-network "Gaps detected for 2026-05-15 — Meta missing 8 hours" badge with a "Backfill" button that POSTs to the same ETL Edge Fn with `?backfill_date=YYYY-MM-DD&backfill_window=24h`. Human-in-the-loop avoids hot-loop on persistent API outages. Auto-backfill with circuit breaker deferred to v1.4.

### CAC alert threshold source + delivery

- **D-13 — Alert threshold lives in new `growth_targets` table, admin-tunable.** Columns: `id`, `source` (network or 'all'), `target_ltv_usd`, `cac_multiplier` (default 0.5), `enabled`, `updated_at`, `updated_by_admin_id`. Seeded from research/SUMMARY.md heuristics (or placeholder values flagged in plan-checker iter-1 for user lock). Admin sets via CAC dashboard "Alerts" settings panel. Decouples REQ-07 from code deploys and lets the threshold mature as cohort retention data accumulates. Does NOT compute LTV from v1.2 Phase 14 tier pricing — that would tie alert behavior to a brittle retention constant.
- **D-14 — Delivery reuses funnel-anomaly-cron admin in-app notification + emits PostHog event.** New `cac-alert-cron` Edge Fn evaluates breaches and (a) calls existing admin-notification surface (P27) to create an in-app badge, (b) emits server-side `cac_target_breached` event (attrs: `source`, `7d_cac_usd`, `target_ltv_usd`, `breach_ratio`, `date`) via `captureServer()` → events_mirror → PostHog. Zero new infra; admins already check the funnel-anomaly notification surface. No Slack/Email for v1.3.
- **D-15 — Alert cadence: daily at 00:30 UTC, dedup keyed on (source, date).** Cron runs once per day after midnight UTC. Reads the 7d-rolling CAC from `ad_revenue_normalized`. Writes one `cac_alerts` row per breached (source, date) with `idempotency_key = source || '|' || date`. UPSERT prevents repeat notifications across cron re-runs. Matches typical growth-ops cadence; avoids hourly alert-fatigue on a slow-moving metric.
- **D-16 — Creative-level surface lives inside the same CAC dashboard module, drill-down panel.** Single `ADMIN_MODULES` entry `growth/cac`. Default view = per-source CAC cards (top-level matview aggregation). Row click expands an inline drawer for per-campaign rows; row click in drawer expands per-creative rows (top-5 highest CAC + top-5 lowest CAC per campaign). Reuses P27 cohort-builder primitives and the `cards → detail-drawer` pattern from v1.1 P10. CSV export button satisfies operator export needs. Separate `/admin/creatives` page deferred to v1.4 if creative inventory grows beyond one account per network.

### Claude's Discretion

- **Edge Function file layout:** `supabase/functions/ad-spend-cron-meta/`, `ad-spend-cron-google/`, `ad-spend-cron-tiktok/`, `meta-capi-relay/`, `cac-alert-cron/`, `fx-rates-ecb-cron/`. Shared helpers in `_shared/ad-etl-utils.ts` (idempotent upsert helper, attribution-window resolver, FX lookup).
- **Migration timestamp window:** new migrations in `20270703000001..N_*.sql` (Phase 25 took `20270702*`; Phase 50 took `20260519-20260520` and `20270101*`). Run timestamp collision pre-check (memory: `reference_migration_timestamp_collision_precheck.md`) before pushing.
- **Partition strategy for `ad_spend_facts`:** monthly partitions (`ad_spend_facts_y2026m05` etc.) keyed on `spend_date`. Matches P30 matview pattern. 12-month retention; pg_cron monthly job drops partitions older than 13 months.
- **RLS posture:** all 5 new tables (`ad_spend_facts`, `ad_network_config`, `fx_rates`, `ad_etl_health`, `ad_etl_gaps`, `growth_targets`, `cac_alerts`) are admin-only (`is_admin()` SECDEF function from Phase 24). No public reads. Non-admin clients receive empty result via RLS deny + an explicit 51-deny test (memory: `reference_supabase_project.md` cross-tenant proof rule).
- **Bundle impact:** zero. All net-new code is server-side (Edge Functions + migrations). CAC dashboard admin module reuses existing admin shell + cohort primitives; no new client libraries.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements
- `.planning/ROADMAP.md` §Phase 33 (lines 268–281) — goal, depends-on, REQ list, 5 success criteria.
- `.planning/REQUIREMENTS.md` lines 69–77 — ADETL-01..09 verbatim.
- `.planning/REQUIREMENTS.md` line 370 + lines 428–436 + line 612 — phase mapping + V13-5 silent-drop landmine ownership.

### Research artifacts
- `.planning/research/PITFALLS.md` lines 148–151 — V13-5 ad-ETL silent-drop modes; AEM priority register prescription; plan-checker check list (i)–(iv).
- `.planning/research/PITFALLS.md` line 582 — V13-5 mitigation matrix row.
- `.planning/research/PITFALLS.md` line 638 — Ad ETL checklist item: "Often missing — Meta AEM priority register in events.ts".
- `.planning/research/SUMMARY.md` lines 16, 131, 156 — ad ETL 4 silent-drop modes; V13-5 pre-requisite.

### Locked upstream phase context
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — D-10 (additive-only events.ts + ESLint rule); D-11 (canonical event taxonomy); D-12 (PHI client-side gate); D-13 (Edge Fn distinct_id = auth.users.id); ADMIN_MODULES manifest shape.
- `.planning/phases/27-modular-admin-shell-extensions/27-CONTEXT.md` — D-11 (admin module index sources); plan 27-04 events_mirror dual-write extension to posthog-server.ts.

### Reusable backend assets (paths absolute from monorepo root `/Users/karstenhaldan/minisite/`)
- `supabase/functions/_shared/posthog-server.ts` — `captureServer()` with events_mirror dual-write; `shutdownPostHog()` mandatory before Edge return. AEM relay + cac-alert-cron MUST use this helper.
- `supabase/functions/_shared/supabase-server.ts` — service-role admin client factory.
- `supabase/functions/_shared/with-org-scope.ts` — pattern reference (we don't need org-scoping for ad data — admin-only — but it's the helper-wrapper canonical pattern).
- `supabase/functions/funnel-anomaly-cron/` — closest existing cron Edge Fn to clone for ad-spend-cron-* scaffolds.
- `supabase/functions/affiliate-anomaly-sla-reminder/` — admin notification delivery surface to reuse for CAC alerts.
- `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — partitioned-table + matview-refresh pg_cron pattern.
- `supabase/migrations/20260512000002_anon_cleanup_pg_cron.sql` — minimal pg_cron schedule reference.

### Reusable frontend assets
- `src/lib/analytics/events.ts` — `EventDef` shape; Phase 33 adds optional `aem_priority` + `aem_dropped` fields here.
- `eslint-rules/additive-only-events.js` — extend with `phi+aem cross-check rule` (block `aem_priority` on `phi:true` events).

### Project memory worth flagging to planner
- `feedback_vendor_account_circular_dependency` — vendor approval can't gate phase merge; D-01 honors this.
- `reference_vendor_gated_send_health_check` — D-01 pattern source.
- `reference_supabase_migration_filename_regex` + `reference_migration_timestamp_collision_precheck` — pre-merge `ls supabase/migrations/20270703*.sql | wc -l` check before push.
- `reference_supabase_migration_gotchas` — SECURITY DEFINER `search_path = extensions` for `is_admin()`-style functions; partial-index expressions must be IMMUTABLE.
- `reference_hipaa_baa_vendor_matrix` — Meta never signs BAA; D-08 PHI guardrails are belt+suspenders to enforce.
- `reference_phase15_research_findings` — partition + matview pattern proven in P30.

### Codebase maps (already current; do not re-scan)
- `.planning/codebase/INTEGRATIONS.md` — current vendor integration inventory (no ad networks yet — Phase 33 adds 3).
- `.planning/codebase/STACK.md`, `STRUCTURE.md`, `ARCHITECTURE.md` — backend layout reference.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/_shared/posthog-server.ts` — `captureServer()` already dual-writes to `events_mirror`. The `ad_revenue_normalized` matview joins `events_mirror`; the `cac-alert-cron` emits via `captureServer()`. No new client needed.
- `supabase/functions/funnel-anomaly-cron/` — cron-shape reference. Same shape (5-min schedule, `Deno.serve` handler, shared admin client, `shutdownPostHog()` finally block) clones cleanly to the 3 ad-spend ETLs + meta-capi-relay + cac-alert-cron.
- `supabase/functions/affiliate-anomaly-sla-reminder/` — admin notification delivery: how to write to an `admin_notifications` row + render in the admin shell.
- `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — partitioned table + matview + REFRESH cron full pattern.
- `eslint-rules/additive-only-events.js` — extend rather than create a new rule file; the `phi+aem cross-check` is a one-function addition to the existing AST visitor.

### Established Patterns
- **Edge Fn cron with vendor-gated health check** — `if (!env.X) { console.warn(); return ok }` at top of handler. Resend + Stripe Connect already use this. Apply uniformly to all 3 ETL functions.
- **`events_mirror` for server-readable event counts** — avoids PostHog REST rate limits. CAC matview reads from here, NOT from PostHog.
- **Additive-only events.ts** — ESLint blocks removals + type changes. Adding `aem_priority?` field passes; adding `aem_priority` (non-optional) would fail. Plan accordingly.
- **`ADMIN_MODULES` manifest** — `growth/cac` becomes a new manifest entry; admin shell auto-renders nav + route.
- **pg_cron migration shape** — `cron.schedule('job_name', '0 * * * *', $$ SELECT public.function_name(...); $$);` with companion `cron.unschedule` in DOWN migration.

### Integration Points
- **events_mirror table (`public.events_mirror`)** — read by `ad_revenue_normalized` matview JOIN.
- **`is_admin(uuid)` SECDEF function (Phase 24)** — all RLS policies on the 7 new tables.
- **`admin_notifications` table + admin shell badge surface (P27)** — CAC alert + ad_etl_health badges write here.
- **`captureServer()` helper** — `cac-alert-cron` emits `cac_target_breached`; ETL Edge Fns emit `ad_etl_run_complete` + `ad_etl_credentials_missing` + `ad_etl_gap_detected`.
- **`fbq` browser pixel** — `meta-capi-relay` dedupes against browser pixel using shared `event_id`. The browser-side pixel emission is OUT OF SCOPE for Phase 33 (assumed pre-existing or handled by a marketing-html change orthogonal to this phase).
- **ESLint config (`eslint.config.js`)** — `import-x/no-restricted-paths` already blocks `events.phi.ts` from client zones. `meta-capi-relay` Edge Fn must be added to the allowlist for `events.ts` (server-only zone) AND blocklist for `events.phi.ts` so PHI events cannot be imported into the relay.

</code_context>

<specifics>
## Specific Ideas

- **TikTok hand-rolled fetch client** (PITFALLS.md note: TikTok API is the most fragile). Don't use any community SDK — write a thin `fetch()` wrapper with explicit retry-on-429/5xx + exponential backoff + per-request timeout (15s).
- **Meta CAPI `event_id` field** must match the browser `fbq` `eventID` parameter for dedup to work. Document this dependency in the relay's source comments AND in the CONTEXT for whoever ships the browser pixel.
- **TikTok 168h replay window** is non-negotiable per Area 1 D-04 — TikTok's documented 7-day attribution-restate window is the reason V13-5 silent-drop is flagged.
- **Growth targets seed values:** placeholder `(source='all', target_ltv_usd=200, cac_multiplier=0.5)` in the migration; flag in plan-checker iter-1 for user to lock real values before phase ships.

</specifics>

<deferred>
## Deferred Ideas

### To v1.4
- Multi-ad-account-per-network credential support (Vault-encrypted `ad_account_credentials` table).
- TikTok Events API + Google Enhanced Conversions server-side relays (parity with `meta-capi-relay`).
- Admin UI to drag-reorder AEM top-8 events.
- Per-campaign attribution-window override.
- Auto-backfill cron with circuit-breaker.
- Hybrid VIEW + matview split (recent live, history matview) if matview refresh latency becomes user-visible.
- Conversion-day FX rate (Stripe is mostly USD today; revisit if multi-currency revenue grows).
- Dedicated `/admin/creatives` page if creative inventory grows beyond one account per network.

### Out of scope (other phases / never)
- Browser-side `fbq` pixel emission — orthogonal marketing-html scope.
- Email digest / Slack alert delivery — funnel-anomaly notification surface is sufficient for v1.3.
- Computing LTV from Phase 14 tier pricing — brittle retention constant; growth_targets admin-tunable is the right surface.
- Static per-source `TARGET_LTV_BY_SOURCE` constants — same brittleness reason.

</deferred>

---

*Phase: 33-hourly-ad-spend-etl-meta-google-tiktok*
*Context gathered: 2026-05-18*
