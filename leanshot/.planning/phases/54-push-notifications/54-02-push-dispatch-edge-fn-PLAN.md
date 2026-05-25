---
phase: 54-push-notifications
plan: 02
type: execute
wave: 2
depends_on: [54-01]
files_modified:
  - supabase/functions/push-dispatch/index.ts
autonomous: true
requirements: [PUSH-01, PUSH-04, PUSH-07, PUSH-08]
user_setup:
  - service: apns
    why: "iOS push delivery — pending provisioning, fail-soft until Phase 70"
    env_vars:
      - name: APNS_PRIVATE_KEY_P8
        source: "Apple Developer -> Keys -> .p8 file (PKCS#8 PEM). Supabase Function Secret only — NEVER VITE_*"
      - name: APNS_KEY_ID
        source: "Apple Developer -> Keys -> Key ID"
      - name: APNS_TEAM_ID
        source: "Apple Developer -> Membership -> Team ID"
      - name: APNS_BUNDLE_ID
        source: "Xcode bundle identifier (apns-topic)"
      - name: APNS_SANDBOX
        source: "Set 'true' (default) until real device certs land at Phase 70; 'false' for production endpoint"
  - service: fcm
    why: "Android push delivery — pending provisioning, fail-soft until Phase 70"
    env_vars:
      - name: FCM_SERVICE_ACCOUNT_JSON
        source: "Firebase Console -> Project Settings -> Service accounts -> Generate new private key (JSON). Supabase Function Secret only"
must_haves:
  truths:
    - "push-dispatch verifies a service-role bearer (constant-time) and rejects otherwise"
    - "push-dispatch fans out to a user's web (VAPID), iOS (APNs), and Android (FCM) subscriptions"
    - "Quiet-hours 22:00-08:00 user-tz blocks non-urgent; urgent (cfg.urgent_escalation) overrides and delivers"
    - "When a platform's vendor secret is absent the platform is skipped (fail-soft, no crash)"
    - "Delivery failure increments failure_count; row deleted at 3 consecutive failures; success resets to 0"
    - "push_sent / push_delivered / push_failed PostHog events emitted with platform (+category) props"
  artifacts:
    - path: "supabase/functions/push-dispatch/index.ts"
      provides: "cross-platform push fan-out Edge Fn with quiet-hours, prune, telemetry, injectable transports"
      min_lines: 200
      exports: ["__internal"]
  key_links:
    - from: "supabase/functions/push-dispatch/index.ts"
      to: "push_subscriptions"
      via: "admin select all platforms for user_id"
      pattern: "from\\('push_subscriptions'\\)"
    - from: "supabase/functions/push-dispatch/index.ts"
      to: "notification_category_config.urgent_escalation"
      via: "quiet-hours urgent override read"
      pattern: "urgent_escalation"
    - from: "supabase/functions/push-dispatch/index.ts"
      to: "posthog-server captureServer"
      via: "telemetry"
      pattern: "captureServer"
---

<objective>
Build `push-dispatch` — the #1 deliverable of Phase 54. A standalone service-role Edge Fn that fans a single (user_id, category, payload) notification out across ALL of a user's registered push tokens (web VAPID, iOS APNs, Android FCM), enforcing quiet-hours with an urgent override, auto-pruning failing tokens, and emitting per-platform PostHog telemetry.

Purpose: cron and notification-originating callers need one entry point that reaches every device a user owns, not just web. This is the cross-platform fan-out the rest of the milestone's reminders/alerts depend on.
Output: supabase/functions/push-dispatch/index.ts (turns the 54-01 RED Deno scaffold GREEN).
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
@supabase/functions/notification-send/index.ts
@supabase/functions/_shared/notification-types.ts

<interfaces>
<!-- The 54-01 scaffold supabase/functions/push-dispatch/index.test.ts defines the
     contract this file must satisfy. Read it first; implement __internal to match. -->

<!-- Service-role bearer + constant-time pattern — copy from notification-send/index.ts
     handleSend(): bearerFromReq(req); expected = SUPABASE_SERVICE_ROLE_KEY; constantTimeEqual. -->

<!-- Lazy admin Proxy + setAdminForTest/resetAdminForTest — copy from push-subscribe/index.ts
     lines 51-81. Expose via __internal so the Deno test can inject a mock DB client. -->

<!-- Deno.serve guard (avoid test-runner trap) — from push-subscribe lines 168-181:
     const denoGlobal:any=(globalThis as any).Deno; if(denoGlobal?.serve){denoGlobal.serve(handler);} -->

<!-- captureServer signature (supabase/functions/_shared/posthog-server.ts):
     captureServer({ userId: string, event: string, properties?: Record<string,unknown> }): void
     userId REQUIRED (throws if empty). -->

<!-- notification_category_config row shape (CategoryConfig in notification-types.ts):
     { category, daily_cap, weekly_cap, urgent_escalation, push_enabled_default,
       email_enabled_default, in_app_enabled_default } -->

<!-- profiles.timezone is an IANA name (e.g. 'America/New_York'), exists since Phase 38
     (20270705000009_phase38_profiles_timezone.sql). Fallback 'UTC'. -->

<!-- 54-01 added platform/device_token/failure_count to push_subscriptions:
     web row: { id, user_id, endpoint, p256dh, auth, platform:'web', failure_count }
     native row: { id, user_id, device_token, platform:'ios'|'android', failure_count } -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: push-dispatch core — auth, body validation, subscription load, quiet-hours gate</name>
  <files>supabase/functions/push-dispatch/index.ts</files>
  <behavior>
    - Rejects non-service-role bearer with 401 (constant-time compare).
    - Validates body { user_id (uuid), category (enum), payload (object), urgency? } — 400 on bad shape.
    - Loads the user's push_subscriptions (all platforms), the notification_category_config row for the category, and profiles.timezone in parallel.
    - isQuietHours(timezone, now): true when local hour >= 22 OR < 8 (22:00-08:00 user-tz). Pure + exported via __internal.
    - When isQuietHours AND NOT cfg.urgent_escalation → respond 200 { skipped: 'quiet_hours', tz } and send nothing (PUSH-07).
    - When isQuietHours AND cfg.urgent_escalation (clinic-alerts) → proceed to deliver (Pitfall 3 / patient-safety override). MUST read cfg.urgent_escalation, NEVER a client-supplied urgency flag.
  </behavior>
  <action>
    Implement the handler skeleton for push-dispatch per PUSH-04/07. Reuse notification-send's service-role bearer + constantTimeEqual gate and the push-subscribe lazy-admin Proxy with setAdminForTest/resetAdminForTest exposed via __internal. Body validation reuses the Category Set from _shared/notification-types.ts (now includes helpdesk-reply). Add isQuietHours(timezone, now) computed via `new Date(now.toLocaleString('en-US',{timeZone: tz})).getHours()` (Deno V8 Intl supports IANA). Load context in parallel: subscriptions (select id, platform, endpoint, p256dh, auth, device_token, failure_count where user_id), category config row, profiles.timezone (fallback 'UTC'). Apply the quiet-hours gate using cfg.urgent_escalation as the ONLY urgency authority. Mirror the D-13 PHI gate from notification-send for clinic-alerts ({subject, deeplink} only) before fan-out. Guard Deno.serve. Export __internal { handler, isQuietHours, validateBody, setAdminForTest, resetAdminForTest }.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts 2>&1 | grep -Eq "quiet|passed" && echo PASS</automated>
  </verify>
  <done>Service-role gate, body validation, parallel context load, and quiet-hours gate (with urgent override via cfg.urgent_escalation) all pass their scaffolded tests.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Per-platform fan-out with injectable transports + fail-soft secrets</name>
  <files>supabase/functions/push-dispatch/index.ts</files>
  <behavior>
    - web rows → web-push/VAPID via npm:web-push@3.6.7 (copy defaultPushFn from notification-send).
    - ios rows → APNs HTTP/2: ES256 JWT signed with crypto.subtle from APNS_PRIVATE_KEY_P8 (PKCS#8 PEM); POST to api.sandbox.push.apple.com when APNS_SANDBOX!='false', else api.push.apple.com; headers apns-topic=APNS_BUNDLE_ID, apns-push-type='alert', apns-priority urgent?'10':'5'.
    - android rows → FCM HTTP v1: google-auth-library@9 JWT(client_email,private_key, firebase.messaging scope).authorize() → Bearer; POST to fcm.googleapis.com/v1/projects/{project_id}/messages:send.
    - Each platform transport is injectable (setWebFnForTest/setApnsFnForTest/setFcmFnForTest or one setTransportsForTest) so the Deno test mocks all three without real vendors.
    - Fail-soft: if a platform's required secret env is empty, that platform is skipped (logged, no throw, no crash) — PUSH-01 VAPID is provisioned; APNs/FCM pending → skip gracefully.
    - APNs JWT cached at module scope with expiry check (re-sign within 60s of 1h expiry) per Pitfall 1.
  </behavior>
  <action>
    Implement the three transports and the fan-out loop per Research Patterns 2/3 + Don't-Hand-Roll. Copy the web-push defaultPushFn verbatim from notification-send/index.ts (lines 137-155). APNs: signApnsJwt(teamId,keyId,p8) using crypto.subtle importKey('pkcs8', ECDSA P-256, ['sign']) + sign(ECDSA SHA-256); base64url via the SQL-safe replace chain (+→-, /→_, strip =); pemToBuffer strips PEM headers + base64-decodes. FCM: import { JWT } from 'npm:google-auth-library@9'. Read all vendor secrets with `?? ''` and skip the platform when empty (fail-soft). Make transports injectable via __internal seams mirroring notification-send's _pushFn pattern. Module-scope APNs JWT cache with `let _apnsJwt=''; let _apnsJwtExpiry=0;` re-sign guard. Do NOT echo device tokens or APNs/FCM response bodies into logs (T-54-02-02 information disclosure). Do NOT add new npm packages to package.json — google-auth-library and web-push are Deno `npm:` imports, no install.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts 2>&1 | grep -Eq "fan|platform|passed" && grep -q "google-auth-library@9" supabase/functions/push-dispatch/index.ts && grep -q "crypto.subtle" supabase/functions/push-dispatch/index.ts && echo PASS</automated>
  </verify>
  <done>web/APNs/FCM transports implemented and injectable; missing secrets skip the platform without crashing; APNs JWT expiry-cached; fan-out tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Failure-count prune + per-platform PostHog telemetry</name>
  <files>supabase/functions/push-dispatch/index.ts</files>
  <behavior>
    - On delivery success for a row: update failure_count=0.
    - On delivery failure: newCount = failure_count+1; if newCount >= 3 → DELETE the row (auto-prune); else update failure_count=newCount (PUSH-08).
    - Emit captureServer push_sent (per attempt), push_delivered (per success), push_failed (per failure), each with { platform, category } properties and the Supabase user_id as distinct_id.
    - Response body: { sent, failed, pruned, skipped_quiet_hours }.
  </behavior>
  <action>
    Implement handleDeliveryResult(admin,row,success) per Research Pattern 5 (increment+check+delete using the failure_count loaded with the row, not a re-fetch). Wire captureServer({ userId: user_id, event, properties:{ platform, category } }) for push_sent/push_delivered/push_failed (no PHI in properties per D-12 — platform + category only). Aggregate counts and return the response shape. Ensure telemetry fires even when a platform is fail-soft-skipped is NOT counted as failed (skipped != failed). Confirm the full 54-01 scaffold suite is GREEN.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts 2>&1 | grep -Eq "ok \(|passed" && grep -q "captureServer" supabase/functions/push-dispatch/index.ts && grep -q "failure_count" supabase/functions/push-dispatch/index.ts && echo PASS</automated>
  </verify>
  <done>failure_count increments + deletes at 3; success resets to 0; push_sent/delivered/failed telemetry with platform+category props; all 54-01 push-dispatch scaffold tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| cron/caller → push-dispatch | service-role bearer required; untrusted body |
| push-dispatch → APNs/FCM/web-push | vendor APIs over TLS with signed JWT / VAPID |
| push-dispatch → PostHog | server-side telemetry; must exclude PHI |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-02-01 | Spoofing | push-dispatch entry | mitigate | constant-time service-role bearer check (copy notification-send gate) |
| T-54-02-02 | Information Disclosure | APNs/FCM error logging | mitigate | never log device_token or vendor response body |
| T-54-02-03 | Tampering | quiet-hours urgency override | mitigate | urgency derived from DB cfg.urgent_escalation, never client payload (Pitfall 3) |
| T-54-02-04 | Information Disclosure | clinic-alerts payload | mitigate | reuse D-13 PHI gate ({subject, deeplink} only) before fan-out |
| T-54-02-05 | Information Disclosure | PostHog properties | mitigate | properties limited to { platform, category }; no payload contents |
| T-54-02-SC | Tampering | npm:google-auth-library@9 / web-push | accept | Deno npm: imports (no install/postinstall); both [ASSUMED]-approved official orgs in RESEARCH legitimacy audit |
</threat_model>

<verification>
- `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts` — all GREEN.
- Quiet-hours urgent override case explicitly GREEN (clinic-alerts at 23:00 UTC delivers).
- No real vendor calls in tests (transports mocked via __internal seams).
</verification>

<success_criteria>
push-dispatch fans out web+iOS+Android, enforces quiet-hours with cfg.urgent_escalation override, prunes at 3 failures, emits push_sent/delivered/failed with platform+category, fail-soft on missing APNs/FCM secrets, and turns the entire 54-01 push-dispatch scaffold GREEN.
</success_criteria>

<output>
Create `.planning/phases/54-push-notifications/54-02-SUMMARY.md` when done. Note which vendor secrets are still pending (APNs/FCM) and that on-device delivery defers to Phase 70 HUMAN-UAT.
</output>
