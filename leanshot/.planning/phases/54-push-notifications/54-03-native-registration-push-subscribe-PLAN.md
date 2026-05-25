---
phase: 54-push-notifications
plan: 03
type: execute
wave: 2
depends_on: [54-01]
files_modified:
  - leanshot/package.json
  - leanshot/package-lock.json
  - leanshot/src/lib/native/push.ts
  - supabase/functions/push-subscribe/index.ts
autonomous: false
requirements: [PUSH-02, PUSH-03, PUSH-05]
user_setup: []
must_haves:
  truths:
    - "@capacitor/push-notifications@8.1.1 is installed"
    - "registerForPush() on web returns a not-native result without throwing"
    - "On native, registerForPush() calls checkPermissions() BEFORE requestPermissions() (soft-prompt ordering)"
    - "On grant, the 'registration' listener token is POSTed to push-subscribe with platform + device_token"
    - "push-subscribe accepts the native body { platform, device_token } AND the existing web body"
  artifacts:
    - path: "leanshot/src/lib/native/push.ts"
      provides: "Capacitor native push registration (replaces Phase 12 throw-stub)"
      min_lines: 40
      exports: ["registerForPush", "PushChannel"]
    - path: "supabase/functions/push-subscribe/index.ts"
      provides: "native registration body schema in addition to web"
      contains: "device_token"
  key_links:
    - from: "leanshot/src/lib/native/push.ts"
      to: "@capacitor/push-notifications"
      via: "PushNotifications.register + addListener('registration')"
      pattern: "addListener\\('registration'"
    - from: "leanshot/src/lib/native/push.ts"
      to: "push-subscribe"
      via: "fetch POST device_token"
      pattern: "functions/v1/push-subscribe"
    - from: "supabase/functions/push-subscribe/index.ts"
      to: "push_subscriptions.device_token"
      via: "native UPSERT branch"
      pattern: "device_token"
---

<objective>
Wire native APNs/FCM token registration end-to-end: install @capacitor/push-notifications, replace the Phase 12 throw-stub in src/lib/native/push.ts with a real soft-prompt + register + POST flow, and extend the push-subscribe Edge Fn to accept the native { platform, device_token } body alongside the existing web body.

Purpose: native devices generate APNs/FCM tokens client-side; those tokens must land in push_subscriptions with the platform discriminator so push-dispatch (54-02) can fan out to them.
Output: installed plugin, implemented push.ts (turns 54-01 native scaffold GREEN), extended push-subscribe.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/54-push-notifications/54-RESEARCH.md
@.planning/phases/54-push-notifications/54-01-SUMMARY.md
@supabase/functions/push-subscribe/index.ts
@leanshot/src/lib/native/platform.ts

<interfaces>
<!-- The 54-01 scaffold leanshot/src/lib/native/push.test.ts defines the contract.
     Read it first; implement registerForPush to match its assertions. -->

<!-- push.ts MUST NOT import Capacitor directly — platform.ts is the SOLE legitimate
     @capacitor/core import site in src/lib/native/* (firewall asserted by grep in
     Phase 16). Import detectPlatform from './platform' for the platform value, and
     import { PushNotifications } from '@capacitor/push-notifications' for the plugin.
     Also: DO NOT import from ./health (import-x/no-restricted-paths). -->

<!-- detectPlatform() => 'web' | 'ios' | 'android' | 'capacitor-web' (platform.ts).
     Use it for both the not-native early return and the platform discriminator. -->

<!-- Existing push-subscribe body (web): { endpoint, p256dh, auth, user_agent? }
     UPSERT onConflict 'user_id,endpoint'. JWT-verified user_id (NEVER trust body user_id).
     New native body: { platform: 'ios'|'android', device_token: string } UPSERT
     onConflict 'user_id,device_token' (the partial unique index from 54-01). -->

<!-- Capacitor plugin API (RESEARCH Pattern 4):
     PushNotifications.checkPermissions() / requestPermissions() => { receive: 'granted'|'denied'|'prompt' }
     PushNotifications.addListener('registration', (token)=>{ token.value }) ; addListener('registrationError', ...)
     PushNotifications.register() -->

<!-- npm install requires --legacy-peer-deps (memory reference_sentry_capacitor_npm_install_blocker:
     @sentry/capacitor@^4.0.0 sibling-check aborts a plain install). -->

<!-- Test seam: leanshot/src/lib/native/__mocks__/capacitor-core.ts exists.
     Add a vi.mock for '@capacitor/push-notifications' in the test (54-01 wrote it). -->
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking-human">
  <what-built>About to install @capacitor/push-notifications@8.1.1 (official Ionic/Capacitor org). RESEARCH Package Legitimacy Audit tagged it [ASSUMED] (slopcheck unavailable at research time); source repo github.com/ionic-team/capacitor-plugins.</what-built>
  <how-to-verify>
    1. Open https://www.npmjs.com/package/@capacitor/push-notifications — confirm publisher is the Ionic/Capacitor org, version 8.1.1 exists, repository points to ionic-team/capacitor-plugins.
    2. Confirm it matches the installed @capacitor/core@^8.3.4 version family (8.x).
  </how-to-verify>
  <resume-signal>Type "approved" to proceed with install, or describe concerns.</resume-signal>
</task>

<task type="auto">
  <name>Task 1: Install @capacitor/push-notifications</name>
  <files>leanshot/package.json, leanshot/package-lock.json</files>
  <action>
    Run `npm install @capacitor/push-notifications@8.1.1 --legacy-peer-deps` inside `leanshot/` (Pitfall 5 — a plain install aborts on the @sentry/capacitor@^4.0.0 sibling-check; the --legacy-peer-deps flag is MANDATORY; memory reference_sentry_capacitor_npm_install_blocker). Confirm it lands in dependencies (not devDependencies) alongside the other @capacitor/* plugins. Note node_modules is gitignored so worktree installs do not transfer on merge — only package.json + lock file do (memory reference_npm_install_worktree_main_drift); the orchestrator must re-run install in main post-merge.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -q '"@capacitor/push-notifications"' package.json && echo PASS</automated>
  </verify>
  <done>@capacitor/push-notifications@8.1.1 in package.json dependencies; lock file updated.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement native registerForPush() (replaces Phase 12 stub)</name>
  <files>leanshot/src/lib/native/push.ts</files>
  <behavior>
    - registerForPush(accessToken, supabaseUrl): on web (detectPlatform()==='web') returns { ok:false, error:'not-native: use web VAPID path' } without throwing (PUSH-05 keeps web on the existing permission.ts VAPID path).
    - On native: calls PushNotifications.checkPermissions() FIRST; only if receive==='prompt' calls requestPermissions() (soft-prompt-before-OS-prompt ordering — assert call order).
    - permission !== 'granted' → return { ok:false, error:`permission-${receive}` }.
    - On granted: adds 'registration' listener; on token fires, POSTs { platform: detectPlatform(), device_token: token.value } to `${supabaseUrl}/functions/v1/push-subscribe` with Bearer accessToken; resolves { ok: res.ok }.
    - 'registrationError' listener → resolves { ok:false, error }.
  </behavior>
  <action>
    Replace the Phase 12 throw-stub per RESEARCH Pattern 4 / PUSH-02/03/05. Keep the existing `export type PushChannel = 'apns'|'fcm'|'web-push'`. Import detectPlatform from './platform' (NOT Capacitor directly — firewall) and { PushNotifications } from '@capacitor/push-notifications'. Implement the checkPermissions→(prompt?)requestPermissions→register→listener flow returning a Promise. Use detectPlatform() for both the not-native early return and the platform value sent to push-subscribe (it returns 'ios'|'android' on native). Do NOT add Capacitor logic to permission.ts (anti-pattern — keep web/native separated). Do NOT import from ./health.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run src/lib/native/push.test.ts 2>&1 | grep -Eq "passed|✓" && grep -q "checkPermissions" src/lib/native/push.ts && ! grep -q "from '@capacitor/core'" src/lib/native/push.ts && echo PASS</automated>
  </verify>
  <done>registerForPush implements soft-prompt ordering + native registration + POST; web path returns not-native; no direct @capacitor/core import; 54-01 native scaffold tests GREEN.</done>
</task>

<task type="auto">
  <name>Task 3: Extend push-subscribe to accept native { platform, device_token }</name>
  <files>supabase/functions/push-subscribe/index.ts</files>
  <action>
    Per PUSH-02/03. Extend validateBody to accept TWO shapes: the existing web body { endpoint, p256dh, auth, user_agent? } AND a native body { platform: 'ios'|'android', device_token: string (non-empty) }. Branch in handleSubscribe: web body → existing UPSERT onConflict 'user_id,endpoint' (set platform='web'); native body → UPSERT { user_id, platform, device_token, updated_at } onConflict 'user_id,device_token' (the partial unique index from 54-01). Keep the JWT-verified user_id as the only trusted user identity (T-42-05-02 — never trust body user_id). Reject a body that is neither shape with 400. Keep the Deno.serve guard + __internal export intact; add the native branch to __internal.validateBody coverage if a test exists.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "device_token" supabase/functions/push-subscribe/index.ts && grep -q "user_id,device_token" supabase/functions/push-subscribe/index.ts && echo PASS</automated>
  </verify>
  <done>push-subscribe accepts both web and native bodies; native UPSERT uses (user_id, device_token); web path unchanged; user_id remains JWT-derived.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| native device → push-subscribe | user-JWT-authed; device_token is untrusted input |
| client → npm registry | new package install |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-03-01 | Spoofing | fake device-token registration | mitigate | push-subscribe verifies user JWT via admin.auth.getUser; user_id from JWT not body |
| T-54-03-02 | Tampering | platform value spoof | mitigate | platform CHECK ('ios'/'android') in DB + validateBody enum |
| T-54-03-03 | DoS | mass native registration | mitigate | partial unique (user_id, device_token) from 54-01 |
| T-54-03-SC | Tampering | @capacitor/push-notifications install | mitigate | blocking-human legitimacy checkpoint (Task 0) verifying npmjs.com publisher before install; [ASSUMED] in RESEARCH audit |
</threat_model>

<verification>
- `cd leanshot && npx vitest run src/lib/native/push.test.ts` — GREEN (was RED in 54-01).
- `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — clean.
- push-subscribe still serves the web body unchanged (existing web registrations unaffected).
</verification>

<success_criteria>
@capacitor/push-notifications installed; registerForPush implements soft-prompt + native registration + POST device_token with platform; push-subscribe accepts native body; web path intact; native scaffold GREEN.
</success_criteria>

<output>
Create `.planning/phases/54-push-notifications/54-03-SUMMARY.md` when done. Flag for the orchestrator: post-merge `npm install --legacy-peer-deps` required in main `leanshot/` (node_modules gitignored). On-device APNs/FCM delivery + notification-tap deep-link → Phase 70 HUMAN-UAT.
</output>
