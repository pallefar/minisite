---
phase: 54-push-notifications
plan: 05
type: execute
wave: 3
depends_on: [54-01, 54-03]
files_modified:
  - leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx
  - leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx
autonomous: false
requirements: [PUSH-05, PUSH-06]
user_setup: []
must_haves:
  truths:
    - "NotificationsSubtab shows a quiet-hours section stating the fixed 22:00-08:00 window in the user's timezone"
    - "User sees their detected timezone (from profile, fallback UTC) in the quiet-hours section"
    - "On native, the Enable-push button uses registerForPush (soft-prompt) instead of the web VAPID path"
    - "helpdesk-reply appears in the category matrix with a human label"
  artifacts:
    - path: "leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx"
      provides: "quiet-hours UI section + helpdesk-reply label/matrix + native permission branch"
      contains: "Quiet hours"
  key_links:
    - from: "leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx"
      to: "registerForPush"
      via: "native enable-push branch"
      pattern: "registerForPush"
    - from: "leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx"
      to: "profiles.timezone"
      via: "quiet-hours timezone display"
      pattern: "timezone|timeZone"
---

<objective>
Extend the existing DS-compliant NotificationsSubtab with a quiet-hours section, surface the helpdesk-reply category in the matrix, and route the Enable-push button through the native soft-prompt path on native platforms.

Purpose: users need visibility into the quiet-hours window enforced server-side by push-dispatch, control over the helpdesk-reply category, and a working permission flow on native devices. No new visual surface (UI-SPEC skipped per D — reuses DS primitives in the existing subtab).
Output: NotificationsSubtab.tsx quiet-hours section + helpdesk-reply wiring + native enable branch.
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
@.planning/phases/54-push-notifications/54-03-SUMMARY.md
@leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx
@leanshot/src/lib/notifications/types.ts

<interfaces>
<!-- NotificationsSubtab constants to extend (current shape):
     CATEGORY_LABEL: Record<Category,string> — add 'helpdesk-reply': 'Helpdesk replies'
     MATRIX_CATEGORIES: ['dose-reminders','ai-insights','clinic-alerts','billing','marketing']
       — append 'helpdesk-reply' so it appears in the 6×3 matrix.
     DEFAULT_ENABLED: Record<Category,Record<Channel,boolean>> — add helpdesk-reply
       { email:true, 'web-push':true, 'in-app':true } (matches the config seed from 54-01).
     Because MATRIX_CATEGORIES type is Exclude<Category, `${string}_digest`>, helpdesk-reply
     (not a digest) is allowed. -->

<!-- Existing permission flow (line ~176): requestPushPermission({ fromUserGesture: true })
     from '@/lib/notifications/permission' (web VAPID). On native, branch to
     registerForPush(accessToken, supabaseUrl) from '@/lib/native/push' (54-03).
     Use detectPlatform() from '@/lib/native/platform' to decide which path. -->

<!-- Quiet-hours is a FIXED 22:00-08:00 window (CONTEXT — only timezone is per-user,
     already in profiles.timezone). NO new DB column. The UI is informational:
     show the window + the user's detected timezone. An optional enable/disable toggle
     may write to a client preference, but server enforcement is unconditional in
     push-dispatch — do NOT imply the UI toggle disables server quiet-hours unless a
     backing column exists (it does not). Keep copy accurate: "Non-urgent push is
     paused 22:00-08:00 in your timezone (<tz>). Urgent clinic alerts always deliver." -->

<!-- User timezone: read from the profile (the subtab already loads signedIn user;
     fetch profiles.timezone via supabase or reuse an existing profile selector if present).
     Fallback to Intl.DateTimeFormat().resolvedOptions().timeZone then 'UTC'. -->

<!-- DS primitives available: Card/CardHeader, Pill, Button, Badge (src/components/ui/*).
     Reuse the existing section styling in this file — no net-new visual language. -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: helpdesk-reply in matrix + quiet-hours info section</name>
  <files>leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx</files>
  <action>
    Per PUSH-06 + PUSH-07 (UI surface). (1) Add 'helpdesk-reply':'Helpdesk replies' to CATEGORY_LABEL, append 'helpdesk-reply' to MATRIX_CATEGORIES, and add its DEFAULT_ENABLED row { email:true,'web-push':true,'in-app':true } (matching the 54-01 config seed). The matrix becomes 6 rows. (2) Add a "Quiet hours" section (reuse the existing Card/section styling — no new DS) showing: the fixed window "22:00-08:00", the user's detected timezone (profiles.timezone, fallback Intl resolved tz then 'UTC'), and accurate copy that non-urgent push is paused in that window while urgent clinic alerts always deliver. Do NOT claim a UI toggle disables server-side quiet-hours (no backing column — enforcement is unconditional in push-dispatch). Read the timezone via the existing supabase client already imported in this file. Preserve the existing 5-row snapshot ordering for the original categories (append helpdesk-reply last).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -q "helpdesk-reply" src/components/dashboard/settings/NotificationsSubtab.tsx && grep -qi "quiet hours" src/components/dashboard/settings/NotificationsSubtab.tsx && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -v "^$" | grep -c "NotificationsSubtab" | grep -q "^0$" && echo PASS</automated>
  </verify>
  <done>helpdesk-reply in matrix + label + defaults; quiet-hours section shows window + timezone with accurate copy; typechecks.</done>
</task>

<task type="auto">
  <name>Task 2: Native soft-prompt branch on the Enable-push button</name>
  <files>leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx</files>
  <action>
    Per PUSH-05. In the existing enable-push click handler (currently always calls requestPushPermission for web VAPID), branch on detectPlatform() from '@/lib/native/platform': native ('ios'|'android') → call registerForPush(accessToken, supabaseUrl) from '@/lib/native/push' (54-03), where accessToken is the signed-in user's Supabase session access token and supabaseUrl is the configured Supabase URL; web → keep the existing requestPushPermission({ fromUserGesture: true }) path. Surface the registerForPush result via the existing toast pattern (success/decline). Keep the gesture-gate guarantee (handler runs from the user click). Do NOT move native logic into permission.ts (keep web/native separated).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -q "registerForPush" src/components/dashboard/settings/NotificationsSubtab.tsx && grep -q "detectPlatform" src/components/dashboard/settings/NotificationsSubtab.tsx && echo PASS</automated>
  </verify>
  <done>Enable-push uses registerForPush on native and the web VAPID path on web; result toasted; gesture gate preserved.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Quiet-hours section + helpdesk-reply matrix row + native-aware Enable-push button in NotificationsSubtab, reusing existing DS primitives (no new visual surface).</what-built>
  <how-to-verify>
    1. `cd leanshot && npm run dev`, sign in, open Settings -> Notifications.
    2. Confirm the "Quiet hours" section shows 22:00-08:00 and your timezone, with copy that urgent clinic alerts always deliver.
    3. Confirm "Helpdesk replies" appears as a new row in the category × channel matrix.
    4. Confirm the layout matches the existing DS styling (no broken spacing / off-palette colors).
    On-device native push permission + actual delivery is verified at Phase 70 (needs real devices + provisioned certs) — only the web layout is checkable now.
  </how-to-verify>
  <resume-signal>Type "approved" or describe layout/copy issues.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser UI → push-subscribe / web VAPID | user-gesture-gated permission request |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-05-01 | Spoofing | misleading quiet-hours toggle | mitigate | copy states server enforcement is unconditional; no toggle implies disabling server quiet-hours without a backing column |
| T-54-05-02 | Tampering | permission request without gesture | mitigate | reuse existing fromUserGesture gate (Pitfall 3 of permission.ts) |
| T-54-05-SC | Tampering | npm/Deno installs | accept | no installs in this plan |
</threat_model>

<verification>
- `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — clean.
- `cd leanshot && npx vitest run src/components/dashboard/settings/NotificationsSubtab.test.tsx` (if extended) — GREEN.
- Human verify: quiet-hours section + helpdesk-reply row render correctly in DS.
</verification>

<success_criteria>
NotificationsSubtab shows an accurate quiet-hours section with the user's timezone, surfaces helpdesk-reply in the matrix, and routes Enable-push through the native soft-prompt on native while keeping the web VAPID path — all in the existing DS with no net-new surface.
</success_criteria>

<output>
Create `.planning/phases/54-push-notifications/54-05-SUMMARY.md` when done. Note on-device native permission UX defers to Phase 70 HUMAN-UAT.
</output>
