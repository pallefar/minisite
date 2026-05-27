---
plan: "70-04-ios-device"
phase: "70"
wave: 0
depends_on: []
autonomous: false
type: execute
requirements:
  - UAT-02
  - UAT-03
  - UAT-04
files_modified:
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/ios-device/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-04-PLAN-ios-device.md
fixture_group: "ios-device"
estimated_duration: "3-4 hours operator time on physical iOS device + Mac + paired Apple Watch"
must_haves:
  - "ios-device-S01-testflight-first-build-cold-launch"
  - "ios-device-S02-apple-oauth-private-relay"
  - "ios-device-S03-healthkit-opt-in-import-revoke"
  - "ios-device-S04-push-delivery-web-safari-and-apns"
  - "ios-device-S05-apple-watch-complication-quick-log-offline-sync"
  - "ios-device-S06-capacitor-dose-log-parity"
  - "ios-device-S07-instagram-dm-preview"
  - "ios-device-S08-axe-core-mobile-safari-baseline"
  - "ios-device-S09-dark-mode-vr-on-device"
  - "ios-device-S10-pwa-installability"
  - "ios-device-S11-smart-notifications-quiet-hours"
  - "ios-device-S12-ios-lighthouse-mobile-min-90"
---

<objective>
Plan 04 — iOS device. All physical-iOS-device walkthroughs against the v1.4 build: TestFlight first-build cold-launch (Phase 53), Apple OAuth signin + Apple private-relay email path (Phase 59), HealthKit OPT-IN consent + data import + revoke flow + PrivacyInfo.xcprivacy reviewer-verified (Phase 55), web Safari + native APNs push delivery (Phase 54), Apple Watch complication + quick-log + offline-queue + reconnect-sync (Phase 57), Capacitor dose-log + onboarding parity smoke. Plus the 5 Phase 42 carry-over signals re-validated on a physical iOS device (axe-core mobile baseline, push device smoke, dark-mode VR snapshots on-device, PWA installability, smart-notifications quiet-hours). Plus iOS Lighthouse-mobile ≥90 (UAT-04 design polish).

Fixtures required:
- Physical iPhone (iOS 17+ recommended, paired with the same Apple ID used in TestFlight).
- Paired Apple Watch with watchOS 10+ (for Phase 57 signals).
- Mac running Xcode 15+ for build + provisioning.
- Apple Developer account active (gated by Plan 01 S14 + S15).
- TestFlight build uploaded (operator action via Xcode → Archive → upload). Build number documented inline per signal.

Purpose: UAT-02 (5 Phase 42 device signals on iOS) + UAT-03 (new v1.4 iOS device signals) + UAT-04 (iOS Lighthouse) coverage.

Output: signoff checkboxes filled inline + device photos (timestamp visible) + screen recordings + console logs committed to `evidence/ios-device/<signal-slug>/`.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-01-PLAN-vendor-oauth-secrets.md

**Prereqs:** Plan 01 S14 (Apple Dev account + APPLE_TEAM_ID/BUNDLE_ID), Plan 01 S15 (Sign-in-with-Apple JWT + Supabase Auth provider). If either deferred, this plan halts at S02. Plan 01 S18 (AdMob) gates the ad-render sub-signal in S06.
</context>

<tasks>

<task id="04-S01" name="Signal — TestFlight first-build cold-launch (Phase 53)">
  <type>verification</type>
  <signal_id>ios-device-S01-testflight-first-build-cold-launch</signal_id>
  <criticality>critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/phases/53-capacitor-mobile-shells-ios-android/53-CONTEXT.md
  </read_first>
  <action>
1. From Mac with the leanshot repo: `cd leanshot && npx cap sync ios && cd ios/App && pod install`.
2. Open `ios/App/App.xcworkspace` in Xcode. Select scheme "App" + a connected iPhone. Set build number to the next sequential integer (record this in evidence). Archive → Distribute App → TestFlight & App Store → Upload.
3. Wait for App Store Connect to process the build (5-30 min). Confirm build appears at https://appstoreconnect.apple.com → My Apps → LeanShot → TestFlight tab.
4. On the physical iPhone, open TestFlight app → install LeanShot (or update to the new build). Note the build number on the TestFlight install screen.
5. **Cold launch**: force-quit any prior instance (App Switcher → swipe up). Tap LeanShot icon. **Measure time from icon tap to first interactive frame**: should be ≤ 3s on iPhone 13 or newer (≤ 5s on older devices).
6. Take a device photo: lock-screen clock visible + TestFlight build number caption. Also record a 10s screen recording of cold launch.
7. Open the app, sign in, navigate to Home → confirm dashboard renders without obvious layout breakage.
  </action>
  <acceptance_criteria>
    - TestFlight build successfully uploaded + processed
    - app installs + opens on physical iPhone
    - cold launch ≤ 3s (or ≤ 5s on older iPhone, documented)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt; (include TestFlight build number)
    - evidence: evidence/ios-device/S01-testflight-first-build-cold-launch/ — device photo + screen recording
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Mobile shell shipping is core v1.4 deliverable. If Apple Developer membership not active (Plan 01 S14 deferred), halt Phase 70 entirely.
  </defer_clause>
</task>

<task id="04-S02" name="Signal — Apple OAuth signin + private-relay email handling (Phase 59)">
  <type>verification</type>
  <signal_id>ios-device-S02-apple-oauth-private-relay</signal_id>
  <criticality>critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/phases/59-apple-oauth-sign-in-with-apple-onboarding-completion/
    - Plan 01 S15 (Sign-in-with-Apple JWT)
  </read_first>
  <action>
1. On the test iPhone, open LeanShot (fresh install, signed-out state).
2. Tap "Sign in with Apple" → use a test Apple ID that has Apple's private-relay enabled (`@privaterelay.appleid.com` masked email).
3. On the Apple consent sheet, select **"Hide My Email"** (forces private-relay path). Approve.
4. Confirm app lands authenticated (Home tab loads with default empty state for the new user).
5. CLI cross-check (run from Mac):
   `supabase db query --linked "SELECT id, email, raw_user_meta_data FROM auth.users WHERE created_at &gt; now() - interval '5 minutes' ORDER BY created_at DESC LIMIT 1;"`
   Expected: email matches the `@privaterelay.appleid.com` masked address; raw_user_meta_data shows provider='apple'.
6. **Onboarding completion**: complete the new-user onboarding flow on device. Confirm:
   - the masked email is correctly recorded in the user's profile
   - no error states (e.g. "couldn't send welcome email" — Apple relay routes through Apple's MX)
7. Send a test transactional email (e.g. trigger a refund request via Plan 02 S07 on this user) → confirm Apple relay successfully forwards the email to the real Apple ID inbox.
8. **Revoke flow**: on the iPhone → Settings → Apple ID → Password & Security → Apps Using Apple ID → LeanShot → "Stop Using Apple ID". Confirm the next sign-in attempt creates a new sub or re-binds correctly per Phase 59 D-XX (verify behavior matches phase spec — defer to Phase 59 docs).
  </action>
  <acceptance_criteria>
    - Apple OAuth signin completes with private-relay email
    - email delivery via Apple relay succeeds
    - onboarding completion path works for first-time Apple signups
    - revoke flow behaves per Phase 59 spec
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S02-apple-oauth-private-relay/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Apple-OAuth + private-relay path is CONTEXT.md Area 1 critical-gate.</defer_clause>
</task>

<task id="04-S03" name="Signal — HealthKit OPT-IN + import + revoke (Phase 55)">
  <type>verification</type>
  <signal_id>ios-device-S03-healthkit-opt-in-import-revoke</signal_id>
  <criticality>critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/phases/55-healthkit-two-tunnel-firewall/
  </read_first>
  <action>
1. On the test iPhone with the v1.4 TestFlight build installed and Apple-signed-in: navigate to Settings (in-app) → Integrations → "Connect Apple Health".
2. Apple's HealthKit consent sheet appears. Toggle ON the specific data types the app requests (per Phase 55 D-XX: weight, body fat %, heart rate, workouts, dietary energy, etc.). Confirm.
3. Confirm in-app: "Connected" status + last-sync timestamp updates within 30s.
4. **Import smoke**: tap "Import last 30 days" → confirm progress indicator + at least one weight entry imports (use a test Apple ID with actual Apple Health data, or pre-seed via the iOS Health app).
5. CLI cross-check:
   `supabase db query --linked "SELECT user_id, source, recorded_at FROM public.weights WHERE user_id='&lt;test-user&gt;' AND source='healthkit' ORDER BY created_at DESC LIMIT 5;"`
6. **Revoke flow**: iPhone → Settings → Privacy & Security → Health → LeanShot → toggle off all permissions. Re-open the app → confirm: "Connection paused" banner appears + new imports stop (does NOT auto-delete historical imports — Phase 55 D-XX).
7. **PrivacyInfo.xcprivacy reviewer check**: in the Xcode-built .ipa bundle, confirm `App/PrivacyInfo.xcprivacy` exists and declares HealthKit data types collected. Open the file → verify it lists the same types the app actually reads.
  </action>
  <acceptance_criteria>
    - HealthKit consent sheet appears + user opt-in respected
    - import populates weights/etc. with source='healthkit'
    - revoke flow stops new imports + banner appears
    - PrivacyInfo.xcprivacy declares correct types
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S03-healthkit-opt-in-import-revoke/
  </acceptance_criteria>
  <defer_clause>Cannot defer. HealthKit OPT-IN path is CONTEXT.md Area 1 critical-gate + App Store review requirement.</defer_clause>
</task>

<task id="04-S04" name="Signal — Push delivery web Safari + native APNs (Phase 54)">
  <type>verification</type>
  <signal_id>ios-device-S04-push-delivery-web-safari-and-apns</signal_id>
  <criticality>critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/phases/54-push-notifications/
  </read_first>
  <action>
1. **Native APNs path** (Phase 54 native push):
   - On the test iPhone with the TestFlight build, sign in → Settings → Notifications → "Enable push".
   - iOS permission prompt appears → "Allow".
   - Confirm device token registered: `supabase db query --linked "SELECT user_id, token, platform FROM public.push_tokens WHERE user_id='&lt;test-user&gt;' AND platform='ios' ORDER BY created_at DESC LIMIT 1;"` → 1 row.
   - Trigger a test push from admin UI (`/admin/notifications/send-test`) targeting this user. Confirm push arrives on lock screen within 10s. Photo lock screen showing notification.
2. **Web Safari path** (PWA push, separate from native):
   - In mobile Safari, navigate to `https://leanshot.app/` (PWA, not the TestFlight build).
   - "Add to Home Screen" → open from Home Screen icon → sign in.
   - Settings → "Enable browser notifications" → Safari permission prompt → "Allow".
   - Trigger test push targeting this PWA user → confirm push arrives.
   - **Note:** Safari Web Push requires iOS 16.4+; document the test device's iOS version.
3. **Quiet hours**: in Settings → Notifications → set quiet-hours window to "now - 1h to now + 1h" → trigger a test push → confirm push does NOT arrive (or arrives as silent badge-only update per Phase 54 spec).
  </action>
  <acceptance_criteria>
    - native APNs push delivers within 10s
    - web Safari push delivers within 10s (or document iOS-version skip if &lt; 16.4)
    - quiet-hours suppresses or silences delivery
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S04-push-delivery-web-safari-and-apns/ — lock screen photos for both paths
  </acceptance_criteria>
  <defer_clause>Cannot defer native APNs. Web Safari path defer-OK if test device iOS &lt; 16.4 with explicit documented version.</defer_clause>
</task>

<task id="04-S05" name="Signal — Apple Watch complication + quick-log + offline-queue + reconnect-sync (Phase 57)">
  <type>verification</type>
  <signal_id>ios-device-S05-apple-watch-complication-quick-log-offline-sync</signal_id>
  <criticality>critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/phases/57-watch-apps-apple-watch-wear-os/
  </read_first>
  <action>
1. Pair an Apple Watch (watchOS 10+) with the test iPhone. From the iPhone's Watch app, install LeanShot's Watch app (should auto-install with the TestFlight build per Capacitor + watchOS config).
2. **Complication**: on the Apple Watch, customize a watch face → add LeanShot complication (e.g. "next dose" or "streak counter"). Confirm it renders with live data within 30s.
3. **Quick-log**: tap the LeanShot Watch app → tap "Log dose" → confirm a dose-log entry creates and syncs to iPhone within 10s. Verify in iPhone app + via CLI:
   `supabase db query --linked "SELECT user_id, recorded_at, source FROM public.injections WHERE source='watch' ORDER BY created_at DESC LIMIT 1;"`
4. **Offline queue**: turn off Watch + iPhone connectivity (Airplane mode on both) → log another dose from Watch → confirm a "queued" indicator. Re-enable connectivity → confirm queued entries sync to backend within 60s of reconnect.
5. **Reconnect sync**: with Watch in BLE-only range of iPhone (iPhone has internet, Watch doesn't): log from Watch → confirm cellular-less Watch syncs via iPhone bridge.
6. Capture: complication screenshot, quick-log flow screen recording, offline queue indicator + post-reconnect log row.
  </action>
  <acceptance_criteria>
    - complication renders with live data
    - quick-log creates injection row with source='watch'
    - offline queue persists + syncs on reconnect
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S05-apple-watch-complication-quick-log-offline-sync/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 57 watch app shipping is v1.4 differentiator.</defer_clause>
</task>

<task id="04-S06" name="Signal — Capacitor dose-log + onboarding parity on iOS">
  <type>verification</type>
  <signal_id>ios-device-S06-capacitor-dose-log-parity</signal_id>
  <criticality>critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/phases/53-capacitor-mobile-shells-ios-android/
  </read_first>
  <action>
1. From a fresh state (or use a new test user via Apple OAuth from S02), complete the in-app onboarding flow end-to-end on the iPhone. Confirm:
   - All onboarding screens render correctly with no layout breakage on small screens (iPhone SE / mini if available; otherwise on standard 6.1" device).
   - Keyboard handling: input fields scroll into view, never hide under keyboard.
   - Drug picker, dose-input, side-effect taxonomy all match the web version (per Phase 53 parity requirement).
2. Open the dose-log modal from Home → log a manual dose. Confirm:
   - Modal renders edge-to-edge on small phone with safe-area insets respected
   - Photo capture (if applicable) works via native camera
   - Save persists to backend + appears in dashboard list
3. **Ad render** (if Plan 01 S18 AdMob approved): on the dose-log success screen or relevant consumer surface, confirm a test AdMob ad renders (Google's test ad ID; should display "Test Ad" placeholder). On clinic-shell tabs, confirm ZERO ads (Phase 56 zero-ads requirement).
  </action>
  <acceptance_criteria>
    - onboarding completes without layout breakage
    - dose-log persists + appears in dashboard
    - AdMob test ad renders on consumer surface OR `defer:admob-pending` (Plan 01 S18)
    - clinic-shell tabs render zero ads
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S06-capacitor-dose-log-parity/
  </acceptance_criteria>
  <defer_clause>Cannot defer onboarding + dose-log parity. AdMob sub-signal defer-OK only if S18 deferred.</defer_clause>
</task>

<task id="04-S07" name="Signal — Instagram DM preview (Phase 35 Signal 5)">
  <type>verification</type>
  <signal_id>ios-device-S07-instagram-dm-preview</signal_id>
  <criticality>non-critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 35 — Signal 5
  </read_first>
  <action>
1. On the iPhone, open the Instagram mobile app.
2. Open DM → send yourself the share URL from Plan 03 S01.
3. Expect: preview card renders inline in the DM thread (image + title).
4. Photo screen.
  </action>
  <acceptance_criteria>
    - DM preview card renders OR `defer:instagram-defer`
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S07-instagram-dm-preview/
  </acceptance_criteria>
  <defer_clause>Defer-OK. Non-critical share-card preview.</defer_clause>
</task>

<task id="04-S08" name="Signal — axe-core mobile-Safari baseline (Phase 42 carry-over)">
  <type>verification</type>
  <signal_id>ios-device-S08-axe-core-mobile-safari-baseline</signal_id>
  <criticality>non-critical</criticality>
  <fixture>device-ios</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md (Phase 42 carry-over reference)
  </read_first>
  <action>
1. In mobile Safari on the iPhone, install the axe DevTools Safari extension (or use a remote-debugging session from Mac via Safari → Develop → connected iPhone).
2. Navigate to the top 5 consumer surfaces: Home, Medication, Body, Settings, Dose-log modal.
3. Run axe scan on each. Compare against the Phase 42 baseline (`leanshot/tests/axe-baselines/` or wherever stored).
4. New violations: log in evidence as candidates for v1.5 follow-up; pre-existing baseline counted: OK per CONTEXT.md Area 1 ("axe-CI 0 violations introduced — existing baseline OK").
  </action>
  <acceptance_criteria>
    - axe scan complete on 5 surfaces
    - 0 new violations vs baseline
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S08-axe-core-mobile-safari-baseline/
  </acceptance_criteria>
  <defer_clause>Defer-OK if axe extension not available; alternative is running web axe-CI against staging URL from the iPhone Safari user agent.</defer_clause>
</task>

<task id="04-S09" name="Signal — Dark-mode VR snapshots on iOS device (Phase 42 carry-over)">
  <type>verification</type>
  <signal_id>ios-device-S09-dark-mode-vr-on-device</signal_id>
  <criticality>non-critical</criticality>
  <fixture>device-ios</fixture>
  <action>
1. On the iPhone, set system dark mode (Settings → Display → Dark).
2. Open LeanShot (TestFlight build) → navigate Home, Medication, Body, Settings, Dose-log modal.
3. For each, take a screen capture (volume-up + side button). Compare against Plan 03 S18 dark-mode baselines.
4. Any layout breaks (text invisible, contrast failure): log as a defect; file via `scripts/uat-defer.sh dark-mode-ios-<surface> '<concern>'`.
  </action>
  <acceptance_criteria>
    - 5 surfaces captured in dark mode
    - no contrast/invisible-text breaks
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S09-dark-mode-vr-on-device/
  </acceptance_criteria>
  <defer_clause>Defer-OK for minor visual drift; halt on contrast failures (WCAG AA).</defer_clause>
</task>

<task id="04-S10" name="Signal — PWA installability on iOS Safari (Phase 42 carry-over)">
  <type>verification</type>
  <signal_id>ios-device-S10-pwa-installability</signal_id>
  <criticality>non-critical</criticality>
  <fixture>device-ios</fixture>
  <action>
1. In mobile Safari, navigate to `https://leanshot.app/` (PWA, not TestFlight).
2. Share button → "Add to Home Screen" → confirm the LeanShot icon + name added to home.
3. Open from home screen icon. Confirm:
   - Status bar styled per `theme-color` meta (#EFEBE0 light / #0B1413 dark)
   - "Apple PWA mode" UI: no Safari URL bar, splash screen on launch
4. Test offline: enable Airplane mode → tap PWA icon → confirm the app still launches and shows cached UI (Phase 42 PWA shell requirement).
  </action>
  <acceptance_criteria>
    - PWA installs to home
    - opens in standalone mode
    - cached shell loads offline
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S10-pwa-installability/
  </acceptance_criteria>
  <defer_clause>Defer-OK if PWA shell-only is scoped to web non-Capacitor users post-launch.</defer_clause>
</task>

<task id="04-S11" name="Signal — Smart notifications + quiet-hours on device (Phase 42 carry-over)">
  <type>verification</type>
  <signal_id>ios-device-S11-smart-notifications-quiet-hours</signal_id>
  <criticality>non-critical</criticality>
  <fixture>device-ios</fixture>
  <action>
1. On the iPhone with v1.4 build, set quiet hours window (Settings → Notifications → Quiet Hours: 22:00 - 07:00 device time).
2. Configure system clock to a time inside the quiet window (Settings → General → Date & Time → toggle off "Set automatically" → set to 23:00).
3. Trigger a "smart" reminder (e.g. dose reminder, behavior-triggered nudge) from admin or by enqueuing via the lifecycle-behavior-triggered Edge Fn.
4. Confirm: notification does NOT arrive (or arrives as silent badge only).
5. Move clock outside quiet hours (set to 14:00) → trigger again → confirm notification arrives with sound.
6. Reset system clock to auto.
  </action>
  <acceptance_criteria>
    - quiet hours suppresses delivery
    - outside-window delivery works
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S11-smart-notifications-quiet-hours/
  </acceptance_criteria>
  <defer_clause>Defer-OK with documented edge case.</defer_clause>
</task>

<task id="04-S12" name="Signal — iOS Lighthouse mobile ≥90 (UAT-04)">
  <type>verification</type>
  <signal_id>ios-device-S12-ios-lighthouse-mobile-min-90</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69-layout-design-polish/
  </read_first>
  <action>
1. Run Lighthouse against staging URL using mobile-emulator preset with iOS UA override (Lighthouse mobile preset emulates a Moto G4 by default; we want the iOS Safari UA):
   `npx lighthouse "https://&lt;staging&gt;/" --preset=mobile --form-factor=mobile --user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" --quiet --output=json --output-path=".planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/ios-device/S12-ios-lighthouse-mobile-min-90/lighthouse-ios.json"`
2. Confirm Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90, SEO ≥ 90.
3. If any category &lt; 90, document opportunities and file follow-up.
  </action>
  <acceptance_criteria>
    - all 4 categories ≥ 90
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ios-device/S12-ios-lighthouse-mobile-min-90/lighthouse-ios.json
  </acceptance_criteria>
  <defer_clause>Cannot defer the threshold; bundle-perf-known issues file `v1.5-perf-followup` issue.</defer_clause>
</task>

<task id="04-S13" name="Signal — Evidence directory bootstrap">
  <type>verification</type>
  <signal_id>ios-device-S13-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/ios-device/`
2. Create S01..S12 subdirs.
3. Test photo: snap a quick device photo of the iPhone lock screen to confirm device-photo workflow works (delete after).
  </action>
  <acceptance_criteria>
    - evidence dirs exist
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Non-critical — but bootstrap before S01.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan: every critical signal signed off; device-photo evidence committed with lock-screen-clock timestamps for the device-anchored signals.
</verification>

<success_criteria>
- All 7 critical signals signed off (S01, S02, S03, S04, S05, S06, S12).
- Non-critical signals (S07, S08, S09, S10, S11, S13) signed OR `defer:<reason>`.
- Evidence under `evidence/ios-device/`.
</success_criteria>

## Resume State

- [ ] **S01** — TestFlight first-build cold-launch — signoff: __________
- [ ] **S02** — Apple OAuth + private-relay — signoff: __________
- [ ] **S03** — HealthKit OPT-IN + import + revoke — signoff: __________
- [ ] **S04** — Push delivery (web Safari + native APNs) — signoff: __________
- [ ] **S05** — Apple Watch complication + quick-log + offline-sync — signoff: __________
- [ ] **S06** — Capacitor dose-log + onboarding parity — signoff: __________
- [ ] **S07** — Instagram DM preview (non-critical) — signoff: __________
- [ ] **S08** — axe-core mobile Safari baseline (non-critical) — signoff: __________
- [ ] **S09** — Dark-mode VR on device (non-critical) — signoff: __________
- [ ] **S10** — PWA installability (non-critical) — signoff: __________
- [ ] **S11** — Smart notifications + quiet hours (non-critical) — signoff: __________
- [ ] **S12** — iOS Lighthouse mobile ≥90 — signoff: __________
- [ ] **S13** — Evidence dir bootstrap — signoff: __________

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `approved` | All 13 signals green |
| `approved — non-criticals-deferred` | 7 critical signals green; non-criticals deferred |
| `blocked: <reason>` | Any critical signal cannot land |

<output>
Update PLAN.md inline. Plan 08 aggregates this file's checkbox state.
</output>
