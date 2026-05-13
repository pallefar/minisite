# Phase 10: Clinic Operator Surface - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

The clinic operator opens `/clinic/{slug}` and sees a ranked roster of all linked patients with at-a-glance signal columns (last dose, weight-trend arrow, recent symptom severity, days-since-injection, missed-dose flag) sorted by `rankPatients` "needs attention" score; clicks any row to drill into a read-only patient detail page that REUSES Phase 8's DoctorView component via a newly-extracted `ReadOnlyPatientView` shared component (passing `viewerMode='clinic'`); the Org Owner has access to a Settings → Audit tab surfacing every operator action with member/action/time-range filters and a 13-month rolling window; and every operator action mirrors back to the affected patient via Phase 9's "Active organizations" row → "View activity" modal (which Phase 9 stubbed and Phase 10 fills). The role substrate (Owner/Coach/View-only + custom roles, has_permission helper, audit_logs capture, Realtime broadcast primitive) is already live from Phase 9 — Phase 10 only READS from it; no new role/permission rows except `roster.read_breakdown` (Coach has, Viewer doesn't) added via seed update.

**Phase 10 closes when:**
- CLINIC-04 (roster ranking via rank_org_patients RPC), CLINIC-05 (drill-in via ReadOnlyPatientView reuse), and CLINIC-07 (org-owner audit surface UI) are shipped and verified.
- SC#5 50-patient roster renders < 2s on Vercel preview (PR-gated CI test).
- Phase 8 SharePage is non-regressively refactored to consume the extracted `ReadOnlyPatientView`.
- Per-patient audit mirror surfaces in Phase 9's previously-stubbed "View activity" modal.
- Coach vs Viewer role differences enforced in UI (hide sections) AND RLS (already from Phase 9).

**Out of scope (deferred):**
- Roles/permissions schema work (Phase 9 D-07 done).
- BAA/HIPAA disclosure language reviews (counsel-led, separate track).
- Billing/seat scaffold (not v1).
- "Send patient check-in message" / push-from-clinic flows (Phase 11+).
- Custom rank weights per org (v2 if operators ask).

</domain>

<decisions>
## Implementation Decisions

### Rank algorithm + execution location (CLINIC-04 / SC#1, SC#5)

- **D-01 (LOCKED, rank server-side, no cache):** New SECURITY DEFINER RPC `rank_org_patients(p_org_id uuid)` returns ordered array of `(user_id uuid, display_name text, score smallint, breakdown jsonb, last_injection_at timestamptz, weight_trend_arrow text, recent_symptom_severity smallint, days_since_injection int, missed_dose_flag bool)`. RLS-gated by `has_permission(auth.uid(), p_org_id, 'patient_data.read')` via inner-join on the helper. Recomputes on every roster load — no materialized view, no cron. Implementation: plpgsql batched per-patient or a Deno Edge Function reading from a share_snapshot_view-shape projection scoped by org+consent_scope. SLA: 50 patients < 500ms RPC latency to satisfy SC#5's 2s total render.
- **D-02 (LOCKED, fixed weights V1 + breakdown):** Score 0-100. Weights (highest→lowest): missed-dose flag, recent symptom severity, weight-trend reversal, days-since-injection, streak break. Implementation reuses Phase 3 `pickFocus`/`generateInsights` weight architecture, batched per patient. `breakdown` jsonb is `{ "missed_dose": <signal_score>, "symptom_severity": <signal_score>, ... }`. Roster row shows aggregate score + tooltip expansion (gated by `roster.read_breakdown` permission per D-13). Weights NOT org-tunable in v1.

### Drill-in component reuse pattern (CLINIC-05 / SC#2)

- **D-03 (LOCKED, extract ReadOnlyPatientView):** Refactor Phase 8's `SharePage` into a thin wrapper around a new `src/components/shared/ReadOnlyPatientView.tsx` component that accepts:
  - `viewerMode: 'share' | 'clinic'` — controls chrome (CodeEntryScreen vs ClinicContextBar) and which sections are visible
  - `snapshot: SnapshotData` — same shape as Phase 8's SnapshotResponse
  - `permissionMap?: { canViewPhotos: bool, canViewBreakdown: bool, ... }` — for Coach vs Viewer role-tailored UI per D-12
  - Lands in a NEW shared chunk that both `share` and `clinic` lazy chunks depend on. Bundle redistribution: share chunk shrinks slightly; clinic chunk grows accordingly; shared chunk lazily loaded on either entry point.
- **D-04 (LOCKED, clinic-snapshot Edge Function):** New `supabase/functions/clinic-snapshot/index.ts` mirroring Phase 8's `/share/snapshot`:
  1. Validates operator JWT (passed as `Authorization: Bearer <user_token>`)
  2. Verifies operator is active member of `org_id` (`memberships.revoked_at IS NULL`)
  3. Verifies operator's role has `patient_data.read` via `has_permission(operator, org_id, 'patient_data.read')`
  4. Verifies patient's `memberships.consent_scope` for this org includes the requested sections AND patient's `revoked_at IS NULL`
  5. Returns SnapshotResponse with `viewer_context: 'clinic'`, `org_id`, `patient_user_id`, `permission_map` (computed from operator's role)
  6. Cache-Control: private, no-store (same as Phase 8 SHARE-03 — every response, every status code)
  7. Audit-row writes per D-09 (`section_view` events per audit-row-per-section granularity).

### Roster data fetching + pagination

- **D-05 (LOCKED, single denormalized RPC):** The `rank_org_patients` RPC from D-01 returns ALL signal columns + score + breakdown in one row per patient. No follow-up per-patient queries from client. RLS filters by `has_permission(viewer, org_id, 'patient_data.read')`.
- **D-06 (LOCKED, 50/page server-side sort):** Pagination 50/page; default sort score DESC; column-click triggers a new RPC call with `p_sort_column` + `p_sort_direction` params for server-side resort. Cursor or offset pagination — planner picks (offset is simpler at this scale; cursor if SC scales).

### Org-owner audit surface UI (CLINIC-07 second half)

- **D-07 (LOCKED, Settings tab):** New `/clinic/{slug}/settings/audit` tab in ClinicSettingsPage alongside Workspace / Members / Roles. Tab visibility gated by `has_permission(viewer, org_id, 'audit_log.read')` — Owner has by default; can be granted to custom roles.
- **D-08 (LOCKED, 3 filters + per-patient mirror):** Audit tab filters: member dropdown (all org members), action-type dropdown (member.invite / member.revoke / patient_data.read / patient_photos.read / role.update / rank_computed / etc.), time-range picker (last 24h / 7d / 30d / custom). Per-row display: timestamp, actor (name + role badge), action, target, expandable details. **Per-patient mirror:** Phase 9's stubbed "View activity" on each Active Orgs row (per Phase 9 D-15) gets filled — clicking opens a modal with audit rows where `target_user_id = current patient AND org_id = membership.org_id`. End-user trust surface — invested.
- **D-09 (LOCKED, 13-month retention):** Audit surface reads directly from `audit_logs`; Phase 7 D-04's retention cron handles the purge. Operators see anything younger than 13 months. No CSV export, no archival banner in v1 (defer to v2 if counsel asks).

### Performance verification (SC#5)

- **D-10 (LOCKED, CI seed + Playwright assertion):** New script `leanshot/e2e/fixtures/seed-org-50.ts` creates one test org, 50 synthetic patients (via Supabase admin client), each with 30 days of synthetic injections/weights/symptoms via INSERT. New Playwright spec `leanshot/e2e/roster-perf.spec.ts` signs in as operator, navigates to `/clinic/{slug}`, asserts roster renders within 2000ms via `page.evaluate(() => performance.now() - navigationStart)`. afterAll cleanup removes the org + 50 users (per memory `feedback_parallel_executor_git_isolation.md` HI-6-style hygiene).
- **D-11 (LOCKED, PR gate, path-scoped):** New CI job `roster-perf` in `.github/workflows/ci.yml` triggered on PR when changed files match `leanshot/src/components/clinic/**` OR `supabase/migrations/*roster*.sql` OR `supabase/functions/clinic-snapshot/**`. Runs the seeded Playwright test against a Vercel preview deploy URL. ~3-min added to PR feedback on Phase-10-relevant PRs only. Mirrors Phase 2.1 path-scoped Lighthouse pattern. HI-2 additive convention: append to ci.yml AFTER Plan 08-05's `share-security-drill` job, don't modify prior appends.

### Coach vs Viewer behavioral differences

- **D-12 (LOCKED, hide sections entirely):** Permission-gated sections of `ReadOnlyPatientView` are absent (not rendered) when the operator lacks the relevant permission. Viewer (no `patient_photos.read`) sees the drill-in with the Photos section completely missing. Mirrors Phase 7-8-9 Settings NAV gating (tabs hide for users without permission).
- **D-13 (LOCKED, score breakdown role-gated):** Rank score 0-100 shown to both Coach and Viewer. The expandable breakdown tooltip with per-signal weights is gated by a NEW permission key `roster.read_breakdown` — added to Phase 9's seed list (extension via row insert, not a Phase 10 schema migration). Coach seeded with `roster.read_breakdown` = true; Viewer = false. Owner inherits all permissions. Rationale: breakdown reveals which signals are firing; useful for Coach's clinical outreach decisions but unnecessary for Viewer's read-only role.

### Mobile roster + drill-in UX

- **D-14 (LOCKED, mobile card-stack):** Below 768px viewport, roster table collapses to vertical card stack. Each card: patient name (top), score chip (top-right), signal grid (2×2 below: last dose / weight arrow / symptom severity / days since injection), tap-to-drill-in. Uses existing `<Card>` primitive (Phase 8 UI-SPEC token discipline). Sort affordance becomes header dropdown. Pagination 50/page (same as desktop); cards stack vertically with paging footer.
- **D-15 (LOCKED, full-screen mobile drill-in):** Mobile drill-in replaces the roster view with a back button in the clinic-context bar. Returns to roster on back. Desktop is split-pane (roster left, drill-in right) reusing Phase 8 SharePage layout via ReadOnlyPatientView.

### Realtime roster updates

- **D-16 (LOCKED, signal columns live, score periodic):** Operator's `/clinic/{slug}` subscribes to the org-scoped Realtime channel from Phase 9 D-10. New broadcast trigger on `injections`, `weights`, `symptoms` INSERT (server-side filtered by org-member relationship + consent_scope) — operator UI patches the relevant roster row's signal columns. Score is NOT recomputed on each event (avoids per-event RPC spam); a passive 30s refetch + a manual "refresh" button handle score recompute. Sub-second feedback on signal-column changes; periodic refresh on score.
- **D-17 (LOCKED, row-flash + threshold toast):** When a row's signal columns update via Realtime, the row briefly flashes (200ms fade-in highlight, respects `prefers-reduced-motion`). When a patient's score crosses a threshold (e.g., crosses 70 = "needs attention") a toast surfaces with the patient name + reason. Routine updates are silent; threshold crossings are notable.

### Ranking-explainability + per-patient mirror data shape

- **D-18 (LOCKED, audit ranking calls + threshold crossings):**
  - `rank_org_patients` RPC writes ONE audit_logs row per CALL with `actor_type='org_system'`, `action='rank_computed'`, `org_id=p_org_id`, `metadata={ patient_count, weights_snapshot, top_3_score_buckets }`.
  - Per-patient audit row whenever a patient's score crosses a threshold (70+ "needs attention" or drops below): `target_user_id=patient`, `action='rank_threshold_crossed'`, `metadata={ score, breakdown_snapshot, threshold_crossed, direction }`.
  - HBNR/WMHMDA defensible: patients can request the breakdown of any flag decision.
- **D-19 (LOCKED, patient surface):** Patient's "View activity" modal (Phase 9 stubbed; Phase 10 fills) has TWO tabs: "Operator views" (audit rows from operator drill-ins, per-section granular per D-21) and "Ranking events" (threshold-crossing rows from D-18 with copy: "On <date>, your data triggered a clinical-attention flag in this clinic's ranking. Why?"). Both filtered by `target_user_id = patient_id AND org_id = membership.org_id`.
- **D-20 (LOCKED, patient-mirror detail level):** Per-row display: `<timestamp> — <actor display name> (<role>) <action verb> your <section>`. No IP, no UA, no device fingerprint visible. Actor name from `auth.users.user_metadata.display_name`, falls back to "a clinic member" if empty. Mirrors HIPAA Right of Access shape ("who saw what, when") without surveillance theater.
- **D-21 (LOCKED, per-section audit granularity):** Audit rows fire on section-component mount, not per-RPC. Sections that trigger audit rows: Injections, Weights, Symptoms, Photos, Doctor Report, Chart (full chart view). Skip noise (chart hover, modal close). Typical drill-in session = 5-10 audit rows. Implementation: each section component calls `posthog.capture` AND writes an audit row via a new `log_clinic_view(org_id, target_user_id, section_name)` SECURITY DEFINER RPC. Volume: 50 drill-ins/day per org × 10 rows = 500/day → 6 months = ~90K rows → well within retention cron capacity.

### Bulk operator affordances

- **D-22 (LOCKED, full bulk suite in v1):** Multi-select infrastructure on roster (checkbox per row, header "select all visible", selection state preserved across pagination clicks). Three bulk actions ship:
  1. **View latest reports as bulk PDF** — operator selects N patients → server-side jsPDF assembly (reuse Phase 7 dynamic-import pattern) → one PDF with per-patient sections (chart + injections + weights + symptoms + doctor report stub). 1 audit row per included patient (`action='bulk_pdf_export'`, `target_user_id=<patient>`). Honors `consent_scope` and `has_permission` — sections the operator doesn't have permission to see are absent in the PDF.
  2. **Export symptoms last 30d as CSV** — N patients → one CSV file with columns (patient_display_name, date, symptom_name, severity). Plain server-side CSV assembly; no PDF infra. 1 audit row per patient.
  3. **Open all in tabs** — opens N new tabs each at `/clinic/{slug}/patient/{user_id}` (client-side `window.open` loop). 1 audit row per `patient_drill_open` as the page loads (handled by D-21's section audit). Capped at 5 tabs/op to prevent browser blocking; toast warns at cap.
- **D-23 (LOCKED, multi-select UX):** Checkbox per row (40px hit target per Phase 8 UI-SPEC IconButton precedent); header "X selected" pill with action menu dropdown (3 actions). Selection persists across column resort and pagination. Clear-selection button. Mobile: long-press to select; tap-to-drill remains primary.

### Telemetry / PHI-safe events

- **D-24 (LOCKED, 10 events, PHI-safe):** All Phase 10 PostHog events specified in `10-EVENTS.md` (canonical doc per D-25):
  1. `clinic_workspace_loaded` `{ org_id }`
  2. `clinic_roster_loaded` `{ org_id, patient_count, render_ms }`
  3. `clinic_roster_sorted` `{ column, direction }`
  4. `clinic_patient_drilled_in` `{ org_id, score_bucket: 'low'|'mid'|'high' }`
  5. `clinic_drill_section_expanded` `{ section_name }`
  6. `clinic_audit_tab_opened` `{ org_id }`
  7. `clinic_audit_filter_applied` `{ filter_type, has_member_filter, has_action_filter, has_time_filter }`
  8. `clinic_bulk_selected` `{ count, action_planned }`
  9. `clinic_bulk_action_executed` `{ action, patient_count }`
  10. `clinic_rank_breakdown_expanded` `{ score_bucket }`
  PHI rules: NO patient IDs, NO patient names, NO score values (use `low`/`mid`/`high` buckets — 0-29/30-69/70-100), NO membership IDs. Org IDs OK (organizational identifier, not patient PHI). Comply with Phase 1 PostHog hygiene (no free-text health content).
- **D-25 (LOCKED, single 10-EVENTS.md doc):** All events specified in `.planning/phases/10-clinic-operator-surface/10-EVENTS.md` with name + properties schema + fire location + PHI-safety rationale. Each implementing plan `read_first` references it. Single audit pass after phase close confirms PHI-safety contract across the suite.

### Claude's Discretion

- **`rank_org_patients` implementation language** — planner picks plpgsql vs Deno Edge Function. plpgsql is simpler (one round-trip); Edge Function might be cleaner if logic gets complex.
- **Score-bucket boundaries** — D-24 names `low`/`mid`/`high` but the actual thresholds (currently 0-29/30-69/70-100) are tunable by the planner if operator feedback warrants.
- **PDF assembly path for bulk export** — jsPDF dynamic-import (Phase 7 pattern) vs server-side render via a new `bulk-export` Edge Function (heavier). Recommend client-side jsPDF for v1 since bundle cost is already paid in Phase 7.
- **Realtime broadcast trigger payload shape** — planner picks; recommend `{ user_id, section: 'injections'|'weights'|'symptoms', changed_at }` minimum.
- **Roster column ordering on desktop** — Score | Name | Last Dose | Weight Arrow | Symptom Sev | Days Since | Missed-Dose Flag is a sensible default; planner can adjust.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 10 requirements
- `.planning/REQUIREMENTS.md` §"Clinic / coach B2B" — CLINIC-04, CLINIC-05, CLINIC-07 (post-2026-05-12 split: capture in Phase 9, surface UI in Phase 10)
- `.planning/ROADMAP.md` §"Phase 10: Clinic Operator Surface" — 5 success criteria

### Phase 9 carry-forward (load-bearing — Phase 9 must close before Phase 10 plan-phase)
- `.planning/phases/09-clinic-b2b-foundations/09-CONTEXT.md` D-07 (role system + has_permission helper), D-09 (clinic-context bar), D-10 (two-layer revoke + Realtime primitive), D-14 (workspace switcher), D-15 (Active Organizations tab — Phase 10 fills its "View activity" stub)
- `.planning/phases/09-clinic-b2b-foundations/09-UI-SPEC.md` — ClinicWorkspace shell + ClinicContextBar + ClinicSettingsPage tabs (Workspace/Members/Roles) + design tokens carried forward
- `supabase/migrations/<phase-9-ranges>_*.sql` — 13 migrations applied by Phase 9 (orgs, memberships, invites, roles, role_permissions, permissions, has_permission helper, realtime.messages RLS, broadcast trigger, system-role seed trigger)
- `supabase/functions/clinic-invite/*` and `supabase/functions/clinic-photo/*` — Phase 9 Edge Functions; Phase 10's `clinic-snapshot` follows the same template
- Phase 9 NEW permission key extension: `roster.read_breakdown` added via row insert in `permissions` + `role_permissions` seed update (NOT a Phase 10 schema migration; ships as part of Plan 10-01)

### Phase 8 carry-forward (load-bearing — Phase 8 SharePage refactor is a Phase 10 plan)
- `.planning/phases/08-doctor-read-share/08-CONTEXT.md` D-02 (per-request DB revocation primitive — Phase 10's clinic-snapshot mirrors), D-03 (cookie binding — NOT used in clinic since operator has JWT auth), D-04 (audit_logs extension)
- `.planning/phases/08-doctor-read-share/08-UI-SPEC.md` — SharePage state machine, CodeEntryScreen, design tokens, copy strings (Phase 10 inherits via ReadOnlyPatientView extraction)
- `leanshot/src/components/share/SharePage.tsx` — refactor target for Plan 10-NN (extract ReadOnlyPatientView)
- `leanshot/src/components/share/share-client.ts` — pattern reference for `clinic-client.ts`
- `supabase/functions/share/index.ts` — template for `clinic-snapshot/index.ts`
- `leanshot/e2e/fixtures/shares.ts` — fixture pattern; Phase 10 adds `e2e/fixtures/clinic-org.ts` + `seed-org-50.ts`

### Phase 7 carry-forward
- `.planning/phases/07-compliance-foundations-legal-counsel-led/07-CONTEXT.md` D-04 (audit_logs retention cron — Phase 10's audit surface respects it)
- jsPDF dynamic-import pattern (Phase 7 D-NN — for bulk PDF export per D-22)

### Phase 3 carry-forward
- `leanshot/src/lib/insights.ts` (`pickFocus`, `generateInsights`) — D-02's weight architecture mirrors this; D-01 RPC batches the per-patient computation

### Phase 1 carry-forward (PostHog hygiene)
- `.planning/phases/01-quality-gates-observability-foundation/01-CONTEXT.md` PostHog cookieless setup + PHI-safe event redaction rules — D-24/D-25 must comply

### Project rules / memories
- `reference_supabase_project.md` (memory) — every new RLS surface gets cross-tenant impersonation proof. NEW Phase 10 RLS surfaces: `rank_org_patients` RPC (verify Viewer can't see other orgs' rosters), `log_clinic_view` RPC (target_user_id RLS), `clinic-snapshot` Edge Function path. Add 3 RLS impersonation specs minimum.
- `reference_supabase_migration_gotchas.md` (memory) — IMMUTABLE partial indexes, SECURITY DEFINER `extensions` search_path, audit GUC suppression. Apply preventively to new RPCs (`rank_org_patients`, `log_clinic_view`).
- `reference_deno_test_discovery.md` (memory) — `<name>.test.ts` naming for clinic-snapshot Deno tests.
- `feedback_parallel_executor_git_isolation.md` (memory) — Phase 10 has ~12 plans; pathspec commits MANDATORY in Waves 2+.
- `feedback_parallel_chunked_planning.md` (memory) — fire parallel-eligible Wave 2 + Wave 3 plans via run_in_background where independent.
- `feedback_planner_iter1_anti_patterns.md` (memory) — Phase 10 planner prompt must pre-empt: cross-plan App.tsx writer choreography (Phase 8 SharePage refactor + Phase 10 ClinicDrillIn both touch shared chunk; Phase 9 already handled App.tsx ownership); shared TypeScript interface for SnapshotData (one canonical, not redefined per consumer); VALIDATION flag flip on Plan 10-01 (not 10-NN).
- `project_phase5_bundle_regression.md` (memory) — Heavy SDKs deferred. jsPDF for bulk PDF export = dynamic-import per Phase 7 pattern; do NOT static-import into clinic chunk.
- `project_phase8_phase9_planning_complete.md` (memory) — bundle budget tracking; clinic chunks currently sized; Phase 10 grows clinic chunk slightly with drill-in + audit tab + bulk actions; share chunk shrinks slightly via ReadOnlyPatientView extraction. Re-baseline expected.

### Plan-phase pre-flight blockers (must complete BEFORE `/gsd-plan-phase 10` runs)
- Phase 9 must be executed/closed (Phase 10 depends on 13 migrations + has_permission helper + Realtime broadcast trigger + Workspace shell components).
- Phase 8 wave 3 must close (Phase 10's SharePage refactor depends on Plan 08-04 + 08-05 + 08-06 having shipped).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`audit_logs` table + retention cron (Phase 7+8+9)** — Phase 10 writes new `action` enum values (`rank_computed`, `rank_threshold_crossed`, `section_view`, `bulk_pdf_export`, `bulk_csv_export`); extend `audit_logs_action_check` constraint.
- **Phase 8 SharePage + DoctorReport + MedLevelChart** — refactor extraction target for ReadOnlyPatientView.
- **Phase 9 ClinicContextBar + WorkspaceSwitcher** — Phase 10 reuses without modification.
- **Phase 9 ClinicSettingsPage tabs structure** — Phase 10 adds 4th tab "Audit" alongside Workspace/Members/Roles.
- **Phase 9 has_permission SECURITY DEFINER helper** — Phase 10's all-new RPCs (`rank_org_patients`, `log_clinic_view`) use this for RLS.
- **Phase 9 Realtime broadcast trigger pattern** — Phase 10 extends with new broadcast triggers on `injections`/`weights`/`symptoms` INSERT (scoped to org members via consent_scope).
- **Phase 7 jsPDF dynamic-import** — bulk PDF export per D-22.
- **Phase 1 PostHog cookieless setup** — Phase 10's 10 events fire via existing `posthog.capture` calls; D-24/D-25 codify the contract.

### Established Patterns
- **DB-row-checked authorization via has_permission()** — every clinic-scoped operation (RPC, Edge Function call, RLS policy) calls the helper.
- **Realtime broadcast on UPDATE + per-request DB check** (Phase 9 D-10) — Phase 10 extends to INSERT events on patient-owned tables.
- **Lazy-loaded route branches in App.tsx** — Phase 10 may need additional sub-routes (`/clinic/{slug}/patient/{user_id}`) but they go INTO the existing `clinic` lazy chunk (no new App.tsx top-level branches).
- **Component prop-extension pattern** (Phase 8 HI-5 MedLevelChart) — `ReadOnlyPatientView` extracts the same way: optional props + Zustand fallback in dashboard, snapshot path in share/clinic.

### Integration Points
- Supabase Auth (operator JWT) — `clinic-snapshot` Edge Function decodes JWT, calls has_permission.
- Supabase Realtime — new triggers on `injections`/`weights`/`symptoms` broadcast to org channel.
- Supabase Storage (photos) — Phase 9's clinic-photo Edge Function reused for any photo loads in `ReadOnlyPatientView` clinic mode.
- `SettingsPage` nav array — extend with "Audit" tab gated by `audit_log.read`.
- Active Organizations Settings section (Phase 9 D-15) — Phase 10 fills "View activity" modal stub.

</code_context>

<specifics>
## Specific Ideas

- **Score thresholds:** 0-29 low, 30-69 mid, 70-100 high (used for both PostHog event buckets AND the "needs attention" toast trigger in D-17). Planner can tune.
- **Mobile breakpoint:** 768px (matches existing Tailwind `md:` boundary).
- **Bulk action cap:** 5 patients per "Open all in tabs" bulk; no cap on PDF or CSV exports.
- **Display name fallback:** `auth.users.user_metadata.display_name || 'a clinic member'` for actor name in patient mirror.
- **`roster.read_breakdown` permission key:** added via Plan 10-01 row insert into `permissions` + `role_permissions` seed update. NO schema migration.
- **`rank_org_patients` recompute cadence:** every roster load + every 30s passive refetch on operator's open tab. NOT cached.

</specifics>

<deferred>
## Deferred Ideas

### Out of scope (other phases / vNext)
- **Custom rank weights per org** — defer to v2 if operators report ranking is mis-tuned.
- **"Send patient check-in message" / Resend-templated push from clinic** — Phase 11+; needs deeper operator-to-patient message infra.
- **CSV archival export for org audit** — defer; only ship if counsel asks during BAA review.
- **Cursor-based infinite-scroll roster** — defer to v2 if orgs scale to 200+ patients.
- **Org-tunable score thresholds for "needs attention" toast** — defer.

### Recorded gray areas not deep-dived (planner picks minimal defaults)
- **Coach permission to invite other Coaches** — Phase 9 D-07 said custom roles can be created; Phase 10 doesn't change that.
- **Org-deletion edge case when operator owns multiple orgs** — Phase 9 deferred; planner picks safe default.
- **`clinic-snapshot` Edge Function rate-limit** — planner picks (recommend: per-operator-per-org 60 req/min).
- **Billing scaffold** — not v1.

### Follow-ups
- After Phase 10 ships, run a full `gsd-audit-uat` to verify CLINIC-04/05/07 SCs all green AND that ranking-explainability claim survives a counsel review pass.

</deferred>

---

*Phase: 10-Clinic Operator Surface*
*Context gathered: 2026-05-13*
