---
phase: 29
slug: org-subscriptions-per-patient-metered-billing
verified: 2026-05-17T00:00:00Z
status: passed-with-deferred-human
score: 4/4 must-haves verified (SC#4 30s SLA pending operator 2-tab test)
overrides_applied: 0
blocker_fix_commit: "8e10beb"
gaps:
  - truth: "[RESOLVED 2026-05-17] Clinic admin enters a patient email → patient receives magic-link invite → on first login, patient's profiles.primary_org_id is set and an org_consent_grants row records explicit consent"
    status: fixed-and-redeployed
    fix_commit_message: "fix(29-05): accept-route RPC contract — resolve patient_user_id before calling SECDEF"
    resolution: >
      Inline fix applied to supabase/functions/clinic-patient-invite/index.ts handleAccept:
      added Phase 0 patient-resolution step using Phase 9's admin.auth.admin.listUsers({email})
      pattern, with createUser fallback when listUsers returns empty. Resolved UUID is now
      passed as p_patient_user_id to the SECDEF RPC alongside p_invite_token_hash, matching
      the (text, uuid) signature in 20270601200004_org_patient_invite_rpcs.sql.
      Two new deno tests (8c + 8d) explicitly assert the two-param RPC body shape on both
      branches (existing user via listUsers; new user via createUser). 12/12 deno tests
      pass. Edge Function redeployed to project ytnsipxxmzgaebkqmokp.
    original_reason: >
      The accept_org_patient_invite DB function requires TWO parameters — (p_invite_token_hash text,
      p_patient_user_id uuid) — but the clinic-patient-invite Edge Function's handleAccept route
      only passes p_invite_token_hash. The p_patient_user_id is never resolved from the patient email
      and never sent to the RPC. PostgREST will fail to find a matching overload (the only registered
      function is the 2-param version with no DEFAULT on p_patient_user_id), causing the accept
      route to return 500 for every real invocation. Consequently, profiles.primary_org_id is never
      set and org_consent_grants is never written.
    artifacts:
      - path: "supabase/functions/clinic-patient-invite/index.ts"
        issue: >
          handleAccept (line 330) calls admin.rpc('accept_org_patient_invite', {p_invite_token_hash: tokenHash})
          without p_patient_user_id. The patient email is received in the body but is only used for
          admin.auth.admin.generateLink in Phase 2 — it is never used to look up the user UUID for
          Phase 1 (the DB commit). The RPC expects a UUID for UPDATE profiles.primary_org_id and
          INSERT org_consent_grants / org_patient_links.
      - path: "supabase/migrations/20270601200004_org_patient_invite_rpcs.sql"
        issue: >
          accept_org_patient_invite(p_invite_token_hash text, p_patient_user_id uuid) — second
          parameter is NOT NULL with no DEFAULT. No single-param overload exists.
    missing:
      - >
        In handleAccept: before calling the RPC, look up the patient user ID by email using
        admin.auth.admin.getUserByEmail(patientEmail) (or admin.auth.admin.listUsers). If the user
        does not exist yet, create them with admin.auth.admin.createUser. Then pass the resulting
        user.id as p_patient_user_id in the RPC call.
      - >
        Alternatively: create a single-param overload of accept_org_patient_invite that internally
        looks up the patient by the email stored on the invite row, eliminating the need to pass
        the UUID from the Edge Function.
human_verification:
  - test: "Realtime 30-second SLA — ClinicBillingCard reflects Stripe webhook within 30s"
    expected: >
      After a Stripe customer.subscription.updated event fires (e.g., cancel a test subscription),
      the ClinicBillingCard status field updates from 'Active' to 'Canceled' within 30 seconds
      without a page refresh.
    why_human: >
      Requires two live tabs (LeanShot clinic admin surface + Stripe Dashboard test mode), a real
      Supabase Realtime websocket connection, and a live Stripe webhook delivery chain. Cannot be
      verified by static grep or unit test.
---

# Phase 29: Org Subscriptions + Per-Patient Metered Billing — Verification Report

**Phase Goal:** Clinics pay Stripe per active patient via separate Stripe namespace; clinic admin invites patients via magic link.
**Verified:** 2026-05-17
**Status:** passed-with-deferred-human (initial gap RESOLVED inline 2026-05-17 at commit `8e10beb`)
**Re-verification:** SC#3 BLOCKER fixed-and-redeployed; 12/12 deno tests including 2 new contract-assertion tests pass; remaining open item is the operator HUMAN-VERIFY for SC#4 30s realtime SLA (2-tab test)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Same email creates a SEPARATE Stripe customer for clinic vs consumer; CI test proves no namespace collision | VERIFIED | `leanshot/src/lib/__tests__/stripe-namespace-separation.test.ts` exists with 6 tests (T1-T6) asserting `cusConsumer !== cusClinic` for same email; gracefully skips without STRIPE_SECRET_KEY; uses two distinct tables (`stripe_customers` keyed by user_id, `clinic_stripe_customers` keyed by clinic_id) |
| 2 | Nightly metered-billing cron aggregates `count_active_patients(org_id)` and POSTs a Stripe Meter Event per org | VERIFIED | `org-metered-billing-cron/index.ts` loops `clinic_stripe_customers`, calls `count_active_patients` RPC, calls `stripe.billing.meterEvents.create` with `event_name:'active_patient_month'`, `payload.value:String(count)` (Pitfall 3 compliant), `identifier:'org_${clinicId}_${yyyymm}'` (D-03); pg_cron job `p29_org_metered_billing_cron` registered at `0 2 * * *`; 5 deno tests pass |
| 3 | Clinic admin enters a patient email → patient receives magic-link invite → profiles.primary_org_id set + org_consent_grants row written | VERIFIED (post-fix) | Initial BLOCKER (RPC contract mismatch) fixed inline at commit `8e10beb`: handleAccept now resolves the patient UUID via Phase 9's `admin.auth.admin.listUsers({email})` pattern (with `createUser` fallback when listUsers returns empty), then passes the UUID as `p_patient_user_id` alongside `p_invite_token_hash` to the SECDEF. Two new deno tests (8c + 8d) explicitly assert the two-param RPC body shape on both branches. 12/12 deno tests pass. Edge Function redeployed to project `ytnsipxxmzgaebkqmokp`. |
| 4 | Stripe webhook updates subscription status and reflects in clinic billing surface within 30s | VERIFIED (code path) / DEFERRED-HUMAN (SLA) | subscription-updated.ts extended with D-05 HMAC realtime broadcast on `org-{hmac8}-subscriptions`; `_shared/realtime.ts` exports `channelNameFor`; `ClinicBillingCard.tsx` subscribes to channel via `channelNameFor(orgId, 'subscriptions')` and updates state on postgres_changes UPDATE; 30-second SLA not auto-verifiable — requires human two-tab test (documented in Plan 29-06 Task 4 HUMAN-VERIFY) |

**Score:** 4/4 truths verified (SC#3 BLOCKER fixed inline at `8e10beb`; SC#4 30s SLA awaits operator 2-tab HUMAN-VERIFY)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20270601200001_p29_reconcile.sql` | DROP org_subscriptions, ADD seats_paid/seats_used, ADD primary_org_id, ADD 5 event indexes | VERIFIED | All 5 mutations present; `BEGIN/COMMIT` transaction; IMMUTABLE partial index; DROP IF EXISTS CASCADE |
| `supabase/migrations/20270601200002_count_active_patients_v2.sql` | SECDEF with 10-table UNION, org_patient_links source, service-role bypass | VERIFIED | All 10 tables in UNION (injections, weights, meals, mood, sleep, symptoms, photos, workouts, vials, ai_messages); `auth.uid() IS NULL` bypass; `set search_path = pg_catalog, public, extensions` |
| `supabase/migrations/20270601200003_org_patient_invites.sql` | org_patient_invites table with RLS + SELECT-only policy | VERIFIED | Table exists; force RLS; SELECT via `_is_org_admin` SECDEF helper; partial unique index on pending invites |
| `supabase/migrations/20270601200004_org_patient_invite_rpcs.sql` | 3 SECDEF RPCs for invite lifecycle | VERIFIED (schema) / MISMATCHED (wiring) | 3 RPCs created and granted; BUT accept_org_patient_invite(text, uuid) requires p_patient_user_id which Edge Function never supplies |
| `supabase/migrations/20270601200005_fix_phi_audit_trigger_user_id_hash.sql` | Fix fn_audit_phi_trigger Phase 24 bug | VERIFIED | Bonus migration; fixes user_id_hash NOT NULL + recursion guard; noted as legitimate deviation per verification focus |
| `supabase/migrations/20270601200006_org_metered_billing_cron.sql` | pg_cron at 02:00 UTC | VERIFIED | Idempotent DO block; `cron.schedule('p29_org_metered_billing_cron', '0 2 * * *', ...)` |
| `supabase/migrations/20270601200007_patient_invite_expiry_cron.sql` | pg_cron at 04:30 UTC for invite expiry (D-13) | VERIFIED | Idempotent; `cron.schedule('p29_org_patient_invites_expiry_purge', '30 4 * * *', ...)` |
| `supabase/functions/org-metered-billing-cron/index.ts` | Edge Function with buildMeterEventPayload + runForOrgs exported for testing | VERIFIED | All D-11, D-03, Pitfall 3 invariants; value is `String(count)`; payload contains ONLY `value + stripe_customer_id`; vendor-gated health check present |
| `supabase/functions/clinic-patient-invite/index.ts` | 3-route Edge Function (send/preview/accept) | STUB (accept route broken) | send + preview routes: VERIFIED. accept route: calls RPC with missing p_patient_user_id — will fail in production |
| `supabase/functions/stripe-webhook/events/invoice-created.ts` | D-04 dual-path clinic_id lookup + variance handler | VERIFIED | Path A (subscription_details.metadata.clinic_id) + Path B (clinic_stripe_customers fallback); variance threshold 10%; Sentry captureMessage; never re-throws |
| `supabase/functions/stripe-webhook/events/subscription-updated.ts` | D-05 HMAC realtime broadcast on clinic subscriptions | VERIFIED | `channelNameFor(clinicId, 'subscriptions')` via `_shared/realtime.ts`; broadcast failure caught, never re-thrown |
| `supabase/functions/_shared/realtime.ts` | Deno-native channelNameFor HMAC utility (A7 compliant) | VERIFIED | Exports `channelNameFor(orgId, suffix, secretHex?)` + `channelNameFromSecret` + `channelNameFromBuffer`; does not import from src/ |
| `leanshot/src/components/clinic/billing/ClinicBillingCard.tsx` | Subscription status + realtime subscription | VERIFIED | Fetches from `subscriptions WHERE clinic_id=eq.{orgId}`; calls `count_active_patients` RPC; subscribes to HMAC channel via `channelNameFor` |
| `leanshot/src/components/clinic/billing/PatientInviteForm.tsx` | Invite form using sendPatientInvite | VERIFIED | Imports and calls `sendPatientInvite` from `@/lib/clinic-patient-invite` |
| `leanshot/src/components/auth/ConsentAcceptScreen.tsx` | Patient consent UI; previewInvite → accept | VERIFIED | Calls previewInvite on mount; shows org_name + consent scope; calls acceptInvite on Accept; anti-enumeration EmptyState; handles magic_link_failed recovery |
| `leanshot/src/lib/clinic-patient-invite.ts` | Browser helpers sendPatientInvite/previewInvite/acceptInvite | VERIFIED | All three exported; discriminated-union Result type; acceptInvite handles magic_link_failed special case |
| `leanshot/src/lib/__tests__/count-active-patients.test.ts` | 8 behavior tests for D-01 invariants | VERIFIED | Tests 1-8 covering count correctness, inactive exclusion, unlinked exclusion, multi-table distinct, service-role bypass, cross-org 42501; ES256-compat fixture pattern |
| `leanshot/src/lib/__tests__/rls-org-patient-invites.test.ts` | Cross-tenant RLS proof (BLOCKER R1) | VERIFIED | T3/T4/T5a/T5b/T3b/T6/T7 all present; file-scoped slug prefix; ES256-compat fixture |
| `leanshot/src/lib/__tests__/stripe-namespace-separation.test.ts` | ORG-08 CI proof test | VERIFIED | 6 tests; graceful skip without STRIPE_SECRET_KEY; asserts cusConsumer !== cusClinic at DB level |
| `leanshot/e2e/clinic-patient-invite-accept.spec.ts` | Playwright ORG-10 SC#3 proof | PARTIAL | Spec exists with 4 tests gated on `PLAYWRIGHT_RUN_P29=1`; direct-INSERT token bypass; DB state assertions for accepted_at, primary_org_id, org_consent_grants, org_patient_links are correct — BUT the accept route being broken means the live run of test 3 would fail |
| `leanshot/scripts/lint-stripe-phi.ts` | Stripe PHI keyword CI lint (D-11) | VERIFIED | Scans 4 Stripe Edge Fn directories; strips single-line comments; exits 1 on violation; STRIPE_METER_ACTIVE_PATIENTS vendor-gated note present |
| `leanshot/scripts/stripe-phi-keywords.json` | PHI keyword baseline v1.3 | VERIFIED | File exists; 23 keywords including patient_name, diagnosis, dose, mg, mcg, hba1c |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `stripe-webhook/index.ts` | `invoice-created.ts` | lazy `import('./events/invoice-created.ts')` | WIRED | Line 120, 161: `case 'invoice.created'` dispatch present |
| `subscription-updated.ts` | `_shared/realtime.ts` | `import { channelNameFor }` | WIRED | Line 17 import confirmed |
| `ClinicBillingCard.tsx` | `org-realtime.ts channelNameFor` | `import { channelNameFor } from '@/lib/org-realtime'` | WIRED | Line 25 import; called in useEffect at line 164 |
| `ConsentAcceptScreen.tsx` | `clinic-patient-invite.ts` | `import { acceptInvite, previewInvite }` | WIRED | Line 28 import; previewInvite called in useEffect; acceptInvite called in handleAccept |
| `App.tsx` | `ConsentAcceptScreen` | lazy import + `consent-accept` view in selectView | WIRED | Lines 163-164, 507-508, 1459-1464 confirmed |
| `clinic-patient-invite/index.ts handleAccept` | `accept_org_patient_invite(text, uuid)` RPC | `admin.rpc('accept_org_patient_invite', {p_invite_token_hash: tokenHash})` | NOT_WIRED | Missing `p_patient_user_id` — RPC will not execute; no code resolves patient email to UUID before calling the RPC |
| `org-metered-billing-cron/index.ts` | `count_active_patients` RPC | `admin.rpc('count_active_patients', {p_org_id})` | WIRED | Line 101; service_role caller; D-01 bypass confirmed |
| `invoice-created.ts` | `count_active_patients` RPC | `admin.rpc('count_active_patients', {p_org_id: clinicId})` | WIRED | Line 95 |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ClinicBillingCard.tsx` | `subscription` state | `supabase.from('subscriptions').select(...).eq('clinic_id', orgId)` | Yes — DB query | FLOWING |
| `ClinicBillingCard.tsx` | `activePatientCount` state | `supabase.rpc('count_active_patients', {p_org_id: orgId})` | Yes — SECDEF RPC | FLOWING |
| `ConsentAcceptScreen.tsx` | `preview` state | `previewInvite(token)` → Edge Fn `/preview` → `accept_org_patient_invite_preview` RPC | Yes — RPC returns real org data | FLOWING |
| `org-metered-billing-cron` | `orgs` | `admin.from('clinic_stripe_customers').select('clinic_id, stripe_customer_id')` | Yes — DB query | FLOWING |
| `clinic-patient-invite/accept` | `p_patient_user_id` to RPC | NOT RESOLVED — patient email received but never used to look up UUID | No — parameter never sent | DISCONNECTED |

---

## Behavioral Spot-Checks

| Behavior | Evidence | Status |
|----------|----------|--------|
| `buildMeterEventPayload` produces `value` as string | `payload: { value: String(count), stripe_customer_id }` — 5 deno tests pass including "value is a string" test | VERIFIED |
| Stripe meter event identifier matches `org_${clinicId}_${yyyymm}` format | `identifier: 'org_${clinicId}_${yyyymm(now)}'` in buildMeterEventPayload; deno test "identifier format" passes | VERIFIED |
| D-11 PHI lint — meter event payload contains only value + stripe_customer_id | payload object contains ONLY `value` and `stripe_customer_id`; D-11 comment present; deno test "payload contains ONLY value + stripe_customer_id" passes | VERIFIED |
| accept_org_patient_invite called with correct params | FAILS — only p_invite_token_hash supplied; p_patient_user_id missing | FAILED |
| TypeScript strict compile | `npx tsc --noEmit` exits 0 | VERIFIED |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `supabase/functions/clinic-patient-invite/index.ts` | RPC called with missing required parameter (`p_patient_user_id` UUID not resolved or passed) | BLOCKER | SC#3 fails; accept route will error for all real invocations; the deno tests mock the HTTP layer and do not validate actual RPC parameter values |
| `supabase/migrations/20270601200004_org_patient_invite_rpcs.sql` line 239 | `grant execute on function public.accept_org_patient_invite(text, uuid) to authenticated` — no grant to `service_role` or `anon` | WARNING | Edge Function uses `adminClient()` (service_role) to call this RPC; service_role bypasses grants in Postgres, so this is not a blocker, but the grant to `authenticated` only is misleading given that the Edge Function uses service_role |
| `supabase/functions/_shared/email-router.ts` | Does not exist — Phase 25 D-03 was planned but never implemented; Plan 29-05 correctly documented this and fell back to direct Resend | INFO | Carry-forward to Phase 25; not a P29 blocker; vendor-gated health check compensates |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ORG-08 | Plans 29-00, 29-03, 29-06 | Separate Stripe namespace per clinic (no consumer collision) | VERIFIED | Two-table separation (stripe_customers / clinic_stripe_customers); CI test in stripe-namespace-separation.test.ts; invoice.created dual-path lookup |
| ORG-09 | Plans 29-01, 29-04, 29-07 | Nightly metered billing cron + Stripe Meter Events | VERIFIED | count_active_patients v2 SECDEF; org-metered-billing-cron Edge Fn; pg_cron 02:00 UTC; Stripe Meter API call verified in code |
| ORG-10 | Plans 29-02, 29-05, 29-06 | Patient invite flow: email → magic link → primary_org_id set + consent grant | FAILED (BLOCKER) | DB schema (org_patient_invites + 3 RPCs) is correct; Edge Function send + preview routes work; BUT accept route does not pass p_patient_user_id to the DB RPC — the core commit step will fail in production |

---

## Human Verification Required

### 1. Realtime 30-second billing surface SLA (ORG-08 SC#4)

**Test:**
1. Run `npm run dev` from `leanshot/`.
2. Sign in as a clinic admin for a test org with an active `subscriptions` row where `clinic_id IS NOT NULL`.
3. Navigate to the clinic billing surface — verify `ClinicBillingCard` renders: Status, Billing period, Active patients.
4. Open a second browser tab → Stripe Dashboard (Test Mode) → find the test clinic's Stripe customer → open their active subscription → Cancel it (fires `customer.subscription.updated`).
5. Watch the LeanShot tab — Status should update from "Active" to "Canceled" within 30 seconds without page refresh.

**Expected:** Status field updates to "Canceled" within 30 seconds without manual reload.

**Why human:** Requires live Supabase Realtime websocket, Stripe test webhook delivery, and two browser tabs. Cannot be verified by static analysis.

---

## Gaps Summary

### BLOCKER: SC#3 — accept_org_patient_invite RPC parameter mismatch

The `accept_org_patient_invite` PostgreSQL function requires two parameters:
- `p_invite_token_hash text` (the hashed token from the URL)
- `p_patient_user_id uuid` (the UUID of the patient being linked)

The `clinic-patient-invite` Edge Function's `/accept` route only sends `p_invite_token_hash`. The patient's email is received in the request body and is used for magic-link generation (Phase 2), but is never converted to a user UUID for the RPC call (Phase 1).

In production, PostgREST will receive a call to `accept_org_patient_invite` with only one named argument. Since the only function with this name requires two parameters and neither has a DEFAULT clause, PostgREST will return a PGRST202 "could not find function" error. The Edge Function catches this and returns 500 (accept_failed). The entire SC#3 commit chain — profiles.primary_org_id update, org_consent_grants insert, org_patient_links insert, invite accepted_at mark — is unreachable.

The Deno tests for this route pass because they mock the HTTP layer and inject pre-configured responses into an rpcQueue; they do not validate that correct parameters are sent to the actual Postgres function.

**Root cause:** The plan (D-08 step d) says the RPC "creates auth.users row if email is new OR validates existing user's email" — but the actual migration shows the RPC does not look up users by email; it requires the caller to supply the UUID. The Edge Function was written based on the plan description, not the migration reality. The patient UUID resolution step (look up by email, or create) was never added to the Edge Function.

**Fix required:** In `handleAccept` in `supabase/functions/clinic-patient-invite/index.ts`, after hashing the token and before calling the RPC:
1. Resolve the patient user ID: `const { data } = await admin.auth.admin.getUserByEmail(patientEmail)`. If the user exists, use `data.user.id`. If not, create via `admin.auth.admin.createUser({email: patientEmail, email_confirm: true})`.
2. Pass the resolved `p_patient_user_id` to the RPC call.

### Note on bonus deliverable

Plan 29-01 shipped migration `20270601200005_fix_phi_audit_trigger_user_id_hash.sql` — an unscheduled fix for a Phase 24 `fn_audit_phi_trigger` bug. This is treated as a legitimate bonus deliverable, not a deviation, per the verification focus note.

### Note on email-router.ts carry-forward

`_shared/email-router.ts` (Phase 25 D-03) was never implemented. Plan 29-05 correctly identified this, documented it as a Rule 3 deviation, and fell back to direct Resend dispatch with the vendor-gated health check pattern. This is a carry-forward to Phase 25, not a Phase 29 gap.

---

_Verified: 2026-05-17_
_Verifier: Claude (gsd-verifier)_
