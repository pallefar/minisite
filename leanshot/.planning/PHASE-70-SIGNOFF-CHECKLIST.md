# Phase 70 — Consolidated UAT v1.4 Launch-Gate Signoff Checklist

_How to use: tick each box as you sign off the signal. Capture evidence under `evidence/<group>/<id>/`. Done **or** deferred both count as ticked (deferred items are annotated `(deferred)` with their GH issue). Pending items block the gate per the SHIP RULE below._

> **Operator quick-start:** Items 1-3 of `OPERATOR-RUNBOOK-2026-06-01.md` (Supabase Auth, OAuth, edge-fn deploy) clear most of `vendor-oauth-secrets` + `browser`. Run those first.

## SHIP RULE (severity-tiered go/no-go — from 70-08 + 70-CONTEXT Area 1)

> **Critical signals MUST pass; non-critical can ship with a documented `defer:<reason>` (open `v1.4-launch-deferral` GH issue).**
>
> The critical list (verbatim from CONTEXT.md Area 1):
> - vendor secrets present (all 6 missing from 69.7 + originals) — Plan 01 critical signals
> - Stripe Tax active — Plan 02 S01
> - MFA enroll + AAL2 + brute-force-lockout — Plan 06 S04
> - 48h regression sweep green — Plan 07 S10
> - device-UAT first-build cold-launch (iOS + Android) — Plan 04 S01 + Plan 05 S01
> - Apple OAuth signin + private-relay activation — Plan 04 S02
> - push delivery (web + iOS + Android) — Plan 03 implicit + Plan 04 S04 + Plan 05 S02
> - HealthKit OPT-IN flow — Plan 04 S03
> - payment-resilience dunning — Plan 02 S03
> - PITR restore drill evidence — Plan 06 S01
>
> **Decision rule:** If ALL critical boxes are ticked → SHIP RULE APPLIED → **GO eligible**. If ANY critical box is not ticked → SHIP RULE APPLIED → **NO-GO**; document which critical signal failed + the blocker.

**Progress: 94/94 signals (66 critical) — 14 done, 5 deferred, 75 pending**

## vendor-oauth-secrets

- [x] **S01** (critical) — Verify share-token signing secret in Supabase Vault — _Confirm vault.secrets returns share_token_secret + service_role_key (2 rows) via SQL Editor on project ytnsipxxmzgaebkqmokp._
- [x] **S02** (critical) — Verify SHARE_TOKEN_SECRET in Vercel production env matches vault — _Run `vercel env ls production | grep SHARE_TOKEN_SECRET`; confirm 1 encrypted row byte-identical to S01 vault value._
- [x] **S03** (non-critical) (deferred) — Claim Trustpilot vendor profile + set claimed flag — _Deferred (GH issue #4); post-launch claim leanshot.app at business.trustpilot.com then set review_cta_catalog.claimed=true for slug=trustpilot._
- [x] **S04** (non-critical) (deferred) — Claim G2 + Capterra vendor profiles + set claimed flags — _Deferred (GH issue #5); post-launch claim both listings then set review_cta_catalog.claimed=true for slugs g2 and capterra._
- [x] **S05** (critical) — Verify PostHog experiment + POSTHOG_PERSONAL_API_KEY Function Secret — _Confirm experiment 82078 nps_prompt_copy is running and supabase secrets list shows POSTHOG_PERSONAL_API_KEY; live-user smoke folded into Plan 03 S03._
- [x] **S06** (critical) — Verify Stripe Lifetime product + STRIPE_PRICE_LIFETIME secret + price-lookup seed — _Confirm STRIPE_PRICE_LIFETIME secret + stripe_price_lookup 'lifetime' row present (TEST price_0Tbj1G1xTnHBqsUWKgtlE8FW); flip to LIVE per STRIPE-MODE-SWITCHOVER.md before launch._
- [ ] **S07** (critical) — Set + verify Mux Function Secrets (TOKEN_ID/SECRET/WEBHOOK_SECRET) — _Generate Mux R/W token + webhook signing secret, set all three Supabase secrets, then smoke mux-create-upload expecting 200 (not 503)._
- [x] **S08** (critical) — Create Stripe win-back coupon + set Function Secret (S08) — _Confirm STRIPE_COUPON_WINBACK_10 secret (drift-corrected from WB_3MO_50; TEST coupon WINBACK_10 10%-once) matches lifecycle-win-back handler; flip _LIVE before launch._
- [x] **S09** (critical) — Create Stripe win-back coupon + set Function Secret (S09) — _Confirm STRIPE_COUPON_WINBACK_25 secret (drift-corrected from WB_6MO_30; TEST coupon WINBACK_25 25%-once) present; flip _LIVE before launch._
- [x] **S10** (critical) — Create Stripe win-back coupon + set Function Secret (S10) — _Confirm STRIPE_COUPON_WINBACK_50 secret (drift-corrected from WB_LIFETIME_20; TEST coupon WINBACK_50 50%-once) present; flip _LIVE before launch._
- [x] **S11** (critical) — Set NEWSLETTER_PHYSICAL_ADDRESS Function Secret (CAN-SPAM) — _PLACEHOLDER ONLY — replace with real legal postal address + verify in test-newsletter footer BEFORE Sun 2026-05-31 cron or launch (guard 503s on placeholder)._
- [ ] **S12** (critical) — Set BETTER_STACK_API_KEY Function Secret + monitors (uptime) — _Create Better Stack team token, set Supabase secret, smoke bs-status-poller/run for live monitor data, and add prod + healthz monitors._
- [x] **S13** (critical) — Set PHYSICAL_ADDRESS Function Secret (refund email compliance) — _PLACEHOLDER ONLY — replace with real legal address + verify in refund-confirmation email footer BEFORE launch (request-refund guard 503s on placeholder)._
- [ ] **S14** (critical) — Verify Apple Developer account active + set APPLE_TEAM_ID/BUNDLE_ID — _Confirm active Apple Dev membership, then set APPLE_TEAM_ID + APPLE_BUNDLE_ID in both Vercel (2) and Supabase secrets (2); 4 rows total._
- [ ] **S15** (critical) — Configure Sign-in-with-Apple Service ID + client-secret JWT — _Create Apple Service ID + .p8 key, generate 6-mo ES256 client_secret JWT, set APPLE_CLIENT_SECRET/SERVICE_ID/KEY_ID secrets, enable Supabase Apple provider, smoke web sign-in, record JWT expiry._
- [ ] **S16** (critical) — Verify Google Play Developer account + Android signing key — _Confirm active Play Console account, create LeanShot app + internal track, capture upload-key SHA-1 to evidence (not the keystore)._
- [x] **S17** (non-critical) (deferred) — Register Calendly OAuth client + token rotation — _Deferred (GH issue #6); post-launch register Calendly OAuth app, set CALENDLY_CLIENT_ID/SECRET, walk handshake — book-a-call falls back to mailto until then._
- [ ] **S18** (critical) — Verify AdMob publisher account + ADMOB_PUBLISHER_ID env — _Get approved AdMob account, register iOS+Android apps, set ADMOB_PUBLISHER_ID + App IDs in Vercel, smoke test ad on dev devices (Plan 04/05)._
- [x] **S19** (non-critical) (deferred) — Set up Google AdSense publisher (web landing pages) — _Deferred (GH issue #7); post-launch get AdSense approval + wire ADSENSE_PUBLISHER_ID/SLOT envs — mobile AdMob (S18) is primary surface._
- [x] **S20** (critical) — Ship scripts/uat-defer.sh deferral helper — _Confirm scripts/uat-defer.sh is committed + executable; smoke-verified by creating/closing real v1.4-launch-deferral GH issue #3._
- [x] **S21** (non-critical) — Bootstrap evidence dir + run final 17-secret presence sweep — _Evidence tree (21 subdirs) bootstrapped; re-run the 17-secret grep sweep (expect 17) once S07/S12/S14/S15 land — currently deferred until all critical secrets set._

## stripe-test

- [x] **S01** (critical) — Confirm Stripe Tax active with at least 2 US states registered — _Operator: activate Stripe Tax in Dashboard (fill head_office, register CA+NY) — currently status=pending; re-probe `stripe get /v1/tax/settings` for `active`._
- [x] **S02** (critical) — Verify 6 SAVE-* + 3 win-back coupons seeded and idempotent — _Re-run cancellation-seed-coupons Fn and `curl .../v1/coupons` to confirm 6 SAVE-* + 3 WINBACK_* (drift-corrected from WB_*) = 9 present._
- [ ] **S03** (critical) — Verify 3-email dunning cadence ends in cancellation via test-clock — _Create Stripe test-clock with failing card 4000000000000341, fast-forward 1mo+3d+4d+1d, confirm 3 dunning_emails_log rows + subscription canceled._
- [ ] **S04** (critical) — Verify Lifetime checkout grants lifetime tier (MEMBER-01) — _Complete Lifetime checkout (card 4242…), confirm lifetime_purchases row + tier_effective='lifetime' + Pro UI unlocked._
- [ ] **S05** (critical) — Verify grandfathered cohort gets silent override pricing (MEMBER-02) — _Add admin grandfathered row, sign in as cohort user, confirm stripe-checkout receives override price.id, no upgrade prompt, pricing page shows grandfathered amount._
- [ ] **S06** (critical) — Verify 70%-cap discount stacking with idempotency (MEMBER-03) — _Seed SAVE-30-3MO offer + apply TEST50 promo, confirm Stripe discount clamps to exactly 70% and promo_trial_extensions_log stays 1 row on resubmit._
- [ ] **S07** (critical) — Verify in-window refund self-service and out-of-window rejection — _Request refund within 30-day window, confirm Stripe refund succeeded + refund_requests_log row + email with physical-address footer; confirm out-of-window flow rejected._
- [ ] **S08** (critical) — Verify cross-state purchase tax calc differs per nexus state — _Run Pro Monthly checkout for CA/NY/TX customers, confirm state-correct tax line items + tax=0 (no error) for a non-nexus state._
- [ ] **S09** (critical) — Verify RLS denies cross-tenant grandfathered_prices reads (MEMBER-04) — _Sign in as out-of-cohort User B, confirm PostgREST grandfathered_prices returns [] and current_user_has_pro() returns correct booleans per user._
- [ ] **S10** (non-critical) — Bootstrap evidence dirs and smoke Stripe test-mode API auth — _Re-run Stripe `/v1/account` smoke and capture acct_* + charges_enabled into evidence; bootstrap.txt present but only a bootstrap artifact (no setup/cli-output/state-probe file)._

## browser

- [ ] **S01** (non-critical) — Mint share URL and validate Twitter Card — _Sign in as level-5 user, share level, paste URL into cards-dev.twitter.com/validator, confirm 1200x630 summary_large_image card; screenshot to evidence/browser/S01-share-card-mint-twitter-validator/._
- [ ] **S02** (non-critical) — Preview LinkedIn + Instagram share cards — _Paste S01 share URL into linkedin.com/post-inspector and an Instagram mobile DM; confirm card renders or record per-platform defer; screenshot to evidence/browser/S02-linkedin-instagram-card-preview/._
- [ ] **S03** (non-critical) — Smoke-test NPS consumer + admin flows — _Trigger admissible event to render NPSPromptModal, submit 5-star then 1-star (ticket in /admin/helpdesk), create rule + Ship Winner in /admin/reviews, run nps-cooldown-multi-device.spec.ts; evidence to S03 dir._
- [ ] **S04** (critical) — Create admin save-offer rule and run end-to-end cancel flow — _Add SAVE-25-3MO rule in /admin/cancellation, then run decline path (cancel_at_period_end=true) and accept path (discounts[] has coupon) via Stripe test subs; verify in Stripe; evidence to S04 dir._
- [ ] **S05** (non-critical) — Review notification + email template copy for dark patterns — _Open Phase 35/40/65 email templates (sample 5 of 31 Phase 65), confirm ethical-only copy or file copy-revision concern via scripts/uat-defer.sh; notes to evidence/browser/S05-copy-review/notes.md._
- [ ] **S06** (critical) — Verify Mux video upload roundtrip — _As Pro user upload a 5-30s mp4 to a community space, confirm video_status='ready' within 90s (SQL cross-check) and MuxPlayer plays; screenshots to S06 dir._
- [ ] **S07** (critical) — Verify @mention email delivery + opt-out suppression — _As alice post '@bob' (email arrives within 60s), toggle off bob's community_mentions, post again and confirm no email; capture both states to S07 dir._
- [ ] **S08** (critical) — Verify cross-tab realtime broadcast — _In 2 tabs/accounts of same community space, post a comment and a reaction in Tab A, confirm each appears in Tab B within 2s without reload; screenshots to S08 dir._
- [ ] **S09** (critical) — Verify tier-locked discovery card + upgrade CTA — _As Free user confirm Pro-only space shows locked card (no post body) and Upgrade CTA routes to /pricing; as Pro user confirm full content; screenshot both to S09 dir._
- [ ] **S10** (critical) — Verify public knowledge hub render + AI-coach citations — _Load /knowledge in incognito (no auth wall), ask AI Coach a KB question expecting citation footnotes + Sources block, confirm /admin/knowledge publish/unpublish; screenshots to S10 dir._
- [ ] **S11** (critical) — Verify Protocol Creator 2-person review + adopt-to-prefill — _Admin A drafts protocol, Admin B approves (A cannot self-approve), Clinician C adopts for patient, confirm patient dose-log prefill; SQL cross-check status=approved; screenshots to S11 dir._
- [ ] **S12** (critical) — Verify insights research-blog publish + k-anonymity enforcement — _Compose insight with <5-user cohort (suppressed placeholder) and >=5-user cohort (renders), publish + verify public /insights/<slug> incognito, confirm rag_feedback_log row on feedback; screenshots to S12 dir._
- [ ] **S13** (critical) — Verify state-privacy opt-out propagation — _Toggle Settings>Privacy advertising opt-out, confirm PostHog opted_out_advertising=true + ad IDFA/AAID flip + privacy_optout_log propagated_at within 24h; DMCA sub-signal defer-OK; evidence to S13 dir._
- [ ] **S14** (non-critical) — Smoke-test Spanish locale rendering — _Set browser/lang=es, confirm 5 consumer surfaces render in Spanish with no untranslated leaks and correct date/currency locale; screenshots to S14 dir._
- [ ] **S15** (critical) — Verify per-audience landing pages render (zero-ads on doctors/clinics) — _In incognito load /patients, /doctors, /clinics, confirm correct copy/CTAs, page-source shows zero ads on doctors+clinics, and /clinics Demo-org CTA provisions a fresh org; screenshots to S15 dir._
- [ ] **S16** (non-critical) — Verify demo-org auto-purge end-to-end — _Seed/find demo orgs older than 7d, POST to demo-org-purge/run Edge Fn (expect 200), re-query to confirm purge; exact timing defer-OK; evidence to S16 dir._
- [ ] **S17** (critical) — Run gsd-ui-auditor final pass against staging — _Run npm run audit:ui against staging URL, confirm 0 ERROR findings + all FLAGs accepted + no undefined @theme tokens; report to evidence/browser/S17-ui-auditor-final-pass/audit-report.md._
- [ ] **S18** (critical) — Capture + review light/dark VR snapshot baselines — _Run playwright.config.vr.ts --update-snapshots for light + dark, manually review every baseline for broken layouts, commit accepted baselines; evidence + git SHA to S18 dir._
- [ ] **S19** (critical) — Run Lighthouse mobile >=90 on 3 audience pages — _Run lighthouse --preset=mobile on /patients, /doctors, /clinics, confirm Perf/A11y/BestPractices/SEO all >=90 (or defer FIX only, not gate); 3 JSON reports + summary to S19 dir._
- [ ] **S20** (critical) — Verify DS-01/02/03 CI gates fire on PR — _Open 3 smoke PRs each introducing a typography/spacing/color violation, confirm each DS gate fails independently with a line-pointing error, close+delete branches; 3 PR URLs + 3 CI logs to S20 dir._
- [ ] **S21** (non-critical) — Bootstrap evidence directory + confirm staging reachable — _mkdir evidence/browser/ with S01..S20 subdirs and confirm staging returns 200 via curl -sI; do before S01._

## ios-device

- [ ] **S01** (critical) — Verify TestFlight first-build cold-launch on physical iPhone — _Upload v1.4 build to TestFlight, install on iPhone, force-quit then cold-launch and measure time-to-interactive (<=3s/5s); commit device photo + screen recording._
- [ ] **S02** (critical) — Verify Apple OAuth sign-in with private-relay email — _Sign in with Apple choosing 'Hide My Email', confirm authenticated Home + masked email in auth.users, complete onboarding, test relay email forward, and exercise revoke flow._
- [ ] **S03** (critical) — Verify HealthKit opt-in consent, import, and revoke — _Grant HealthKit consent in-app, import last 30 days (confirm weights row source='healthkit'), revoke via iOS Settings (banner + stops imports), and verify PrivacyInfo.xcprivacy declares correct types._
- [ ] **S04** (critical) — Verify push delivery via native APNs and web Safari — _Enable native push (confirm push_tokens row + lock-screen delivery <=10s), repeat via Safari PWA (iOS 16.4+), and confirm quiet-hours suppresses/silences; commit lock-screen photos for both paths._
- [ ] **S05** (critical) — Verify Apple Watch complication, quick-log, offline-queue, reconnect-sync — _Install Watch app, add complication with live data, quick-log a dose (injections row source='watch'), then test airplane-mode offline queue + BLE-bridge reconnect sync._
- [ ] **S06** (critical) — Verify Capacitor dose-log and onboarding parity on iOS — _Complete onboarding (no layout breakage/keyboard issues), log a manual dose (persists to dashboard), confirm AdMob test ad on consumer surface (or defer:admob-pending) and zero ads on clinic tabs._
- [ ] **S07** (non-critical) — Verify Instagram DM link-preview card — _Send the Plan 03 S01 share URL in an Instagram DM and confirm the inline preview card (image + title) renders; photo the screen or defer:instagram-defer._
- [ ] **S08** (non-critical) — Verify axe-core mobile-Safari baseline (0 new violations) — _Run axe scan on Home, Medication, Body, Settings, and Dose-log modal in mobile Safari; confirm 0 new violations vs Phase 42 baseline (or run web axe-CI from iPhone UA)._
- [ ] **S09** (non-critical) — Verify dark-mode VR snapshots on iOS device — _Set iOS dark mode, capture 5 surfaces, compare to Plan 03 S18 baselines; halt on any contrast/invisible-text break (WCAG AA), file defects via scripts/uat-defer.sh._
- [ ] **S10** (non-critical) — Verify PWA installability on iOS Safari — _Add leanshot.app to Home Screen, open standalone (theme-color status bar, no URL bar, splash), and confirm cached shell loads in Airplane mode._
- [ ] **S11** (non-critical) — Verify smart notifications respect quiet-hours on device — _Set quiet hours 22:00-07:00, set clock inside window (23:00) and trigger a smart reminder (no/silent delivery), then outside window (14:00) for audible delivery; reset clock to auto._
- [ ] **S12** (critical) — Verify iOS Lighthouse mobile scores >=90 — _Run Lighthouse mobile preset with iOS Safari UA against staging, confirm Performance/Accessibility/Best-Practices/SEO all >=90, output JSON to evidence dir._
- [ ] **S13** (non-critical) — Bootstrap evidence directory + verify device-photo workflow — _mkdir evidence/ios-device/ with S01..S12 subdirs and snap a test lock-screen photo to confirm the device-photo workflow before S01._

## android-device

- [ ] **S01** (critical) — Play internal-testing first-build cold-launch — _Build app-release.aab (cap sync android + gradlew bundleRelease), upload to Play internal testing, install on test phone, cold-launch within 3s/5s, sign in, photo lock-screen + record; capture versionCode._
- [ ] **S02** (critical) — Push delivery on Chrome PWA + native FCM — _Enable push on Android Play build, verify FCM token row in push_tokens, fire test push (lock-screen <10s), repeat via Chrome PWA add-to-home, and confirm quiet-hours suppression._
- [ ] **S03** (critical) — Wear OS complication + quick-log + offline-sync — _Pair Wear OS 3+ watch, install LeanShot watch app, add complication, quick-log dose (verify source='wear' row), airplane-mode both for offline queue, restore and confirm sync within 60s._
- [ ] **S04** (critical) — Capacitor dose-log + onboarding parity on Android — _Complete onboarding end-to-end on Android (keyboard/picker/taxonomy parity), log a manual dose with safe-area insets + native camera, confirm persistence; record full flow._
- [ ] **S05** (critical) — AdMob test-ad render + clinic/doctor/admin zero-ads — _On consumer surface confirm AdMob test-ad renders + tap registers in console; sign in as clinic/doctor-share/admin and confirm ZERO ads + zero AdMob network calls via chrome://inspect._
- [ ] **S06** (non-critical) — Phase-42 carry-over bundle (dark-mode VR + axe-core + PWA installability) — _Capture device dark-mode screens vs Plan-03 S18 baselines, run axe/Lighthouse-a11y on top 5 consumer surfaces (0 new violations), and verify PWA install + standalone + offline shell._
- [ ] **S07** (non-critical) — Smart notifications quiet-hours window enforcement — _Set quiet hours 22:00-07:00, spoof device clock to 23:00 and trigger smart reminder (confirm suppressed), set to 14:00 and confirm delivery, then reset clock to auto._
- [ ] **S08** (critical) — Android Chrome Lighthouse mobile >=90 (4 categories) — _Run npx lighthouse --preset=mobile against staging URL, save JSON to S08 evidence dir, confirm Performance/Accessibility/Best-Practices/SEO all >=90._
- [ ] **S09** (non-critical) — Evidence directory bootstrap + adb device check — _mkdir evidence/android-device/ with S01..S08 subdirs and confirm `adb devices` shows the test Android phone connected for logcat capture._

## ops-runbook-drill

- [ ] **S01** (critical) — PITR restore drill completes on test branch with witness count restored — _Create Supabase pitr-drill branch, snapshot witness injections count, DELETE rows, PITR-restore to pre-delete timestamp, re-run witness query to confirm match, record RTO timings to evidence/S01._
- [ ] **S02** (non-critical) — DDoS k6 load-test results meet p95/error-rate budgets — _Run k6 against staging (--vus 100 --duration 60s edge-fn-spike.js), confirm p95<1000ms + error rate<1% + no Sentry P1 spike, document to evidence/S02._
- [ ] **S03** (critical) — Funnel-break alert fires on synthetic traffic drop — _Confirm PostHog funnel-break alert enabled, synthesize a signup-bounce traffic drop via PostHog API on a test funnel, wait the eval window, confirm alert delivery in a configured channel, then snooze._
- [ ] **S04** (critical) — MFA brute-force lockout fires on 6th failed TOTP attempt — _Enroll TOTP for a test user, enter 5 wrong codes then a 6th, confirm 15-min lockout message + auth_rate_limit_log row (event_type=mfa_brute_force_lockout, count>=6, locked_until set), verify clears after expiry._
- [ ] **S05** (critical) — k-anonymity cohort suppression (<5 suppressed, >=5 aggregated, no PII bypass) — _Run rpc_insights_cohort_query on a <5-user filter (expect suppressed marker) and a >=5 filter (expect PII-free aggregate), and confirm non-admin JWT cannot read insights_cohort_query table directly (401/403)._
- [ ] **S06** (non-critical) — Admin 2FA enforcement mandatory at sign-in with enroll redirect — _Confirm admin 2FA is required (no skip) at sign-in, and a 2FA-disabled admin (set via SQL) is redirected to the enroll page on /admin/*; capture enforcement screenshots to evidence/S06._
- [ ] **S07** (non-critical) — Traffic-recorder env signal present and recording bursts — _Confirm Phase-67 traffic-recorder env var via vercel env ls production (set if missing), fire 10 GETs to /healthz on staging, confirm recorder log shows the 10 events._
- [ ] **S08** (non-critical) — Demo-org auto-purge cron registered and recently executed — _Query cron.job for demo-org-purge entry and cron.job_run_details for a run in the last 24h; capture output to evidence/S08._
- [ ] **S09** (non-critical) — Evidence directory bootstrap (S01..S08 subdirs) — _mkdir -p evidence/ops-runbook-drill/ and create S01..S08 signal subdirectories._

## regression-watch

- [x] **S01** (critical) — Capture code-freeze SHA + open 48h watch window — _Confirm freeze SHA/UTC ts in freeze-sha.txt and that 70-07-WATCH-DASHBOARD.md was created+committed._
- [ ] **S02** (critical) — Verify Playwright e2e suite 100% pass on main (>=2 runs, >=24h apart) — _Run `gh run list --workflow=e2e.yml --branch=main` and save >=2 green post-freeze run URLs to S02/run-urls.txt._
- [ ] **S03** (critical) — Verify Deno test sweep 100% pass on main (>=2 runs) — _Run `gh run list --workflow=deno-test.yml --branch=main` (or CI workflow) and save >=2 green run URLs to S03/run-urls.txt._
- [ ] **S04** (critical) — Verify axe-CI introduces 0 new violations vs baseline — _Run `gh run list --workflow=axe-ci.yml --branch=main`, confirm 0 net-new violations, save summary to S04/._
- [x] **S05** (critical) — Verify all 10 Edge Fn /healthz return 200 (>=8 ~6h snapshots) — _Re-run `bash scripts/smoke-edge-fns.sh` every ~6h, append each 10/10 result to S05/snapshots-h0..h48.txt (h0 captured; continue)._
- [ ] **S06** (critical) — Verify 0 P1 Sentry errors + all health sources green across window — _Sign in to Sentry (needs API token), filter unresolved fatal/high-volume errors, confirm 0, save screenshots to S06/._
- [ ] **S07** (critical) — Verify PostHog funnel-break alert stays dormant + funnel stable — _Confirm the funnel-break alert exists and is OK in PostHog, spot-check funnel conversion, save chart screenshots to S07/._
- [ ] **S08** (critical) — Verify Better Stack uptime monitors all green across window — _Set BETTER_STACK_API_KEY (Plan 70-01 S12), confirm all monitors green + bs-status-poller reporting, save screenshots to S08/._
- [ ] **S09** (critical) — Re-run Lighthouse mobile >=90 on 3 landing pages at h24 + h48 — _At hour 24 and 48 run lighthouse on /patients,/doctors,/clinics; confirm all 4 categories >=90; save 6 JSON reports to S09/._
- [ ] **S10** (critical) — Confirm 48h window elapsed GREEN + commit final dashboard — _At freeze+48h run final integrated sweep (smoke 10/10, 0 failed CI, Sentry 0, BetterStack/PostHog OK), commit dashboard, write S10/window-closed.txt with close SHA._
- [ ] **S11** (non-critical) — Bootstrap evidence dirs + confirm gh auth — _S01-S10 subdirs + gh auth already established at bootstrap; re-confirm `gh auth status` and replace bootstrap.txt with a completed setup/cli-output record._

## Sign-off

- **Date:** ____________________ (YYYY-MM-DD)
- **Operator:** ____________________ (karsten.haldan@gmail.com — Karsten alone is the authoritative go-decider)
- **Decision:** [ ] GO  /  [ ] NO-GO
  - _GO requires ALL 66 critical signals ticked (done or deferred-with-issue). If any critical is pending → NO-GO; document the failing signal + blocker._
- **Rationale (1-3 sentences):** ____________________________________________
- **Tag (on GO only):** `git tag -a v1.4.0-ship -m "v1.4 Launch Gate — Phase 70 signoff <UTC ts>. Decided by karsten.haldan@gmail.com."` then `git push origin v1.4.0-ship`
