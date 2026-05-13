# Pitfalls Research

**Domain:** Cross-platform health-adjacent SaaS adding mobile shells + watch + monetization + ads + page builder + affiliate (LeanShot v1.2)
**Researched:** 2026-05-13
**Confidence:** HIGH on App Store / Stripe / Health SDK / Safari ITP (verified against current official docs + industry reporting). MEDIUM on Capacitor + page-builder + bundle-budget specifics (verified against project precedents + community sources).

> **Audience:** This document feeds the v1.2 roadmap success-criteria and per-phase planner prompts. Every pitfall is mapped to a v1.2 workstream (1–11 from `PROJECT.md`) and includes a concrete check / config / test, not just "be careful."
>
> **Naming:** Workstreams are numbered to match `PROJECT.md` lines 13-25. References to existing v1.1 artifacts (`sync-defer.ts`, `assert-clinic-bundle-budget.sh`, etc.) point at code that already shipped — reuse over reinvent.

---

## Critical Pitfalls

### Pitfall 1: HealthKit data leaks into ad targeting (Apple §5.1.3 hard-reject)

**What goes wrong:**
HealthKit-derived data (weight, steps, HR, sleep, anything we import via the Health SDK workstream) flows into an analytics event, a PostHog property, an ad-network targeting key, an audience segment, a Stripe metadata field that an ad partner can see, or even a logged-in user-id used as an AdMob/AdSense `ppid`. Apple App Review fails the build with §5.1.3(i)(ii): "Apps may not use or disclose to third parties data gathered in the health, fitness, and medical research context — including from the HealthKit API — for advertising or other use-based data mining purposes." Re-review delays launch 1–2 weeks per round.

**Why it happens:**
v1.1 already pipes user-id and event metadata into PostHog. Without an architectural firewall, a well-meaning developer adding HealthKit auto-fill in Workstream 4 also fires `posthog.capture("weight_logged", { value })`. Ad SDKs in Workstream 9 read the same `distinctId`. A regression-style code change in Workstream 4 silently widens the ad-eligible event shape.

**How to avoid:**
1. Codify the "Health firewall" as a TypeScript module boundary: `src/lib/health/*` exports a `HealthSample` opaque type that **cannot** be imported anywhere under `src/lib/ads/*`, `src/lib/analytics/*`, `src/lib/affiliate/*`, or any Stripe metadata helper. Enforce via an eslint `no-restricted-imports` rule (project already uses `no-restricted-syntax` patterns in `eslint.config.js`).
2. Distinct PostHog project for ad-eligible events vs. health events (or use PostHog feature-flag `groups` with `process_for_ads: false` on health events). Audit the PostHog event taxonomy before launch.
3. Apple privacy-manifest (`PrivacyInfo.xcprivacy`) for the iOS shell declares HealthKit data category as "Not Linked to User, Not Used for Tracking." If the manifest says otherwise, App Review will fail even without code-level violations.
4. Add a CI test that greps the production bundle for HealthKit type names appearing within any ad-SDK or analytics-SDK chunk after Vite's tree-shaking.

**Warning signs:**
- Any PR touching `src/lib/health/` also touches `src/lib/analytics/` or `src/lib/ads/`.
- PostHog event property names contain `weight`, `steps`, `hr`, `sleep`, `bmi`.
- A reviewer asks "should we use HealthKit data to improve ad relevance?" — answer is always no, write it down.

**Phase to address:**
Workstream 4 (Health SDK) **owns the firewall implementation**. Workstream 9 (Advertising network) **owns the audit checklist** before App Review submission. Both must reference each other in their phase success criteria.

---

### Pitfall 2: Apple IAP commission ambush on the paid-tier subscription (Workstream 6 × Workstream 2)

**What goes wrong:**
LeanShot's paid tier unlocks features **consumed inside the app** (ad-free dashboard, full AI coach, etc.). Apple's guideline 3.1.1 requires IAP for digital content consumed in-app. If the iOS shell shows a "Subscribe" button that links to Stripe Checkout, Apple rejects under 3.1.3(b) anti-steering. Either: (a) ship IAP and forfeit 30%/15%, (b) hide the paywall in iOS entirely, or (c) use the post-Epic-ruling external-link entitlement (US only as of May 2025, EU under DMA with a different fee schedule).

**Why it happens:**
Most engineers assume "Stripe works everywhere" because v1.1 was web-only. Stripe themselves now explicitly distinguish "reader" apps from "purchases-consumed-in-app." The April 2025 Epic ruling and December 2025 appeals decision **allow** external payment links in the US, but Apple will likely respond with a different commission rate that is yet to be approved by the court. EU is governed separately by the DMA "communication & promotion of offers" entitlement (2% acquisition + 5–13% Store Services + 5% CTC by Jan 2026).

**How to avoid:**
1. **Decide the IAP/external-link split in CONTEXT.md before any mobile code ships.** Three viable strategies: (a) Web-only sign-up flow (user creates account + pays on web, downloads app, signs in); (b) IAP for iOS using StoreKit 2 via a Capacitor plugin like `revenuecat`; (c) External-link entitlement (US only) with required Apple-approved disclosure sheet. Picking (a) is the cheapest path and matches the project's web-first DNA.
2. If picking (a): the iOS app must not display pricing, "subscribe," "upgrade," or any monetary mention. Reader-app pattern. Apple still allows a "Sign in" button.
3. If picking (b): RevenueCat or a similar layer handles receipt validation, server-side entitlement, restore-purchases UX. Building this from scratch is a 3-week timesink.
4. Document the decision in `09-CONTEXT.md`-style architecture decision records so plan-checker can verify mobile plans don't accidentally include a paywall route.

**Warning signs:**
- Any mobile-app PR adds a `/pricing`, `/upgrade`, or `Stripe.checkout` reference.
- Capacitor build logs include `StoreKit` framework links that nobody planned.
- The iOS app's home screen shows a "Go Premium" badge or banner.

**Phase to address:**
Workstream 6 (Monetization) owns the policy decision. Workstream 2 (Mobile shells) owns enforcement (compile-time exclusion of paywall routes from the iOS bundle).

---

### Pitfall 3: Required in-app account deletion is missing or hidden (App Store guideline 5.1.1(v) auto-reject)

**What goes wrong:**
Since June 30, 2022, Apple requires apps that offer account creation to **also** offer in-app account deletion that initiates the deletion (not just a "contact support" email). Burying the option three levels deep or routing to a web page is rejected on submission. The deletion must cascade to all linked data and revoke the session immediately.

**Why it happens:**
v1.1's account deletion path doesn't exist as a self-service flow — onboarding has account creation but no deletion UI. Workstream 10 lists "in-app account deletion" but a developer might implement it as a deep-link to a web page, which Apple still treats as non-compliant.

**How to avoid:**
1. The delete flow must live at `Settings → Account → Delete account` reachable in ≤3 taps from any signed-in screen on iOS.
2. The button kicks off the deletion server-side (Supabase function), shows progress, and signs the user out on completion — not a `mailto:` or external URL.
3. Confirm with a typed-text challenge ("Type DELETE to confirm") **and** a 7-day soft-delete grace window (industry standard, reduces abuse + accidental loss).
4. **Cascade map** must be explicit and tested: Supabase `auth.users` cascade → `profiles`, `injections`, `weights`, `photos` (Storage bucket objects), `clinic_memberships`, Stripe customer + subscription + Connect account + payment intents, Resend audience subscriber list, ad-network user IDs, affiliate ledger (**anonymize, do not delete — tax retention**), PostHog `distinctId` reset.
5. Snapshot test: spawn a fresh test user, populate every table + Storage path + Stripe/Resend record, delete, then assert zero foreign-key orphans + zero residual `auth.users` row + zero Storage objects + Stripe customer in `deleted: true` state.

**Warning signs:**
- The deletion button is labeled "Request account deletion" (Apple flags this verbiage).
- Deletion requires email confirmation that takes hours.
- A test deletion still leaves rows in any of the cascade tables.

**Phase to address:**
Workstream 10 (Launch essentials) **owns the UX + cascade**. Workstream 5 (Owner/admin surface) **owns the affiliate-ledger anonymization** (tax retention requires keeping the record, just stripping PII). Workstream 6 (Monetization) **owns Stripe customer/subscription/Connect cascade**.

---

### Pitfall 4: Cookie consent fires PostHog / AdSense / Meta Pixel before user opt-in (GDPR €€€)

**What goes wrong:**
v1.1 already loads PostHog at app boot. Adding AdSense + Meta Pixel + ad-network UMP SDK in Workstream 9 means three more scripts that **must not** execute for EU users until granular consent is given (functional / analytics / marketing / personalization). One pre-consent fire = a GDPR violation. EU DPA fines have hit 7-figures for first-load Pixel fires.

**Why it happens:**
Most consent libraries (e.g. Osano, CookieYes, Cookiebot) provide a banner but only block tags **if** the integrator wires the gate correctly. PostHog's `loaded()` callback can be deferred via `opt_out_capturing_by_default: true` + `opt_in_capturing()` on consent. AdSense's `<script async>` insertion happens at HTML parse time unless deferred.

**How to avoid:**
1. **All third-party scripts must be loaded dynamically after consent** — no `<script>` tags in `index.html` except for fonts (which are first-party-loaded). Pattern: extend the existing `sync-defer.ts` idle-deferred-init wrapper to gate by consent category.
2. PostHog: `posthog.init(KEY, { opt_out_capturing_by_default: true, ... })`. Call `posthog.opt_in_capturing()` only on analytics-consent acceptance.
3. AdSense / AdMob web SDK / Meta Pixel: do not include in `index.html`. Inject via dynamic `import()` inside a `useEffect` gated by `consentStore.marketing === 'granted'`.
4. Geolocation default: assume EU = no consent until granted; US = analytics on by default (CCPA opt-out model), marketing requires opt-in.
5. CI test: bundle-analyze the initial chunk for any of the third-party script hostnames as static imports — fail the build.

**Warning signs:**
- DevTools Network tab shows requests to `googletagmanager.com`, `facebook.net`, `googleadservices.com` before the consent banner is clicked.
- Lighthouse "third-party usage" panel shows non-zero domains on first load for EU geo.
- The consent library's logs say "category granted" but the script was already running.

**Phase to address:**
Workstream 10 (Launch essentials) owns the consent layer + DSAR portal. Workstream 9 (Advertising network) owns the dynamic-load wiring. Both must reference the `sync-defer.ts` pattern.

---

### Pitfall 5: Bundle index ceiling breach when Stripe + AdSense + page-builder + push libs land in the same wave

**What goes wrong:**
v1.1 fought hard to keep `index.*.js` under 50 kB gz (currently held at 21.49 kB through Phase 6 close, per project memory). v1.2 adds Stripe Elements (~50 kB gz, often ~120 kB if not tree-shaken), AdSense / AdMob web glue (~30 kB), Resend/web-push libs (~15 kB), and a page-builder runtime (could be 100+ kB if a heavy editor like Craft.js or Builder.io's SDK is chosen). A naive static import in any of these regresses the index gz back over 50 kB and trips the `bundle-size` CI guard.

**Why it happens:**
The project's `sync-defer.ts` pattern is well-documented but only enforced by reviewer discipline. Plan-checker doesn't gate static-import additions to `App.tsx`/`main.tsx`/`store.ts`. A developer adding a Stripe pricing page imports `@stripe/stripe-js` at the route module's top level; even with lazy-route splitting, the SDK ends up in the route chunk but tree-shaking misses initialization globals that leak into the shared chunk.

**How to avoid:**
1. **Every new third-party SDK in v1.2 MUST route through `src/lib/sync-defer.ts` or an equivalent idle-deferred-init wrapper.** Direct static imports in `App.tsx` / `main.tsx` / `store.ts` are explicitly forbidden — this rule is already in project memory from Phase 6.
2. Extend the existing `scripts/assert-clinic-bundle-budget.sh` pattern to add per-chunk ceilings for: `stripe-elements`, `adsense-glue`, `page-builder-runtime`, `web-push`, `capacitor-bridge`. Each gets its own gz limit. Fix the hash-hyphen bug (`reference_bundle_budget_hash_hyphen.md`) before adding new chunks — content hashes containing `-` cause the script to report `wave-N skip` and silently un-enforce per-chunk ceilings. **The fix is scheduled but not shipped** — confirm in v1.2 Phase 0.
3. Index gz ceiling for v1.2 should hold at 25 kB gz (a stretch goal, given new realities). If we admit it has to go to 35 kB, write the new number into ROADMAP.md so plan-checker enforces it.
4. Choose the page-builder strategy before any UI work: (a) Server-rendered HTML stored in DB + minimal client hydration (lightest, ~5 kB runtime), (b) JSON tree + custom renderer (~20 kB), (c) Off-the-shelf editor SDK (Craft.js, GrapesJS, Builder.io — 100–300 kB editor + runtime). Recommend (a) or (b); (c) is a 6× bundle hit.
5. Stripe-elements: use `loadStripe` lazily with `import('@stripe/stripe-js')` inside the checkout component, not the module top.

**Warning signs:**
- `bundle-size` CI job goes red on a v1.2 PR.
- A `stripe-elements` or `adsense` chunk appears that isn't dynamic-imported.
- The shared/vendor chunk gz size jumps >2 kB on a single PR.
- Build log shows `assert-clinic-bundle-budget.sh: wave-N skip` (the hash-hyphen bug — investigate; treat as ceiling breach until fixed).

**Phase to address:**
Workstream 6 (Monetization) — Stripe deferred-load. Workstream 9 (Advertising network) — ad-SDK deferred-load. Workstream 7 (Page builder) — runtime sizing decision. Workstream 10 (Launch essentials) — push-lib deferred-load. v1.2 Phase 0 (bootstrap) — fix the hash-hyphen bug + add per-chunk ceilings for the new chunks.

---

### Pitfall 6: Safari ITP kills affiliate attribution after 7 days (or 1 day for link-decorated cookies)

**What goes wrong:**
Workstream 8's affiliate program ships with a referral-code cookie set by JavaScript on the landing page. Safari ITP 2.2+ caps JS-set first-party cookies at **24 hours** if the inbound URL has link decoration (query params from a cross-site source — exactly what `?ref=abc123` looks like). ITP 2.3 caps non-decorated JS-set cookies at 7 days. Result: 30-day affiliate cookies don't work on Safari (~25% of consumer web traffic). Affiliates accuse LeanShot of fraud; payouts dispute volume spikes.

**Why it happens:**
This is industry-known but constantly forgotten because Chrome/Edge work fine in dev. QA on Safari is the only way to catch it unless the engineer reads ITP release notes.

**How to avoid:**
1. **Server-side first-party cookie via `Set-Cookie` HTTP header.** The affiliate-click endpoint is a Vercel function (or Supabase Edge Function) that 302-redirects to the landing page while setting an `HttpOnly` first-party cookie with the configured TTL (e.g., 30 days). ITP does not cap server-set cookies.
2. The endpoint also writes the click to a Supabase `affiliate_clicks` table keyed by an anonymous `click_id` (UUID). Conversion later joins on the cookie value (which can also live as a localStorage entry as backup) and the click_id.
3. Use a first-party domain for the redirect (`leanshot.app/r/abc123` not `track.thirdparty.com/abc123`) — ITP treats third-party redirect chains as cross-site.
4. Optional belt-and-braces: server-to-server postback from Stripe's webhook to the affiliate ledger using the `client_reference_id` field on the Checkout Session (which propagates from the affiliate cookie into the Stripe session).
5. E2E test on Safari (Playwright `webkit` channel) that simulates a click + 8-day wait (via clock manipulation) + conversion — must still attribute.

**Warning signs:**
- Affiliate dashboards show much lower conversion on Safari than on Chrome (>2× delta = ITP, not luck).
- Affiliate disputes contain phrases like "I checked the cookie was there yesterday."
- The affiliate JS sets `document.cookie = "ref=..."` directly.

**Phase to address:**
Workstream 8 (Viral affiliate program) owns the server-side click-tracking endpoint and the Playwright/webkit test.

---

### Pitfall 7: Account-deletion cascade leaves Stripe Connect / affiliate-ledger orphans + tax compliance violation

**What goes wrong:**
A user with a connected Stripe Express account (because they're an affiliate) requests account deletion. Code path deletes `auth.users` row, cascades to `affiliates`, cascades to `affiliate_ledger`. **This is illegal.** Form 1099-NEC requires the platform to keep affiliate records for 4+ years for IRS reporting (and the affiliate is entitled to their issued 1099 even after deletion). Separately, the Stripe Connect account is orphaned (linked to a deleted email) — Stripe Express logins start failing, support tickets pile up.

**Why it happens:**
The intuitive `ON DELETE CASCADE` foreign-key rule from `affiliates(user_id) → auth.users(id)` is the obvious schema choice. Tax retention is a non-code concern most engineers never read about.

**How to avoid:**
1. **Affiliate ledger and the affiliate's tax-form records use `ON DELETE SET NULL` + anonymization columns** (`anonymized_name`, `anonymized_email_hash`). The original `auth.users.email` is replaced with a hash, but the payout history, 1099 totals, and W-9/W-8BEN records remain.
2. Stripe Connect account: API call to `stripe.accounts.del(account_id)` is part of the cascade — wraps the orphan problem. **Caveat**: Stripe will refuse to delete a Connect account with an open payout. Soft-delete the LeanShot side and queue the Stripe deletion when payouts settle.
3. DSAR (data subject access request) export must include the anonymized ledger entries with a note explaining tax retention.
4. Document this in `12-CONTEXT.md`-style ADR so plan-checker rejects naive `ON DELETE CASCADE` migrations for affiliate tables.
5. Snapshot test: delete a user who is also an affiliate, assert ledger row count decreases by 0, assert the email column is hashed, assert Stripe Connect deletion was enqueued.

**Warning signs:**
- A migration adds `affiliate_ledger.user_id REFERENCES auth.users(id) ON DELETE CASCADE`.
- The deletion test passes but a 1099 generation job a year later crashes on missing records.
- Stripe Express login fails for a deleted user's email (because the Stripe account wasn't deleted in sync).

**Phase to address:**
Workstream 6 (Monetization) owns Stripe cascade. Workstream 8 (Viral affiliate program) owns ledger retention/anonymization. Workstream 10 (Launch essentials) owns DSAR export composition.

---

### Pitfall 8: Capacitor WKWebView OOM crash when scrolling photo lists or comparing weight photos

**What goes wrong:**
v1.1 stores progress photos in Supabase Storage and displays them in a `PhotoCompareModal` + body-tab gallery. iOS Capacitor uses WKWebView, which has a hard memory ceiling (~3 GB for the entire app process, but WKWebView crashes earlier under pressure, ~1 GB sustained). Rendering ~30 high-resolution `<img>` tags simultaneously or decoding base64 thumbnails into memory cards causes `webViewWebContentProcessDidTerminate` — the user sees a blank screen with no error, the app reloads to home. App Review will catch this in normal usage and reject for stability.

**Why it happens:**
The web build works fine because desktop browsers have effectively unlimited memory. Capacitor inherits the web bundle 1:1, so any memory-naive image rendering hits the WKWebView limit only on mobile.

**How to avoid:**
1. **Server-side image transformation via Supabase Storage transforms** (`?width=400&quality=75`) — never download a full-res image into the gallery. The compare modal can opt-in to a "load full resolution" button.
2. **Virtualize the photo grid** with a windowing library (e.g., `react-virtuoso`, 8 kB gz). Only mount visible items.
3. Use the `loading="lazy"` + `decoding="async"` + `fetchpriority="low"` attributes on `<img>` for off-screen photos.
4. Drop the base64-in-Zustand legacy code path (project memory says photos moved to Supabase Storage in v1; if any old base64 paths remain, kill them).
5. Manual QA: Capacitor build on a physical iPhone (not simulator — simulator has no memory cap), scroll 50+ photos, observe app does not reload.

**Warning signs:**
- `console.log("webViewWebContentProcessDidTerminate")` (Capacitor logs this on the JS side via a plugin event).
- TestFlight crash reports cite `JavaScriptCore` or `WebKit` in the stack.
- Memory profiler in Xcode shows WKWebView climbing past 500 MB during photo browsing.

**Phase to address:**
Workstream 2 (Mobile shells) owns the gallery virtualization + Storage-transform usage as a launch-gate criterion. Add a physical-device QA checklist to the mobile-submission readiness review.

---

### Pitfall 9: HealthKit + Health Connect read-only import silently fails because permission strings or capability declarations are missing

**What goes wrong:**
iOS: omitting `NSHealthShareUsageDescription` (and `NSHealthUpdateUsageDescription` if writing) from `Info.plist` causes the app to crash on first HealthKit call with no user-facing error. The HealthKit entitlement also requires explicit provisioning-profile setup in App Store Connect; without it, the build fails during archive — usually 30 minutes before submission deadline. Android Health Connect: missing intent filters (`VIEW_PERMISSION_USAGE` action + `HEALTH_PERMISSIONS` category) in `AndroidManifest.xml` causes the permission dialog to never open, leaving the auto-fill toggle visually stuck in the "enable" state.

**Why it happens:**
Capacitor plugin docs cover the JS API but leave the native config to the integrator. The error mode is silent — no exception, no log — just no data.

**How to avoid:**
1. Pre-flight checklist for Workstream 4:
   - `ios/App/App/Info.plist` contains `NSHealthShareUsageDescription` with a user-facing justification ("LeanShot reads weight and steps to enrich your dashboard and pre-fill logs").
   - `NSHealthUpdateUsageDescription` if any write is planned (probably not in v1.2 read-only scope).
   - Apple Developer Portal: HealthKit capability enabled for the App ID; provisioning profile regenerated; downloaded; embedded in the Capacitor build.
   - `android/app/src/main/AndroidManifest.xml`: intent filter for `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` + `<category android:name="androidx.intent.category.HEALTH_PERMISSIONS"/>`.
   - Android: `targetSdkVersion ≥ 34` (Android 14) for native Health Connect; for Android <14, the standalone Health Connect APK must be installed by the user.
2. **Custom permission UI is rejected by Google Play** for Health Connect — the permission picker is platform-owned. Workstream 4's design must show LeanShot's *explainer* screen BEFORE launching the platform picker, not try to skin the picker.
3. Test on physical devices (HealthKit returns no data in the iOS simulator).
4. A "Connect Health" smoke test that exercises grant-flow + first-sync + revoke-and-reconnect.

**Warning signs:**
- "Why isn't my weight showing up?" support tickets after install.
- iOS TestFlight crash log mentions `HKHealthStore` or `requestAuthorization`.
- Android Play Console pre-launch report flags "Health Connect permission UI deviates from policy."

**Phase to address:**
Workstream 4 (Health SDK) owns native config + UI explainer + physical-device QA. Add to Workstream 2 (Mobile shells) submission checklist as a hard-gate item.

---

### Pitfall 10: PostHog / AdSense / Meta Pixel fire on the `/clinic/*` and `/share/*` surfaces (B2B trust violation + Apple §5.1.3 risk)

**What goes wrong:**
PROJECT.md explicitly states: **"no ads on clinic/doctor-share surfaces (B2B trust)."** Workstream 9's ad scripts get added to the SPA-wide `App.tsx` boot. Even with route-level conditionals, the AdSense script's `<script async>` tag in `index.html` (or a globally-mounted UMP consent SDK) executes on all routes including `/clinic/*` and `/share/*`. Clinic operators or doctors see a 200ms blink of an ad slot. Trust breach.

**Why it happens:**
Ad scripts are easier to globally include than per-route. Most ad-network docs assume site-wide deployment.

**How to avoid:**
1. **Route-gated ad injection**, not `index.html` inclusion. The ad-init module lives in a hook (`useAdsForRoute`) that imports the SDK dynamically only when the route is in `ALLOWED_AD_ROUTES = ['/marketing/*', '/dashboard/free-tier/*']`.
2. CSP-level enforcement: add `Content-Security-Policy-Report-Only` headers on `/clinic/*` and `/share/*` routes that forbid `googlesyndication.com`, `googleadservices.com`, `doubleclick.net`. Anything that violates triggers a report — surface in monitoring.
3. Playwright test: navigate to `/clinic/some-roster`, listen for any request to ad domains, fail if found. Run as part of `clinic-bundle-budget` style guard.
4. Visual regression test on `/share/*` to catch any ad slot reservation flash (CLS-style).

**Warning signs:**
- Network tab shows `pagead2.googlesyndication.com` requests on a `/clinic/*` URL.
- Clinic operator support ticket: "I saw a weight-loss ad on the patient roster page."
- Bundle analyzer shows ad SDK in the shared chunk (it should only be in the marketing/free-tier chunks).

**Phase to address:**
Workstream 9 (Advertising network) owns the route-gated injection. Workstream 10 (Launch essentials) owns the CSP report-only header. v1.2 Phase 0 owns the Playwright clinic-ad-free e2e gate.

---

### Pitfall 11: Page builder generates non-semantic HTML and ships ARIA/SEO regressions

**What goes wrong:**
Workstream 7's drag-and-drop builder generates `<div>`-only markup with inline styles. Marketing pages built with it score poorly on Lighthouse SEO + accessibility. JSON-LD is missing (the builder doesn't know what `Product`/`Article` schema applies). Heading hierarchy is wrong (designers drop H1s wherever, no H2/H3 logical order). Search rankings stay low; screen-reader users abandon. Apple/Google Play reviewers don't gate on this directly, but Google's spam-update can downrank an entire domain after enough auto-generated low-quality pages.

**Why it happens:**
Drag-and-drop UIs prioritize WYSIWYG over semantics. The DX of "every text block is a `<div>` with style" is much simpler than "is this a heading, paragraph, callout?" The builder's runtime is usually framework-agnostic so it can't tap React semantic primitives.

**How to avoid:**
1. **Block taxonomy = semantic taxonomy.** The builder offers `Heading 1/2/3`, `Paragraph`, `Quote`, `Image (with required alt)`, `Button (link or action)`, `Section` — not `Text` and `Box`. Each block renders to its semantic tag.
2. **Per-page SEO panel is mandatory before publish**: title (`<title>`), meta description, canonical URL, OG image, JSON-LD type picker (Article / Product / FAQPage / SoftwareApplication). Block publish if title or description is missing.
3. **Linting at save**: count `<h1>` per page (must be exactly 1); enforce heading order (no H3 without H2); reject images without alt text.
4. **Tailwind v4 compatibility check**: drag-drop libs like `react-dnd` work fine with Tailwind, but some (e.g., Builder.io's editor) inject their own CSS-reset that fights Tailwind's `@theme {}` tokens. Pick the lib first, verify with a Tailwind v4 dev-server before designing the builder.
5. Render the published page server-side (or pre-render at build) so Googlebot sees full content — SPA-rendered builder pages tank SEO.

**Warning signs:**
- Lighthouse "SEO" score drops below 90 on a builder-published page.
- Google Search Console shows "page has no description."
- A screen-reader user reports the page is unnavigable.

**Phase to address:**
Workstream 7 (Page builder + landing pages) owns block taxonomy + SEO panel + lint-at-save + render strategy.

---

### Pitfall 12: Affiliate fraud (self-referral, fake account farms, cookie stuffing) drains payout budget

**What goes wrong:**
Workstream 8 ships with a referral cookie + commission on first paid conversion. Bad actor signs up as an affiliate, uses their own referral link on disposable email accounts that subscribe (trial → cancel → refund cycle), pockets the commission. Or: high-volume affiliate stuffs the cookie via hidden iframes on unrelated sites, attributing organic conversions as theirs. By Q2 of v1.2, 30–60% of payouts are fraudulent.

**Why it happens:**
A naive implementation pays out on `subscription.created` instead of `subscription.paid` after the trial. Or it pays out on the first invoice but doesn't verify the chargeback hasn't been filed. Self-referral is trivial when there's no IP + device-fingerprint check.

**How to avoid:**
1. **Payout trigger = `invoice.paid` AND `now - referrer.signup_at > 14 days` AND `referrer.last_payout_chargeback_at IS NULL`.** Hold period (60–90 days) before payout to absorb chargebacks (Stripe chargeback window is 120 days).
2. **Self-referral detection**: at signup, compute a fingerprint hash of `(ip_subnet, browser_fingerprint, device_class, email_provider)` and compare against the referrer's hash. Same-match within ±30 days = automatic disqualification (silent; flag for review).
3. **Cookie-stuffing detection**: server-side click endpoint logs `referrer_url` (the page the click came from). Block / flag if `referrer_url` is empty (direct/iframe) and the click rate from that affiliate exceeds 10× the median.
4. **Tiered commission**: 1st tier = $10 flat per paid signup, 2nd tier (after $1000 in valid commissions) = 20% rev share. Forces a quality bar before lucrative payouts.
5. **Manual review queue for first payout** of any new affiliate. Owner/admin (Workstream 5) gets a notification, approves or rejects.

**Warning signs:**
- An affiliate's conversions all come from the same `/24` IP subnet.
- Conversion rate from one affiliate is >10× the cohort median.
- Chargeback rate from a single affiliate's cohort >5%.
- Affiliate's email domain matches the referred user's email domain.

**Phase to address:**
Workstream 8 (Viral affiliate program) owns fraud-detection rules + payout hold. Workstream 5 (Owner/admin surface) owns the review queue UI.

---

### Pitfall 13: Stripe Connect Express onboarding stalls because W-9/W-8BEN enforcement is misconfigured

**What goes wrong:**
The platform (LeanShot) is required by the IRS to issue 1099-NEC for any US affiliate earning ≥$600 in a calendar year. Without explicit W-9/W-8BEN collection enforced in Stripe Connect, the IRS rejects the 1099 batch in January for missing TINs. LeanShot eats penalties (~$280 per missing form) and the affiliate's 1099 generation fails. Stripe will also block payouts once an account hits the platform-configured TIN threshold.

**Why it happens:**
Stripe Connect defaults are lax — you can ship payouts without collecting W-9 if you don't set enforcement thresholds. Engineers see "it works" in test mode and move on. By December 31, the missing-TIN list is multi-page.

**How to avoid:**
1. **Set platform enforcement thresholds in the Stripe Dashboard**: block payouts after $500 USD processed OR 30 days from first payout, whichever comes first, until W-9 (US) or W-8BEN (non-US) is submitted.
2. The Stripe Connect Express onboarding link must include `requirements_collection: "currently_due"` and tax-form collection is gated by the country-of-residence answer.
3. Backend cron job: nightly, query `stripe.accounts.list({ requirements: { currently_due: ['individual.id_number', 'tos_acceptance'] } })` for any blocked accounts; surface in admin dashboard (Workstream 5).
4. Email reminder via Resend at +7 days, +14 days, +25 days from threshold breach.
5. Snapshot test: simulate an affiliate earning $501, assert payout is blocked, assert TIN-collection link is generated and emailed.

**Warning signs:**
- Stripe Dashboard "Affiliates with outstanding requirements" count >0 by Q3.
- January 1: Stripe support ticket "1099 generation failed for N accounts due to missing TIN."
- An affiliate complains "Stripe is asking me for tax info, what's going on?" — that's the system working but the in-app explainer is missing.

**Phase to address:**
Workstream 6 (Monetization — Stripe Connect setup). Workstream 8 (Affiliate program — UX for the W-9/W-8BEN flow). Workstream 5 (Owner/admin surface — outstanding-requirements dashboard).

---

### Pitfall 14: Apple privacy manifest (PrivacyInfo.xcprivacy) declarations don't match actual SDK behavior

**What goes wrong:**
Since May 2024, Apple requires `PrivacyInfo.xcprivacy` for any app and any included SDK that uses "required reason APIs" (UserDefaults, FileTimestamp, SystemBootTime, DiskSpace, ActiveKeyboards). Capacitor + AdMob + PostHog + Stripe SDKs all use at least one. If the manifest claims "no tracking" but the AdMob SDK actually fingerprints, App Review fails with a specific privacy-manifest mismatch flag.

**Why it happens:**
The manifest is a static XML/plist file that the developer hand-writes. Each SDK ships its own manifest. Some SDKs (especially older ad SDKs) ship outdated or wrong manifests.

**How to avoid:**
1. **Validate manifests at build time**: Apple provides Xcode's "App Privacy Report" command which compiles all SDK manifests into a single report. Run as part of Capacitor's `ios:build` and diff against the declared parent manifest.
2. Pin specific SDK versions known to have correct manifests:
   - AdMob iOS SDK ≥11.0
   - Stripe iOS SDK ≥23.0
   - PostHog iOS ≥3.0 (if a native plugin is used; otherwise PostHog runs in JS only and doesn't need a native manifest)
3. App Tracking Transparency (ATT) prompt is required if any SDK declares tracking. AdMob requests IDFA — must show the ATT prompt before AdMob initialization or the SDK returns no-fill. Tie ATT prompt to the consent flow in Workstream 10.
4. The parent `PrivacyInfo.xcprivacy` must declare data categories collected (e.g., "Email Address — App Functionality"); a checklist tracks each Workstream's contribution.

**Warning signs:**
- Xcode Organizer's "App Privacy Report" shows a category not declared in the manifest.
- App Review rejection cites "Privacy Manifest" in the resolution center.
- AdMob fill rate is suspiciously 0% on iOS post-install (ATT prompt missing).

**Phase to address:**
Workstream 2 (Mobile shells) owns the parent manifest. Workstream 9 (Advertising network) owns the ATT prompt timing. Workstream 4 (Health SDK) declares health data category. Workstream 6 (Monetization) declares purchase-history category.

---

### Pitfall 15: GDPR DSAR export is incomplete (forgets Storage / Stripe / Resend / ad-network / PostHog)

**What goes wrong:**
A user files a Data Subject Access Request. The export endpoint returns a JSON of their `injections`, `weights`, etc. — but misses: Supabase Storage photo URLs + signed-url metadata; Stripe customer/subscription/invoice records; Resend audience subscriber entries + email-send history; PostHog event log; ad-network click/conversion log if affiliate; affiliate ledger entries. EU Data Protection Authority audit finds the gap → fines + mandatory remediation timeline.

**Why it happens:**
DSAR is an integration concern, not a single-table query. As features get added in v1.2 (Workstreams 6, 8, 9), each one creates a new PII surface that the DSAR endpoint must learn about. Plan-checker doesn't natively gate "does this feature update the DSAR export?"

**How to avoid:**
1. **DSAR-export contract test**: a Vitest snapshot test that lists every table + bucket + third-party with PII. When a v1.2 plan adds a new table/bucket/integration, the test fails until the export module is updated.
2. **Per-workstream DSAR checklist**: every workstream's "definition of done" includes "DSAR export updated + tested" — make it a CLAUDE.md project rule for v1.2.
3. **30-day clock starts from request receipt**, not acknowledgment. Use Resend confirmation emails timestamped to set the clock; surface to admins via Workstream 5.
4. Stripe portion: `stripe.customers.list({ email })` + `stripe.charges.list({ customer })` + `stripe.subscriptions.list({ customer })`. Resend portion: list contacts, list emails sent. PostHog portion: GDPR delete API + event export by `distinctId`.
5. Format: machine-readable JSON + a human-readable PDF (use the existing jsPDF dynamic-import pattern from Phase 7).

**Warning signs:**
- A new feature lands without touching `src/lib/dsar/export.ts`.
- A user's DSAR export is <100 KB despite heavy use (something's missing).
- DPA audit finds a discrepancy between LeanShot's PII inventory and what the DSAR export returns.

**Phase to address:**
Workstream 10 (Launch essentials) owns the DSAR portal. Every workstream that creates new PII surfaces (6, 8, 9) updates the DSAR export module as part of its acceptance criteria.

---

## Moderate Pitfalls

### Pitfall 16: Web Push doesn't work on iOS Safari without PWA install + iOS 16.4+

**What goes wrong:**
Workstream 10's Web Push implementation works on Chrome/Firefox/desktop Safari, fails silently on iOS. Apple gates web-push to PWA-installed-to-home-screen + iOS ≥16.4. Most users haven't installed the PWA.

**How to avoid:**
On iOS: detect `standalone` mode + iOS version; if not eligible, fall back to APNs via the Capacitor native shell (Workstream 2). The "Enable notifications" UI must check capability before prompting, otherwise the prompt never shows and users blame LeanShot.

**Phase:** Workstream 10 + Workstream 2 (notification routing layer).

---

### Pitfall 17: AdMob banner refresh races HealthKit fetch on app open (cold-start jank)

**What goes wrong:**
AdMob web/native SDK initialization runs eagerly on app open. HealthKit auto-sync also runs on app open. Both want main-thread time. App feels frozen for 2-3 seconds.

**How to avoid:**
Defer AdMob init by `requestIdleCallback` or `setTimeout(0)` after the first paint. HealthKit fetch goes into a Web Worker (Workstream 4 should evaluate; current architecture is main-thread only, may justify a `worker` exception). First-contentful-paint should not include any ad slot.

**Phase:** Workstream 9 + Workstream 4 coordination.

---

### Pitfall 18: Resend deliverability tanks because domain isn't verified or DKIM/SPF/DMARC are wrong

**What goes wrong:**
v1.1 carries over an unverified Resend domain (per project memory). Lifecycle emails (welcome / receipts / password reset) land in Gmail spam. Affiliates think the program is broken.

**How to avoid:**
Verify the domain in Resend dashboard (DNS records: SPF + DKIM + DMARC). Use the `curl https://api.resend.com/domains -H "Authorization: Bearer $KEY"` check pattern from project memory (`reference_resend_phase9_wiring.md`). Set `RESEND_FROM` to the verified domain (not `noreply@app.leanshot.app` which the memory flagged as unverified).

**Phase:** Workstream 10 + carry-over from v1.1 tech debt.

---

### Pitfall 19: Capacitor deep-links (Universal Links / App Links) require host-side AASA file and Digital Asset Links JSON

**What goes wrong:**
Sharing a doctor-share link `https://leanshot.app/share/abc` on iOS doesn't open the app — opens Safari. The native shell looks installed but deep-links route to the browser.

**How to avoid:**
Host `https://leanshot.app/.well-known/apple-app-site-association` (AASA, JSON, no extension, served as `application/json`, HTTPS, no redirects) and `https://leanshot.app/.well-known/assetlinks.json` (Android). Both must declare the share-route patterns. Capacitor's `App` plugin handles the runtime listener — the native side requires entitlements (`Associated Domains` capability in Apple Developer Portal).

**Phase:** Workstream 2 (Mobile shells) + Workstream 7 (Page builder — ensure marketing site hosts the well-known files in its Vercel config).

---

### Pitfall 20: PostHog client-side initialization spikes the bundle when the autocapture + session-replay flags are on

**What goes wrong:**
PostHog's `posthog-js` is small (~25 kB gz) but autocapture + session-replay can grow it to 80+ kB gz when those features are enabled. Workstream 10's analytics revamp turns on session-replay for "growth experiments" and the bundle ceiling breaks.

**How to avoid:**
Use `posthog-js/lite` (no replay) for the main bundle. Lazy-load `posthog-js` only on routes where session-replay is needed (rare). Configure with `capture_pageview: 'history_change'` to avoid replay overhead on SPA navigation.

**Phase:** Workstream 10. Cross-reference with Pitfall 5 (bundle budget).

---

### Pitfall 21: Stripe Checkout vs. Elements decision is reversed mid-implementation

**What goes wrong:**
Stripe Elements gives a customizable in-app form but requires PCI-scope SAQ-A-EP attestation (light, but more than zero) and adds ~50 kB gz to the bundle. Stripe Checkout is a hosted redirect (zero PCI scope, near-zero bundle cost) but reduces brand consistency. Picking Elements first, then trying to switch to Checkout, wastes a week.

**How to avoid:**
Lock the decision in `06-CONTEXT.md` (or wherever Workstream 6 plans). Recommendation: Stripe Checkout for subscription start, Stripe Customer Portal for subscription management (zero in-app payment UI = simplest compliance + lightest bundle). Elements only if a critical UX requirement is identified.

**Phase:** Workstream 6 (Monetization).

---

### Pitfall 22: Watch app data sync uses HealthKit shared store but assumes phone-side is reachable

**What goes wrong:**
Workstream 3's Apple Watch app reads "next dose" from the phone via WatchConnectivity. When the phone is dead/out-of-range, the watch shows stale data with no indication.

**How to avoid:**
The watch app caches the last-known dose + streak locally (WatchKit complications + `WKExtendedRuntimeSession`). Show a small "Last synced 2h ago" badge when phone unreachable >15 min. Don't try to fetch from the cloud directly from the watch (battery + complexity).

**Phase:** Workstream 3 (Watch apps).

---

### Pitfall 23: Tailwind v4 beta + page-builder drag-drop libs conflict on CSS-reset

**What goes wrong:**
Tailwind v4's CSS-first `@theme` system relies on cascade layers (`@layer base/components/utilities`). Some drag-drop libs (GrapesJS in particular) inject their own `<style>` tags at runtime that win the cascade and break the builder's preview vs production rendering.

**How to avoid:**
Pick the page-builder approach (custom JSON renderer recommended in Pitfall 5) that doesn't ship its own CSS. Or, if using a lib, validate Tailwind v4 compatibility in a 1-day spike before committing.

**Phase:** Workstream 7 (Page builder).

---

### Pitfall 24: Account merging breaks when a user signs up to clinic-invite while already a B2C subscriber

**What goes wrong:**
Existing v1.1 user (with personal subscription) accepts a clinic invite. Code creates a new clinic-scoped membership without checking for conflict with their personal `billing_customer_id`. Stripe sees two subscriptions for one email. Charged twice.

**How to avoid:**
Workstream 5 (admin surface) + Workstream 6 (monetization) coordinate: clinic invites detect existing `billing_customer_id`; the invite acceptance flow asks "do you want to keep your personal sub, or switch to clinic-paid?" and prorates accordingly.

**Phase:** Workstream 6 + Workstream 5.

---

### Pitfall 25: Push notification tokens expire / rotate and the server keeps sending to dead tokens

**What goes wrong:**
APNs / FCM rotate tokens silently when user reinstalls, restores device, etc. Old tokens fail-to-send and the failure isn't surfaced. Workstream 10's lifecycle emails (Resend) and push notifications drift apart.

**How to avoid:**
APNs `BadDeviceToken` and FCM `UNREGISTERED` responses must trigger a token-cleanup in the `push_tokens` table. Daily cron prunes tokens older than 60 days with no successful send. Don't store a token without an `updated_at`.

**Phase:** Workstream 10 (Launch essentials).

---

## Minor Pitfalls

### Pitfall 26: ASO assets (screenshots, app icons, splash screens) don't match Apple/Google's exact pixel specs

Pixel spec lists from Apple/Google change with new device announcements. Use Figma plugins (e.g., "App Store Screenshot Generator") that regenerate from a single design source. **Phase:** Workstream 2.

### Pitfall 27: AdSense child-directed content flag misconfigured

If the AdSense unit is marked "child-directed" by mistake, eCPM drops to ~$0.10. Confirm at unit creation. **Phase:** Workstream 9.

### Pitfall 28: Cookie banner blocks first impression / fires Lighthouse CLS penalty

Avoid full-screen modal banners. Use a bottom-of-viewport bar with `position: fixed`. Measure CLS contribution; should be 0. **Phase:** Workstream 10.

### Pitfall 29: app-ads.txt + ads.txt mismatches lose ad inventory

Publishers must serve `/ads.txt` (web) and `/app-ads.txt` (mobile) listing authorized sellers. Mismatch with AdMob/AdSense settings = inventory rejected. **Phase:** Workstream 9.

### Pitfall 30: Geist + Geist Mono + Fraunces font payload is heavy if not subset

Three font families × multiple weights = 200+ kB easily. Self-host via `next/font`-style subset to Latin + variable axes; preload with `<link rel="preload">`. **Phase:** Workstream 1 (Design system rollout).

### Pitfall 31: `s.user!` non-null assertions land in mobile shell code path without runtime check

v1.1 audit flagged 15 occurrences / 14 files. Mobile shells extend new code paths that may inherit the assumption. Lift to a runtime narrow before the mobile build adds more. **Phase:** Workstream 11 (v1.1 tech debt sweep).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip W-9/W-8BEN enforcement thresholds in Stripe Connect | Faster affiliate onboarding | January 1099 disaster, IRS penalties, blocked Stripe payouts | **Never** |
| Render page-builder pages client-side only (SPA) | Faster builder development | Tanks SEO; marketing pages don't rank | Only for previews, never published pages |
| Static `<script>` tags for AdSense / Meta Pixel in `index.html` | One-line install | EU cookie-consent violations + Workstream 10's Pitfall 10 (clinic surface contamination) | **Never** |
| Capacitor live-reload pointing at prod URL during dev | Real-data testing | Live-reload bypasses CSP / cookie-domain logic and ships bugs to prod | Only on private dev branches, never CI |
| WebView2 / Capacitor without `webViewWebContentProcessDidTerminate` handler | Faster iOS shell ship | Silent reload-to-home on memory pressure = App Review reject | **Never** for v1.2 launch |
| Storing affiliate referral cookie via `document.cookie` (JS) | Trivial implementation | Safari ITP caps at 1-7 days; lost commissions; affiliate disputes | **Never** for production; OK in dev for unit tests |
| Hand-writing PrivacyInfo.xcprivacy | Quick first build | Drifts as SDKs update; App Review reject on mismatch | Only with the build-time diff check from Pitfall 14 |
| Apple watch app pulls from cloud directly | Simpler architecture | Battery drain + WatchConnectivity bypass = poor UX | **Never** — use phone as proxy |
| Single Zustand store extended for billing + ads + affiliate state | Consistency with v1.1 | Persisted state hits localStorage quota; un-tree-shakeable bundle | Until Workstream 1 ships; then split into feature stores |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Stripe Connect Express | Treating `account.payouts_enabled` as the only readiness flag | Also check `requirements.currently_due`, `requirements.disabled_reason`, and TIN-collection status |
| Stripe Checkout | Hard-coding success/cancel URLs to localhost in `.env.local` | Always derive from `import.meta.env.VITE_APP_URL`; use Stripe's `client_reference_id` to pass the affiliate cookie value through |
| AdMob (iOS) | Initializing before ATT prompt → 0% fill rate | Show ATT prompt on first launch; gate AdMob init on `ATTrackingManager.trackingAuthorizationStatus == .authorized` (otherwise non-personalized) |
| AdMob (Android) | Forgetting child-directed (COPPA) + GDPR consent params | Pass `requestNonPersonalizedAdsOnly: true` for EU users without marketing consent |
| Google Ad Manager (web) | Using auto-refresh too aggressively | Min 30s refresh interval; pause refresh when tab backgrounded (use `Page Visibility API`) |
| Meta Audience Network | Single-app SDK conflicting with Capacitor's network layer | Pin SDK version; test crash-rate post-install |
| HealthKit | Reading `HKQuantityType.bodyMass` once and assuming it's complete | Use `HKAnchoredObjectQuery` for incremental sync; HealthKit doesn't return historical data without explicit query |
| Health Connect | Trying to skin the platform permission picker | Picker UI is platform-owned; build a *pre-picker* explainer screen |
| Resend | Sending from an unverified domain | Always verify domain DNS; use `RESEND_FROM` env var, not hard-coded |
| Capacitor (iOS) | Using `localStorage` for large data (>5MB) | Persist to native `FilesystemPlugin` or Supabase Storage; localStorage is best-effort on iOS |
| Web Push (Safari) | Assuming all browsers behave the same | iOS Safari requires PWA-install + ≥16.4; surface the requirement in UI |
| Universal Links (iOS) | AASA file served with wrong Content-Type or via redirect | Must be `application/json`, served from HTTPS, no redirects, on the apex domain |
| Vercel — clinic/share routing | Forgetting `vercel.json` path rewrites for `/clinic/*` | Carry the pattern from v1.1 Phase 9 (`project_phase8_phase9_planning_complete.md`) |
| Supabase Storage | Storing raw images, no transforms | Use `?width=...&quality=...` URL transforms for all gallery views; full-res only on explicit request |
| Supabase RLS (clinic crossover) | Mutual-org leakage when an affiliate is also a clinic operator | Cross-tenant impersonation proof test per project rule (project memory: every RLS surface needs a live impersonation test) |
| PostHog | Sending events before consent | `opt_out_capturing_by_default: true` in init; `opt_in_capturing()` on consent |
| jsPDF (DSAR export) | Static import balloons bundle | Dynamic-import per Phase 7 pattern (`reference_phase7_research_findings.md`) |
| `pgsodium` for encryption | Trying to use it on free-tier Supabase | Deprecated on free tier (project memory); use app-layer encryption via Web Crypto if needed |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Bundle index regression from new SDKs | `bundle-size` CI red; LCP slows on landing page | `sync-defer.ts` for every new SDK; per-chunk ceilings in `assert-clinic-bundle-budget.sh` | First add of Stripe / AdMob / page-builder |
| WKWebView OOM on photo gallery | Mobile app reloads silently mid-scroll | Storage transforms + virtualization (Pitfall 8) | ~30 photos rendered simultaneously |
| AdMob auto-refresh on tab background | Battery drain + wasted impressions | Pause refresh on `visibilitychange === 'hidden'` | Always when no Page Visibility handler |
| PostHog autocapture firing on every tab switch | Event volume × bundle weight × event quota | Disable autocapture; manual events only | Dashboards with frequent tab interactions |
| Resend bulk send hitting rate limit | Lifecycle emails delayed; password resets stuck | Use Resend `batch` API; queue with a worker | >100 sends/min |
| Page-builder save → re-render full DOM | Editor jank with 50+ blocks | Memoize blocks by ID + diff-based updates | Page hits ~50 blocks |
| Stripe webhook handler doing sync work | Webhook timeouts → Stripe retries → duplicate processing | Idempotency keys + async queue (Supabase function returns 200 immediately) | First webhook with non-trivial work |
| AdMob banner refresh racing main thread | Cold-start jank, scroll stutter | Defer init via `requestIdleCallback` | Always on cold start |
| Affiliate ledger growth without partitioning | Slow admin queries | Partition by `created_at` month; index on `affiliate_id, created_at` | ~100k click rows |
| Health Connect background sync waking the app | Battery drain on Android | Use `WorkManager` with constraint `requiresBatteryNotLow` | Frequent (>1/hour) syncs |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| HealthKit data → ad targeting | App Store rejection (§5.1.3) + GDPR-style sensitive-data violation | TypeScript firewall (Pitfall 1); eslint `no-restricted-imports`; CI bundle grep |
| Stripe webhook endpoint without signature verification | Anyone can POST fake subscription events → fake entitlements | `stripe.webhooks.constructEvent` with the signing secret; reject if missing |
| Anthropic key in localStorage exposed to ad scripts | Ad scripts could exfiltrate the BYO key | Move to a Supabase Edge Function proxy (or at minimum, scope localStorage reads to first-party origin only — already the default but verify CSP) |
| Cross-tenant data leak via clinic operator who also has B2C account | Operator sees their own personal sensitive data alongside a patient's | Cross-tenant impersonation proof test per project rule |
| RLS not enforced on `affiliate_clicks` / `affiliate_ledger` | Affiliate sees another affiliate's commission data | RLS policy: `affiliate_id = auth.jwt() -> 'affiliate_id'` |
| AdSense pre-bid exposure of user-id | Ad networks can fingerprint via PPID | Hash `auth.users.id` with a per-network salt before sending as PPID; rotate the salt quarterly |
| Affiliate referral link URL injection (XSS via `?ref=<script>`) | Stored XSS in admin dashboard | Sanitize referral codes server-side; allow only `[a-zA-Z0-9_-]{4,32}` |
| Stripe Customer Portal session URL leaking via Referer header | Account takeover | Always use POST with redirect, not GET; CSP `referrer-policy: same-origin` |
| Sensitive Stripe metadata (subscription IDs) exposed in PostHog events | PII spread across tools | Whitelist event properties; never send raw IDs |
| Watch app communicates with phone over insecure channel | Watch could be spoofed | Use `WCSessionDelegate` with built-in encryption; don't roll your own |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Ad slot loads slowly → CLS pushes content down | Frustration, accidental ad clicks | Reserve fixed-height ad container `min-height: 250px` (or whatever the slot is); skeleton state |
| Cookie banner takes >2 clicks to reject all | EU users abandon | Equal-prominence "Accept all" + "Reject all" + "Customize" (also a legal requirement in most EU jurisdictions) |
| Stripe Checkout doesn't return user to expected route | Confusion + double-purchase attempts | Use `success_url` with `{CHECKOUT_SESSION_ID}` placeholder; verify session server-side on return |
| Account deletion gives no progress feedback | User clicks again, opens support ticket | Show progress steps ("Removing photos... Canceling subscription... Done"); send confirmation email |
| Watch app shows stale data with no timestamp | User trusts stale info, miscounts streak | "Last synced 2h ago" badge; refresh on tap |
| Page-builder preview drifts from production | Designer publishes broken page | Identical render pipeline for preview + prod (same renderer, same CSS, same fonts) |
| Affiliate dashboard shows commissions before they're confirmed | Affiliate sees "$200 earned" then $50 disappears after refund | Two columns: "Pending" + "Confirmed"; only "Confirmed" is payable |
| Onboarding asks for HealthKit + camera + notifications + ATT all at once | Permission fatigue → user denies all | Sequential, just-in-time prompts tied to feature use |
| AdSense / Meta Pixel showing inappropriate ads (weight-loss scam, etc.) | Brand damage, especially for health-adjacent audience | Default-block category list (competing GLP-1 brands, weight-loss-scam terms); LeanShot per-placement filter |
| Push notification prompt on app open | Users deny → no future opportunity | Trigger after positive interaction (logged 3 doses, etc.); explain value before prompting |

---

## "Looks Done But Isn't" Checklist

- [ ] **Account deletion:** Often missing — Stripe Connect account isn't deleted in cascade; verify `stripe.accounts.del(account_id)` runs and queue-retries on transient failures
- [ ] **Account deletion:** Often missing — Resend audience subscriber isn't removed; verify Resend Contacts API call
- [ ] **Account deletion:** Often missing — Supabase Storage photo objects orphaned; verify bucket-level recursive delete
- [ ] **Account deletion:** Often missing — Affiliate ledger anonymization (NOT deletion) for tax retention; verify `email_hash` replaces `email` and PII columns are nulled
- [ ] **DSAR export:** Often missing — Stripe records (invoices, charges, subscription history); verify `stripe.invoices.list({ customer })`
- [ ] **DSAR export:** Often missing — PostHog event log; verify GDPR delete API + event export
- [ ] **DSAR export:** Often missing — Ad-network click/conversion log entries
- [ ] **DSAR export:** Often missing — Resend email-send history per recipient
- [ ] **Apple submission:** Often missing — `NSHealthShareUsageDescription` in Info.plist; verify via Xcode build settings
- [ ] **Apple submission:** Often missing — PrivacyInfo.xcprivacy declaration; verify Xcode "App Privacy Report" matches
- [ ] **Apple submission:** Often missing — In-app account deletion ≤3 taps from any screen; verify with App Review test account
- [ ] **Apple submission:** Often missing — App Tracking Transparency prompt fires before AdMob init; verify with `ATTrackingManager.trackingAuthorizationStatus`
- [ ] **Apple submission:** Often missing — App-Ads.txt at marketing apex domain; verify `curl https://leanshot.app/app-ads.txt`
- [ ] **Google Play submission:** Often missing — Health Connect intent filters in AndroidManifest.xml; verify Play Console pre-launch report
- [ ] **Google Play submission:** Often missing — Ad ID consent flow (UMP SDK) for EU users; verify with EU VPN test
- [ ] **Stripe Connect launch:** Often missing — W-9/W-8BEN enforcement threshold in Dashboard; verify with test affiliate that hits the threshold
- [ ] **Stripe Connect launch:** Often missing — Idempotency keys on webhook handlers; verify with replay of same event ID
- [ ] **Affiliate program launch:** Often missing — Server-side click endpoint (not JS cookie); verify Safari test ≥7 days post-click
- [ ] **Affiliate program launch:** Often missing — Self-referral detection; verify with same-IP / same-fingerprint test
- [ ] **Cookie consent launch:** Often missing — PostHog/AdSense/Pixel deferred until consent; verify DevTools Network on EU geo
- [ ] **Cookie consent launch:** Often missing — Equal-prominence reject-all button; verify with French/German DPA spec
- [ ] **Page builder launch:** Often missing — Per-page SEO meta + JSON-LD; verify with Google Rich Results Test
- [ ] **Page builder launch:** Often missing — Server-rendered output for SEO; verify with `curl -A Googlebot` → see content
- [ ] **Web Push launch:** Often missing — iOS PWA-install + 16.4+ gating; verify on actual iOS device
- [ ] **Universal Links:** Often missing — AASA file served with correct content-type; verify with `curl -I https://leanshot.app/.well-known/apple-app-site-association`
- [ ] **Clinic/share ads-free invariant:** Often missing — CSP report-only headers + Playwright e2e on `/clinic/*` and `/share/*`; verify zero ad-domain requests
- [ ] **Bundle ceiling:** Often missing — Per-chunk budgets for new SDKs; verify `assert-clinic-bundle-budget.sh` runs without `wave-N skip` (hash-hyphen bug)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| HealthKit data leaked to ads (Pitfall 1) | **HIGH** | (1) Pull from App Store immediately; (2) audit all events for last 90 days; (3) PostHog GDPR-delete event batch; (4) consult counsel re: §5.1.3 incident disclosure; (5) re-architect firewall + re-submit; expect 2-3 week delay |
| App Store reject for missing deletion (Pitfall 3) | LOW | Add the flow; resubmit; ~1-week re-review |
| Cookie consent fires pre-opt-in (Pitfall 4) | MEDIUM–HIGH | (1) Hot-fix CSP to block; (2) audit DPA exposure; (3) document timeline for any audit; (4) re-architect with `sync-defer.ts` gating |
| Bundle ceiling breach (Pitfall 5) | LOW | Revert offending PR; refactor to dynamic import; re-PR. Set as plan-checker rule going forward |
| Safari ITP killing affiliate (Pitfall 6) | MEDIUM | Ship server-side endpoint; backfill attribution for past 30 days via best-effort (may not be possible — communicate to affiliates) |
| Affiliate ledger orphaned by deletion cascade (Pitfall 7) | **HIGH** | (1) Restore from PITR backup if within window; (2) reconcile with Stripe records; (3) issue manual 1099s for lost data; (4) re-architect cascade |
| WKWebView OOM crash (Pitfall 8) | LOW | Add virtualization + storage transforms; ship as patch release |
| HealthKit/Health Connect silent fail (Pitfall 9) | LOW | Add missing config; ship patch. Apple/Google won't reject for this; only users notice |
| Ads on clinic surface (Pitfall 10) | MEDIUM (trust) | Hot-fix route gating; reach out to affected clinic operators with explanation; offer trial extension or comp |
| Page-builder SEO regression (Pitfall 11) | MEDIUM | Audit existing pages; fix block taxonomy; republish all; allow 4-8 weeks for search re-ranking |
| Affiliate fraud at scale (Pitfall 12) | MEDIUM–HIGH | (1) Pause payouts; (2) audit + claw back fraudulent commissions; (3) deploy fraud rules; (4) communicate to legit affiliates re: delay |
| Stripe Connect W-9 misconfig (Pitfall 13) | MEDIUM | Catch in November (before Jan 1); collect missing forms via bulk-email push; manual 1099 backfill if needed |
| PrivacyInfo manifest mismatch (Pitfall 14) | LOW | Update manifest; resubmit; ~1-week re-review |
| Incomplete DSAR export (Pitfall 15) | MEDIUM (DPA-dependent) | Per-request, supplement manually; ship the missing integration ASAP; document remediation timeline if audited |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase / Workstream | Verification |
|---------|-------------------------------|--------------|
| 1. HealthKit → ads firewall | Workstream 4 (impl) + Workstream 9 (audit) | TS lint rule passes; CI bundle-grep for HealthKit type names in ad chunks |
| 2. Apple IAP commission ambush | Workstream 6 (policy) + Workstream 2 (enforcement) | iOS build excludes `/pricing` route; ADR in CONTEXT.md; App Review pass |
| 3. In-app deletion required | Workstream 10 (UX) + Workstream 5/6 (cascade) | Snapshot test: zero orphans post-deletion; App Review test-account flow |
| 4. Cookie consent pre-fire | Workstream 10 (consent) + Workstream 9 (gating) | DevTools Network EU test; CI bundle-import audit |
| 5. Bundle ceiling | v1.2 Phase 0 (chunk budgets) + Workstreams 6/7/9/10 | `assert-clinic-bundle-budget.sh` green; index <25 kB gz target |
| 6. Safari ITP affiliate | Workstream 8 (server-side click endpoint) | Playwright webkit e2e with 8-day clock advance |
| 7. Affiliate ledger retention | Workstream 8 (anonymization) + Workstream 10 (DSAR) | Snapshot test: ledger count unchanged post-deletion, PII hashed |
| 8. WKWebView OOM | Workstream 2 (virtualization + transforms) | Physical-device QA scrolling 50+ photos without reload |
| 9. HealthKit / Health Connect config | Workstream 4 (native config + UI) | Physical-device smoke test + Play Console pre-launch report |
| 10. Ads on clinic surfaces | Workstream 9 (route gating) + Workstream 10 (CSP) + Phase 0 (Playwright gate) | Playwright e2e: zero ad-domain requests on `/clinic/*` and `/share/*` |
| 11. Page-builder SEO/a11y | Workstream 7 (block taxonomy + lint + SSR) | Lighthouse ≥90 SEO/a11y on every published page; Google Rich Results Test green |
| 12. Affiliate fraud | Workstream 8 (rules) + Workstream 5 (review queue) | Self-referral test rejected; >10× cohort flagged |
| 13. Stripe Connect 1099/W-9 | Workstream 6 (Stripe setup) + Workstream 5 (admin dashboard) | Test affiliate hits threshold → payout blocked until form submitted |
| 14. PrivacyInfo manifest | Workstream 2 (parent manifest) + Workstreams 4/6/9 (declarations) | Xcode build-time manifest diff; App Privacy Report green |
| 15. DSAR completeness | Workstream 10 (portal) + all PII-touching workstreams (export module updates) | Vitest snapshot test fails on new PII surface unless export updated |
| 16. iOS web push gating | Workstream 10 + Workstream 2 (APNs fallback) | iOS device smoke test |
| 17. AdMob cold-start jank | Workstream 9 + Workstream 4 | FCP unchanged from baseline; Lighthouse perf ≥85 |
| 18. Resend deliverability | Workstream 10 + v1.1 tech debt | `curl api.resend.com/domains` shows verified; spam-test via mail-tester |
| 19. Capacitor deep-links | Workstream 2 + Workstream 7 (host AASA) | iOS device tap-share-link opens app, not Safari |
| 20. PostHog bundle bloat | Workstream 10 | Bundle ceiling holds; replay only on opted-in routes |
| 21. Stripe Checkout vs Elements | Workstream 6 (decision lock) | ADR in 06-CONTEXT.md; no Elements code in production |
| 22. Watch sync resilience | Workstream 3 | Phone-off test shows "Last synced N ago" badge |
| 23. Tailwind v4 + drag-drop conflict | Workstream 7 (lib spike before build) | 1-day spike confirms zero CSS conflict |
| 24. Clinic-invite × B2C subscription | Workstream 6 + Workstream 5 | Test: existing subscriber accepts clinic invite, prorate dialog appears |
| 25. Push token rotation | Workstream 10 | Daily cron pruning; 30-day dead-token cleanup verified |
| 26. ASO asset specs | Workstream 2 | App Store Connect + Play Console upload succeeds first try |
| 27. AdSense child-directed flag | Workstream 9 | AdSense unit config screenshot in admin docs |
| 28. Cookie banner CLS | Workstream 10 | Lighthouse CLS = 0 contribution from banner |
| 29. ads.txt / app-ads.txt | Workstream 9 + Workstream 7 (hosting) | `curl https://leanshot.app/app-ads.txt` returns correct sellers |
| 30. Font subsetting | Workstream 1 | Initial font payload <80 kB; FCP unchanged |
| 31. `s.user!` audit | Workstream 11 | Grep returns 0 occurrences after sweep |

---

## App Store / Play Store Review Pitfalls (Grouped)

Per the quality-gate requirement, all submission-gating pitfalls collected here for the pre-submission review checklist owned by **Workstream 2 (Mobile shells)**:

| # | Pitfall | Apple guideline / Play policy | Gate |
|---|---------|-------------------------------|------|
| 1 | HealthKit → ads | Apple §5.1.3 | HARD reject; firewall must be in place |
| 2 | IAP commission on in-app digital content | Apple §3.1.1 / §3.1.3(b) | HARD reject; decision locked in CONTEXT |
| 3 | In-app account deletion | Apple §5.1.1(v) (June 2022+) | HARD reject; ≤3-tap deletion verified |
| 9 | HealthKit permission strings + entitlement | Apple §5.1.1(i) | HARD crash on first use without |
| 9 | Health Connect permissions UI | Google Play Health Permissions policy | HARD reject if custom-skinned |
| 14 | PrivacyInfo.xcprivacy (manifest) | Apple May 2024 requirement | HARD reject on mismatch |
| 14 | App Tracking Transparency prompt | Apple iOS 14.5+ | Required if any SDK declares tracking |
| 17 | App-Ads.txt | IAB Tech Lab + Apple/Play ad-policy | SOFT — ad inventory rejected, not app |
| 19 | Universal Links (Associated Domains) | Apple capability requirement | Feature breaks if missing |
| 26 | ASO asset pixel specs | Apple/Google upload validation | HARD — can't submit until correct |
| 28 | Cookie consent banner UX (EU) | GDPR + EU member-state DPA | SOFT — DPA action risk |

---

## Bundle-Budget Pitfalls (Grouped)

Per the quality-gate requirement, all bundle-impacting pitfalls reference the existing `scripts/assert-clinic-bundle-budget.sh` pattern owned by **v1.2 Phase 0 (bootstrap)**:

| # | Source of bloat | Mitigation | Chunk ceiling (proposed) |
|---|-----------------|------------|--------------------------|
| 5 | Static import of Stripe / AdSense / page-builder / web-push | `sync-defer.ts` deferred-init wrapper | New per-chunk ceiling per SDK |
| 5 | Index gz creep | Lock at 25 kB gz (or document the new ceiling) | `index.*.js` gz ≤25 kB |
| 17 | AdMob native bridge JS | Lazy-import on free-tier dashboard mount | `admob-bridge.*.js` gz ≤15 kB |
| 20 | PostHog session-replay | `posthog-js/lite` in main; full only where needed | `posthog-full.*.js` gz ≤80 kB (separate chunk) |
| 23 | Page-builder runtime | Custom JSON renderer over off-the-shelf editor | `page-builder-runtime.*.js` gz ≤30 kB |
| 30 | Font payload | Subset to Latin + variable axes | Total font requests ≤80 kB |

**Phase 0 prereq:** Fix the hash-hyphen bug in `assert-clinic-bundle-budget.sh` (`reference_bundle_budget_hash_hyphen.md`) before adding any new per-chunk ceilings, otherwise content hashes containing `-` will report `wave-N skip` and the new ceilings will be silently un-enforced.

---

## Sources

**Apple App Store / HealthKit:**
- [App Review Guidelines — Apple Developer](https://developer.apple.com/app-store/review/guidelines/) — §5.1.3 Health, §5.1.1(v) Account deletion, §3.1.1 IAP, §3.1.3(b) anti-steering
- [Protecting user privacy — HealthKit documentation](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)
- [Distributing reader apps with a link to your website](https://developer.apple.com/support/reader-apps/)
- [App-to-web: navigating external purchases in iOS and Android apps — RevenueCat](https://www.revenuecat.com/blog/engineering/app-to-web-purchase-guidelines/)
- [Apple's June 2025 EU update — DMA fees and CTF sunset](https://www.revenuecat.com/blog/growth/apple-eu-dma-update-june-2025/)
- [New U.S. ruling on external iOS payments — Adapty](https://adapty.io/blog/new-us-ruling-on-external-ios-payments/)

**Stripe Connect / 1099 / Taxes:**
- [Connect W-8 and W-9 onboarding — Stripe Docs](https://docs.stripe.com/connect/connect-w8-w9-onboarding)
- [US tax reporting for Connect platforms — Stripe Docs](https://docs.stripe.com/connect/tax-reporting)
- [Stripe Connect 1099 overview](https://stripe.com/connect/1099)
- [Changes to mobile app store rules — Stripe Help](https://support.stripe.com/questions/changes-to-mobile-app-store-rules)
- [Affiliate Tax Compliance Made Easy: W-9, W-8BEN](https://www.i-payout.com/blog/affiliate-tax-compliance-made-easy-w-9-w-8ben-and-beyond)

**Safari ITP / Affiliate Attribution:**
- [Safari ITP — Stape](https://stape.io/blog/safari-itp)
- [Server-Side Affiliate Tracking Without Cookies: The 2026 Guide — iRev](https://irev.com/blog/cookieless-affiliate-tracking-what-actually-works-in-2026/)
- [Safari's Done It Again — Impact.com on ITP 2.2](https://impact.com/partnerships/safaris-done-it-again-what-you-need-to-know-about-itp-2-2/)

**Health Connect (Android):**
- [Permissions and data access — Android Health Connect](https://developer.android.com/health-and-fitness/health-connect/ui/permissions)
- [Health Connect UI guidelines](https://developer.android.com/health-and-fitness/guides/health-connect/design/ui-guidelines)
- [Android Health Permissions: Guidance and FAQs — Play Console Help](https://support.google.com/googleplay/android-developer/answer/12991134?hl=en)

**Capacitor / WKWebView memory:**
- [Capacitor OOM crash on photo input — GitHub issue](https://github.com/ionic-team/capacitor/issues/2265)
- [WKWebView memory issue causes crash — Apple Developer Forums](https://developer.apple.com/forums/thread/663084)
- [localStorage durability — Capacitor GitHub discussion](https://github.com/ionic-team/capacitor/issues/555)

**LeanShot project memory (internal):**
- `feedback_aggressive_foundations.md` — informs the breadth of this list
- `project_phase5_bundle_regression.md` — `sync-defer.ts` pattern + 50 kB index ceiling history
- `reference_bundle_budget_hash_hyphen.md` — `assert-clinic-bundle-budget.sh` hash-hyphen bug
- `reference_resend_phase9_wiring.md` — Resend domain-verify pattern + smoke commands
- `reference_phase7_research_findings.md` — jsPDF dynamic-import + `s.user!` inventory + HBNR/WMHMDA legal context
- `reference_supabase_auth_traps.md` — implicit-grant hash-route gotcha (relevant for new auth-bridge surfaces v1.2 may touch)
- `feedback_regulator_vs_user_audience_pattern.md` — refined by Phase 10 to confirm operator UX is end-user, not process
- `project_phase8_phase9_planning_complete.md` — Vercel `/clinic/*` path rewrites pattern
- `project_phase10_context_complete.md` — v1.1 baseline for B2B trust boundaries (no ads on clinic surfaces)

---

*Pitfalls research for: LeanShot v1.2 (mobile shells + watch + Health SDK + Stripe + ads + page builder + affiliate + launch essentials + admin + v1.1 tech debt sweep)*
*Researched: 2026-05-13*
