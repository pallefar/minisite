# Phase 27: Modular Admin Shell Extensions - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Shared admin infrastructure that powers Phases 28, 30, 34, 37:

1. **Bulk actions on Members table** — 5 action types (CSV export, tag, comp-plan, ban, force-password-reset) with sync/async execution, confirmation modal, undo banner, per-row audit_logs.
2. **Cohort builder** — JSONB rule tree authored via visual builder UI; `cohort_definitions` + `cohort_membership` matview refreshed via pg_cron 15-min. Consumers: PAYWALL variants (Phase 39), RECOMMEND triggers (Phase 38), SAVE eligibility (Phase 40), GAME challenges (Phase 35), TAXO funnels.
3. **Command palette (Cmd+K)** — cmdk-based fuzzy navigation across modules + recent items + quick actions; aal2 step-up gate on destructive quick actions.
4. **Funnel-anomaly cron** — admin-configurable list of tracked funnels (`anomaly_tracked_funnels` table); hybrid same-day-of-week + same-hour-of-day baseline with weighted blending; in-app banner + email to superadmin alias; 4h same-funnel suppression.

REQ coverage: ADMIN-04, ADMIN-05, ADMIN-06, TAXO-03, TAXO-05.

Out of scope: per-org bulk actions (P28 owns org-scoping); patient-side dashboard cohorts (analytics not for-public); cohort-based personalized email send (Phase 38 RECOMMEND owns digest); Slack/PagerDuty alert channels (deferred).

</domain>

<decisions>
## Implementation Decisions

### Bulk actions (ADMIN-04)
- **D-01 — Execution: sync ≤100 rows; queue background Edge Fn beyond, hard cap 10,000.** `admin_bulk_jobs` table (`id, action_type, target_filter jsonb, requested_by, status enum('pending','running','completed','failed'), rows_total int, rows_completed int, error_log jsonb, created_at, completed_at`). Sync path runs inside the admin RPC. Async path enqueues + admin sees progress bar polling job_status every 2s. Per-row `log_admin_action` (Phase 24) writes ONE row per affected user with `before_data` + `after_data`.
- **D-02 — Confirmation modal: button-click for all actions** (per user). Simpler UX; relies on undo (D-03) as the safety net. Modal shows action summary + affected count + first 3 sample users (e.g. "Ban 47 users — Alice, Bob, Carol, +44 more").
- **D-03 — Undo policy:**
  - **Ban + comp-plan + tag/untag**: 60-second undo banner (toast) in admin shell; clicking Undo writes reverse action + audit_logs entry.
  - **Force-password-reset**: NO undo (password already reset; user must re-set on next login).
  - **CSV export**: NO undo (just a download; no state mutation).
  - Undo state stored in transient client-side state + a `bulk_action_undo_token` row that the reverse RPC validates against (defends against expired tokens).
- **D-04 — 5 action types ship at v1:** `csv_export`, `tag`, `comp_plan` (grant free Pro for N days), `ban` (account_state='banned'), `force_password_reset` (clear current session + email reset link). Each gates on admin_role + aal2 freshness.

### Cohort builder (ADMIN-05 + TAXO-03)
- **D-05 — Expression language = JSONB rule tree + visual builder UI.** Stored as `cohort_definitions.rule jsonb`. Shape: `{op:'and'|'or', children:[...]}` recursively, leaf nodes `{field, op('='|'!='|'>'|'<'|'>='|'<='|'in'|'is_null'|'is_not_null'), value}`. Visual builder UI translates to/from this shape. Server-side translator generates SQL WHERE clause for matview population.
- **D-06 — Field allowlist (15 fields v1):** `tier (free|pro|lifetime)`, `role (patient|clinician|admin|superadmin)`, `days_since_signup`, `days_since_last_login`, `total_paid_amount_cents`, `active_streak_days`, `has_active_subscription`, `signup_source`, `country`, `language`, `has_org` (org_id IS NOT NULL), `has_completed_onboarding`, `is_affiliate`, `anomaly_flagged`, `account_state (active|banned|comp|past_due)`. Adding fields = small PR + matview column adjustment. No custom-SQL escape hatch in v1.
- **D-07 — Consumer read pattern = matview + indexed read** (per TAXO-03 + SC#4 sub-50ms p99). `cohort_membership(user_id, cohort_id, joined_at)` PRIMARY KEY `(user_id, cohort_id)`. Matview rebuilt every 15min via pg_cron. Consumers query `select 1 from cohort_membership where user_id = ? and cohort_id = ?`. 15-min staleness acceptable for PAYWALL/RECOMMEND/SAVE/GAME/TAXO use cases.
- **D-08 — Matview refresh pattern: `refresh materialized view concurrently`** so reads don't block during rebuild. Single matview rebuilt per cron tick (not per-cohort) — at v1 cohort count (<20) this is fastest.
- **D-09 — Cohort lifecycle: `cohort_definitions.status` enum('draft','active','archived')`.** Only `active` cohorts populated into matview. Admin can `archive` (cohort no longer evaluated) but not delete (preserves history of which user was in which cohort for past consumer queries — though those queries read live matview, so archive = effectively delete from consumers' perspective. Document this).

### Command palette (ADMIN-06)
- **D-10 — Library: cmdk (vercel/cmdk).** React-only headless component, ~10kB gz. Fits inside Phase 24 admin-shell 30 kB ceiling.
- **D-11 — Index sources:** (a) Build-time modules — derived from Phase 24 `ADMIN_MODULES` manifest. (b) Recent items via SECDEF RPC `admin_palette_recent` fetched lazily on palette open — returns last 20 admin-interacted items (members recently viewed, helpdesk tickets recently opened, affiliates recently reviewed). (c) Build-time quick actions list (e.g. "Ban user...", "Export members CSV...", "Open audit log..."). No search-as-you-type DB lookup in v1 (defer to v1.4 if needed).
- **D-12 — Quick-action destructive gate: aal2 step-up required.** Phase 24 D-09 admins log in at aal2 every session. Selecting destructive action in palette (ban, comp-plan, reset-password) re-verifies aal2 freshness; if older than 15 minutes, prompt fresh TOTP before executing. Defends against shoulder-surfing palette usage.
- **D-13 — Keyboard-first UX (per SC#3):** Cmd+K opens; ↑↓ navigates; ⏎ executes (or opens sub-action confirmation modal); Esc closes. Mouse interactive but keyboard is the primary path.

### Funnel-anomaly cron (TAXO-05 + SC#5)
- **D-14 — Tracked-funnels list: admin-configurable via `anomaly_tracked_funnels` table.** Columns: `(funnel_id, event_name text not null, is_enabled boolean default true, baseline_lookback_days int default 7, sigma_threshold numeric default 2.0, created_by uuid, created_at)`. Superadmin manages via /admin/anomaly settings. Seed v1 with 5 funnels: `signup_completed`, `activation_event`, `payment_succeeded`, `lifetime_grant`, `helpdesk_ticket_resolved`.
- **D-15 — Baseline methodology: hybrid same-day-of-week AND same-hour-of-day with weighted blending.** Compute 24h count for each funnel. Compare to blend of (a) mean+stddev of same hour-of-day across last 7 days, weighted 0.4; (b) mean+stddev of same day-of-week across last 4 weeks, weighted 0.6. If 24h count < (blended mean - 2σ): flag anomaly. SQL computed in `funnel_anomaly_baseline_compute` SECDEF function.
- **D-16 — Cron schedule:** every 5 minutes (per SC#5 "<5 minutes from detection"). `0,5,10,15,20,25,30,35,40,45,50,55 * * * *`. Verify no collision with existing crons (audit-archive day-1 03:00, vendor BAA expiry day-1 06:00, subprocessor-diff Mon 07:00, affiliate-lifetime-recurring day-1 03:00) — none collide.
- **D-17 — Alert routing: in-app banner on /admin/* (realtime channel to all admin+) + email to superadmin alias.** Realtime channel `funnel_anomaly_alerts` broadcasts alert payload; AdminLayout subscribes + renders banner. Email goes to `SUPERADMIN_ALERTS_EMAIL` env var (founder's inbox at v1; future could route per-role).
- **D-18 — Suppression: same funnel suppressed 4 hours after first alert.** `funnel_anomaly_alerts(funnel_id, fired_at)` last-alert timestamp; next-alert cron tick checks if `now() - last_fired < interval '4 hours'` and skips. Reset suppression when 24h count returns to within baseline (resolution event also broadcast).
- **D-19 — Alert log table:** `funnel_anomaly_alerts(id, funnel_id, fired_at, observed_count, expected_mean, expected_stddev, z_score, resolution_status enum('firing','resolved','acknowledged'), acknowledged_by uuid, acknowledged_at)`. Append-only; superadmin acknowledges via admin UI; audit-logged.

### Schema additions (planner discretion)
- **D-20 — New tables:** `admin_bulk_jobs`, `cohort_definitions`, `cohort_membership` (matview), `anomaly_tracked_funnels`, `funnel_anomaly_alerts`, `bulk_action_undo_token` (transient, 60s TTL via cron-purge).
- **D-21 — New SECDEF RPCs:** `admin_bulk_action_execute(action_type, target_filter)`, `admin_bulk_action_undo(undo_token)`, `cohort_define(name, rule_jsonb)`, `cohort_archive(cohort_id)`, `admin_palette_recent()`, `funnel_anomaly_baseline_compute(event_name)`, `funnel_anomaly_acknowledge(alert_id)`. All audit-logged via Phase 24 `log_admin_action`.
- **D-22 — New Edge Functions:** `admin-bulk-job-worker` (background bulk action processor; SQS-style poll-claim pattern on admin_bulk_jobs.status='pending'), `funnel-anomaly-cron` (5-min cron tick; computes baselines + emits alerts), `bulk-undo-token-purge` (1-min cron purges expired undo tokens).
- **D-23 — Append-only RLS on `audit_logs` (Phase 24 carry)** + same posture on `funnel_anomaly_alerts` + `admin_bulk_jobs` (read-only after creation).

### Claude's Discretion

Researcher and planner have latitude on:
- Exact JSONB rule tree → SQL translator implementation (recursive function in TS + tests).
- Visual builder UI primitives (recommend headless library — e.g. dnd-kit for nesting, or hand-rolled).
- Matview refresh failure handling (cron alert if refresh takes >60s).
- cmdk theming to match Phase 24 admin-shell visual style.
- Recent-items recency window (recommend last 7 days, max 20 items).
- aal2 step-up implementation (Supabase Auth `mfa.challengeAndVerify` per Phase 24 D-07).
- Field-allowlist seed migration shape (DB enum vs TS const + ESLint rule).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 27 (lines 127–138) — Goal + 5 success criteria + 5 REQ list + UI hint.
- `.planning/REQUIREMENTS.md` — ADMIN-04..06 (lines 25–27); TAXO-03 (line 33); TAXO-05 (find).

### v1.3 Research
- `.planning/research/SUMMARY.md` — admin extensions in must-have tier; cohort builder feeds RECOMMEND/PAYWALL/SAVE/GAME.
- `.planning/research/STACK.md` — cmdk option in admin-heavy surfaces stack.
- `.planning/research/FEATURES.md` — admin command palette in should-have; cohort builder must-have.
- `.planning/research/ARCHITECTURE.md` — cohort_membership matview pattern; cross-feature wiring.
- `.planning/research/PITFALLS.md` — matview refresh blocking reads; suppression-window alert fatigue.

### Phase 24 + 25 + 26 carry-forward (load-bearing)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — admin role enum + ADMIN_MODULES manifest (D-01..D-05); audit_logs schema (D-14..D-17); TOTP / aal2 (D-06..D-09); bundle ceilings (D-18..D-20).
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-01-PLAN.md` — audit_logs actual DDL (action_name FREE TEXT; source enum 'rpc'|'trigger'; service_role REVOKE insert).
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-03-PLAN.md` — ADMIN_MODULES manifest shape (palette indexes from this).
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — phi_access_log (palette + bulk actions on patient data trigger phi_access_log writes via Phase 25 D-07).
- `.planning/phases/26-multi-tier-affiliate-standard-gold-lifetime/26-CONTEXT.md` — affiliate review queue cohort (anomaly funnel "lifetime_grant" reads from Phase 26 affiliate_program.tier).

### Memory references
- `[[reference_supabase_migration_gotchas]]` — SECURITY DEFINER + IMMUTABLE for partial indexes (cohort matview).
- `[[reference_supabase_migration_filename_regex]]` — 14-digit timestamp strict.
- `[[reference_rls_fixture_gotruechient_flake]]` — RLS test pattern for new tables.
- `[[reference_realtime_layer_e2e_pattern]]` — funnel_anomaly_alerts realtime broadcast verification.
- `[[reference_bundle_budget_hash_hyphen]]` — admin-shell 30 kB ceiling check.
- `[[reference_eslint_import_x_path_gotcha]]` — field allowlist enforcement via import zone restrictions.
- `[[feedback_planner_iter1_anti_patterns]]` — defensive jsonb contracts (cohort rule tree shape lives in ONE TS type, not duplicated in plpgsql).
- `[[feedback_status_machine_transition_owner]]` — admin_bulk_jobs status transitions (pending→running→completed/failed) owned by which plan.
- `[[reference_vendor_gated_send_health_check]]` — email alerts via existing Resend email-router (Phase 25 D-03, non-PHI path).

### External docs (consult via Context7 at research time)
- cmdk (vercel/cmdk) — current API + theming.
- Supabase `refresh materialized view concurrently` + unique index requirement.
- Supabase Auth aal2 step-up via `mfa.challengeAndVerify`.
- Postgres recursive CTE for JSONB rule tree → SQL translation.
- pg_cron schedule precedence.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 24 admin shell + ADMIN_MODULES manifest** — Phase 27 wires bulk-action + cohort + palette UI into the manifest's existing module slots (Members, Settings, Audit Log).
- **Phase 24 `log_admin_action` SECDEF RPC** — every bulk-action row + every cohort/palette/anomaly admin action writes here.
- **Phase 24 audit_logs schema** — `action_name`, `target_user_id`, `before_data`, `after_data`, `source='rpc'`; bulk actions use one row per affected user.
- **Phase 25 Resend email-router (`_shared/email-router.ts`)** — anomaly alert email uses non-PHI template + Resend path (per Phase 25 D-03).
- **Phase 25 admin_role superadmin tier** — gates anomaly-tracked-funnels config + cohort archive + bulk-action approval.
- **Phase 26 affiliate anomaly review queue UI** — pattern for the funnel_anomaly_alerts admin acknowledgment UI.
- **Existing v1.2 `clinic/roster/BulkExportCSVFlow.tsx`** — pattern for bulk CSV export (path: `src/components/clinic/roster/BulkExportCSVFlow.tsx`).

### Established Patterns
- **Pattern S1 dual-layer security (Phase 24 D-03)** — every admin RPC client gate + DB SECDEF re-check.
- **`refresh materialized view concurrently`** — requires unique index on matview; existing patterns from v1.2 affiliate_click_baseline.
- **Append-only RLS** (Phase 24 D-17) — same posture on funnel_anomaly_alerts, admin_bulk_jobs.
- **Idempotency on cron jobs** (Phase 26 D-07) — anomaly cron tick idempotent on `(funnel_id, tick_yyyymmddhhmm)` key.
- **Bundle ceiling** — Phase 24 D-18 admin-shell 30 kB; Phase 27 ADDs cmdk (~10kB) + visual builder (~5kB est) + bulk-action modal (~3kB) = ~18 kB. Watch ceiling; may need lazy-load palette + builder.
- **Realtime channel broadcast** for in-app banner — pattern from Phase 19 affiliate updates.
- **`addInitScript` for Playwright** ([[reference_playwright_state_seeding]]) for testing palette + cohort flows.

### Integration Points
- **Phase 24 ADMIN_MODULES** — palette indexes from this manifest.
- **Phase 24 audit_logs.log_admin_action** — all admin RPCs in Phase 27 call it.
- **Phase 24 admin_role enum** — gating tier on each RPC.
- **Phase 25 email-router** — anomaly alert email send (non-PHI template).
- **Phase 26 affiliate Anomaly Review tab** — sibling pattern for funnel anomaly acknowledgment UI.
- **v1.2 `clinic/roster/BulkExportCSVFlow.tsx`** — bulk-export pattern carry-forward.
- **PostHog event registry (Phase 24 events.ts)** — anomaly cron reads event counts from PostHog `/api/projects/{id}/insights/trend/` OR (preferred per [[reference_vendor_gated_send_health_check]]) from a local `events_mirror` table populated by `_shared/posthog-server.ts`. Researcher recommends approach.

</code_context>

<specifics>
## Specific Ideas

- 15-field allowlist enumerated in D-06.
- 5 funnel seed list: signup_completed, activation_event, payment_succeeded, lifetime_grant, helpdesk_ticket_resolved.
- pg_cron schedules: matview 15min, anomaly 5min, undo-purge 1min — all distinct from existing crons.
- Bulk action sync cap 100, async cap 10,000.
- Undo banner: 60s for ban + comp-plan + tag.
- Suppression window: 4 hours per funnel.
- aal2 freshness window: 15 minutes for destructive palette actions.
- Email recipient: `SUPERADMIN_ALERTS_EMAIL` env var (founder's inbox v1).
- Alert payload schema: `{funnel_id, fired_at, observed_count, expected_mean, expected_stddev, z_score}`.

</specifics>

<deferred>
## Deferred Ideas

- **Custom-SQL escape hatch in cohort builder (superadmin-only)** — D-06 explicit reject for v1; revisit if 15-field allowlist proves insufficient.
- **Search-as-you-type member lookup in palette** — D-11 reject for v1; v1.4 if recent-items proves insufficient.
- **Slack/PagerDuty alert channels** — D-17 explicit defer; v1.5 when on-call rotation exists.
- **Type 'CONFIRM' free-text for destructive bulks** — D-02 reject; revisit if accidental-bulk-ban incident occurs.
- **5-minute universal undo for ALL actions** — D-03 reject; current 60s is sufficient for ban/comp/tag.
- **Per-cohort matview refresh** — D-08 reject for v1 cohort count <20; revisit at cohort count >50.
- **Per-clinic anomaly tracking** — defer to Phase 30 (clinic dashboard) — clinics get clinic-scoped anomaly view of their own funnels.
- **Cohort overlap / set operations UI** — D-05 explicit reject in v1; visual builder supports nested AND/OR/NOT via rule tree but doesn't surface "intersect cohort A with cohort B" sugar.
- **Auto-suppression on resolution** — D-18 acknowledged but full implementation deferred; v1 ships fixed 4h window; v1.4 adds "resolved when count returns to within 1σ".
- **Bulk action templates / saved filters** — v1.4.

### Reviewed Todos (not folded)
None.

</deferred>

---

*Phase: 27 — Modular Admin Shell Extensions*
*Context gathered: 2026-05-17*
