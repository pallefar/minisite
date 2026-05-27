---
plan: "70-05-android-device"
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
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/android-device/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-05-PLAN-android-device.md
fixture_group: "android-device"
estimated_duration: "2-3 hours operator time on physical Android device + paired Wear OS smartwatch"
must_haves:
  - "android-device-S01-play-internal-first-build-cold-launch"
  - "android-device-S02-push-delivery-chrome-and-fcm"
  - "android-device-S03-wear-os-complication-quick-log-offline-sync"
  - "android-device-S04-capacitor-dose-log-parity"
  - "android-device-S05-admob-test-ad-render"
  - "android-device-S08-android-lighthouse-mobile-min-90"
---

<objective>
Plan 05 — Android device. All physical-Android-device walkthroughs against the v1.4 build: Play internal-testing first-build cold-launch (Phase 53), push delivery on Chrome + native FCM (Phase 54), Wear OS complication + quick-log + offline-queue (Phase 57), Capacitor dose-log + onboarding parity, AdMob test-ad render on consumer surface + zero-ads on clinic/admin paths (Phase 56). Plus axe-core mobile-Chrome baseline + dark-mode VR on device + PWA installability + smart-notifications (Phase 42 carry-over signals re-validated on Android). Plus Android Chrome Lighthouse-mobile ≥90 (UAT-04 design polish).

Fixtures required:
- Physical Android phone (Android 12+ / API 31+ recommended).
- Paired Wear OS smartwatch (Wear OS 3+) for Phase 57 signals.
- Local Android SDK + adb + JDK 17.
- Play Developer account active (gated by Plan 01 S16).
- Internal testing track build uploaded (operator action via `npx cap sync android && cd android && ./gradlew bundleRelease` → Play Console upload). Version code documented per signal.

Purpose: UAT-02 (Phase 42 device signals on Android) + UAT-03 (new v1.4 Android device signals) + UAT-04 (Android Lighthouse) coverage.

Output: signoff checkboxes filled inline + device photos (lock-screen clock visible) + screen recordings + `adb logcat` excerpts + Play Console screenshots committed to `evidence/android-device/<signal-slug>/`.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-01-PLAN-vendor-oauth-secrets.md

**Prereqs:** Plan 01 S16 (Play Developer account + Android signing key). If deferred, this plan halts. Plan 01 S18 (AdMob) gates S05.
</context>

<tasks>

<task id="05-S01" name="Signal — Play internal-testing first-build cold-launch (Phase 53)">
  <type>verification</type>
  <signal_id>android-device-S01-play-internal-first-build-cold-launch</signal_id>
  <criticality>critical</criticality>
  <fixture>device-android</fixture>
  <read_first>
    - .planning/phases/53-capacitor-mobile-shells-ios-android/53-CONTEXT.md
  </read_first>
  <action>
1. From local repo: `cd leanshot && npx cap sync android && cd android && ./gradlew bundleRelease`. Output: `app/build/outputs/bundle/release/app-release.aab`. Note the versionCode.
2. https://play.google.com/console → LeanShot app → Internal testing → Create new release → upload the AAB → save + roll out. Wait for Play review (~5-30 min for internal track).
3. Add test tester (the operator's Google account) to the internal testing track if not already. Visit the opt-in URL from Play Console → "Become a tester" → install via Play Store.
4. On the test Android phone, install LeanShot from the Play Store (or update). Note the versionCode shown in Play Store app details.
5. **Cold launch**: force-stop via Settings → Apps → LeanShot → Force stop. Tap LeanShot icon on home screen. Measure time to first interactive frame: ≤ 3s on Pixel 7 or newer (≤ 5s on older).
6. Take device photo: lock-screen clock visible + Play Store version caption. Record 10s screen recording.
7. Open the app, sign in, navigate to Home → confirm dashboard renders without layout breakage.
  </action>
  <acceptance_criteria>
    - Play internal-testing build available + installable
    - cold launch ≤ 3s (or ≤ 5s on older Android, documented)
    - app installs + opens
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt; (include versionCode)
    - evidence: evidence/android-device/S01-play-internal-first-build-cold-launch/ — device photo + screen recording
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. If Play Developer membership not active (Plan 01 S16 deferred), halt Phase 70.
  </defer_clause>
</task>

<task id="05-S02" name="Signal — Push delivery Chrome + native FCM (Phase 54)">
  <type>verification</type>
  <signal_id>android-device-S02-push-delivery-chrome-and-fcm</signal_id>
  <criticality>critical</criticality>
  <fixture>device-android</fixture>
  <read_first>
    - .planning/phases/54-push-notifications/
  </read_first>
  <action>
1. **Native FCM path**:
   - On the test Android phone with the Play internal build, sign in → Settings → Notifications → "Enable push".
   - Android system permission prompt (Android 13+) → "Allow".
   - Confirm FCM token registered: `supabase db query --linked "SELECT user_id, token, platform FROM public.push_tokens WHERE user_id='&lt;test-user&gt;' AND platform='android' ORDER BY created_at DESC LIMIT 1;"` → 1 row.
   - Trigger test push from /admin/notifications/send-test → confirm push arrives on lock screen within 10s. Photo lock screen.
2. **Web Chrome PWA path**:
   - In mobile Chrome, navigate to `https://leanshot.app/`. Tap menu → "Add to Home Screen".
   - Open from home icon → sign in → Settings → "Enable browser notifications" → Allow.
   - Trigger test push targeting PWA user → confirm push arrives.
3. **Quiet hours**: set Settings → Notifications → quiet hours window covering "now" → trigger test push → confirm not delivered (or silent).
4. Capture `adb logcat | grep -i fcm` snippet showing token registration if helpful.
  </action>
  <acceptance_criteria>
    - native FCM push delivers within 10s
    - web Chrome PWA push delivers within 10s
    - quiet hours suppresses delivery
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/android-device/S02-push-delivery-chrome-and-fcm/
  </acceptance_criteria>
  <defer_clause>Cannot defer native FCM. Web Chrome PWA path defer-OK with documented Android version.</defer_clause>
</task>

<task id="05-S03" name="Signal — Wear OS complication + quick-log + offline-queue (Phase 57)">
  <type>verification</type>
  <signal_id>android-device-S03-wear-os-complication-quick-log-offline-sync</signal_id>
  <criticality>critical</criticality>
  <fixture>device-android</fixture>
  <read_first>
    - .planning/phases/57-watch-apps-apple-watch-wear-os/
  </read_first>
  <action>
1. Pair a Wear OS smartwatch (Wear OS 3+) with the test Android phone via the Wear OS companion app.
2. Install LeanShot's Wear OS app on the watch (auto-pushed from the Play build or via standalone watch Play Store).
3. **Complication**: long-press a watch face → customize → add LeanShot complication. Confirm live data renders within 30s.
4. **Quick-log**: open LeanShot watch app → tap "Log dose" → confirm sync to phone + backend within 10s. Verify in app + CLI:
   `supabase db query --linked "SELECT user_id, recorded_at, source FROM public.injections WHERE source='wear' ORDER BY created_at DESC LIMIT 1;"`
5. **Offline queue**: airplane-mode the watch (phone has internet — Wear OS often pipes through phone, so airplane-mode the phone too for a true offline test). Log dose from watch → "queued" indicator. Restore connectivity → confirm queued entry syncs within 60s.
6. Capture: complication screenshot, quick-log screen recording.
  </action>
  <acceptance_criteria>
    - complication renders
    - quick-log persists with source='wear'
    - offline queue sync on reconnect
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/android-device/S03-wear-os-complication-quick-log-offline-sync/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer if a Wear OS device is available. If no Wear OS hardware on hand, document `defer:wear-os-hardware-unavailable` and open `v1.5-watch-os-recheck` issue.
  </defer_clause>
</task>

<task id="05-S04" name="Signal — Capacitor dose-log + onboarding parity on Android">
  <type>verification</type>
  <signal_id>android-device-S04-capacitor-dose-log-parity</signal_id>
  <criticality>critical</criticality>
  <fixture>device-android</fixture>
  <read_first>
    - .planning/phases/53-capacitor-mobile-shells-ios-android/
  </read_first>
  <action>
1. From fresh state or new test user, complete onboarding end-to-end on the Android phone. Confirm:
   - All screens render correctly across small + standard Android resolutions
   - Keyboard handling: input fields scroll into view, never hidden under keyboard
   - Drug picker + dose-input + side-effect taxonomy parity with web + iOS
2. Open dose-log modal → log a manual dose. Confirm:
   - Modal renders edge-to-edge with safe-area (gesture nav) insets respected
   - Photo capture via native camera works
   - Save persists + appears in dashboard
3. Capture screen recording of full onboarding flow.
  </action>
  <acceptance_criteria>
    - onboarding completes without layout breakage
    - dose-log persists + appears
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/android-device/S04-capacitor-dose-log-parity/
  </acceptance_criteria>
  <defer_clause>Cannot defer parity.</defer_clause>
</task>

<task id="05-S05" name="Signal — AdMob test-ad render + clinic-zero-ads (Phase 56)">
  <type>verification</type>
  <signal_id>android-device-S05-admob-test-ad-render</signal_id>
  <criticality>critical</criticality>
  <fixture>device-android</fixture>
  <read_first>
    - .planning/phases/56-ad-network/
    - Plan 01 S18 (AdMob publisher)
  </read_first>
  <action>
1. On the Android phone (Play internal build), navigate to a consumer surface where ads are configured to render (per Phase 56 — likely dose-log success screen or specific banner placement).
2. Confirm an AdMob test-ad placeholder renders ("Test Ad — Google" overlay).
3. Tap the test ad → confirm click-tracking lands in AdMob console (real impressions take 10-30 min to appear, but tap count should increment).
4. Sign in as a clinic-tier user → navigate to clinic surfaces (e.g. /clinic/patients, /admin/*). Confirm ZERO ads render. View Network panel via Chrome Remote DevTools (chrome://inspect) → confirm zero AdMob SDK network calls.
5. Sign in as doctor-share viewer → confirm ZERO ads on `/doctor/<token>` surfaces.
6. Capture screenshots: ad-rendered consumer surface, ad-free clinic surface.
  </action>
  <acceptance_criteria>
    - AdMob test ad renders on consumer surface
    - zero ads on clinic + doctor-share + admin surfaces
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/android-device/S05-admob-test-ad-render/
  </acceptance_criteria>
  <defer_clause>Cannot defer the clinic-zero-ads. AdMob render defer-OK if Plan 01 S18 deferred.</defer_clause>
</task>

<task id="05-S06" name="Signal — Dark-mode VR + axe-core mobile-Chrome baseline + PWA installability (Phase 42 carry-over bundle)">
  <type>verification</type>
  <signal_id>android-device-S06-phase42-carryover-bundle</signal_id>
  <criticality>non-critical</criticality>
  <fixture>device-android</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md (Phase 42 carry-over)
  </read_first>
  <action>
**Sub-signal A — Dark-mode VR on device**: set Android system dark mode (Settings → Display → Dark theme). Open the v1.4 build → navigate Home, Medication, Body, Settings, Dose-log modal → screen capture each. Compare to Plan 03 S18 baselines. No contrast/visibility breaks.

**Sub-signal B — axe-core mobile-Chrome baseline**: from Mac, run Chrome Remote Debugging (`chrome://inspect` → connected Android Chrome → Inspect). In DevTools → Lighthouse → Accessibility (or use the axe DevTools panel) → run on top 5 consumer surfaces. 0 new violations vs Phase 42 baseline.

**Sub-signal C — PWA installability**: In Chrome mobile → `https://leanshot.app/` → "Install app" prompt (Add to home screen). Confirm icon installs + opens in standalone mode + offline cached shell loads in airplane mode.

Capture per sub-signal in separate evidence subdirs.
  </action>
  <acceptance_criteria>
    - 3 sub-signals all signed off OR defer-clauses recorded
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/android-device/S06-phase42-carryover-bundle/ — a/b/c subdirs
  </acceptance_criteria>
  <defer_clause>Defer-OK per sub-signal with documented edge case.</defer_clause>
</task>

<task id="05-S07" name="Signal — Smart notifications + quiet hours (Phase 42 carry-over)">
  <type>verification</type>
  <signal_id>android-device-S07-smart-notifications-quiet-hours</signal_id>
  <criticality>non-critical</criticality>
  <fixture>device-android</fixture>
  <action>
1. Set Settings → Notifications → Quiet Hours: 22:00-07:00 device time.
2. Override Android system clock to 23:00 (Developer Options → Date & Time spoof) or use ADB time override.
3. Trigger a smart reminder (admin or lifecycle-behavior-triggered Edge Fn).
4. Confirm notification does NOT arrive (or silent badge only).
5. Set clock to 14:00 → trigger again → confirm notification arrives normally.
6. Reset clock to auto.
  </action>
  <acceptance_criteria>
    - quiet hours suppresses delivery
    - outside-window delivery works
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/android-device/S07-smart-notifications-quiet-hours/
  </acceptance_criteria>
  <defer_clause>Defer-OK with documented edge.</defer_clause>
</task>

<task id="05-S08" name="Signal — Android Chrome Lighthouse mobile ≥90 (UAT-04)">
  <type>verification</type>
  <signal_id>android-device-S08-android-lighthouse-mobile-min-90</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/69-layout-design-polish/
  </read_first>
  <action>
1. Run Lighthouse against staging URL using default mobile preset (emulates Moto G4 = Android Chrome UA):
   `npx lighthouse "https://&lt;staging&gt;/" --preset=mobile --quiet --output=json --output-path=".planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/android-device/S08-android-lighthouse-mobile-min-90/lighthouse-android.json"`
2. Confirm Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90, SEO ≥ 90.
3. (Optional) repeat with throttling=devtools simulated for the connected Android device's real network.
  </action>
  <acceptance_criteria>
    - all 4 categories ≥ 90
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/android-device/S08-android-lighthouse-mobile-min-90/lighthouse-android.json
  </acceptance_criteria>
  <defer_clause>Cannot defer threshold; pre-existing bundle perf issues → v1.5-perf-followup.</defer_clause>
</task>

<task id="05-S09" name="Signal — Evidence directory bootstrap">
  <type>verification</type>
  <signal_id>android-device-S09-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/android-device/`
2. Create S01..S08 subdirs.
3. Confirm `adb devices` shows the test Android phone connected for logcat capture.
  </action>
  <acceptance_criteria>
    - evidence dirs exist
    - adb sees device
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Non-critical bootstrap.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan: every critical signal signed off; device-photo evidence committed with lock-screen-clock timestamps for the device-anchored signals.
</verification>

<success_criteria>
- All 6 critical signals signed off (S01, S02, S03, S04, S05, S08).
- Non-critical signals (S06, S07, S09) signed OR `defer:<reason>`.
- Evidence under `evidence/android-device/`.
</success_criteria>

## Resume State

- [ ] **S01** — Play internal-testing first-build cold-launch — signoff: __________
- [ ] **S02** — Push delivery (web Chrome + native FCM) — signoff: __________
- [ ] **S03** — Wear OS complication + quick-log + offline-sync — signoff: __________
- [ ] **S04** — Capacitor dose-log + onboarding parity — signoff: __________
- [ ] **S05** — AdMob test-ad render + clinic-zero-ads — signoff: __________
- [ ] **S06** — Phase 42 carry-over bundle (dark-mode VR + axe + PWA) (non-critical) — signoff: __________
- [ ] **S07** — Smart notifications + quiet hours (non-critical) — signoff: __________
- [ ] **S08** — Android Chrome Lighthouse mobile ≥90 — signoff: __________
- [ ] **S09** — Evidence dir bootstrap — signoff: __________

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `approved` | All 9 signals green |
| `approved — non-criticals-deferred` | 6 critical signals green; non-criticals deferred |
| `blocked: <reason>` | Any critical signal cannot land |

<output>
Update PLAN.md inline. Plan 08 aggregates this file's checkbox state.
</output>
