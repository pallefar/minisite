# Phase 25: HIPAA Audit Hardening + Vendor BAA Chain - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Every engineering control HIPAA needs is LIVE in code; vendor BAA chain SIGNED across 6 critical vendors so the first clinic deal can close mid-v1.3.

Three concurrent workstreams ship under this phase:

1. **Vendor BAA chain (6 vendors)** — Supabase Team+HIPAA addon, Vercel Pro+HIPAA addon, Sentry Business, Anthropic Enterprise (sales-assisted), AWS SES (via AWS Artifact), PostHog (tier-decision). All 6 calls kicked off in PARALLEL during Phase 24 Wave 0; founder owns all 6.
2. **Engineering controls (audit + email + AI router)** — `phi_access_log` sibling table (sensitive-surface RPC writes only), `_shared/email-router.ts` for SES/Resend split on template `phi:boolean`, dual-credential Anthropic router (consumer vs clinical branches on `org_id IS NOT NULL`), Sentry mask audit + PostHog session-replay disable on PHI URLs.
3. **Compliance / process controls** — SOC 2 Type I via Drata (parallel ~6wk), written policies in `/legal/hipaa/` + Notion mirror, employee training + periodic access reviews via Drata, BAA expiry calendar + admin banner alerts, annual risk assessment + breach-notification SLA docs.

REQ coverage: HIPAA-01..18 (all 18 REQs).

Out of scope: clinic `org_id` axis & per-org BAA scoping (P28); first signed clinic contract (sales process post-P30); enterprise health-system deals requiring SOC 2 Type II (v1.5).

</domain>

<decisions>
## Implementation Decisions

### Vendor BAA chain
- **D-01 — All 6 vendor BAA calls kicked off in PARALLEL during Phase 24 Wave 0; founder owns all 6.** Supabase Team+HIPAA addon ($924/mo), Vercel Pro+HIPAA addon ($350/mo), Sentry Business ($80/mo), Anthropic Enterprise (sales-assisted, custom pricing $500-2K/mo), AWS SES via AWS Artifact (~$10/mo), PostHog (tier decision per D-04). 4-8 week parallel lead time. Tracked in PROJECT.md Vendor Accounts table with `baa_signed_at` + `baa_expiry_at` columns surfaced via `vendor_baa_chain` table.
- **D-02 — Stripe NEVER signs BAA; CI lint enforces "banking exemption" boundary.** Per Stripe corporate policy. v1.3 ships CI lint (D-09) that blocks Stripe API call sites containing PHI keywords. Banking exemption = Stripe processes payment data only, never sees patient diagnosis/medication/dose values; the lint ENFORCES that boundary at commit time.
- **D-03 — Resend NEVER signs BAA at v1.3; PHI emails route via AWS SES.** Per `[[reference_resend_phase9_wiring]]`. `_shared/email-router.ts` switches on template `phi: boolean` flag. Non-PHI (welcome, receipts, marketing, password reset) stays on Resend (faster, better deliverability). PHI (clinic notifications, dose-alert emails, doctor-share confirmations, patient access-log notifications) routes via AWS SES with BAA. Two SDK clients in same Edge Function.
- **D-04 — PostHog HIPAA tier = scrub-only, NO Boost add-on at v1.3.** Save $24K/yr. Session-replay HARD-disabled on all PHI URL regex (HIPAA-17: `/clinic`, `/patient`, `/admin/users`, `/dose-log`, `/share`, `/auth`). Trigger to revisit: "we can't ship Phase 30 clinician dashboard improvements because we have no replay data" becomes an active blocker. Until then, debug via PostHog autocapture events + Sentry + manual reproduction.

### SOC 2 + compliance tooling
- **D-05 — SOC 2 tooling = Drata; Type I at v1.3 (~$10-15K + 6wk); Type II deferred to v1.5.** Drata picked over Vanta for tighter HIPAA module + faster onboarding per most-recent reviews. Single tool covers SOC 2 Type I attestation + HIPAA-10 employee security training + periodic access-review automation. Type I = point-in-time snapshot, accepted by most clinics as trust signal alongside BAA. Type II (12-month observation) deferred until first enterprise health-system deal requires it.
- **D-06 — Written policies live at `/legal/hipaa/` in repo + Notion mirror.** Repo subdirs: `access-control.md`, `incident-response.md`, `breach-notification.md`, `training.md`, `baa-management.md`, `risk-assessment.md`, `data-classification.md`. Source of truth = repo (git diff = policy change history). Notion mirror auto-synced for non-engineering team readability. Drata policy library can SUPPLEMENT but does NOT replace repo as SoT.

### phi_access_log (HIPAA-14)
- **D-07 — phi_access_log writes triggered by explicit RPC calls at sensitive UI surfaces ONLY.** Logged events: patient detail page open (one row per pageview), photo viewer open (one per photo), dose-history export run (one per export), conversation thread open (one per open). Roster paginate = ZERO log rows (aggregate counts only — NOT "access to PHI"). Implemented as `select log_phi_access(actor_id, patient_id, accessed_fields[], reason)` SECURITY DEFINER RPC called from each clinician-facing component. Compliant with HIPAA "minimum necessary access" + low write volume + cheap to query.
- **D-08 — phi_access_log retention = same as audit_logs (90d hot + Parquet cold forever); patient-side viewer in account Settings.** Match Phase 24 D-16 audit_logs retention. Patients see a "Who has viewed my data" tab in account Settings showing every PHI-access by clinician/staff/admin with timestamp + actor name + reason. Strongest patient-trust signal; satisfies HIPAA right-of-accounting-of-disclosures.

### Stripe PHI keyword lint (HIPAA-08)
- **D-09 — PHI keyword list = static curated JSON + inline allowlist comments.** Hand-maintained at `scripts/stripe-phi-keywords.json`. Initial list: `patient`, `diagnosis`, `medication`, `dose`, `lab`, `mg`, `ml`, `GLP-1`, `Ozempic`, `Wegovy`, `Mounjaro`, `Zepbound`, `semaglutide`, `tirzepatide`, `dulaglutide`, `liraglutide`, `blood pressure`, `weight`, `BMI`, `A1C`, `glucose`, `injection`, `peptide`. CI grep blocks any Stripe API call site whose string arguments (description, statement_descriptor, metadata values, line_item description) contain any keyword. False positives cleared via `// stripe-phi-lint:allow reason='patient-month metering'` inline comment. Add-keyword discipline = whenever a new medication ships in `medications` table, add brand + generic to the JSON; PR review enforces. Lives at `scripts/lint-stripe-phi.ts` (Node script) + CI workflow step.

### MFA enforcement (HIPAA-15)
- **D-10 — Clinician MFA = hard-cut at first /clinic/* request post-Phase-25-deploy.** Same posture as Phase 24 D-06 admin. Consistent organization-wide policy. Org-admin (clinic owner) CANNOT defer per-clinician. Communicated to clinic operators via onboarding email + in-product banner 7 days before Phase 25 ship.
- **D-11 — Patient MFA = optional, prompted in onboarding (skippable) + persistent in Settings.** No enforcement on patients (clinic-org or B2C). Patient PHI in own account protected by password + email-OTP on new-device challenge (Supabase Auth default). Most consumer-health apps take this posture; mandatory MFA would crater signup conversion. Sensitive patient actions (account deletion, change clinic affiliation, export full data) trigger email-OTP step-up regardless of TOTP enrollment.

### BAA expiry + subprocessor alerts (HIPAA-12, HIPAA-13)
- **D-12 — BAA expiry + subprocessor-diff alert = admin banner + email-to-founder + audit-log entry.** `vendor_baa_chain` check cron runs nightly. 60-day advance: persistent banner in /admin shell ("VENDOR_NAME BAA expires in 60 days") + email to founder. 30/14/7/1-day milestones: escalate (additional emails, banner color shifts from amber → red). On expiry: red "COMPLIANCE GAP" banner in /admin. Subprocessor-diff cron compares vendor subprocessor lists weekly against last-known and routes alerts the same way. Each alert writes an `audit_logs` row (tamper-detection). No PagerDuty in v1.3 (overkill for 2-person team).

### Anthropic dual-credential router (HIPAA-07)
- **D-13 — `ai-chat` Edge Function branches on `org_id IS NOT NULL`.** `org_id` present (clinical context): use `ANTHROPIC_CLINICAL_API_KEY` (BAA + ZDR + restrictive system prompt + web_search disabled). `org_id` null (consumer): use `ANTHROPIC_CONSUMER_API_KEY` (existing v1.2 key, may NOT cover BAA). Runtime BAA-scope guard (D-14) gates model IDs regardless. Default to consumer (cheaper, broader model access) only when `org_id` is genuinely null — never silent-fallback from clinical to consumer.
- **D-14 — Runtime BAA-scope guard (HIPAA-04 success criterion #1).** Hard-coded allowlist of BAA-covered Anthropic model IDs in `_shared/anthropic-baa-allowlist.ts`. Edge Fn checks model ID against allowlist BEFORE forwarding; refuses with 403 + audit-log entry if not allowed (especially: blocks calls to Workbench/Console/Cowork/beta endpoints in clinical context). CI test asserts the refusal path is hit for non-allowlisted IDs. Allowlist updated when Anthropic publishes BAA scope changes (subprocessor-diff cron alerts on docs change).

### Sentry + PostHog masking (HIPAA-16, HIPAA-17)
- **D-15 — Sentry `data-sentry-mask` audit via CI lint.** Custom ESLint/grep rule scans all `.tsx` files for inputs/components touching PHI prop names (`patient.name`, `profiles.email`, dose-value props, photo URLs, etc.) and REQUIRES `data-sentry-mask` attribute on that element. Blocks PR on missing mask. PHI-prop list maintained at `scripts/sentry-mask-required-props.json`.
- **D-16 — PostHog `disable_session_recording_on_url` regex covers `/clinic/*`, `/patient/*`, `/admin/users/*`, `/dose-log/*`, `/share/*`, `/auth/*`.** Initialized in `src/main.tsx` PostHog config. Per HIPAA-17 + research PITFALL. Phase 24 D-12 PHI gate already enforces this on the events side; Phase 25 adds the session-replay enforcement.

### Annual risk assessment + breach SLA (HIPAA-18)
- **D-17 — Annual risk assessment template lives at `/legal/hipaa/risk-assessment.md`; Drata schedules + tracks completion.** Calendar event auto-created by Drata. Breach-notification SLA documented (60 days to HHS per HIPAA Breach Notification Rule). Drill (tabletop exercise) annually with founder + on-call ops. Documentation kept in `/legal/hipaa/incident-response.md`.

### Claude's Discretion

Researcher and planner have latitude on:
- Exact DDL for `vendor_baa_chain` and `phi_access_log` tables (follow v1.2 conventions per `[[reference_supabase_migration_gotchas]]`).
- Exact regex / glob shape for the Stripe PHI lint script (single tool to read all `.ts`/`.tsx` files matching `stripe.*` imports).
- Drata SDK / portal-only flow for evidence collection (Drata may have an API for some controls; manual portal for others — choose based on Drata current docs).
- Whether Anthropic dual credentials live in Supabase Function secrets, Vercel env, or split (recommend Function secrets to keep secrets out of build pipeline).
- Drata vs Vanta migration path (D-05 picks Drata; if onboarding hits unexpected friction, switch is acceptable BEFORE Type I attestation work starts).
- Pre-stubbing strategy: Phase 25 may declare `vendor_baa_chain` rows with `baa_signed_at = null` and `status = 'pending'`, then flip rows to `signed` as each vendor call closes during Wave 0.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 25 (lines 85–95) — Goal + 5 success criteria + 18 REQ list.
- `.planning/REQUIREMENTS.md` — HIPAA-01..18 (lines 143–160); REQ → phase mapping table.
- `.planning/PROJECT.md` — Vendor Accounts table; v1.3 milestone scope; current state.
- `.planning/STATE.md` — accumulated decisions; HIPAA chain vendor list + cost summary.

### v1.3 Research
- `.planning/research/SUMMARY.md` — HIPAA tier-upgrade cost matrix ($1,864-4,364/mo); foundation-first sequencing; HIPAA BAA chain breakage LANDMINE risk.
- `.planning/research/STACK.md` — AWS SES via `@aws-sdk/client-sesv2` Deno import; PostHog tier options.
- `.planning/research/PITFALLS.md` — Resend BAA gap; Stripe PHI banking exemption; runtime BAA scope guard; subprocessor-diff cron requirement.
- `.planning/research/ARCHITECTURE.md` — `_shared/email-router.ts` pattern; dual Anthropic credential router; vendor_baa_chain table.

### Phase 24 carry-forward (load-bearing prerequisites)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — `audit_logs` schema + retention (D-14..17); admin role model (D-04: superadmin tier for HIPAA-sensitive actions); event taxonomy `phi:boolean` (D-12); TOTP hard-cut posture (D-06..09); modular admin shell manifest (D-01..05 — Audit Log module ships at P24; this phase adds phi_access_log viewer surface).

### Memory references (decision rationale)
- `[[reference_hipaa_baa_vendor_matrix]]` — verified vendor BAA + pricing across 6 vendors; 13 required engineering controls + 5 non-code controls + lead times.
- `[[reference_resend_phase9_wiring]]` — Resend NO public BAA → AWS SES fallback (D-03).
- `[[reference_supabase_migration_gotchas]]` — SECURITY DEFINER search_path; RLS deny patterns.
- `[[reference_supabase_migration_filename_regex]]` — 14-digit timestamp strict.
- `[[reference_vendor_gated_send_health_check]]` — pattern for code that depends on still-pending vendor (Drata, BAAs); build prod path + startup health check that no-ops with logged warning.
- `[[reference_stripe_legacy_key_and_supabase_token]]` — Stripe legacy keys still valid.
- `[[feedback_realtime_layer_e2e_pattern]]` — DB-level invariant verification for RLS deny on phi_access_log + vendor_baa_chain.
- `[[reference_rls_fixture_gotruechient_flake]]` — RLS test pattern for new HIPAA tables.

### External docs (consult via Context7 at research time)
- AWS SES v2 API + SDK (Deno `npm:` specifier).
- AWS Artifact BAA process (self-serve portal).
- Drata HIPAA + SOC 2 Type I onboarding flow + API (if any).
- Anthropic Enterprise pricing + BAA + ZDR addendum process.
- Supabase Team plan + HIPAA add-on enablement.
- Vercel Pro + HIPAA add-on enablement (self-serve since 2025 per `[[reference_hipaa_baa_vendor_matrix]]`).
- Sentry Business plan + BAA process.
- PostHog Boost add-on documentation.
- HIPAA Breach Notification Rule (60-day HHS SLA).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`supabase/functions/_shared/`** (currently only `_uat-resend`) — pattern target for adding `email-router.ts`, `posthog-server.ts` (Phase 24), `anthropic-baa-allowlist.ts`, `log-phi-access.ts`.
- **Phase 24 `audit_logs` migration + RLS deny pattern** — directly applicable to `phi_access_log` and `vendor_baa_chain`.
- **Phase 24 admin shell manifest** — Audit Log module already declared; Phase 25 adds a sibling "Compliance" module showing `vendor_baa_chain` rows + expiry status + subprocessor-diff feed.
- **Phase 24 `admin_role` enum** — `superadmin` tier already exists; Phase 25 reuses it for vendor-BAA management UI + reset_totp for clinicians.
- **`scripts/assert-clinic-bundle-budget.sh`** (Phase 24 D-20 generalization) — pattern target for `scripts/lint-stripe-phi.ts` CI script.
- **PostHog client init in `src/main.tsx`** — Phase 24 already adds `disable_session_recording_on_url`; Phase 25 expands the regex per HIPAA-17.

### Established Patterns
- **Pattern S1 (dual-layer security):** Phase 24 D-03. Carry forward to clinician + clinic-admin RPCs in Phase 25 (especially log_phi_access).
- **Vendor-gated send via health check** (per `[[reference_vendor_gated_send_health_check]]`): code shipping ahead of vendor BAA signing — build prod path + startup health check no-ops with logged warning. Critical for AWS SES email-router.ts and Drata-driven controls during the 4-8 week vendor lead window.
- **Append-only RLS** (Phase 24 D-17): same posture for `phi_access_log` and `vendor_baa_chain`.
- **Curated PHI-table list** (Phase 24 D-14): same list + `phi_access_log` triggers extend it.
- **Per-chunk bundle ceilings** (Phase 24 D-18..20): Phase 25 adds NO new client-side chunk (this is mostly Edge Functions + admin pages, all already inside admin-shell 30 kB).

### Integration Points
- **`src/main.tsx` PostHog config** — expand `disable_session_recording_on_url` regex (HIPAA-17).
- **`ai-chat` Edge Fn** (existing v1.2) — wrap with org_id branching (D-13) + BAA-scope guard (D-14).
- **`_shared/email-router.ts`** (NEW) — replaces direct Resend calls in clinical/PHI email paths.
- **CI workflow** — adds `lint-stripe-phi` step + `audit-sentry-mask` step + nightly `vendor-baa-chain` cron job + weekly `subprocessor-diff` cron job.
- **`/admin/compliance` route** (NEW module entry in Phase 24 manifest) — vendor_baa_chain UI, BAA expiry calendar, subprocessor-diff feed, Drata sync status.
- **Vercel Routing Middleware** — extends Phase 24 `/admin/*` aal2 step-up to `/clinic/*` per D-10 clinician hard-cut.

</code_context>

<specifics>
## Specific Ideas

- Initial Stripe PHI keyword list (D-09): patient, diagnosis, medication, dose, lab, mg, ml, GLP-1, Ozempic, Wegovy, Mounjaro, Zepbound, semaglutide, tirzepatide, dulaglutide, liraglutide, blood pressure, weight, BMI, A1C, glucose, injection, peptide. Maintainable JSON.
- Vendor BAA cost summary visible in /admin/compliance dashboard so the founder sees monthly compliance cost at a glance.
- AWS SES BAA via AWS Artifact portal = same-day self-serve (per `[[reference_hipaa_baa_vendor_matrix]]`).
- Vercel HIPAA add-on self-serve since 2025.
- BAA expiry alert color scheme: amber 60-30d → orange 30-14d → red <14d (matches v1.2 affiliate-payout staleness pattern).
- `vendor_baa_chain` columns: vendor_name, baa_signed_at, baa_expiry_at, monthly_cost_usd, scope_summary, subprocessor_list (jsonb), subprocessor_last_diff_at, contact_email, status enum (pending/signed/expired).
- Drata setup: 6 weeks parallel — kick off in Phase 24 Wave 0 alongside vendor BAA calls.

</specifics>

<deferred>
## Deferred Ideas

- **SOC 2 Type II attestation** — D-05 explicitly defers to v1.5 when enterprise health-system deals require it.
- **PostHog Boost add-on** — D-04 defers; revisit only when clinician-dashboard replay debugging becomes the active blocker.
- **PagerDuty (or any oncall tool) for BAA expiry** — D-12 explicit reject; revisit when team grows past 5 and oncall rotation exists.
- **Org-admin per-clinician MFA grace extension** — D-10 explicit reject for v1.3; revisit if clinic operators give substantial pushback.
- **Patient mandatory MFA (option B)** — D-11 explicit reject; revisit if a compromised-patient-account incident occurs OR if a major clinic deal requires patient-side TOTP as deal terms.
- **Drata-hosted policy library as SoT** — D-06 keeps repo as SoT; revisit if SOC 2 Type II audit work prefers Drata-managed policy templates.
- **Dynamic PHI keyword lint from `medications` table** — D-09 rejects (CI DB-read flakiness risk); revisit if static list grows past 200 keywords or maintenance becomes burden.
- **Per-row trigger phi_access_log on all PHI tables** — D-07 rejects (perf cost); revisit if HIPAA audit finding pushes us to "every SELECT must be logged" reading.
- **Per-org BAA scoping** (specific clinic asks "is our subprocessor list X-compliant?") — defers to Phase 28 (org schema) + Phase 30 (clinician dashboard) when the org-side BAA dashboard becomes a feature.
- **Anthropic third-credential tier** (e.g., extra-restrictive prompts for clinic-research use cases) — defers to v1.5.
- **In-product BAA viewer for clinics** ("download our BAA + subprocessor list") — defers to P30/P31 clinic-side surfaces.

### Reviewed Todos (not folded)
None — STATE.md "Pending Todos" section shows none for Phase 25.

</deferred>

---

*Phase: 25 — HIPAA Audit Hardening + Vendor BAA Chain*
*Context gathered: 2026-05-17*
