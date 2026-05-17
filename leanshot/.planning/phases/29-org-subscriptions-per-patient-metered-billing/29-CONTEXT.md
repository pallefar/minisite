# Phase 29: Org Subscriptions + Per-Patient Metered Billing - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Clinics pay Stripe per active patient via the SEPARATE Stripe namespace Phase 14 already established (`public.clinic_stripe_customers` + `public.subscriptions` clinic branch + `subscription_events`). Clinic admin invites a patient by email; patient receives magic-link, accepts consent, and is bound to the org via `profiles.primary_org_id` + `org_consent_grants`. Stripe Meter Events fire nightly with `count_active_patients(org_id)` rolling 30-day definition.

REQ coverage: ORG-08, ORG-09, ORG-10 (3/3).

Out of scope: clinician dashboard + custom rank weights + alerts (Phase 30); white-label theming + 3-role admin UX (Phase 31); helpdesk Resend Inbound (Phase 37); affiliate program (Phase 26 / v1.2 P19). Recurrent invoice line-item rendering UX (admin "Billing" page deep view) deferred to v1.4 polish if the minimal billing surface ships sufficient for clinic operator needs.

</domain>

<decisions>
## Implementation Decisions

### Phase 14 reconciliation (locks the schema before any code)

- **A1 — DROP `public.org_subscriptions` (P28 D-14 skeleton); extend Phase 14 `public.subscriptions` table.** P28 shipped `org_subscriptions` as deny-all RLS skeleton with NO writes anywhere. Drop it via Plan 29-00 RECONCILE migration. Phase 14's `public.subscriptions` already has `(user_id is null) XOR (clinic_id is null)` CHECK constraint and references `organizations(id)` (auto-renamed by P28 RECONCILE rename). Add columns P29 needs that aren't already present: `seats_paid int default 0` and `seats_used int default 0` if missing (verify via `\d subscriptions` first — Phase 14 may have shipped these). Zero data migration. Phase 14 `subscriptions` is canonical for ALL Stripe subs going forward.
- **A2 — Phase 14 `public.clinic_stripe_customers` (keyed by `clinic_id` → `organizations(id)`) is canonical for clinic Stripe customer mapping; ORG-08 ROADMAP wording "stripe_customer_id_org keyed by (user_id, customer_context)" is imprecise — the real key is `clinic_id`. The (user, context) separation is satisfied by two tables: `stripe_customers` (consumer, keyed by user_id) and `clinic_stripe_customers` (clinic, keyed by clinic_id). Same-email-different-customer property holds because consumer + clinic customer-create paths are independent. CI test asserts this directly.

### Per-active-patient billing meter (ORG-09)

- **D-01 — `count_active_patients(org_id uuid) returns int` SECDEF function.** Definition: `select count(distinct opl.patient_user_id) from org_patient_links opl where opl.org_id = $1 and opl.unlinked_at is null and exists (select 1 from <event tables UNION> where user_id = opl.patient_user_id and created_at > now() - interval '30 days')`. Event tables UNION: `injections`, `weights`, `meals`, `mood`, `sleep`, `symptoms`, `photos`, `workouts`, `vials`, `ai_messages` (every Phase 9 user-data table). Function explicit `set search_path = pg_catalog, public, extensions`. Indexed lookup on each event table's `(user_id, created_at)` — verify all 10 exist; add `create index if not exists` for any missing. Plan-checker BLOCKER if any new patient-data table added in future phases isn't included in this UNION.
- **D-02 — Nightly metered-billing cron: pg_cron at 02:00 UTC daily.** Edge Function `org-metered-billing-cron` aggregates per-org `count_active_patients()` for the current billing period and POSTs Stripe Meter Events with idempotency key `org_${org_id}_${yyyymm}` (one event per org per month). Stripe dedups on idempotency key — re-runs safe. Schedule `0 2 * * *` — collision check vs P24/26/27/28 crons: audit-archive 03:00, vendor-baa 06:00, subprocessor-diff Mon 07:00, affiliate-lifetime 03:00, funnel-anomaly 5min, matview 15min, undo-purge 1min, org_invites-expiry 04:00 — 02:00 is clean.
- **D-03 — Stripe Meter Events 2024 API.** Use new Meter Events endpoint `POST /v1/billing/meter_events` with `event_name: 'active_patient_month'`, `payload: {value: count, stripe_customer_id: <clinic_customer>}`, `identifier: org_${org_id}_${yyyymm}` (idempotency). Per ROADMAP. Single API call per org per month under D-02 schedule.

### Stripe webhook extension (ORG-08 + ORG-09 SC#4)

- **D-04 — Extend existing `supabase/functions/stripe-webhook/index.ts`** with additional event handlers for org-specific flows. Existing webhook already handles `customer.subscription.created/updated/deleted` + `invoice.paid/payment_failed/upcoming` + `checkout.session.completed` + `account.updated` + `charge.refunded`. P29 ADDS no new event types — clinic subs flow through the SAME subscription.* events (Phase 14 webhook's branch logic on `clinic_id` already routes correctly via the unified `subscriptions` table). P29 ADDS: meter-event invoice line acknowledgment via `invoice.created` handler (read meter total, validate against local count_active_patients snapshot, log discrepancy to Sentry if >10% variance — early drift detection). Zero new Edge Functions.
- **D-05 — Webhook latency budget: SC#4 says clinic admin billing surface reflects within 30s.** Existing webhook idempotency via `subscription_events.event_id` (Phase 14 pattern). Realtime broadcast on `subscriptions` UPDATE goes to clinic-side admin via Phase 28 HMAC channel `org-{hmac8}-subscriptions` — Phase 28 already shipped the HMAC machinery; P29 wires the channel subscription in the new clinic billing UI surface.

### Patient invite flow (ORG-10)

- **D-06 — NEW `org_patient_invites` table** (parallel to Phase 28 `org_invites` which is org-ADMIN role-based; this one is patient-consent-based — same anti-pattern that Phase 28 A2 rejected for merging `org_invites` with `public.invites`). Schema: `id uuid pk default gen_random_uuid()`, `org_id uuid references organizations(id) on delete cascade`, `patient_email citext not null`, `invite_token_hash text not null` (SHA-256), `consent_scope jsonb not null` (validated via Phase 9 `_validate_consent_scope` per [[feedback_planner_iter1_anti_patterns]]), `invited_by uuid references auth.users` (clinic admin), `expires_at timestamptz default now() + interval '14 days'` (longer than admin invites since patients onboard at their own pace), `accepted_at timestamptz null`, `created_at timestamptz default now()`, `unique(org_id, patient_email) where accepted_at is null` (prevents duplicate pending invites). RLS: SELECT for org admins of this org_id; INSERT/UPDATE via SECDEF `send_org_patient_invite` + `accept_org_patient_invite` RPCs.
- **D-07 — NEW Edge Function `clinic-patient-invite/send`** at `supabase/functions/clinic-patient-invite/index.ts`. Imports `makeInviteTokenHash` from `src/lib/clinic.ts` (W-1 anti-enumeration — returns identical 200 shape regardless of email existence in auth.users). Resend non-PHI template per Phase 25 D-03 (`_shared/email-router.ts`). Email body: "Your clinic <org_name> invites you to track your treatment via LeanShot. [Accept invite (14 days)]" — NO patient name, NO diagnosis, NO dose values (HIPAA-safe email per Phase 25 D-12). Token URL: `https://leanshot.app/accept-clinic-invite?token=<raw>`.
- **D-08 — Accept flow:** When patient clicks link: (1) Server resolves token via SECDEF `accept_org_patient_invite_preview(token)` returning `{org_name, org_logo_url, scope_summary}` (anti-enumeration: 404 for invalid/expired tokens). (2) Patient sees consent UI showing scope (read patient data, write dose-adherence flags, etc.) + Accept/Decline buttons. (3) On Accept: SECDEF `accept_org_patient_invite(token)` (a) creates `auth.users` row if email is new OR validates existing user's email; (b) sets `profiles.primary_org_id = org_id`; (c) writes `org_consent_grants(org_id, patient_user_id, scope, granted_at=now(), granted_via='invite')`; (d) writes `org_patient_links(org_id, patient_user_id, linked_by=invited_by, linked_at=now(), consent_grant_id=...)`; (e) marks invite `accepted_at`; (f) issues magic-link session via Supabase Auth `admin.generateLink({type:'magiclink', email})`; (g) returns redirect to `/dashboard` with welcome banner. All in single transaction; failure rolls back.
- **D-09 — `profiles.primary_org_id` column** — verify exists via `\d profiles`; if missing, ADD via Plan 29-00 migration. References `organizations(id) on delete set null`. Patient can be member of multiple orgs (multi-org future) but `primary_org_id` is the default workspace context loaded at sign-in.

### Schema additions (Plan-0 RECONCILE)

- **D-10 — Plan 29-00 RECONCILE migration ships AS the Wave 0 single-file migration** covering: (a) DROP TABLE org_subscriptions (deny-all skeleton, no data); (b) verify-or-ADD `subscriptions.seats_paid int default 0` + `seats_used int default 0`; (c) verify-or-ADD `profiles.primary_org_id uuid references organizations(id) on delete set null`; (d) audit row counts pre + post via `supabase db query --linked`. Plan-checker BLOCKER for any downstream plan that references `org_subscriptions` (replace with `subscriptions` where `clinic_id is not null`).

### Stripe PHI lint extension (HIPAA-08 carry-forward)

- **D-11 — Phase 25 D-09 Stripe PHI keyword lint runs on every P29 Stripe API call site.** Specifically: meter-event payload constructed by `org-metered-billing-cron` MUST NOT include any PHI keywords (patient names, dose values, diagnoses). The meter event payload contains ONLY `(stripe_customer_id, value=count, idempotency_key=org_${id}_${yyyymm})` — no patient identifiers. Plan-checker BLOCKER: grep `org-metered-billing-cron/index.ts` for PHI keyword list; CI lint enforces.

### Status-machine ownership (per [[feedback_status_machine_transition_owner]])

- **D-12 — `subscriptions.status` transitions (Phase 14 enum: incomplete | incomplete_expired | trialing | active | past_due | canceled | unpaid | paused) owned by Phase 14 webhook handler.** P29 inherits unchanged. ux_tier collapse via Phase 14 `billing.ts:getActiveTier()`. Plan-checker: any new status transition introduced must update the Phase 14 webhook + the billing.ts collapse map.
- **D-13 — `org_patient_invites.accepted_at` transitions:** NULL (pending) → timestamptz (accepted); NULL → NULL + expires_at < now() = expired (no separate column needed; query derives expiry). Cleanup cron at 04:30 daily (no collision with P28 org_invites expiry at 04:00) sweeps expired-and-unaccepted rows older than 90 days (audit retention window).

### Claude's Discretion

Researcher and planner have latitude on:
- Exact UI shape of patient consent accept screen (D-08 step 2) — simple consent UI; researcher/UI-researcher decides primitives.
- Whether to issue magic-link via `admin.generateLink` (D-08 step f) OR use existing Phase 5 magic-link send pattern from `src/lib/auth.ts` — re-use existing if possible per [[feedback_planner_iter1_anti_patterns]].
- Exact Sentry `>10%` variance threshold in D-04 — researcher tunes based on expected count volatility.
- Whether `org-metered-billing-cron` Edge Function batches multiple orgs in one invocation OR loops one-org-per-invocation — Stripe API rate limit (100 RPS Tier 1 per [[project_moonshot_tier_for_leanshot]]; we're on Tier 1 +200 RPM Anthropic — Stripe rate is separate, likely 100 RPS published default). Batching recommended.
- Whether `count_active_patients()` is a materialized view refreshed nightly OR a function called fresh by the cron — function direct is simplest; matview adds 15min staleness vs P27 cohort matview pattern. Recommend function unless perf testing shows >1s query time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 29 (lines 160–168) — 4 success criteria + 3 REQ list.
- `.planning/REQUIREMENTS.md` lines 123–125 (ORG-08, ORG-09, ORG-10) + 470–472 (REQ→phase mapping).

### v1.3 Research
- `.planning/research/PITFALLS.md` §V13-2(d) (Stripe namespace collision) — D-08 mitigation rationale.
- `.planning/research/STACK.md` — Stripe Meter Events 2024 API; existing Stripe SDK version.

### Phase 28 carry-forward (load-bearing)
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-CONTEXT.md` — `organizations` table (post-rename), `org_consent_grants`, `org_patient_links`, `org_invites` (admin-only — NOT for patients); Custom Access Token Hook for JWT claims; HMAC realtime channels.
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md` — BLOCKERs R1-R5 apply to all new org-scoped tables (`org_patient_invites`).
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-ADDENDUM-orgs-reconciliation.md` — A1 (rename), A2 (org_invites parallel pattern — direct precedent for D-06 `org_patient_invites`), A7 (`_shared/` placement for Deno code).

### Phase 25 carry-forward (HIPAA + Stripe + Resend)
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — D-09 Stripe PHI keyword lint (D-11); D-03 Resend non-PHI path (D-07); D-12 alert-email PHI-free design.

### Phase 14 carry-forward (Stripe baseline — DO NOT DUPLICATE)
- `supabase/migrations/20260601000019_stripe_subscriptions.sql` — `stripe_customers`, `clinic_stripe_customers`, `subscriptions` (XOR user_id/clinic_id), `subscription_events` (idempotency anchor by Stripe `evt_xxx`).
- `supabase/functions/stripe-webhook/index.ts` — 8 event handlers already live; extend per D-04.
- `leanshot/src/lib/billing.ts` — `getActiveTier()` collapse + `TIER_GATE_REGISTRY`; P29 wires clinic tier same as user tier.

### Phase 9 carry-forward
- `src/lib/clinic.ts` (Phase 9) — `makeInviteTokenHash` (W-1 fix), `_validate_consent_scope` (jsonb shape guard), Result-discriminated-union RPC wrapper pattern.
- `src/lib/auth.ts` (Phase 5) — magic-link send pattern (D-08 step f re-use).

### Memory references (project rules)
- `[[reference_supabase_project]]` — every RLS surface gets cross-tenant impersonation proof test.
- `[[reference_rls_fixture_gotrueclient_flake]]` — ES256-compat fixture pattern.
- `[[feedback_rls_per_file_slug_prefix]]` — file-scoped TEST_SLUG_PREFIX.
- `[[reference_supabase_migration_filename_regex]]` — strict 14-digit.
- `[[reference_supabase_migration_gotchas]]` — SECDEF search_path; IMMUTABLE for partial indexes.
- `[[feedback_planner_iter1_anti_patterns]]` — re-use Phase 9/14 patterns; no defensive duplicates.
- `[[feedback_status_machine_transition_owner]]` — every status transition has owning plan.
- `[[reference_supabase_edge_function_deploy]]` — bundler ignores import_map; use esm.sh; UAT-probe pattern for Function Secrets.
- `[[reference_resend_phase9_wiring]]` — RESEND_API_KEY + RESEND_FROM Function secrets.
- `[[reference_vendor_gated_send_health_check]]` — startup health check no-ops with logged warning.
- `[[feedback_discuss_phase_must_scout_live_schema]]` — THIS DECISION (A1+A2) caught a Q-A1-class LANDMINE before any plan was written.
- `[[reference_worktree_supabase_push_leak]]` — Plan 29-00 migration push pattern.
- `[[reference_supabase_management_api_auth_hooks]]` — if D-09 needs auth hook for primary_org_id default, this PATCH pattern bypasses Dashboard.
- `[[reference_supabase_keychain_token_extraction]]` — Management API token extraction.
- `[[reference_stripe_legacy_key_and_supabase_token]]` — Stripe key access.
- `[[reference_stripe_platform_capabilities_endpoint]]` — `/v1/account` (singular) for platform capabilities check.

### External docs (consult via Context7 at research time)
- Stripe Meter Events 2024 API — POST /v1/billing/meter_events full spec + idempotency-key contract.
- Stripe invoice line-item rendering for metered subscriptions.
- Supabase Auth `admin.generateLink({type:'magiclink'})` — exact response shape, expiry, rate limits.
- pg_cron schedule precedence + lock contention with sibling crons.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (DO NOT DUPLICATE)
- **`supabase/migrations/20260601000019_stripe_subscriptions.sql`** — `subscriptions` unified table + `clinic_stripe_customers` + `subscription_events` — P29 extends, does not replace.
- **`supabase/functions/stripe-webhook/index.ts`** — 8 event handlers + `subscription_events` idempotency log — P29 adds `invoice.created` meter validation handler.
- **`supabase/functions/_shared/email-router.ts`** (Phase 25) — `phi:false` template path for non-PHI invite emails.
- **`supabase/functions/_shared/with-org-scope.ts`** (Phase 28) — withOrgScope wrapper for any service_role queries in new Edge Functions.
- **`leanshot/src/lib/billing.ts`** (Phase 14) — `getActiveTier()` tier-collapse + `TIER_GATE_REGISTRY`; clinic billing reuses.
- **`leanshot/src/lib/clinic.ts`** (Phase 9) — `makeInviteTokenHash`, `_validate_consent_scope`, RPC wrapper pattern.
- **`leanshot/src/lib/auth.ts`** (Phase 5) — magic-link send pattern; D-08 step f reuses.
- **Phase 24 `log_admin_action`** — every P29 SECDEF RPC writes audit row.

### Established Patterns
- **Pattern S1 dual-layer security** (P24 D-03) — client gate + DB SECDEF re-check on every RPC.
- **Append-only RLS** (P24 D-17) — `subscription_events`, `org_patient_invites` (no UPDATE except `accepted_at` flip), Stripe meter event records.
- **Cross-tenant RLS fixture** (project rule) — ES256-compat `admin.generateLink + plain fetch /auth/v1/verify` + file-scoped slug prefix.
- **W-1 invariant** — identical 200 response shape regardless of email existence (Phase 9 + P28 A2 + D-07).
- **HMAC realtime channel** (P28 D-20..D-24) — `org-{hmac8}-subscriptions` channel for D-05 realtime billing surface update.

### Integration Points
- **Phase 14 `stripe-webhook`** — add `invoice.created` case (D-04) + extend `customer.subscription.updated` to also emit realtime broadcast on `org-{hmac8}-subscriptions` per D-05.
- **Phase 28 `org_consent_grants`** — D-08 accept flow writes here.
- **Phase 28 `org_patient_links`** — D-08 accept flow writes here.
- **Phase 28 `org_settings.notification_email`** — D-04 invoice discrepancy alerts route here.
- **Phase 24 admin_role enum** — `accept_org_patient_invite` SECDEF uses Phase 24 admin-tier check for clinic admin invitations.
- **Phase 25 Resend email-router** — D-07 patient invite send.

</code_context>

<specifics>
## Specific Ideas

- Drop target: `public.org_subscriptions` (P28 skeleton, deny-all RLS, no data).
- Phase 14 `subscriptions` becomes canonical for clinic subs (existing XOR constraint already supports it).
- `count_active_patients()` 30-day rolling window; event tables UNION enumerated in D-01.
- Meter event idempotency key: `org_${org_id}_${yyyymm}`.
- pg_cron schedule for billing: `0 2 * * *` (02:00 UTC daily).
- pg_cron schedule for invite expiry sweep: `30 4 * * *` (04:30 UTC daily; no collision).
- `org_patient_invites.expires_at`: 14 days default (vs 7 for admin invites).
- Magic-link redirect: `https://leanshot.app/accept-clinic-invite?token=<raw>`.
- Meter event name: `active_patient_month`.
- Stripe API endpoint: `POST /v1/billing/meter_events`.
- Sentry variance threshold for invoice-line vs local-snapshot: 10% (D-04, planner tunes).
- Plan 29-00 RECONCILE: drop org_subscriptions + verify-or-add subscriptions.seats_* + profiles.primary_org_id.

</specifics>

<deferred>
## Deferred Ideas

- **Admin "Billing" deep-view UX** — D-07 ships minimal admin surface (status + current period + active count); rich invoice rendering / proration UI deferred to v1.4 polish.
- **Multi-org-admin scenario** — A2 explicitly defers; one user as admin of multiple orgs uses multiple org_members rows; no per-user-org Stripe customer split needed in v1.3.
- **Hourly billing cron** — D-02 explicit reject; nightly is sufficient for monthly-billed metered model.
- **Per-clinic patient activity dashboard** — what counts as "active" surfaced to clinic admin — deferred to Phase 30 clinic dashboard.
- **Prorate-on-invite** — patient added mid-month is billed for that month even if active <30 days. v1.4 if clinics push back.
- **Patient self-revoke org_consent_grants from clinic** — schema supports `revoked_at`; UI surface deferred to v1.4.
- **Stripe Tax integration for clinic invoices** — defer; clinic operators handle tax separately for now.
- **Multiple billing plans (Starter / Pro / Enterprise tiers per clinic)** — v1.3 ships single tier; tier UI deferred.
- **Invoice retry policy customization per clinic** — Stripe defaults (smart retries) suffice.

### Reviewed Todos (not folded)
None — STATE.md has no Phase 29-applicable open todos.

</deferred>

---

*Phase: 29 — Org Subscriptions + Per-Patient Metered Billing*
*Context gathered: 2026-05-17*
