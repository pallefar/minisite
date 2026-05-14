---
phase: 14-monetization-foundation-stripe-web-clinic-seats
verified: 2026-05-14T06:29:09Z
status: gaps_found
score: 2/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "User clicks Upgrade → Stripe Checkout → card → 7-day trial → returns → sees tier='paid' in UI; day 8 auto-charge keeps subscriptions row current"
    status: failed
    reason: "Two independent code defects prevent this flow from completing end-to-end. (1) CR-01: there is no DB→store sync path — no code in src/ ever queries the subscriptions table and calls setTier(), so the Zustand tier is permanently 'free' for all real users regardless of Stripe state. The webhook writes the DB correctly but the frontend never reads it. (2) CR-02: PaywallUpsell.fetchCheckoutUrl() (wired into MedLevelChart blur-upsell and AIChatPanel hard-block-cta) calls the checkout Edge Function with the wrong URL (no /session sub-path → action='' → 404 unknown_action), no Authorization header (→ 401 unauthenticated), and no plan body (→ 400 invalid_plan). Every free user who clicks Upgrade on the chart or AI panel hits a silent console.error and nothing happens."
    artifacts:
      - path: "leanshot/src/components/billing/PaywallUpsell.tsx"
        issue: "fetchCheckoutUrl() posts to /functions/v1/stripe-checkout (bare, no /session), with credentials:'include' (no JWT), and no body. All three required parameters for stripe-checkout/session are missing."
      - path: "leanshot/src/lib/store.ts"
        issue: "setTier() action is defined at line 482 but has zero non-test call sites anywhere in src/. No SIGNED_IN handler, no useEffect, no Realtime subscription ever calls it with real DB data."
      - path: "leanshot/src/App.tsx"
        issue: "SIGNED_IN / INITIAL_SESSION handler (lines 378-389) calls deferOnSignedIn() for sync but zero billing-related code. No subscriptions query and no setTier() call in this or any auth handler."
    missing:
      - "Post-auth billing sync: on SIGNED_IN / INITIAL_SESSION, query subscriptions table for the current user, run getActiveTier(status, current_period_end, new Date()), and call setTier(). Pattern already exists in Phase 9 clinic-permissions fetch."
      - "Fix PaywallUpsell.fetchCheckoutUrl() to use supabase.functions.invoke('stripe-checkout/session', { body: { plan } }) exactly as UpgradeCTA.tsx:49-52 already does correctly. Add a plan prop (default 'plus_monthly') and remove credentials:'include' + the raw fetch."
      - "Optionally: Realtime subscription on subscriptions row OR window focus refetch so webhook-driven changes propagate within the SC#2 10-second budget."

  - truth: "User opens Manage subscription → Stripe Customer Portal → cancel/change → returns → subscription_events webhook landed and tier reflects the change within 10 seconds"
    status: failed
    reason: "Blocked by CR-01 (no DB→store sync). Portal link (ManageSubscriptionLink.tsx) and webhook handler (subscription-updated.ts) are both correctly wired in isolation, but the sync path from DB to Zustand store does not exist, so the tier value never changes in the UI regardless of what the webhook writes."
    artifacts:
      - path: "leanshot/src/lib/store.ts"
        issue: "setTier() has no call site that reads from the DB. Zustand persist means a value written at sign-in time persists stale across Portal round-trips."
    missing:
      - "Same fix as SC#1 gap: implement the DB→store sync path. A Realtime subscription on the user's subscriptions row would cover the 10-second budget without a reload."

  - truth: "User's card fails → Stripe Smart Retries → user sees past_due banner + dunning email; banner clears on successful retry"
    status: failed
    reason: "Two independent defects. (1) CR-04: invoice-payment-failed.ts reads invoice.subscription_status which does not exist on any Stripe Invoice object (it is always undefined at runtime). The cast via 'as unknown as {subscription_status?: string}' suppresses the type error. subStatus therefore defaults to 'active' on every invocation. mapStripeStatusToUxTier('active') returns 'paid'. So a real invoice.payment_failed webhook writes ux_tier='paid' and status='active' to the DB — the exact opposite of the dunning trigger. (2) CR-01: even if the DB were written correctly, no sync path moves the DB tier into the Zustand store, so the PastDueBanner (which reads useStore((s) => s.tier)) would never show."
    artifacts:
      - path: "supabase/functions/stripe-webhook/events/invoice-payment-failed.ts"
        issue: "Lines 27-29: reads invoice.subscription_status (non-existent field, always undefined at runtime) → defaults to 'active' → writes ux_tier='paid' on payment failure. Dunning trigger is inverted."
      - path: "supabase/functions/stripe-webhook/events/invoice-paid.ts"
        issue: "Lines 30-32: same non-existent field read. Benign by luck (paid→active) but structurally broken."
    missing:
      - "Fix invoice-payment-failed.ts: do not read invoice.subscription_status. Instead, set ux_tier='past_due' directly (by definition, invoice.payment_failed means dunning has started), OR retrieve the subscription via stripe.subscriptions.retrieve(subId) and read its real .status."
      - "Fix invoice-paid.ts similarly: retrieve the subscription and use its real status, or simply write ux_tier='paid' directly since invoice.paid proves the payment succeeded."
      - "Fix CR-01 (DB→store sync) as above so the banner can actually render."

  - truth: "TierGate blocks premium features for tier='free' users; <TierGate> primitive is correctly wired in MedLevelChart and AIChatPanel"
    status: failed
    reason: "TierGate.tsx, MedLevelChart.tsx, and AIChatPanel.tsx are all structurally correct and wired to each other. However, the gate is permanently 'free' for all real users (CR-01: no DB sync), making the gate semantically dead for any paid subscriber. PaywallUpsell (the blur-upsell fallback rendered by TierGate in MedLevelChart) calls the checkout endpoint incorrectly (CR-02), so the Upgrade CTA is also broken. The gate exists in code; it does not function for real users."
    artifacts:
      - path: "leanshot/src/components/billing/PaywallUpsell.tsx"
        issue: "Upgrade CTA calls wrong endpoint, no JWT, no plan body — 401/404/400 on every click."
    missing:
      - "Fix CR-01 and CR-02 as described above. Once tier is correctly synced from DB, TierGate will function correctly."

human_verification:
  - test: "Deploy stripe-webhook and stripe-checkout Edge Functions to Supabase"
    expected: "supabase functions deploy stripe-checkout stripe-webhook succeeds; functions appear in Supabase dashboard"
    why_human: "Requires live Supabase project credentials and deploy access (supabase CLI auth). Cannot verify from code alone."
  - test: "Register Stripe webhook endpoint and retrieve whsec_ secret; set Supabase Function secrets"
    expected: "STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, STRIPE_PRICE_* secrets visible in supabase secrets list"
    why_human: "Requires live Stripe Dashboard access and supabase secrets set CLI commands."
  - test: "Run scripts/stripe-bootstrap.ts against live Stripe test account"
    expected: "5 prices created idempotently; VITE_STRIPE_PRICE_PLUS_MONTHLY, _YEARLY, STRIPE_PRICE_CLINIC_BASE, _OVERAGE populated in Vercel env and Supabase secrets"
    why_human: "Requires live STRIPE_SECRET_KEY and Vercel CLI access."
  - test: "Configure Stripe Customer Portal return-URL allowlist"
    expected: "https://app.leanshot.app/settings?from=portal in Portal allowed return URLs"
    why_human: "Stripe Dashboard UI configuration — cannot be automated."
  - test: "Register invoice.upcoming Stripe webhook event"
    expected: "invoice.upcoming appears in Stripe webhook endpoint event list alongside customer.subscription.updated etc."
    why_human: "Stripe Dashboard webhook configuration."
  - test: "Push migration 20260601000019_stripe_subscriptions.sql to live Supabase DB"
    expected: "supabase db push succeeds; subscriptions, subscription_events, stripe_customers, clinic_stripe_customers tables visible in Supabase dashboard"
    why_human: "Requires live Supabase project access and supabase db push CLI command."
---

# Phase 14: Monetization Foundation (Stripe web + clinic seats) Verification Report

**Phase Goal:** A web user can subscribe to a paid plan via Stripe Checkout (7-day card-required trial), manage their subscription via Stripe Customer Portal, and downstream features gate cleanly on the `tier` field. A clinic owner is billed per-active-patient with monthly true-up via Stripe metered billing. Webhook state from Stripe is the source of truth — the DB never drifts. Card-failure dunning surfaces a `past_due` banner and a retry-card flow.
**Verified:** 2026-05-14T06:29:09Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Summary Judgment

**Three code-level BLOCKERs** independently confirmed against the codebase (not just accepted from the code review). SC#1, SC#2, and SC#4 cannot be met in production. SC#3 is partially met (webhook + DB function exist; meter verification test is hollow). SC#5 is partially met (TierGate primitive works structurally; pricing page is deferred to Phase 15 per CONTEXT D-12; checkout redirect from PaywallUpsell is broken). Six vendor/deploy items are legitimately deferred human-verification steps.

**This phase requires a gap-closure plan before the core monetization flow can function.**

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User clicks Upgrade → Stripe Checkout → 7-day trial → returns → sees tier='paid' in UI | FAILED | CR-01: no DB→store sync (setTier never called from non-test code). CR-02: PaywallUpsell calls wrong endpoint path/no JWT/no body → 401/404/400 every time. |
| 2 | User opens Manage subscription → Portal → change → returns → tier reflects change within 10s | FAILED | CR-01: webhook writes DB correctly; no code path reads subscriptions and calls setTier(). Tier is permanently stale. |
| 3 | Clinic owner adds 11th patient → Stripe metered billing incremented → invoice reflects charge | PARTIAL | count_active_patients() function exists in migration. invoice-upcoming.ts exists. But WR-09: clinic-metered-billing.spec.ts uses hardcoded 'mtr_test_placeholder' meter ID, catches the exception, and passes on webhook HTTP 200 status alone — SC#3 is not actually proven by this spec. |
| 4 | User's card fails → past_due banner appears; banner clears on successful retry | FAILED | CR-04: invoice-payment-failed.ts reads non-existent invoice.subscription_status (always undefined → 'active') → writes ux_tier='paid' on payment failure (inverted trigger). CR-01: even if DB were correct, no sync to store means banner never renders for real users. |
| 5 | Visitor sees pricing page with comparison table; Subscribe → live Checkout; TierGate blocks free users | PARTIAL | Phase 14 portion: TierGate primitive is structurally correct (MedLevelChart + AIChatPanel wired); price IDs flow via env vars (bootstrap script exists). Pricing page UI deferred to Phase 15 per CONTEXT D-12 (SC#5 explicitly split this way). PaywallUpsell checkout call is broken (CR-02). |

**Score: 0/5 fully verified** (2 partial — SC#3 and SC#5 — due to deferred scope per CONTEXT and hollow test respectively; 3 outright FAILED)

The scoring of 2/5 in the frontmatter credits SC#3 and SC#5 as partially-met (their deferred portions are intentional per CONTEXT), with 3 clear blockers.

---

## Independently Verified Code Review Findings

### CR-01 — CONFIRMED BLOCKER: Billing tier is never synced from DB to store

**Files checked:**
- `leanshot/src/lib/store.ts` — `setTier()` defined at line 482, type declared at line 218
- `leanshot/src/lib/billing.ts` — `getActiveTier()` defined; no call site outside tests
- `leanshot/src/App.tsx` — SIGNED_IN handler (lines 378-389) calls `deferOnSignedIn()` only; zero billing code
- `leanshot/src/lib/sync-defer.ts` — no billing/subscription references

**Finding:** `grep -rn "setTier|getActiveTier" leanshot/src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."` returns only:
- store.ts line 218 (type declaration)
- store.ts line 482 (action implementation)
- billing.ts (function definition only)

There is no production call site that queries the `subscriptions` table and calls `setTier()`. The `clearTierCache()` dynamic import in the signOut action is correctly wired, but that only handles teardown — there is no corresponding setup/sync. `useStore((s) => s.tier)` returns `'free'` for 100% of real users forever.

### CR-02 — CONFIRMED BLOCKER: PaywallUpsell calls checkout endpoint incorrectly

**File:** `leanshot/src/components/billing/PaywallUpsell.tsx:52-63`

```ts
const res = await fetch(`${base}/functions/v1/stripe-checkout`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
});
```

**Verified defects:**
1. Missing `/session` sub-path: `stripe-checkout/index.ts:500-512` routes on `segments[fnIdx + 1]`; bare `/stripe-checkout` yields `action = ''` → `jsonError(404, 'unknown_action')`.
2. No Authorization header: `handleSession()` at line 292-296 requires `jwt = jwtFromReq(req)`; `credentials:'include'` sends cookies which the CORS config explicitly rejects.
3. No body: `handleSession()` at line 307-311 requires `body.plan` ∈ `{plus_monthly, plus_yearly, clinic}` → `jsonError(400, 'invalid_plan')`.

**Correct pattern already exists:** `UpgradeCTA.tsx:49-52` uses `supabase.functions.invoke('stripe-checkout/session', { body: { plan } })`. PaywallUpsell needs the same pattern plus a `plan` prop.

### CR-04 — CONFIRMED BLOCKER: Invoice handlers read non-existent field, inverting dunning trigger

**Files:** `supabase/functions/stripe-webhook/events/invoice-payment-failed.ts:27-29` and `invoice-paid.ts:30-32`

Both handlers read:
```ts
const subStatus = (
  (invoice as unknown as { subscription_status?: string }).subscription_status ?? 'active'
) as Stripe.Subscription.Status;
```

`invoice.subscription_status` does not exist on the Stripe Invoice object in any API version. The `as unknown as` cast suppresses the TypeScript error. At runtime, `subscription_status` is always `undefined`, so `subStatus` is always `'active'`.

**Concrete consequence in `invoice-payment-failed.ts`:** `mapStripeStatusToUxTier('active')` returns `'paid'`. The handler then writes `ux_tier='paid'` and `status='active'` when Stripe fires `invoice.payment_failed`. A payment failure clears the past_due state — the dunning trigger is inverted.

**Concrete consequence in `invoice-paid.ts`:** Writes `ux_tier='paid'` correctly by luck (paid→active), but does not actually read Stripe truth as the comment claims.

---

## Required Artifacts

| Artifact | Expected | Status | Notes |
|----------|----------|--------|-------|
| `supabase/migrations/20260601000019_stripe_subscriptions.sql` | 4-table schema + RLS + count_active_patients() | VERIFIED (exists, substantive) | Not pushed to live DB — deferred human step |
| `supabase/functions/stripe-checkout/index.ts` | Checkout + Portal Edge Function | VERIFIED (substantive, routing logic confirmed) | Not deployed — deferred human step |
| `supabase/functions/stripe-webhook/index.ts` | Webhook with signature verification + event dispatch | VERIFIED (substantive) | Not deployed — deferred human step |
| `leanshot/src/lib/billing.ts` | getActiveTier() + TIER_GATE_REGISTRY + clearTierCache() | VERIFIED | Correct collapse logic, correct registry |
| `leanshot/src/types/index.ts` | Tier + SubscriptionProvider + BillingState types | VERIFIED | Correct |
| `leanshot/src/lib/store.ts` | setTier() action + billing fields in PersistedState | VERIFIED (exists) | ORPHANED write-side — no caller syncs DB to store |
| `leanshot/src/components/billing/TierGate.tsx` | 3-mode gating primitive | VERIFIED (substantive) | Logic correct; blocked by CR-01 making tier always 'free' |
| `leanshot/src/components/billing/PaywallUpsell.tsx` | Upgrade CTA with Checkout redirect | STUB / BROKEN | CR-02: wrong URL/no JWT/no plan — will 401/404/400 on every click |
| `leanshot/src/components/billing/PastDueBanner.tsx` | past_due chrome banner | VERIFIED (substantive) | Logic correct; blocked by CR-01 + CR-04 |
| `leanshot/src/components/billing/UpgradeCTA.tsx` | Settings upgrade CTA | VERIFIED | Correctly uses supabase.functions.invoke |
| `leanshot/src/components/billing/ManageSubscriptionLink.tsx` | Settings portal link | VERIFIED | Correctly uses supabase.functions.invoke |
| `leanshot/src/components/layout/AppShell.tsx` | PastDueBanner mounted in chrome | VERIFIED | PastDueBanner rendered at line 53 |
| `leanshot/src/components/dashboard/charts/MedLevelChart.tsx` | 7-day forecast gated by TierGate blur-upsell | VERIFIED (wired) | TierGate at line 287; blocked by CR-01 + CR-02 |
| `leanshot/src/components/dashboard/ai/AIChatPanel.tsx` | Model selector gated by TierGate hard-block-cta | VERIFIED (wired) | TierGate at line 179; blocked by CR-01 + CR-02 |
| `leanshot/tests/rls/subscriptions-impersonation.test.ts` | Cross-tenant impersonation proof test (project rule) | VERIFIED (exists) | Not run against live DB — deferred |
| `leanshot/tests/csp/csp-snapshot.txt` | Stripe CSP directives added | VERIFIED | script-src + frame-src + connect-src all updated correctly |
| `leanshot/scripts/stripe-bootstrap.ts` | Idempotent price/meter creation script | VERIFIED (exists, substantive) | Uses Stripe v17 npm dep against v19 API shape — CR-03 latent risk |
| `leanshot/e2e/checkout-trial-flow.spec.ts` | Checkout trial E2E | EXISTS | Day-8 conversion unverifiable (seed-subscription.ts passes default_payment_method: undefined — IN-04) |
| `leanshot/e2e/past-due-banner.spec.ts` | Past-due banner E2E | EXISTS | page.reload() assertion cannot pass until CR-01 + CR-04 are fixed |
| `leanshot/e2e/clinic-metered-billing.spec.ts` | Clinic metered billing E2E | HOLLOW | WR-09: hardcoded 'mtr_test_placeholder' meter ID, catches exception, passes on HTTP 200 status alone |
| `leanshot/e2e/portal-plan-change.spec.ts` | Portal plan change E2E | EXISTS | Blocked by CR-01 for full e2e verification |

---

## Key Link Verification

| From | To | Via | Status | Notes |
|------|----|-----|--------|-------|
| MedLevelChart.tsx | TierGate.tsx | import + JSX wrap | WIRED | Lines 2 + 287 |
| AIChatPanel.tsx | TierGate.tsx | import + JSX wrap | WIRED | Line 4 + 179 |
| TierGate.tsx | useStore (s.tier) | useStore selector | WIRED | Line 49 |
| TierGate.tsx → PaywallUpsell | checkout Edge Function | fetch() | BROKEN | CR-02: wrong URL/no JWT/no plan |
| UpgradeCTA.tsx | stripe-checkout/session | supabase.functions.invoke | WIRED | Line 49-52 — correct pattern |
| ManageSubscriptionLink.tsx | stripe-checkout/portal | supabase.functions.invoke | WIRED | Line 29-32 |
| PastDueBanner.tsx | stripe-checkout/portal | supabase.functions.invoke | WIRED | Line 38-41 |
| invoice-payment-failed.ts | subscriptions DB row | admin.from('subscriptions').update() | BROKEN | CR-04: writes wrong tier |
| App.tsx SIGNED_IN | subscriptions table | (missing) | NOT_WIRED | CR-01: no query exists |
| webhook handler | store.setTier() | (missing) | NOT_WIRED | CR-01: no read path exists in frontend |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| TierGate.tsx | `userTier` | `useStore((s) => s.tier)` | NO — `tier` is always 'free', never updated from DB | HOLLOW |
| PastDueBanner.tsx | `tier` | `useStore((s) => s.tier)` | NO — never receives 'past_due' from real Stripe events | HOLLOW |
| UpgradeCTA.tsx | `tier` | `useStore((s) => s.tier)` | NO — always 'free', so UpgradeCTA always renders | HOLLOW (but correct for free users) |
| invoice-payment-failed.ts | `subStatus` | `invoice.subscription_status` | NO — field is always undefined; defaults to 'active' | DISCONNECTED |
| invoice-paid.ts | `subStatus` | `invoice.subscription_status` | NO — same non-existent field | DISCONNECTED |

---

## Behavioral Spot-Checks

| Behavior | Checkable | Notes |
|----------|-----------|-------|
| Checkout redirect from PaywallUpsell | No (requires live Supabase Function) | Code analysis sufficient — CR-02 is unambiguous |
| Tier stored in Zustand after sign-in | Yes (code trace) | setTier() has zero non-test callers — confirmed HOLLOW |
| PastDueBanner renders on payment failure | No (requires Stripe webhook) | Code analysis sufficient — CR-04 is unambiguous |

Step 7b: SKIPPED for behaviors requiring running server. Code-level analysis is conclusive for all three BLOCKERs.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MONEY-01 | 14-01, 14-02, 14-03 | subscriptions + subscription_events + stripe_customers tables; stripe-webhook with signature verification | PARTIAL | Schema + Edge Functions exist in code; migration not pushed (deferred human step). Webhook signature verification via constructEventAsync correctly implemented. |
| MONEY-02 | 14-03, 14-04, 14-05 | Web user subscribes via Stripe Checkout with 7-day trial; auto-converts | BLOCKED | CR-01 (no DB→store sync) + CR-02 (PaywallUpsell broken) prevent end-to-end flow |
| MONEY-03 | 14-04, 14-06 | Web user manages via Stripe Customer Portal | BLOCKED | ManageSubscriptionLink correctly calls portal endpoint; but CR-01 means tier never updates after return |
| MONEY-04 | 14-05, 14-06 | TierGate + tier slice gate premium features | PARTIAL | TierGate structural implementation is correct; functionally dead due to CR-01 |
| MONEY-05 | 14-01, 14-02, 14-07 | Clinic billed per-active-patient with monthly true-up | PARTIAL | count_active_patients() function + invoice-upcoming.ts exist; metered billing spec is hollow (WR-09); CR-06 LIMIT 1 placement is fragile |
| MONEY-08 | 14-05 | Visitor sees pricing page with paywall surfaces | PARTIAL | Phase 14 portion (TierGate primitive + env var price IDs) shipped; pricing page UI deferred to Phase 15 per CONTEXT/ROADMAP |
| MONEY-09 | 14-03, 14-06 | Card failure → Smart Retries → past_due banner + dunning email; clears on retry | BLOCKED | CR-04 inverts the trigger (payment failure writes 'paid' not 'past_due'); CR-01 means banner never shows even if DB were correct |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| supabase/functions/stripe-webhook/events/invoice-payment-failed.ts | 27-29 | Non-existent field access disguised by `as unknown as` cast | BLOCKER | Dunning trigger inverted — CR-04 |
| supabase/functions/stripe-webhook/events/invoice-paid.ts | 30-32 | Same non-existent field read + dead code `void invoiceObj` | BLOCKER | Structurally broken even if benign today — CR-04 |
| leanshot/src/components/billing/PaywallUpsell.tsx | 52-58 | Raw fetch with wrong path, no JWT, no body vs correct supabase.functions.invoke pattern already established in UpgradeCTA.tsx | BLOCKER | Every blur-upsell upgrade click fails silently — CR-02 |
| leanshot/tests/sql/count-active-patients.test.sql | 77 | Invalid site value 'abdomen' (valid enum values are 'abdomen-ul', 'abdomen-ur', etc.) | WARNING | SQL test may error on insert before reaching assertion — count_active_patients() unverified |
| leanshot/e2e/clinic-metered-billing.spec.ts | 274 | Hardcoded 'mtr_test_placeholder' meter ID in production assertion path | WARNING | Spec passes on HTTP 200 status alone; SC#3 not actually proven |
| leanshot/package.json | 67 | stripe@^17.7.0 while bootstrap + e2e fixtures target API version '2026-04-22.dahlia' / billing.meters (v19 APIs) | WARNING | Latent runtime failure at bootstrap and e2e time |
| leanshot/src/lib/storage.ts | (STORAGE_VERSION=8) | New billing fields added to PersistedState without bumping STORAGE_VERSION or adding a migrateV8ToV9 | WARNING | Existing users get billing defaults via shallow-merge; no explicit migration or test coverage |
| leanshot/src/components/dashboard/ai/AIChatPanel.tsx | ~66-70 | chatModel state set but never passed to callAIChat (TODO comment admits deferral) | INFO | Paid user can select Opus; has zero effect |

---

## Human Verification Required

These items require live Stripe/Supabase/Vercel access — they are NOT code gaps:

### 1. Deploy Edge Functions

**Test:** `supabase functions deploy stripe-checkout stripe-webhook`
**Expected:** Functions appear in Supabase project `ytnsipxxmzgaebkqmokp` dashboard under Edge Functions
**Why human:** Requires authenticated Supabase CLI session with project access

### 2. Register Stripe webhook endpoint

**Test:** In Stripe Dashboard (test mode), add webhook endpoint pointing to deployed stripe-webhook function URL; copy whsec_ secret
**Expected:** STRIPE_WEBHOOK_SECRET set in Supabase secrets; webhook events include customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, checkout.session.completed, invoice.upcoming
**Why human:** Stripe Dashboard UI + supabase secrets set CLI

### 3. Register invoice.upcoming event

**Test:** Add invoice.upcoming to the Stripe webhook endpoint event list
**Expected:** invoice.upcoming appears alongside other events in the endpoint configuration
**Why human:** Stripe Dashboard webhook configuration

### 4. Run stripe-bootstrap.ts against live Stripe test account

**Test:** `cd leanshot && STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-bootstrap.ts`
**Expected:** 5 prices created; 4 VITE_STRIPE_PRICE_* env vars populated in Vercel + Supabase secrets
**Why human:** Requires live STRIPE_SECRET_KEY + Vercel CLI auth

### 5. Configure Stripe Customer Portal return-URL allowlist

**Test:** Stripe Dashboard → Customer Portal settings → add https://app.leanshot.app/settings?from=portal
**Expected:** Portal redirects land on settings page cleanly
**Why human:** Stripe Dashboard UI configuration

### 6. Push migration to live Supabase DB

**Test:** `supabase db push` (migration 20260601000019_stripe_subscriptions.sql)
**Expected:** subscriptions, subscription_events, stripe_customers, clinic_stripe_customers tables visible in Supabase dashboard; RLS policies active
**Why human:** Requires authenticated Supabase CLI session

---

## Gaps Summary

Three code-level BLOCKERs prevent the phase goal from being met. They share a common root: the webhook→DB write half of the system was built correctly, but the DB→frontend read half was never built, and the primary Upgrade CTA was implemented with the wrong calling pattern.

**Root cause cluster A (CR-01 + CR-02):** The frontend billing slice is an island. `setTier()` exists but has no caller that reads from the DB. `PaywallUpsell` (the blur-upsell CTA in MedLevelChart and AIChatPanel) uses a raw `fetch` call that differs from the correct `supabase.functions.invoke` pattern already used by `UpgradeCTA.tsx` (Settings) and `ManageSubscriptionLink.tsx`. The gap-closure plan for CR-01/CR-02 is ~60-90 min of focused work: add a post-auth subscriptions query + `setTier()` call in App.tsx or sync-defer, and fix PaywallUpsell to mirror UpgradeCTA.

**Root cause cluster B (CR-04):** Both invoice handlers try to derive subscription status from a non-existent invoice field. The fix is ~20 min: write `ux_tier='past_due'` directly in invoice-payment-failed (payment failed = dunning started, by definition), and write `ux_tier='paid'` directly in invoice-paid (payment succeeded = dunning cleared).

**Separate concerns (WR-09, CR-03, CR-05/CR-06):** The metered billing e2e test is structurally hollow (cannot prove SC#3 without a real meter ID). The Stripe npm dependency version mismatch (v17 vs v19 API shapes) is a latent runtime risk for the bootstrap script. The SQL test uses an invalid site enum value. These are lower priority than the three blockers but should be part of the gap-closure plan.

**Vendor/deploy items (6 human-verification items):** These are legitimately deferred to a user-action checkpoint. They require live Stripe + Supabase credentials and cannot be verified from code alone. They do not block writing the gap-closure plan.

**Recommended next step:** Run `/gsd-plan-phase 14 --gaps` to generate a gap-closure plan targeting CR-01 + CR-02 (billing sync + PaywallUpsell fix) and CR-04 (invoice handler inversion) as the priority items, then proceed to the vendor/deploy checkpoint.

---

_Verified: 2026-05-14T06:29:09Z_
_Verifier: Claude (gsd-verifier)_
