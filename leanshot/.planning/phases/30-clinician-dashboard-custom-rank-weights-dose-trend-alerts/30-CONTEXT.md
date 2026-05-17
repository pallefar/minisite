# Phase 30: Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Clinic deals close on this surface. Three deliverables tightly coupled:
1. **Per-clinic ranking weights** — clinic admin tunes which signals (dose-adherence / weight-loss / activity / symptoms) drive patient roster ordering; reorder reflects within 1s of save.
2. **Dose-trend alert pipeline** — nightly cron detects per-patient adherence/variance breaches against per-clinic (+ optional per-patient) thresholds; inserts `clinician_alerts`; delivers via Phase-28 HMAC realtime + PHI-aware email; debounce + retry per SC#3/#4; ack/snooze/auto-resolve per SC#4.
3. **Aggregate clinic dashboard** — population-level matview ("# patients on Wegovy below dosing range this week") refreshed every 15 min + alerts-by-type / alerts-by-clinician-ack-rate metrics.

REQ coverage: CLIN-01..08 (8/8).

Out of scope: white-label theming + 3-role admin UX (Phase 31); helpdesk Resend Inbound (Phase 37); SES `_shared/email-router.ts` (Phase 25 — see D-01); Slack/SMS alert channels (post-v1.3); ML-based dose-trend (rule-based only in v1.3); cross-clinic benchmarking (future). Free-form snooze durations (preset-only in v1.3 per D-13).

</domain>

<decisions>
## Implementation Decisions

### Phase 25 dependency unblocked via Resend non-PHI fallback (CLIN-03)

- **D-01 — Ship CLIN-03 email path with Resend + strict no-PHI template; swap to SES via `_shared/email-router.ts` when Phase 25 ships.** Plan 29-05 already proved the Resend non-PHI fallback works (Phase 25 D-03 router never implemented). Phase 30 follows identical pattern: direct Resend dispatch from a new `clinician-alert-deliver-cron` Edge Function, with a CI lint that grep-scans the alert template for PHI keywords (extend Plan 29-07 `scripts/lint-stripe-phi.ts` keyword list — or add a sibling `scripts/lint-phi-email-templates.ts` if scope diverges). When Phase 25 Plan 25-03 lands, swap the direct `resend.emails.send(...)` call for `sendEmail({phi: false, template: ...})` from `_shared/email-router.ts` — no-op rename.
- **D-02 — Email template shape: generic + actionable.** Subject: `New clinical alert — {org_name}`. Body: `A new clinical alert has been raised in your clinic. Log in to review: {link to /clinic/{slug}/alerts?alert={alert_uuid}}`. NO patient name, NO count, NO alert type/severity, NO dose values, NO vitals. Single CTA link includes `?alert={uuid}` deep-link so clinician lands on the right alert record post-auth. Deep-link survives the magic-link authentication redirect (preserve query string).

### Custom rank weights (CLIN-01)

- **D-03 — `org_settings.ranking_weights jsonb null default null` column** (migration adds; `null` = use Phase 10 hardcoded defaults). Shape: `{"dose_adherence": numeric, "weight_loss": numeric, "activity": numeric, "symptoms": numeric}`. CHECK constraint OR `BEFORE INSERT/UPDATE` trigger enforces (a) all 4 keys present, (b) each numeric in [0, 1], (c) sum equals 1.0 within `±0.001` tolerance. Plan-checker BLOCKER if any new signal added to `rank_org_patients` in future phases isn't represented in this shape.
- **D-04 — Extend `rank_org_patients(p_org_id uuid, ...)` SECDEF to read `org_settings.ranking_weights`.** If row exists AND `ranking_weights IS NOT NULL`: use weights as multipliers in the signal-score composition. If NULL: fall through to existing hardcoded defaults (preserve Phase 10 contract for non-clinic users + clinics that haven't customized). Patient-specific thresholds (CLIN-07) live in a SEPARATE table per D-08 and do NOT affect ranking; they only affect dose-trend alert firing.
- **D-05 — Settings UI surface** — `ClinicRankingWeightsForm.tsx` (new) under `src/components/clinic/settings/`. 4 sliders (or numeric inputs) for the 4 signals; auto-normalize to sum=1.0 on input; Save → SECDEF `update_org_ranking_weights(p_org_id, p_weights)` (admin-only, audit-logged). Reuse existing `src/components/clinic/settings/` directory pattern from Phase 28.

### Roster reorder within 1s (CLIN-01 SC#1)

- **D-06 — Realtime broadcast on `org-{hmac8}-settings` HMAC channel via Phase 28 machinery.** `BEFORE UPDATE` trigger on `org_settings` (when `ranking_weights` column changes) emits `pg_notify`/broadcast event; client RosterTable subscribes via `channelNameFor(orgId, 'settings')` and invokes `useRankRoster.refresh()` on receipt. Reuses Phase 28 HMAC channel infrastructure + Plan 29-03 `_shared/realtime.ts` Deno helper. Works cross-tab (admin in tab A saves; admin in tab B reorders within 1s). Phase 10's existing 30s polling stays as failsafe.

### Dose-trend algorithm + thresholds (CLIN-02, CLIN-07)

- **D-07 — Dual-rule trend definition** — alert fires when EITHER:
  - **(a) Adherence rule** — patient missed `>= N` scheduled doses in past `M` days (computed against prescribed schedule cadence in `vials`/`injections` tables)
  - **(b) Variance rule** — actual injection interval variance > `X%` from prescribed schedule
  - **v1.3 defaults:** `N=2 missed`, `M=14 days`, `X=25% variance`. All three knobs live in `org_settings.dose_trend_thresholds jsonb` (new column added by Plan 30-00 alongside `ranking_weights`).
  - Pure SQL inside the nightly cron — no ML, no embeddings. Researcher tunes exact SQL window/lag patterns.
- **D-08 — NEW `org_patient_thresholds` table** for CLIN-07 per-patient overrides. Schema: `(org_id uuid, patient_user_id uuid, thresholds jsonb not null, set_by uuid references auth.users(id) on delete set null, set_at timestamptz default now(), primary key (org_id, patient_user_id))`. `thresholds jsonb` shape mirrors `org_settings.dose_trend_thresholds` (`{missed_doses_n, window_days_m, variance_pct_x}`). FK `(org_id, patient_user_id)` references `org_patient_links(org_id, patient_user_id)` to enforce link-before-override invariant. RLS per Phase 28 BLOCKERs R1-R5 (`_is_org_admin`-or-clinician-role SELECT; INSERT/UPDATE/DELETE via SECDEF `set_patient_dose_thresholds(p_org_id, p_patient_user_id, p_thresholds)` + audit-log). Cron resolves effective threshold per patient with `COALESCE(patient_override.thresholds, org_settings.dose_trend_thresholds)` JSONB merge.

### Alert delivery + status machine (CLIN-03/04/06)

- **D-09 — `clinician_alerts` schema (single-table + status enum).** Columns:
  - `id uuid pk default gen_random_uuid()`
  - `org_id uuid not null references organizations(id) on delete restrict`
  - `patient_user_id uuid not null references auth.users(id) on delete restrict`
  - `alert_type text not null check (alert_type in ('dose_adherence','dose_variance'))` (v1.3; extensible)
  - `severity smallint not null default 1 check (severity in (1,2,3))` (low/med/high; researcher may collapse to single level for v1.3)
  - `status text not null default 'pending' check (status in ('pending','acknowledged','snoozed','auto_resolved','delivery_failed'))`
  - `threshold_snapshot jsonb not null` — captures the effective thresholds at detection-time (for audit + later "why was this alert raised" surface)
  - `ack_by uuid null references auth.users(id) on delete set null`, `ack_at timestamptz null`
  - `snooze_until timestamptz null`
  - `retry_count smallint not null default 0`, `last_attempt_at timestamptz null`
  - `debounce_key text not null` (composite per D-11)
  - `created_at timestamptz not null default now()`, `auto_resolved_at timestamptz null`
  - UNIQUE constraint on `(org_id, debounce_key)` enforces 24h dedup at the INSERT level.
  - RLS forced; SELECT for `_is_org_admin(org_id)` OR clinician-role members; INSERT only via service_role (cron); UPDATE only via SECDEFs.
- **D-10 — Status machine transitions** (per [[feedback_status_machine_transition_owner]] — every transition has a named owner):
  - `pending → acknowledged`: SECDEF `acknowledge_clinician_alert(p_alert_id)` (clinician)
  - `pending → snoozed`: SECDEF `snooze_clinician_alert(p_alert_id, p_duration)` (clinician)
  - `snoozed → pending`: nightly auto-resume cron when `snooze_until < now()` (transition fires when snooze elapses)
  - `pending → auto_resolved`: nightly cron sets pending alerts where `created_at < now() - interval '7 days'` AND `snooze_until IS NULL`
  - `pending → delivery_failed`: deliver-cron sets when `retry_count >= 3` AND last attempt failed
  - Plan-checker BLOCKER: any new status value added downstream must update this map + assign an owning plan.
- **D-11 — `debounce_key` shape:** `${alert_type}:${patient_user_id}:${date_trunc('day', now())::date}`. Combined with UNIQUE `(org_id, debounce_key)` this enforces "same alert type for same patient on same day INSERTs at most once" at the DB level — application-side dedup not needed.
- **D-12 — Two-cron retry/delivery pattern:**
  - **`clinician-alert-detect-cron`** — pg_cron `0 3 * * *` (03:00 UTC daily; no collision audit: P28 audit-archive 03:00 — VERIFY no collision; if collision, use 03:30 or 04:15. Researcher confirms at plan-phase.). Runs detection SQL per CLIN-02; INSERT ON CONFLICT DO NOTHING into `clinician_alerts`.
  - **`clinician-alert-deliver-cron`** — pg_cron `*/20 * * * *` (every 20 min). Picks `WHERE status='pending' AND retry_count<3 AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '20 minutes')`. Attempts (a) HMAC realtime broadcast on `org-{hmac8}-alerts` and (b) Resend non-PHI email (D-02 template) to org's clinician list. On success: leaves status=pending (clinician acts on it). On failure: bumps `retry_count`, sets `last_attempt_at`. On 3rd failure: sets `status='delivery_failed'` + Sentry warning. Total retry window: ~1h (3 × 20min slots).
- **D-13 — In-app delivery + snooze UX.** New `ClinicianAlertsPanel.tsx` component (persistent right-rail OR bell-icon dropdown — researcher/UI-researcher chooses) subscribes to `org-{hmac8}-alerts` channel. Renders pending+snoozed alerts grouped by recency. Action buttons per alert: **Acknowledge** (immediate ack) + **Snooze** (popover with preset durations `1h | 4h | 24h | 7d` — NO free-form duration in v1.3). Both actions hit SECDEFs from D-10. Alert row includes "View patient" deep-link to Phase 10 drill-in.
- **D-14 — Append-only delivery log table `clinician_alert_deliveries`** for audit/debugging: `(id, alert_id references clinician_alerts(id) on delete cascade, channel text check in ('realtime','email'), attempted_at timestamptz default now(), success boolean not null, error text null)`. Append-only (no UPDATE); supports "why didn't this clinician get the email" investigations. INSERT only via service_role (deliver-cron).

### Aggregate dashboard (CLIN-05, CLIN-08)

- **D-15 — `mv_clinic_alert_metrics` materialized view** for CLIN-05 alerts-by-type + alerts-by-clinician-ack-rate. Refresh cadence: 15 min via pg_cron (matches Phase 27 matview pattern). Columns: `(org_id, alert_type, severity, total_count, acknowledged_count, ack_rate_pct, avg_time_to_ack_minutes, period_start, period_end)`. Window: rolling 7 days. Cron schedule: `*/15 * * * *` — verify no collision with P27 matview cron at plan-phase (likely same schedule already exists; reuse the same `cron.schedule` job that refreshes all matviews if Phase 27 ships a shared job).
- **D-16 — `mv_clinic_dose_trend_population` materialized view** for CLIN-08 ("# patients on Wegovy below dosing range this week"). Refresh: 15 min. Columns: `(org_id, medication_name text, dosing_range_status text check in ('below','within','above'), patient_count int, period_start, period_end)`. UI surfaces this in a `ClinicDashboardOverview.tsx` component with stat cards + filter controls.
- **D-17 — Cron collision audit** at plan-phase. Existing crons: audit-archive 03:00, vendor-baa 06:00, subprocessor-diff Mon 07:00, affiliate-lifetime 03:00, funnel-anomaly 5min, matview 15min, undo-purge 1min, org_invites-expiry 04:00, p29 org-metered-billing 02:00, p29 org_patient_invites_expiry 04:30. NEW: detect-cron 03:00 (COLLISION with audit-archive — researcher must shift; suggest 03:15), deliver-cron */20min, auto-resolve-cron 04:15 (COLLISION with org_patient_invites_expiry 04:30 — only 15min gap, acceptable), snooze-resume-cron — can fold into deliver-cron's logic (eliminate). Researcher resolves at plan-phase.

### Stripe PHI lint extension (carry-forward)

- **D-18 — Extend Plan 29-07's `scripts/lint-stripe-phi.ts` (or add `scripts/lint-phi-email-templates.ts`)** to scan the new clinician-alert email template + any other Phase 30 email touchpoint. PHI keyword list reuse from Phase 29 baseline. CI lint MUST pass against the alert template (zero matches). Researcher decides: extend existing script vs new sibling script.

### Claude's Discretion

Researcher and planner have latitude on:
- Exact placement of `ClinicianAlertsPanel.tsx` — right-rail persistent vs bell-icon dropdown (UI-researcher decides primitives; Phase 28 admin shell may have an existing slot).
- Exact ranking-weights settings UI primitive — sliders vs numeric inputs vs presets (UI-researcher; Phase 28 settings page has precedent).
- Severity-level collapse — whether v1.3 uses 3 severity levels or a single level (researcher; clinical-UX evidence-driven).
- Cron schedule collision resolution per D-17 (researcher resolves with `cron.job` table audit).
- Whether `mv_clinic_alert_metrics` + `mv_clinic_dose_trend_population` are 2 separate matviews vs 1 combined (researcher; perf-driven).
- Whether `_shared/email-router.ts` swap-in (when Phase 25 ships) is done as part of P30 or as a separate Phase 25 close task (per RESEARCH/scope).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 30 — 5 success criteria + 8 REQ list.
- `.planning/REQUIREMENTS.md` lines for CLIN-01..08 definitions + REQ→phase mapping.

### Phase 28 carry-forward (load-bearing)
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-CONTEXT.md` — `organizations`, `org_settings`, `org_consent_grants`, `org_patient_links`, `_is_org_admin` helper, HMAC realtime channels.
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md` — BLOCKERs R1-R5 apply to ALL new org-scoped tables (`org_patient_thresholds`, `clinician_alerts`, `clinician_alert_deliveries`).
- `supabase/migrations/20270601100005_org_settings_table.sql` — `org_settings` schema to extend with `ranking_weights` + `dose_trend_thresholds` columns.

### Phase 29 carry-forward (load-bearing)
- `.planning/phases/29-org-subscriptions-per-patient-metered-billing/29-CONTEXT.md` — D-05 HMAC realtime broadcast pattern (`channelNameFor`); D-11 Stripe PHI lint script; two-phase magic-link pattern for any post-RPC HTTP calls.
- `supabase/functions/_shared/realtime.ts` — Deno-safe `channelNameFor(orgId, suffix)` HMAC helper (added by Plan 29-03).
- `supabase/functions/_shared/sentry.ts` — `captureMessage` + `captureException` (P29 D-04 baseline).
- `supabase/migrations/20270601200004_org_patient_invite_rpcs.sql` — SECDEF template (search_path locked, audit_logs direct INSERT pattern; NOT log_admin_action which requires platform-admin role).
- `scripts/lint-stripe-phi.ts` + `scripts/stripe-phi-keywords.json` (P29-07) — PHI keyword baseline; extend OR add sibling.
- `[[project_phase24_audit_trigger_bugfix]]` — `app.suppress_audit='on'` GUC required inside SECDEFs that write audit_logs to avoid recursion.

### Phase 25 references (planned, NOT shipped — D-01 fallback)
- `.planning/ROADMAP.md` §Phase 25 — Plan 25-03 ships `_shared/email-router.ts`. Phase 30 ships WITHOUT this; swap-in is Phase-25-close task per D-18.
- `[[reference_resend_phase9_wiring]]` — RESEND_API_KEY + RESEND_FROM Function secrets (verified live during P29-07).

### Phase 10 carry-forward (load-bearing)
- `supabase/migrations/20260901000003_rank_org_patients_rpc.sql` — `rank_org_patients` SECDEF baseline. EXTEND to read `org_settings.ranking_weights`; do NOT replace. Preserve `RankRosterRow` shape.
- `leanshot/src/components/clinic/roster/*` — `RosterTable.tsx`, `use-rank-roster.ts`, `use-roster-realtime.ts`. Realtime hook is the natural extension point for D-06 weight-change broadcast.
- `leanshot/src/components/clinic/drill-in/*` — `ClinicDrillInPage.tsx`, `PatientActivityModal.tsx`. CLIN-07 per-patient threshold override UI lives here (new tab or section).

### Phase 27 carry-forward
- Phase 27's matview-with-15-min-cron pattern (canonical for D-15/D-16 aggregate views; researcher reads at plan-phase to confirm the shared `cron.schedule` job pattern).

### Memory references (project rules)
- `[[reference_supabase_project]]` — every RLS surface gets cross-tenant impersonation proof test
- `[[reference_rls_fixture_gotrueclient_flake]]` — ES256-compat fixture pattern
- `[[feedback_rls_per_file_slug_prefix]]` — file-scoped TEST_SLUG_PREFIX
- `[[reference_supabase_migration_filename_regex]]` — strict 14-digit; next available slot after Phase 29's `20270601200007` is `20270601300001`
- `[[reference_supabase_migration_gotchas]]` — SECDEF needs `set search_path = pg_catalog, public, extensions`; partial indexes need IMMUTABLE
- `[[feedback_planner_iter1_anti_patterns]]` — re-use Phase 28/29 patterns; no defensive duplicates
- `[[feedback_status_machine_transition_owner]]` — D-10 status transitions named owners
- `[[reference_supabase_edge_function_deploy]]` — bundler ignores import_map; use esm.sh
- `[[feedback_realtime_layer_e2e_pattern]]` — drive trigger via Playwright, instantiate receiving operator's supabase-js channel.subscribe() directly in test file
- `[[feedback_verifier_catches_rpc_contract_drift]]` — add body-keys assertion to mocked deno tests; run verifier even on PLAN COMPLETE
- `[[reference_supabase_list_users_by_email]]` — for any UUID-by-email resolution in SECDEFs/Edge Fns
- `[[reference_vendor_gated_send_health_check]]` — startup health check no-ops with logged warning (apply to Resend in the alert-deliver Edge Fn)

### External docs (consult via Context7 at research time)
- pg_cron schedule precedence + lock contention with sibling crons (D-17 collision audit)
- Postgres `LISTEN/NOTIFY` vs Supabase Realtime broadcast for trigger-driven channel emits (D-06)
- Resend rate limits + bounce handling (deliver-cron retry semantics)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (DO NOT DUPLICATE)
- **`supabase/migrations/20270601100005_org_settings_table.sql`** — `org_settings` table; EXTEND with `ranking_weights jsonb` + `dose_trend_thresholds jsonb` columns.
- **`supabase/migrations/20260901000003_rank_org_patients_rpc.sql`** — Phase 10 SECDEF; EXTEND to read org_settings.ranking_weights with NULL-fallback to existing hardcode.
- **`supabase/functions/_shared/realtime.ts`** (Plan 29-03) — `channelNameFor(orgId, suffix)`; HMAC channel naming for D-06 + D-13.
- **`supabase/functions/_shared/sentry.ts`** — `captureMessage`, `captureException`.
- **`supabase/functions/_shared/supabase-server.ts`** — `_createServiceRoleClientUnsafe` (required by ESLint `no-raw-service-role-client`).
- **`leanshot/src/components/clinic/roster/use-roster-realtime.ts`** (Phase 10) — realtime hook to extend for D-06 weight-change subscription.
- **`scripts/lint-stripe-phi.ts`** + `scripts/stripe-phi-keywords.json` (P29-07) — PHI keyword baseline.
- **Phase 28 `_is_org_admin(org_id)` SECDEF helper** — RLS gate on every new org-scoped table.
- **Phase 24 `app.suppress_audit='on'` GUC pattern** — inside SECDEFs that write audit_logs.

### Established Patterns
- **Pattern S1 dual-layer security** (P24 D-03) — client gate + DB SECDEF re-check.
- **Append-only RLS** (P24 D-17) — `clinician_alerts` (UPDATE only via SECDEFs), `clinician_alert_deliveries` (no UPDATE ever).
- **Cross-tenant RLS fixture** — ES256-compat `admin.generateLink + plain fetch /auth/v1/verify` + file-scoped slug prefix.
- **HMAC realtime channel** (P28 D-20..D-24 + P29 D-05) — `org-{hmac8}-{suffix}` channels (`-settings` for D-06, `-alerts` for D-13).
- **Two-cron pattern** (detect + deliver with backoff) — proven Plan 29-04 `org-metered-billing-cron` style (sequential per-org loop, per-record try/catch, Sentry on failure, no upstream throw).
- **Status-machine ownership table** — every transition has a named SECDEF/cron owner per [[feedback_status_machine_transition_owner]].
- **Matview + 15-min refresh** — Phase 27 pattern, reuse for D-15 + D-16.

### Integration Points
- **Phase 10 `rank_org_patients` RPC** — extend signal-score composition to multiply by `org_settings.ranking_weights[signal]` when present.
- **Phase 28 `org_settings`** — ADD 2 columns via Plan 30-00 RECONCILE migration.
- **Phase 28 `org_patient_links`** — `org_patient_thresholds` FK references this composite.
- **Phase 28 admin-role + clinician-role** — alert ack/snooze SECDEFs gate on clinician-role membership (verify exact role-name in Phase 28 schema at plan-phase).
- **Phase 29 stripe-webhook channel infrastructure** — proven extension pattern for HMAC realtime broadcast on subscription updates; mirror for `org-{hmac8}-settings` weight-change broadcast.
- **Phase 27 matview job** — shared `cron.schedule` invocation; researcher confirms reuse vs new job.
- **Phase 25 `_shared/email-router.ts`** — swap-in target when Phase 25 ships; D-01 explicit no-op rename path.

</code_context>

<specifics>
## Specific Ideas

- Plan 30-00 RECONCILE migration: ADD `org_settings.ranking_weights jsonb null`, ADD `org_settings.dose_trend_thresholds jsonb null default '{"missed_doses_n":2,"window_days_m":14,"variance_pct_x":25}'::jsonb`.
- Migration slot starts at `20270601300001` (next 14-digit slot after Phase 29's `20270601200007`).
- New tables: `clinician_alerts`, `clinician_alert_deliveries`, `org_patient_thresholds`.
- Status enum values (D-09): `pending | acknowledged | snoozed | auto_resolved | delivery_failed`.
- debounce_key shape (D-11): `${alert_type}:${patient_user_id}:${YYYY-MM-DD}` with UNIQUE on `(org_id, debounce_key)`.
- v1.3 dose-trend default thresholds: `missed_doses_n=2`, `window_days_m=14`, `variance_pct_x=25`.
- Snooze preset durations (D-13): `1h | 4h | 24h | 7d` (no free-form).
- Auto-resolve window (CLIN-06 SC#4): 7 days; cron at 04:15 UTC (close to but distinct from p29 org_patient_invites_expiry 04:30).
- Cron schedules (researcher confirms collision at plan-phase):
  - `clinician-alert-detect-cron`: `0 3 * * *` (suspect collision with audit-archive — likely shift to `15 3 * * *`)
  - `clinician-alert-deliver-cron`: `*/20 * * * *`
  - `clinician-alert-auto-resolve-cron`: `15 4 * * *` (or fold into deliver-cron)
  - `clinic-matview-refresh-cron`: reuse Phase 27 shared 15-min job if available
- 2 new matviews: `mv_clinic_alert_metrics`, `mv_clinic_dose_trend_population`; 15-min refresh.
- 2 new Edge Functions: `clinician-alert-detect-cron`, `clinician-alert-deliver-cron`. (auto-resolve may stay pure SQL.)
- Email subject template (D-02): exact string `New clinical alert — {org_name}`.
- New UI components (under `leanshot/src/components/clinic/`):
  - `settings/ClinicRankingWeightsForm.tsx` (CLIN-01)
  - `settings/ClinicDoseTrendThresholdsForm.tsx` (CLIN-02 defaults)
  - `alerts/ClinicianAlertsPanel.tsx` (CLIN-03/06 in-app)
  - `alerts/AlertSnoozePopover.tsx` (preset durations)
  - `dashboard/ClinicDashboardOverview.tsx` (CLIN-05/08 aggregate)
  - drill-in extension: `PatientThresholdOverrideForm.tsx` (CLIN-07)
- Realtime channels: extend Phase 28 HMAC pattern with new suffixes `-settings`, `-alerts`.

</specifics>

<deferred>
## Deferred Ideas

- **Free-form snooze durations** — preset-only in v1.3 per D-13. Custom durations defer to v1.4 if clinics push back.
- **ML-based dose-trend** — pure SQL rule-based in v1.3. ML refinement (e.g., personalized variance baselines via Bayesian update) defers to post-v1.3.
- **Slack/SMS alert channels** — realtime + email only in v1.3. Additional channels via `clinician_alert_deliveries.channel` enum extension.
- **Cross-clinic benchmarking** — aggregate matviews are per-org only; cross-clinic anonymized comparisons defer (multi-tenant analytics surface).
- **Per-clinician notification preferences** — all alerts go to all clinic-role members in v1.3. Per-clinician routing rules defer.
- **Alert escalation chains** — no escalation in v1.3 (if no one acks in 24h → page on-call). Future.
- **Patient-side visibility of alerts raised about them** — none in v1.3 (clinician-only). Patient transparency surface defers.
- **Severity-collapse to single level** — researcher decides at plan-phase per D-09; if dropped, restore in v1.4 if clinicians ask.
- **Matview combine** — if perf testing shows 1 combined matview beats 2 separate, researcher consolidates (Claude's Discretion).
- **`_shared/email-router.ts` swap-in** — when Phase 25 ships, swap direct Resend for router. Could be part of P30 or P25 close — Claude's Discretion.

### Reviewed Todos (not folded)
None — STATE.md has no Phase 30-applicable open todos.

</deferred>

---

*Phase: 30 — Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts*
*Context gathered: 2026-05-17*
