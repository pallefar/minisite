# RevenueCat Go-Live Runbook — LeanShot IAP

**Created:** 2026-05-31 · Owner: founder (operator steps) · Companion to `APP-STORE-SETUP-PLAN-2026-05-31.md` Phase E.

LeanShot uses **RevenueCat for mobile in-app purchases** (iOS + Android, via
`@revenuecat/purchases-capacitor`) and **Stripe for web** subscriptions. All RC
**code** is shipped and audited — see `REVENUECAT-READINESS-2026-05-31.md` (audit) and
**PR #12** (`fix/revenuecat-readiness`, 12 defects fixed). What remains is purely
operator provisioning. Until it's done the paywall is inert by design (graceful
degrade, not a crash).

## The contract the code already expects (do NOT rename)
| Thing | Value (hard-coded in the app) |
|---|---|
| Entitlement | **`plus`** |
| Products | **`app.leanshot.plus.monthly`**, **`app.leanshot.plus.yearly`** |
| Offering packages | **`$rc_monthly`**, **`$rc_annual`** (built-in RC identifiers; custom ids also work via the L4 fallback) |
| iOS bundle id | `app.leanshot.ios` |
| Android package | `app.leanshot.android` |
| RC `appUserID` | the Supabase `auth.users.id` (set by `configureRC()` / `Purchases.logIn`) |
| Webhook URL | `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook` |
| Entitlement source of truth | DB view `tier_effective.has_active` (unifies Stripe + RC + lifetime) |

## Sequence (all **[YOU]** — operator console / secrets)

### 1. RevenueCat dashboard
- Create an RC **project**.
- Add an **iOS app** with bundle id `app.leanshot.ios`, and an **Android app** with package `app.leanshot.android`.
- Copy each app's **Public SDK key** (the API key designed to ship in the client).

### 2. Inject the SDK keys into mobile CI  *(unblocks the paywall — defect H1)*
- GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:
  - `VITE_RC_API_KEY_IOS` = iOS public SDK key
  - `VITE_RC_API_KEY_ANDROID` = Android public SDK key
- These are build-time **client** vars (`import.meta.env.VITE_RC_API_KEY_*`), already wired into the `Build web assets` step of both jobs in `mobile-ios.yml` / `mobile-android.yml`. They are **NOT** Supabase Function Secrets and **NOT** Vercel env (the web build doesn't use RC).
- **Verify:** after the next mobile CI build, the paywall shows real prices on a device; an empty key would throw `RcConfigError` → "Purchases temporarily unavailable".

### 3. Entitlement + offering + products (RC dashboard)
- Create entitlement **`plus`**.
- Create an **offering**, mark it **current**, with two packages: **`$rc_monthly`** and **`$rc_annual`**.
- Attach products `app.leanshot.plus.monthly` + `app.leanshot.plus.yearly` to the `plus` entitlement.

### 4. App Store Connect (iOS) — longest lead time, start early
- Sign the **Paid Applications agreement** + complete banking/tax. (Gates launch; approval can take days.)
- Create two **auto-renewable subscriptions** in a subscription group `plus`, product ids `app.leanshot.plus.monthly` + `.yearly`, each with the **7-day free intro** offer.

### 5. Google Play (Android)
- Set up the Play **merchant account**.
- Create matching **subscriptions + base plans** with the same product ids.

### 6. Webhook secrets (Supabase Function Secrets — server-only, NOT `VITE_`)
```bash
supabase secrets set REVENUECAT_WEBHOOK_AUTH=<bearer-token>   --project-ref ytnsipxxmzgaebkqmokp   # REQUIRED — 401 on every delivery if unset
supabase secrets set REVENUECAT_WEBHOOK_SECRET=<hmac-secret>  --project-ref ytnsipxxmzgaebkqmokp   # optional HMAC (fail-soft)
```

### 7. Register + deploy the webhook
- RC dashboard → **Integrations → Webhooks** → add the URL `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook` with header `Authorization: Bearer <bearer-token>` (the same token as `REVENUECAT_WEBHOOK_AUTH`).
- Deploy the function (it was NOT in the Phase-69.7 curated deploy subset):
  ```bash
  supabase functions deploy revenuecat-webhook --project-ref ytnsipxxmzgaebkqmokp
  ```
  `config.toml` already sets `verify_jwt=false` so RC's unauthenticated POSTs reach the handler. Confirm `verify_jwt` is disabled on the deployed function.

### 8. UAT (real device, once 1–7 land)
- Sandbox **purchase** → tier unlocks within ~5s (Realtime listener) and `subscriptions` gets an RC row.
- **Restore Purchases** → re-grants `plus` and resyncs the DB tier (defect M3).
- Confirm a live RC **test event** mirrors into `subscriptions` (per `revenuecat-webhook/SECRETS-RUNBOOK.md`).

## Cross-platform notes (already handled in code)
- One unified "is pro?" lives in `tier_effective.has_active` (Stripe + RC + lifetime). `syncBillingTier` reads it (defects M1/M2).
- The native paywall + `?upgrade=` handler block a second purchase if the user already holds `plus` via any provider — **no double-charge** (defect H3).
- "Manage subscription" routes RC subscribers to App Store / Play, Stripe subscribers to the Stripe portal (defect H2). No web-purchase CTA on the iOS paywall (Apple §3.1.1).

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| Paywall shows "Purchases temporarily unavailable" / prices "—" | empty/missing SDK key in the bundle, or no current offering | Step 2 (keys) / Step 3 (offering marked current with `$rc_*` packages) |
| Webhook returns 401 on every event | `REVENUECAT_WEBHOOK_AUTH` unset or token mismatch | Step 6 + Step 7 (same Bearer token both places) |
| Purchase succeeds but tier never unlocks | webhook not deployed / not registered / `app_user_id` ≠ Supabase uid | Step 7; confirm client `configureRC(user.id)` |
| Subscribe button disabled with a valid offering | package ids not `$rc_monthly`/`$rc_annual` and product ids don't match | Step 3 (use built-in package ids, or rely on the product-id fallback) |
