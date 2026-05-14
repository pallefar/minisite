---
phase: 14-monetization-foundation-stripe-web-clinic-seats
reviewed: 2026-05-14T00:00:00Z
depth: standard
files_reviewed: 53
files_reviewed_list:
  - leanshot/.env.example
  - leanshot/e2e/checkout-trial-flow.spec.ts
  - leanshot/e2e/clinic-metered-billing.spec.ts
  - leanshot/e2e/fixtures/stripe/seed-subscription.ts
  - leanshot/e2e/fixtures/stripe/stub-webhook.ts
  - leanshot/e2e/fixtures/stripe/test-clock.ts
  - leanshot/e2e/past-due-banner.spec.ts
  - leanshot/e2e/portal-plan-change.spec.ts
  - leanshot/package.json
  - leanshot/scripts/stripe-bootstrap.test.ts
  - leanshot/scripts/stripe-bootstrap.ts
  - leanshot/src/components/billing/ManageSubscriptionLink.test.tsx
  - leanshot/src/components/billing/ManageSubscriptionLink.tsx
  - leanshot/src/components/billing/PastDueBanner.test.tsx
  - leanshot/src/components/billing/PastDueBanner.tsx
  - leanshot/src/components/billing/PaywallUpsell.tsx
  - leanshot/src/components/billing/TierGate.test.tsx
  - leanshot/src/components/billing/TierGate.tsx
  - leanshot/src/components/billing/UpgradeCTA.test.tsx
  - leanshot/src/components/billing/UpgradeCTA.tsx
  - leanshot/src/components/dashboard/ai/AIChatPanel.tsx
  - leanshot/src/components/dashboard/charts/MedLevelChart.tsx
  - leanshot/src/components/dashboard/settings/SettingsPage.tsx
  - leanshot/src/components/layout/AppShell.tsx
  - leanshot/src/lib/billing.test.ts
  - leanshot/src/lib/billing.ts
  - leanshot/src/lib/storage.ts
  - leanshot/src/lib/store.ts
  - leanshot/src/types/index.ts
  - leanshot/tests/csp/csp-snapshot.txt
  - leanshot/tests/rls/subscriptions-impersonation.test.ts
  - leanshot/tests/sql/count-active-patients.test.sql
  - leanshot/vercel.json
  - leanshot/vite.config.ts
  - supabase/functions/import_map.json
  - supabase/functions/stripe-checkout/cors.ts
  - supabase/functions/stripe-checkout/deno.json
  - supabase/functions/stripe-checkout/index.test.ts
  - supabase/functions/stripe-checkout/index.ts
  - supabase/functions/stripe-webhook/cors.ts
  - supabase/functions/stripe-webhook/deno.json
  - supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts
  - supabase/functions/stripe-webhook/events/checkout-session-completed.ts
  - supabase/functions/stripe-webhook/events/customer-subscription-deleted.test.ts
  - supabase/functions/stripe-webhook/events/customer-subscription-deleted.ts
  - supabase/functions/stripe-webhook/events/invoice-paid.test.ts
  - supabase/functions/stripe-webhook/events/invoice-paid.ts
  - supabase/functions/stripe-webhook/events/invoice-payment-failed.test.ts
  - supabase/functions/stripe-webhook/events/invoice-payment-failed.ts
  - supabase/functions/stripe-webhook/events/invoice-upcoming.test.ts
  - supabase/functions/stripe-webhook/events/invoice-upcoming.ts
  - supabase/functions/stripe-webhook/events/subscription-updated.test.ts
  - supabase/functions/stripe-webhook/events/subscription-updated.ts
  - supabase/functions/stripe-webhook/index.test.ts
  - supabase/functions/stripe-webhook/index.ts
  - supabase/migrations/20260601000019_stripe_subscriptions.sql
findings:
  critical: 6
  warning: 9
  info: 5
  total: 20
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-05-14
**Depth:** standard
**Files Reviewed:** 53
**Status:** issues_found

## Summary

Phase 14 ships the Stripe monetization foundation: a 4-table Postgres slice with RLS + a SECURITY DEFINER counter, two Edge Functions (webhook + checkout), an idempotent bootstrap script, a frontend tier-gating slice, and a Playwright e2e suite.

The server-side webhook signature/idempotency/PII discipline is genuinely solid, RLS policies are correctly scoped, and `count_active_patients()` pins `search_path` as required. **However, the feature does not actually function end-to-end.** The single most important finding (CR-01): there is **no DB→store sync path** — `setTier()` and `getActiveTier()` are defined but never called from any non-test code. The Zustand `tier` is permanently `'free'` for every real user regardless of their Stripe subscription state. Every paywall gate, the past-due banner, and the Settings subscription section are driven entirely off a value nothing ever updates. The webhook correctly writes `subscriptions` rows; the frontend never reads them.

Two more BLOCKERs compound this: `PaywallUpsell` (the primary Upgrade CTA wired into `MedLevelChart` and `AIChatPanel`) calls the checkout endpoint with the wrong URL, no JWT, and no `plan` body — it will 401/400 every time. And `package.json` pins `stripe@^17.7.0` while every script and fixture hard-codes `apiVersion: '2026-04-22.dahlia'`, a version the v17 SDK's typings and request shapes do not support.

There are also cross-file schema-drift bugs (the invoice handlers read a non-existent `subscription_status` field; the SQL test inserts an invalid `site` value and a column that doesn't exist).

## Critical Issues

### CR-01: Billing tier is never synced from the DB — entire paywall is dead

**File:** `leanshot/src/lib/store.ts:482`, `leanshot/src/lib/billing.ts:91`
**Issue:** `setTier` (store action) and `getActiveTier` (collapse helper) are both defined but have **zero non-test call sites** in `src/`. There is no code path that:
1. fetches the `subscriptions` row for the current user after sign-in, or
2. subscribes to Realtime changes on `subscriptions`, or
3. calls `setTier(...)` with anything.

Consequently `useStore((s) => s.tier)` is `'free'` for 100% of real users forever. `TierGate`, `PastDueBanner`, `UpgradeCTA`, `ManageSubscriptionLink`, and the gated forecast layers in `MedLevelChart` are all driven off this dead value. A user who completes Checkout, gets `subscriptions.ux_tier='paid'` written by the webhook, reloads the app — and still sees the free-tier blur overlay. The webhook half works; the read half was never built. This also means the e2e specs that `page.reload()` and then assert the past-due banner is visible (`past-due-banner.spec.ts:264`) cannot pass — nothing moves the DB value into the store.
**Fix:** Add a post-auth sync (mirroring the Phase 9 `clinic-permissions` fetch pattern): on `SIGNED_IN` / app mount, query `subscriptions` for the user, run `getActiveTier(status, current_period_end, new Date())`, and call `setTier(...)`. Wire a Realtime subscription (or a focus/interval refetch) so webhook-driven changes propagate within the SC #2 10-second budget. Until this exists, the phase's headline success criteria (MONEY-02/03/09) are unmet.

### CR-02: `PaywallUpsell` calls the checkout Edge Function with wrong URL, no auth, no plan

**File:** `leanshot/src/components/billing/PaywallUpsell.tsx:52-63`
**Issue:** `fetchCheckoutUrl()` does:
```ts
const res = await fetch(`${base}/functions/v1/stripe-checkout`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
});
```
Three independent failures against `stripe-checkout/index.ts`:
1. **Wrong path** — the dispatcher routes on the segment *after* `stripe-checkout` (`index.ts:500-512`). Posting to bare `/stripe-checkout` yields `action === ''` → `404 unknown_action`.
2. **No JWT** — `handleSession` requires `Authorization: Bearer <jwt>` (`index.ts:291-296`). `credentials: 'include'` sends cookies, which the function explicitly ignores (CORS sets no `Allow-Credentials`; `cors.ts` comment confirms "no cookies"). Result: `401 unauthenticated`.
3. **No `plan` body** — `handleSession` requires `body.plan` ∈ `{plus_monthly,plus_yearly,clinic}` (`index.ts:307-311`) → `400 invalid_plan`.

`PaywallUpsell` is the upgrade affordance rendered by both `MedLevelChart` (`blur-upsell` overlay) and `AIChatPanel` (`hard-block-cta`). Every free user who clicks "Upgrade" on the chart or AI panel hits a silent `console.error` and nothing happens.
**Fix:** Use `supabase.functions.invoke('stripe-checkout/session', { body: { plan } })` exactly as `UpgradeCTA.tsx:49-52` already does correctly. `PaywallUpsell` needs a `plan` prop (or a default) and must drop `credentials: 'include'` + the raw `fetch`.

### CR-03: `stripe` dependency pinned to v17 but all code targets API `2026-04-22.dahlia` / Billing Meters / v19 shapes

**File:** `leanshot/package.json:67`, `leanshot/scripts/stripe-bootstrap.ts:33-35`, `supabase/functions/import_map.json:5`
**Issue:** `package.json` adds `"stripe": "^17.7.0"`. But:
- `stripe-bootstrap.ts` (a Node script that *uses* this dependency) sets `apiVersion: '2026-04-22.dahlia'` and calls `stripe.billing.meters.create(...)` / `stripe.billing.meterEvents` — APIs that postdate v17. Its own comment (line 29-31) admits "Stripe SDK v17 types pin to 2025-02-24.acacia" and casts via `as` to bypass the type error, but the *runtime request shape* (e.g. `value_settings`, `customer_mapping`) is not guaranteed on the v17 client.
- The Edge Functions and `import_map.json` use `stripe@19` (`esm.sh/stripe@19`). The Node side (bootstrap + all 3 e2e fixtures) uses the npm `stripe` package — now v17. Two different major versions of the same SDK across one phase.
- `seed-subscription.ts:147` types `lineItems` as `Stripe.SubscriptionCreateParams['items']` and `test-clock.ts` uses `stripe.testHelpers.testClocks` — fine on v17, but the `apiVersion` cast is load-bearing and fragile.

This is a latent runtime break: the bootstrap script and e2e fixtures may throw `Received unknown parameter` or version-mismatch errors against live Stripe.
**Fix:** Pin the npm `stripe` dependency to `^19.x` to match the Edge Function `import_map.json` and the `2026-04-22.dahlia` API version used everywhere. Remove the `as Stripe.LatestApiVersion` / `as any` casts once the types line up.

### CR-04: Invoice handlers read `invoice.subscription_status` — a field that does not exist

**File:** `supabase/functions/stripe-webhook/events/invoice-paid.ts:30-32`, `supabase/functions/stripe-webhook/events/invoice-payment-failed.ts:27-29`
**Issue:** Both handlers do:
```ts
const subStatus = (
  (invoice as unknown as { subscription_status?: string }).subscription_status ?? 'active'
) as Stripe.Subscription.Status;
```
There is no `subscription_status` field on a Stripe `Invoice` object — not in any API version. The `as unknown as {...}` cast suppresses the type error, but at runtime `invoice.subscription_status` is **always `undefined`**, so `subStatus` is **always `'active'`**.

Concrete consequences:
- `invoice-payment-failed.ts` then writes `ux_tier='paid'` and `status='active'` on a payment-failure event. So a real `invoice.payment_failed` webhook *clears* past-due instead of setting it. The whole D-08 dunning trigger is inverted — exactly the opposite of `past-due-banner.spec.ts`'s expectation.
- `invoice-paid.ts` is benign by luck (paid → active), but still not actually re-reading Stripe truth as the comment claims.
**Fix:** The invoice object carries `invoice.subscription` (the sub ID) — fetch the subscription via `stripe.subscriptions.retrieve(subId)` and read its real `.status`, or rely on the separate `customer.subscription.updated` event (which Stripe fires alongside) and make these invoice handlers period-end-only. For `invoice.payment_failed` specifically, do not derive tier from a non-existent field — at minimum set `ux_tier='past_due'` directly, since by definition a `payment_failed` event means dunning has started.

### CR-05: `count-active-patients.test.sql` inserts an invalid `site` value and a non-existent `date` column

**File:** `leanshot/tests/sql/count-active-patients.test.sql:73-81`, `leanshot/e2e/clinic-metered-billing.spec.ts:141-149`
**Issue:** The SQL test inserts injection rows with `site` = `'abdomen'`:
```sql
INSERT INTO public.injections (..., site, ...) VALUES (v_p3, ..., 'abdomen', ...);
```
`'abdomen'` is not a valid `InjectionSite` (`src/types/index.ts:27-35` enumerates `abdomen-ul|abdomen-ur|abdomen-ll|abdomen-lr|...` — there is no bare `'abdomen'`). If the `injections.site` column has a CHECK/enum constraint (consistent with the typed domain), every insert in this test fails and the test errors out before reaching the assertion — meaning `count_active_patients()` is effectively unverified. The clinic e2e fixture (`clinic-metered-billing.spec.ts:147`) repeats the same `site: 'abdomen'`. That same insert also passes `date: recentDate.slice(0,10)` and `dose_unit: 'mg'` — but the SQL test uses `logged_at` and `dose`/`unit`, and `MedLevelChart`/types use `datetime`/`unit`. The two inserts disagree on the `injections` column names, so at least one is wrong against the live schema.
**Fix:** Use a valid enum site (`'abdomen-ul'`). Reconcile the `injections` column names — pick the actual live-schema names (`logged_at` vs `created_at` vs `date`; `unit` vs `dose_unit`) and use them consistently in both the SQL test and the e2e fixture. Note `count_active_patients()` filters on `i.created_at` (`migration:203`) — confirm `injections` actually has a `created_at` column, or the counter silently counts zero.

### CR-06: `count_active_patients` UNION subquery does not filter to the active-patient set — `LIMIT 1` is misplaced

**File:** `supabase/migrations/20260601000019_stripe_subscriptions.sql:201-217`
**Issue:** The "recent activity" `EXISTS` subquery is:
```sql
and exists (
  select 1 from public.injections i where i.user_id = m.user_id and i.created_at > now() - interval '30 days'
  union all
  select 1 from public.weights w where w.user_id = m.user_id ...
  ...
  limit 1
)
```
This is *probably* correct (each `SELECT` is correlated on `m.user_id`, and `EXISTS` short-circuits), but it is fragile: the `limit 1` binds to the **last** `UNION ALL` arm (`symptoms`), not the whole union — it does nothing useful and is misleading. More importantly, if `public.symptoms` / `public.weights` / `public.meals` / `public.workouts` use a different timestamp column than `created_at` (the SQL-test drift in CR-05 suggests they might — injections may use `logged_at`), some arms silently error or never match, undercounting active patients and **under-billing the clinic**. A billing counter that silently undercounts is a revenue-correctness defect.
**Fix:** Drop the meaningless `limit 1`. Verify every one of the 5 tables actually has a `created_at timestamptz` column; if any uses a different name, the query must use that table's real column. Add a SQL test fixture row per table (not just `injections`) so all 5 arms are exercised.

## Warnings

### WR-01: Existing v8 users rely on persist's shallow-merge default for the new billing fields — brittle and untested

**File:** `leanshot/src/lib/storage.ts:91-99`, `leanshot/src/lib/store.ts:410-456`
**Issue:** `PersistedState` gains four **non-optional** fields (`tier`, `current_period_end`, `plan_id`, `provider`) but `STORAGE_VERSION` stays at `8` and no `migrateV8ToV9` is added. Existing users' persisted blobs (version 8) have none of these keys. It happens to work *only* because Zustand `persist`'s default merge is a shallow `{...initialState, ...persisted}` and `initialState` now supplies the defaults — but `migrate` is never invoked for these users (version matches), so there is no explicit, tested migration. Any future change to the merge strategy, or a `partialize` that drops a key, silently reintroduces `undefined` tier. The `noUncheckedSideEffectImports`/strict posture of this codebase warrants an explicit migration.
**Fix:** Either bump `STORAGE_VERSION` to 9 and add a `migrateV8ToV9` that back-stamps the four billing defaults (consistent with the v6→v7 / v7→v8 pattern), or add an explicit assertion/comment that the shallow-merge default is the intended migration path and cover it with a test that hydrates a v8 blob lacking the keys.

### WR-02: `checkout-session-completed.ts` writes `current_period_end: null` and `trial_end: null` unconditionally

**File:** `supabase/functions/stripe-webhook/events/checkout-session-completed.ts:39-41, 74-76`
**Issue:** On `checkout.session.completed` the handler upserts the `subscriptions` row with `current_period_end: null` and `trial_end: null` hard-coded. Stripe fires `checkout.session.completed` and `customer.subscription.created` with no guaranteed ordering. If `checkout.session.completed` is processed *after* `customer.subscription.created`, this upsert (`onConflict: 'id'`) **overwrites** the real `current_period_end`/`trial_end` that `subscription-updated.ts` already wrote, with nulls. `getActiveTier`'s `canceled`-before-period-end branch and any trial-countdown UI then read `null`. The race is real and silent.
**Fix:** Either don't upsert period/trial fields from this handler at all (omit the keys so the upsert doesn't clobber them), or fetch the subscription and populate them. Given D-14 ("webhook is source of truth" and `subscription-updated` owns the full row), `checkout-session-completed` should only write the customer-mapping rows and let `subscription-updated` own `subscriptions`.

### WR-03: `subscription-updated.ts` clobbers `user_id`/`clinic_id` to `null` when metadata is absent

**File:** `supabase/functions/stripe-webhook/events/subscription-updated.ts:63-64, 67-82`
**Issue:** `userId = meta.user_id ?? null` / `clinicId = meta.clinic_id ?? null`, then the upsert writes those values. Stripe `customer.subscription.updated` events are not guaranteed to carry the `subscription_data.metadata` you set at Checkout on *every* future update (e.g. an update triggered from the Customer Portal, or a proration event). If any such event arrives with empty metadata, this upsert sets **both** `user_id` and `clinic_id` to `null` — which violates the table's `check ((user_id is null) <> (clinic_id is null))` constraint (`migration:67`), so the upsert throws, the handler returns 500, and Stripe retries forever. Or, worse, if the constraint were ever relaxed, the row becomes an orphan unreadable by RLS.
**Fix:** On update, do not overwrite `user_id`/`clinic_id` from metadata. Either omit them from the upsert payload (so `onConflict` preserves the existing values) or, for the `created` path only, set them; for `updated`, never touch them.

### WR-04: `invoice-upcoming.ts` `handle()` shim ignores 35-day guard ordering and re-creates a Stripe client per event

**File:** `supabase/functions/stripe-webhook/events/invoice-upcoming.ts:149-154`
**Issue:** The dispatcher-compatible `handle(event, admin)` constructs a brand-new `new Stripe(...)` on every invocation. Minor inefficiency, but more importantly it reads `Deno.env.get('STRIPE_SECRET_KEY')` directly — if unset it constructs `new Stripe('')`, which throws at construction and surfaces as a generic `500 internal` with no actionable log. The webhook's own `getStripe()` factory (`index.ts:41-45`) at least falls back to `'sk_test_placeholder'`; this shim does not share that.
**Fix:** Reuse a module-level Stripe client (or the one the dispatcher already has) instead of constructing per-event; add an explicit env-presence check with a clear log line.

### WR-05: `stripe-checkout` action routing falls through to "last segment" — `/stripe-checkout` with a trailing path could mis-route

**File:** `supabase/functions/stripe-checkout/index.ts:498-512`
**Issue:** `const action = fnIdx >= 0 ? (segments[fnIdx + 1] ?? '') : (segments[segments.length - 1] ...)`. When the function is invoked at exactly `/functions/v1/stripe-checkout` (no sub-action), `fnIdx` is found, `segments[fnIdx+1]` is `undefined` → `action = ''` → `404 unknown_action`. That's acceptable. But the fallback branch (`fnIdx < 0`) takes "the last path segment" as the action — if Supabase ever mounts the function differently, a request to `/foo/session` would be treated as a valid `session` call. Brittle routing that depends on the literal string `'stripe-checkout'` appearing in the path.
**Fix:** Match the action against an explicit allowlist *and* require `fnIdx >= 0`; reject anything else with 404 rather than guessing from the last segment.

### WR-06: `.env.example` sets non-empty placeholder secrets (`sk_test_...`, `whsec_...`) instead of blank

**File:** `leanshot/.env.example:72-92`
**Issue:** `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `VITE_STRIPE_PUBLIC_KEY=pk_test_...`, `STRIPE_PRICE_*=price_...`. The existing Phase 1/2 vars in the same file correctly use *blank* values (`VITE_SENTRY_DSN=`, `SENTRY_AUTH_TOKEN=`). A non-empty placeholder like `sk_test_...` defeats env-presence guards: `stripe-bootstrap.ts:21` checks `if (!process.env.STRIPE_SECRET_KEY)` — the string `'sk_test_...'` is truthy, so a developer who copies `.env.example` to `.env.local` verbatim sails past the guard and gets a confusing Stripe-side auth error instead of the intended "key not set" message.
**Fix:** Blank the placeholder values (`STRIPE_SECRET_KEY=`) and keep the format hint in the comment, matching the established Phase 1/2 convention in this same file.

### WR-07: `getActiveTier` and `mapStripeStatusToUxTier` diverge on the `canceled` status

**File:** `leanshot/src/lib/billing.ts:107-114`, `supabase/functions/stripe-webhook/events/subscription-updated.ts:29-33`
**Issue:** The two functions are documented as "must stay aligned" (`billing.ts:9-11`), but they are not. Client `getActiveTier` treats `canceled` with a future `current_period_end` as `'paid'` (Stripe keeps access until period end). Server `mapStripeStatusToUxTier` collapses `canceled` → `'free'` unconditionally (no period-end check — it doesn't even receive `current_period_end`). So when `customer.subscription.updated` fires with `status='canceled'` mid-period, the webhook writes `ux_tier='free'`, but the client collapse logic (if it were ever wired — see CR-01) would say `'paid'`. The DB row and the canonical client logic disagree for the entire cancel-grace-period window.
**Fix:** Make the server `mapStripeStatusToUxTier` accept `current_period_end` and apply the same future-period-end → `'paid'` rule, OR document that the server intentionally treats `canceled` as immediate `'free'` and remove the "must stay aligned" claim. Pick one and make both sides match.

### WR-08: `customer-subscription-deleted.ts` does not clear `current_period_end`/`cancel_at_period_end`

**File:** `supabase/functions/stripe-webhook/events/customer-subscription-deleted.ts:14-20`
**Issue:** On final cancellation the handler updates only `ux_tier='free'` and `status='canceled'`, leaving `current_period_end` populated (the comment says this is intentional "for audit"). But `getActiveTier('canceled', current_period_end, now)` returns `'paid'` whenever `current_period_end > now` — and a subscription can be deleted *before* its period end (e.g. `cancel immediately` from the Portal). If the client ever reads `status='canceled'` + a future `current_period_end` (which this row now has), the canonical collapse says `'paid'` even though Stripe has fully deleted the subscription. The "UI shouldn't read it after this point" comment is an unenforced assumption.
**Fix:** On `customer.subscription.deleted`, also set `current_period_end = null` and `cancel_at_period_end = false`, so `getActiveTier` cannot mis-collapse the deleted row to `'paid'`. The raw event is still in `subscription_events` for audit.

### WR-09: `clinic-metered-billing.spec.ts` uses a hard-coded placeholder meter ID and treats almost every outcome as a pass

**File:** `leanshot/e2e/clinic-metered-billing.spec.ts:273, 324-342`
**Issue:** The test calls `stripe.billing.meterEventSummaries.list('mtr_test_placeholder', ...)` with a literal placeholder ID — that call always throws, so the test always falls into the `catch`. The cascading fallbacks then end with `meterEventFound = webhookResp.status === 200`, and the final assertion only throws `if (!meterEventFound && webhookResp.status !== 200)`. Net effect: the test passes as long as the webhook returns 200 — it never actually verifies that an overage meter event with `value=1` was recorded. SC #3 / MONEY-05 ("11 active patients → overage=1") is not actually proven by this spec.
**Fix:** Read the real meter ID from `process.env.STRIPE_METER_ACTIVE_PATIENTS` (already a documented env var) and assert `aggregated_value === 1` with no status-code escape hatch. If the meter isn't configured, `test.skip` rather than passing on the webhook status.

## Info

### IN-01: `invoice-paid.ts` carries dead code (`invoiceObj` / `void invoiceObj`)

**File:** `supabase/functions/stripe-webhook/events/invoice-paid.ts:24-26, 53`
**Issue:** `invoiceObj` is constructed with a `subscription_details` type cast, never read, then suppressed with `void invoiceObj` to dodge unused-locals. Dead code that signals an abandoned implementation approach.
**Fix:** Remove `invoiceObj` and the `void` suppression entirely.

### IN-02: `AIChatPanel` ships a `chatModel` selector that does nothing (`TODO(14-05)`)

**File:** `leanshot/src/components/dashboard/ai/AIChatPanel.tsx:66-70, 178`
**Issue:** The gated model selector sets `chatModel` state but it is never passed to `callAIChat` — the comment admits "wiring ... deferred". A paid user can pick "Opus" and it has zero effect. This is a user-visible no-op control behind a paywall, which is worse than not shipping it.
**Fix:** Either wire `chatModel` into the `callAIChat` payload now, or remove the selector until Phase 14 follow-up actually wires it. Shipping an inert paywalled control invites "I paid and nothing changed" complaints.

### IN-03: `stripe-bootstrap.ts` `ensureMeter` lists only 100 meters with no pagination

**File:** `leanshot/scripts/stripe-bootstrap.ts:74-88, 41-49`
**Issue:** `ensureProduct` and `ensureMeter` both `list({ limit: 100 })` and `find()` — if an account ever has >100 products/meters, the idempotency dedup silently misses an existing one and creates a duplicate. Low risk for this project today, but the "search before create" idempotency claim is only true under 100 items.
**Fix:** Use `lookup_keys` / pagination, or at least comment the 100-item ceiling assumption.

### IN-04: `seed-subscription.ts` passes `default_payment_method: undefined` — misleading no-op

**File:** `leanshot/e2e/fixtures/stripe/seed-subscription.ts:184-192`
**Issue:** The web-plus branch sets `default_payment_method: undefined` with a comment "Add a default payment method so the trial auto-converts" — but `undefined` adds nothing. The trial subscriptions seeded by this fixture have no payment method, so they will *not* auto-convert on day 8; `checkout-trial-flow.spec.ts`'s "day-8 conversion" test depends on conversion happening. The comment describes intent the code does not implement.
**Fix:** Either attach a real Stripe test payment method (`pm_card_visa`) to the customer before creating the subscription, or remove the misleading key+comment and document that seeded subs require a separate payment-method attach step.

### IN-05: `subscription_events.payload` stores the full Stripe event including `event.data.object`

**File:** `supabase/functions/stripe-webhook/index.ts:182-186`, `supabase/migrations/20260601000019_stripe_subscriptions.sql:79-87`
**Issue:** The idempotency insert writes `payload: event` — the *entire* Stripe event, including `event.data.object` (customer email, card brand/last4 on some event types). The webhook's own header comment makes a point of "NEVER logs event.data.object" for PII safety, but then persists the whole object to a table. RLS denies `authenticated` access (good), but this is still PII-at-rest in a table whose stated purpose is just idempotency + an audit log. Worth a deliberate decision rather than an accident.
**Fix:** Either store only `{ id, type, created }` in `payload` (idempotency only needs `event_id`, which is the PK), or explicitly document that full-event retention is intentional and acceptable under the project's compliance posture.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
