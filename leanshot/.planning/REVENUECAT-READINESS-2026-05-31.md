# RevenueCat IAP — Launch-Readiness Report

_Audit date: 2026-05-31 · App: LeanShot (Capacitor iOS/Android) · Scope: RevenueCat mobile IAP + Stripe(web) reconciliation_

> Path note: the React app lives at `/Users/karstenhaldan/minisite/leanshot/`, but the git/monorepo root is one level up at `/Users/karstenhaldan/minisite/`. The Edge Functions, migrations, and CI workflows live at the **monorepo root** (`/Users/karstenhaldan/minisite/supabase/`, `/Users/karstenhaldan/minisite/.github/`), NOT under `leanshot/`. All paths below are absolute.

---

## 1. Verdict

**yes-with-defects.** The RevenueCat code path is fundamentally well-architected and correctly wired end-to-end (SDK init → purchase/restore → webhook → DB → entitlement gating). It is NOT broken. But it ships with **5 in-repo code/config defects** that must be fixed before store submission — two of them (CI never injects the RC keys; mobile subscribers are routed to the Stripe portal) will silently break the live IAP business line — plus a substantial **operator-pending** provisioning checklist (RC keys, dashboard offerings/entitlement, ASC/Play products, webhook secrets, Paid-Apps agreement) without which nothing works live regardless of code quality.

---

## 2. ✅ Connected (working)

### SDK initialization & configuration
- `Purchases.configure()` is platform-gated (never on web), idempotent via module-level `_configured`, and links the RC `appUserID` to the authenticated Supabase user id — `/Users/karstenhaldan/minisite/leanshot/src/lib/native/iap.ts:79-93,115-136`.
- Empty key degrades gracefully: throws a typed `RcConfigError`, callers render a clean disabled paywall — `iap.ts:127-132`, `PricingIOS.tsx:96-99,308-312`.
- Cross-account switch handled via `Purchases.logIn()` instead of reconfigure — `iap.ts:120-126`; tested at `iap.test.ts:75-86`.
- Single-importer firewall: `@revenuecat/purchases-capacitor` imported only in `iap.ts:26`; kept off the web entry chunk via lazy `getPricingComponent` — `pricing-page-content.ts:155-161`.

### Offerings & product identifiers
- Offerings fetched live (not hardcoded), ids platform-agnostic, lifetime web-only — `iap.ts:142-182`.
- Product IDs byte-consistent across the whole codebase: `app.leanshot.plus.monthly` / `.yearly` (reverse-DNS); RC packages `$rc_monthly` / `$rc_annual`; single `plus` entitlement — `iap.ts:6,7,259`, `PricingIOS.tsx:50-51`, `App.tsx:1452`.
- Bundle IDs real and consistent: iOS `app.leanshot.ios`, Android `app.leanshot.android`.

### Purchase + restore + UI flow (PricingIOS paywall)
- Subscribe bound to `purchaseSubscription(selectedProductId)`; visible **Restore Purchases** control (Apple §3.1.1) — `PricingIOS.tsx:160-164,290-306`, `iap.ts:240-245`.
- User-cancel is silent; real network/config errors toast; loading/disabled state correct — `iap.ts:225-231`, `PricingIOS.tsx:165-176,293-294`.
- Native-only render; web returns `null` and routes to Stripe; Apple anti-steering enforced (no Stripe CTA on consumer paywall, runtime grep test) — `PricingIOS.tsx:109-111,154-318`, `PricingIOS.test.tsx:183-191`, `App.tsx:1449-1470`.

### Server-side webhook & persistence
- Auth defense-in-depth: REQUIRED Bearer gate before body read + OPTIONAL fail-soft HMAC over raw body — `/Users/karstenhaldan/minisite/supabase/functions/revenuecat-webhook/index.ts:264-287`.
- `verify_jwt=false` declared so RC's unauthenticated POSTs reach the handler — `/Users/karstenhaldan/minisite/supabase/config.toml:408-409`.
- Idempotency via `subscription_events.event_id` PK, 23505→200; other DB errors→500 for bounded retry — `index.ts:310-327`.
- Upsert keys on `(user_id, provider)` with `user_id = event.app_user_id`; the client passes the Supabase auth uid as `appUserID`, so identity flows correctly into `subscriptions` → `tier_effective` → `current_user_has_pro()` — `index.ts:206,237`, `App.tsx:1456`, `PricingIOS.tsx:91`.
- PII-safe responses/logging; `Cache-Control: private, no-store`; 14-test suite covers auth/HMAC/idempotency/downgrade/malformed/PII — `index.test.ts:142-359`.

### Entitlement gating (DB-canonical)
- `tier_effective` view is the single authoritative source, unifying Stripe + RC + Lifetime via `UNION ALL` + `bool_or` into one `has_active` boolean — `/Users/karstenhaldan/minisite/supabase/migrations/20270715000002_p43_tier_effective_view_v2.sql:44-89`.
- Async readers (`useCurrentUserHasPro`, `getContentTier`, `LifetimeBadge`) all read `tier_effective.has_active`; fail-closed to free on error/missing session — `current-user-has-pro.ts:98-103`, `get-content-tier.ts:66,72-77`.
- RC purchase success flips the store tier within ~5s via a Realtime `postgres_changes` listener on `subscriptions:user_id=eq.{userId}` — `App.tsx:1306-1340`.
- `security_invoker=true` + `authenticated`-only grant keep RLS self-read intact — migration `:42,96`.

### appUserID stability
- `configureRC(signedIn.user.id)` passes the Supabase `auth.users.id` on both web and native, matching the webhook's `app_user_id` and the view's `user_id` key — `PricingIOS.tsx:68,91`, `App.tsx:1418,1456`, `iap.ts:115-135`, `index.ts:144-147,206`.

---

## 3. 🛠️ Code defects to fix (MINE)

Sorted blocker → low. No operator action needed to fix these; they are in-repo wiring/config edits.

### HIGH

**H1 — Mobile CI build jobs never inject `VITE_RC_API_KEY_*` into the shipped bundle.** _(code-defect)_
Even after the operator provisions the RC keys, the TestFlight/Play artifact ships with an empty key → `configureRC()` throws → dead paywall. No documented path gets the keys into the bundle (the canonical operator checklist `fastlane/README.md:131-148` has no `VITE_RC_API_KEY_*` entry).
- `/Users/karstenhaldan/minisite/.github/workflows/mobile-ios.yml` — `Build web assets` steps at ~`:52-53` (build-ios) and ~`:102-104` (sign-and-upload) run `npm run build` with NO `env:` for `VITE_RC_API_KEY_IOS`. `mobile-android.yml` identical (build ~`:57-58`, upload ~`:107-109`).
- Vite freezes `import.meta.env.VITE_RC_API_KEY_*` (`iap.ts:87,90`) at build time; empty env → `apiKey=''`.
- **Fix:** add an `env:` block to the `Build web assets` step in BOTH build AND upload jobs of both workflows, mapping `VITE_RC_API_KEY_IOS`/`_ANDROID` from GitHub Actions secrets. Add those two secrets to the operator checklist. (Not a blocker today — upload jobs are inert until signing secrets land — but bites exactly at store-submission.)

**H2 — Manage-subscription Settings row routes RC (App Store/Play) subscribers to the Stripe Customer Portal.** _(code-defect)_
For any `tier==='paid'||'past_due'` the manage flow unconditionally opens the Stripe portal with copy "Open Stripe". An RC subscriber has no Stripe customer → portal invoke fails ("Couldn't open Stripe"); even if it didn't, App Store/Play subs aren't manageable via Stripe. This breaks self-service management for the ENTIRE mobile subscriber cohort and is an App Store §3.1.1 anti-steering rejection risk.
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:855-856` (no provider branch).
- `/Users/karstenhaldan/minisite/leanshot/src/components/billing/ManageSubscriptionLink.tsx:29,36,66` (always `stripe-checkout/portal`).
- The store already has `provider` in the tier slice (`billing-sync.ts:70`, `types/index.ts:275`) and `tier_effective.winning_provider`.
- **Fix:** branch on `provider` — `stripe` → Stripe portal; `revenuecat` → platform-appropriate App Store / Play subscription-management copy/deep-link (or RC in-app management). Only show the Stripe portal for `provider==='stripe'`.

**H3 — No existing-entitlement guard before showing the iOS/Android paywall — enables double-charge of a web-Stripe subscriber.** _(code-defect)_
A user with an active Stripe web sub who opens the native app sees the full paywall and can buy a second, parallel RC subscription for the same `plus` entitlement. The web sibling `UpgradeCTA.tsx:37,42` already guards this (`if (tier !== 'free') return null`); the native paywall + `?upgrade=` handler omit it.
- `/Users/karstenhaldan/minisite/leanshot/src/components/PricingIOS.tsx` — never reads `tier`/entitlement before rendering Subscribe (mount effect `:85-104` only fetches offerings).
- `/Users/karstenhaldan/minisite/leanshot/src/App.tsx:1450-1469` — `?upgrade=` handler calls `purchaseSubscription` with no pro check.
- **Fix:** before rendering Subscribe (and before `purchaseSubscription` in the `?upgrade=` handler), check unified entitlement — if `tier_effective.has_active` (any provider) is true, hide the CTA and show an "already subscribed / manage on web" state. See also §5.

### MEDIUM

**M1 — Two divergent pro-status resolvers: feature-gating tier goes stale for cross-provider users.** _(code-defect)_
`syncBillingTier` reads `subscriptions` with `.eq('user_id').maybeSingle()` and NO provider filter. A user with both a Stripe AND an RC row (one per provider, unique on `user_id,provider`) yields >1 row → `.maybeSingle()` returns PGRST116 → the error branch returns and leaves the persisted store `tier` stale. `TierGate` (and other store-`tier` gates) then diverge from the `tier_effective`-backed gates.
- `/Users/karstenhaldan/minisite/leanshot/src/lib/billing-sync.ts:41-50`.
- Gates on store tier: `TierGate.tsx:49`, `SettingsPage.tsx:855-856`, `MedLevelChart.tsx:294`, `AIChatPanel.tsx:198`.
- **Fix:** make `syncBillingTier` read `tier_effective` (`has_active`/`tier_label`), OR collapse rows with `.order('current_period_end',{ascending:false}).limit(1).maybeSingle()`. Standardize ALL gating on `tier_effective`. Add a >1-row regression test (currently untested).

**M2 — `TierGate` (synchronous store gate) silently DENIES Pro features to Lifetime purchasers.** _(code-defect)_
Lifetime checkout writes ONLY `lifetime_purchases` (no `subscriptions` row), but `syncBillingTier` reads only `subscriptions` → `getActiveTier(null)` → `'free'`. So a Lifetime user has `tier_effective.has_active=true` (async gates unlock) but store `tier='free'` (headline features blurred). _Scope note: this is a Stripe-WEB Lifetime defect; RC subscribers always get a `subscriptions` row and are unaffected — but the FIX is the same as M1 and resolves both._
- `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/checkout-session-completed.ts:62-86` (lifetime → only `lifetime_purchases`).
- `billing-sync.ts:41-45`, `billing.ts:105`, `TierGate.tsx:49,57`, `MedLevelChart.tsx:294`, `AIChatPanel.tsx:198`.
- **Fix:** route the store `tier`/`TierGate` through `tier_effective.has_active` (same fix as M1). Add a Lifetime-only regression test expecting `TierGate` to render children.

**M3 — `restorePurchases()` triggers no DB/entitlement resync (reinstall + TRANSFER stays locked).** _(code-defect)_
`restorePurchases()` returns void (discards `customerInfo`); `handleRestore` only shows a "Purchases restored." toast — no `syncBillingTier`, no `invalidateProCache`, no `customerInfo` inspection. A reinstall+restore that fires RC `TRANSFER` (which the webhook no-ops) never writes a `subscriptions` row, so the user sees the success toast while still gated as free. Window-focus resync only re-reads the DB, so it does not rescue the never-written row.
- `/Users/karstenhaldan/minisite/leanshot/src/lib/native/iap.ts:240-245`, `PricingIOS.tsx:179-197`.
- **Fix:** after `restorePurchases()` resolves, inspect `customerInfo.entitlements.active['plus']` and optimistically `setTier` and/or call `syncBillingTier(userId)` + `invalidateProCache(userId)`. (Pairs with the TRANSFER fix M4 and the optimistic-unlock improvement below.)

**M4 — `vendor-secrets.md` registers RC client SDK keys under the WRONG names AND wrong mechanism.** _(config-gap)_
Lists `RC_API_KEY_IOS`/`_ANDROID` (no `VITE_` prefix) under "Supabase Function Secrets" with `supabase secrets set …` — but the code reads `VITE_RC_API_KEY_*` as a Vite build-time CLIENT var. An operator following this runbook literally provisions a server Function Secret that never reaches the bundle. The correct "Vercel Env (Build-Time Public)" table omits them entirely. _(Mitigated by correct `.env.example:118-143` + `secrets-rotation.md:58`, so medium not high.)_
- `/Users/karstenhaldan/minisite/leanshot/.planning/runbooks/vendor-secrets.md:70-71,84-93,157-158`.
- **Fix:** rename to `VITE_RC_API_KEY_IOS`/`_ANDROID`, MOVE to the build-time-public table, add as mobile-workflow GitHub secrets (per H1), and update the CI-guard allowlist names at `:157-158`.

**M5 — `vendor-secrets.md` omits `REVENUECAT_WEBHOOK_AUTH` (the only REQUIRED webhook secret).** _(config-gap)_
The runbook lists only the OPTIONAL `REVENUECAT_WEBHOOK_SECRET` (HMAC) and its allowlist entry. But the webhook REQUIRES `REVENUECAT_WEBHOOK_AUTH` (Bearer) — when unset it returns 401 on EVERY delivery. The runbook self-declares "single source of truth," so an operator working from it alone provisions the optional secret and misses the required one → silent total IAP-webhook outage. `SECRETS-RUNBOOK.md` documents it correctly, so the two disagree.
- `/Users/karstenhaldan/minisite/leanshot/.planning/runbooks/vendor-secrets.md:72,119-130,159`.
- Required gate: `/Users/karstenhaldan/minisite/supabase/functions/revenuecat-webhook/index.ts:48-50,265-269`.
- **Fix:** add a REQUIRED `REVENUECAT_WEBHOOK_AUTH` row to the Supabase Function Secrets table + the Phase-70 allowlist, with the `supabase secrets set REVENUECAT_WEBHOOK_AUTH=<token>` command.

### LOW

**L1 — No `Purchases.logOut()` wired on sign-out.** _(code-defect)_
On a shared device, RC stays logged in as user A from sign-out until the next `configureRC(B)`. In-app paid gating is DB-driven (not RC local cache) and every in-app RC op re-`logIn`s first, so no paid feature leaks — residual risk is RC-side analytics/attribution hygiene only.
- No `Purchases.logOut` caller anywhere in `src/`; `iap.ts:115-136` exposes no `logOut` wrapper; `App.tsx:1172-1218` SIGNED_OUT branch never touches RC.
- **Fix:** add an exported native-gated `logOutRC()` (resets `_configured`/`_currentAppUserID`) and call it from the SIGNED_OUT branch.

**L2 — `configureRC` idempotency flag set AFTER the awaited `configure()` — concurrent first-callers can double-configure.** _(code-defect)_
The `_configured` guard is read at `iap.ts:120` but written at `:134`, after `await Purchases.configure(...)` at `:133`. Two near-simultaneous first callers (paywall mount + `?upgrade=`) can both pass the check. Both use the same `{apiKey, appUserID}` and both call sites catch, so worst case is a benign RC reconfigure warning.
- `/Users/karstenhaldan/minisite/leanshot/src/lib/native/iap.ts:120,133-134`.
- **Fix:** memoize a module-level in-flight `Promise`, or set `_configured = true` synchronously before the await with rollback on failure.

**L3 — RC webhook writes non-canonical status strings `'cancellation'`/`'expiration'`.** _(code-defect)_
`status = event.type.toLowerCase()` produces values absent from Stripe's canonical vocabulary (`'canceled'`). Today both `getActiveTier` and the `tier_effective` CASE fall through to `'free'` AND the webhook forces `current_period_end=now()`, so entitlement is correct-by-coincidence — but the admin badges (`MemberBillingTab.tsx:36-50`, `MembersTable.tsx:71-86`) render a neutral-tone raw "cancellation" instead of the danger "Canceled", and a future `'canceled'`-special-casing code path would silently miss RC rows.
- `/Users/karstenhaldan/minisite/supabase/functions/revenuecat-webhook/index.ts:181`; consumers `leanshot/src/lib/billing.ts:66-75,116`.
- **Fix:** normalize the webhook to write `'canceled'`, OR add `'cancellation'`/`'expiration'` explicitly to `getActiveTier`, the `tier_effective` CASE, and the admin badge maps.

**L4 — `iap.ts` maps RC packages by hardcoded `monthly`/`annual` — custom dashboard package ids yield a silent dead paywall.** _(code-defect)_
`getOfferings()` reads only `current.monthly`/`current.annual` (populated only for the built-in `$rc_monthly`/`$rc_annual` identifiers). A custom-identifier offering returns `{monthlyPackage:null}` while `offering !== null`, so `sdkReady=true` but `selectedPkg=null` → Subscribe stays disabled, prices show "—", and NO "temporarily unavailable" message. No diagnostic.
- `/Users/karstenhaldan/minisite/leanshot/src/lib/native/iap.ts:147-181,209-214`; chain in `PricingIOS.tsx:158,250,293,308-312`.
- **Fix:** (a) document in the RC-dashboard runbook that packages MUST use `$rc_monthly`/`$rc_annual`, and/or (b) fall back to scanning `current.availablePackages` by `productIdentifier` when `current.monthly`/`.annual` are null.

### INFO (polish — optional)

- **`purchaseSubscription` does a redundant double `getOfferings()` round-trip** (`iap.ts:197` wrapper + `:209` raw). RC caches offerings and the paywall warms it on mount, so this is an in-process cache hit on a cold tap path — micro-optimization. Fix: fetch `Purchases.getOfferings()` once, derive both validation + raw package.
- **`current_period_end` is NULL for active states when RC omits `expiration_at_ms`** (`index.ts:160-166`). Defensive-only — LeanShot's RC catalog is auto-renewable subscriptions, which always populate `expiration_at_ms`; lifetime comes from a separate CTE. Optional hardening: log an anomaly if a paid-state event arrives with null expiry.

---

## 4. ⏳ Operator-pending (cannot work live until done)

The CODE is correct and waits on these human/dashboard/store actions. None are code defects.

**RevenueCat dashboard & keys**
- [ ] Provision RC public SDK keys and set `VITE_RC_API_KEY_IOS` / `VITE_RC_API_KEY_ANDROID` (build env / GitHub Actions secrets — depends on fix **H1**). Empty today per `.env.example:139,143` (Phase-70-gated, expected).
- [ ] Create entitlement `plus` in the RC dashboard.
- [ ] Create an offering with packages `$rc_monthly` + `$rc_annual` (use the built-in identifiers — see **L4**) and mark it **current**.
- [ ] Attach both products (`app.leanshot.plus.monthly`, `app.leanshot.plus.yearly`) to the `plus` entitlement.

**App Store Connect (iOS)**
- [ ] Sign the Apple **Paid Apps agreement** + complete banking/tax (long lead time — gates launch).
- [ ] Create auto-renewable subscription products `app.leanshot.plus.monthly` + `.yearly` (group `plus`) with the 7-day intro offer.

**Google Play Console (Android)**
- [ ] Set up the Play **merchant account**.
- [ ] Create the equivalent Play subscriptions + base plans with matching product ids.

**Webhook secrets & registration (Supabase Function Secrets — server-only, NOT `VITE_`)**
- [ ] Set `REVENUECAT_WEBHOOK_AUTH` (REQUIRED — Bearer; absent → 401 on every delivery).
- [ ] Set `REVENUECAT_WEBHOOK_SECRET` (OPTIONAL HMAC; fail-soft when unset).
- [ ] Register the webhook URL `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook` in RC dashboard → Integrations → Webhooks (with the Bearer token).
- [ ] Deploy `revenuecat-webhook` to project `ytnsipxxmzgaebkqmokp` — it was NOT in the Phase 69.7 curated-subset deploy log (`fn-deploy.log` lists only 10 functions). `config.toml:408-409` already sets `verify_jwt=false`, so a normal `supabase functions deploy revenuecat-webhook` disables JWT verification correctly. Confirm `verify_jwt` disabled on the deployed function.

**Go-live UAT**
- [ ] Live RC test-event → `subscriptions` mirror UAT (per `SECRETS-RUNBOOK.md` Phase-70 checklist).
- [ ] Sandbox purchase + restore on a real device once keys/products land.

> Note: the discrete IAP-product / Paid-Apps / RC-dashboard line items are NOT currently enumerated in `APP-STORE-SETUP-PLAN-2026-05-31.md` (which covers app records + signing + CI only). Add them as explicit operator line items.

---

## 5. 🔀 Cross-platform (Stripe ↔ RC) risks

- **Double-charge is fully possible (H3, HIGH).** Neither the native paywall nor the `?upgrade=` handler checks existing entitlement before `purchaseSubscription`. A paying web-Stripe subscriber opening the native app can buy a second parallel RC subscription for the same `plus` entitlement. The web `UpgradeCTA` already guards this; the native path must too.
- **Manage-subscription mis-routing (H2, HIGH).** RC subscribers are sent to the Stripe portal, which has no record of them — broken self-service + App Store §3.1.1 anti-steering risk for the whole mobile cohort.
- **Divergent resolvers (M1, MEDIUM).** Cross-provider users (paid on BOTH web and mobile) produce >1 `subscriptions` row → `syncBillingTier`'s `.maybeSingle()` errors → store `tier` goes stale, while `tier_effective`-backed gates show pro. Conservative failure (keeps prior tier) but inconsistent.
- **TRANSFER no-op (M3 / the webhook's `index.ts:188-191`).** RC account-merge/reinstall TRANSFER events are not handled — the losing `app_user_id`'s row is never downgraded, and a restore that fires TRANSFER never writes a row, so the user can stay locked. (Also extend `RcEvent` with `transferred_from`/`_to` and downgrade those users.)
- **Mitigating facts:** `appUserID` is stable (same Supabase uid on web + native + webhook + view). `tier_effective` IS a correct unified OR across all providers. RC downgrade events resolve to `'free'` on both resolvers. RC keys are still empty, so no real two-provider user exists yet — these are pre-launch fixes, not active incidents.

---

## 6. Recommended next actions (ordered)

1. **Fix H1** — add `VITE_RC_API_KEY_*` `env:` injection to both build AND upload jobs in `mobile-ios.yml` + `mobile-android.yml`, and register the two GitHub Actions secrets. (Without this, every other RC effort is moot at submission.)
2. **Fix H2** — branch the manage-subscription flow on `provider` (Stripe portal only for `stripe`; App Store/Play management for `revenuecat`).
3. **Fix H3** — add an existing-entitlement guard before the native paywall + `?upgrade=` purchase, mirroring `UpgradeCTA`.
4. **Fix M1 + M2 together** — route store `tier`/`TierGate` and `syncBillingTier` through `tier_effective.has_active` (single source of truth); add cross-provider and Lifetime-only regression tests.
5. **Fix M3 + the TRANSFER no-op** — resync DB/entitlement after `restorePurchases()`; extend `RcEvent` and downgrade `transferred_from` users.
6. **Fix M4 + M5** — correct `vendor-secrets.md`: rename/move the RC client keys to build-time-public + mobile secrets, and add the REQUIRED `REVENUECAT_WEBHOOK_AUTH` row + allowlist entry.
7. **Add the optimistic post-purchase unlock** — read `result.customerInfo.entitlements.active['plus']` and `setTier('paid')` on purchase success so the UI doesn't depend solely on the webhook→Realtime round-trip (defense-in-depth; pairs with M3).
8. **Fix L1–L4** — `logOutRC()` on sign-out; coalesce concurrent `configureRC`; normalize webhook status vocabulary; harden package-id mapping + document `$rc_*` requirement.
9. **Hand off the §4 operator checklist** — and extend `APP-STORE-SETUP-PLAN-2026-05-31.md` with the discrete IAP-product / Paid-Apps / RC-dashboard / webhook-deploy line items.
10. **Optional polish** — collapse the double `getOfferings()`; add a null-expiry anomaly log.
