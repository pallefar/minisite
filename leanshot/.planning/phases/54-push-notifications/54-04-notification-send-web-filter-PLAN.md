---
phase: 54-push-notifications
plan: 04
type: execute
wave: 2
depends_on: [54-01]
files_modified:
  - supabase/functions/notification-send/index.ts
  - supabase/functions/notification-send/index.test.ts
autonomous: true
requirements: [PUSH-06]
user_setup: []
must_haves:
  truths:
    - "notification-send's fanOutPush only delivers to platform='web' rows (native rows are push-dispatch's job, no double-send)"
    - "helpdesk-reply is accepted by notification-send's VALID_CATEGORIES"
    - "Existing notification-send web-push + email + in-app behavior is unchanged for the original categories"
  artifacts:
    - path: "supabase/functions/notification-send/index.ts"
      provides: "web-only push filter + helpdesk-reply category"
      contains: "helpdesk-reply"
  key_links:
    - from: "supabase/functions/notification-send/index.ts"
      to: "push_subscriptions platform='web'"
      via: "fanOutPush .eq('platform','web')"
      pattern: "\\.eq\\('platform', ?'web'\\)"
---

<objective>
Prevent double-send between the existing notification-send Fn and the new push-dispatch Fn, and accept the new helpdesk-reply category.

Purpose: after 54-01 adds the platform column, notification-send's fanOutPush would otherwise iterate native (APNs/FCM) rows it cannot deliver (it only knows the web-push shape). Restricting it to platform='web' makes notification-send the web channel and push-dispatch the cross-platform channel — no overlap, no circular Fn calls (Pitfall 6, Open Question 1). Also wires helpdesk-reply through (PUSH-06).
Output: notification-send/index.ts web filter + VALID_CATEGORIES widening.
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
@supabase/functions/notification-send/index.ts
@supabase/functions/_shared/notification-types.ts

<interfaces>
<!-- fanOutPush (notification-send/index.ts ~line 371): currently
     admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId)
     Add .eq('platform', 'web') so native rows are excluded. -->

<!-- VALID_CATEGORIES Set (line 169) currently has 9 categories. Add 'helpdesk-reply'.
     54-01 already added helpdesk-reply to the _shared/notification-types.ts Category union,
     so the Set member type-checks. -->

<!-- Existing test file supabase/functions/notification-send/index.test.ts uses
     setPushFnForTest + a mock admin; the platform='web' filter must not break the
     mock query chain (mock returns rows regardless of .eq — confirm or extend the mock). -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Restrict fanOutPush to platform='web' + add helpdesk-reply category</name>
  <files>supabase/functions/notification-send/index.ts</files>
  <action>
    Per PUSH-06 / Pitfall 6 / Open Question 1 (filter approach, NOT Fn-to-Fn calls). In fanOutPush, add `.eq('platform', 'web')` to the push_subscriptions select so notification-send only delivers web rows (native APNs/FCM rows are push-dispatch-only). Add 'helpdesk-reply' to the VALID_CATEGORIES Set (line 169) with a brief non-comment-defeating note in the commit message (not a code comment naming a rejected alternative). The Category union member already exists from 54-01. Do NOT alter the email/in-app fan-out paths or the PHI gate. Do NOT call push-dispatch from notification-send (avoid circular Fn calls).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "\.eq('platform', 'web')" supabase/functions/notification-send/index.ts && grep -q "helpdesk-reply" supabase/functions/notification-send/index.ts && echo PASS</automated>
  </verify>
  <done>fanOutPush filters platform='web'; helpdesk-reply in VALID_CATEGORIES; email/in-app paths untouched.</done>
</task>

<task type="auto">
  <name>Task 2: Test coverage — web-only filter + helpdesk-reply accepted</name>
  <files>supabase/functions/notification-send/index.test.ts</files>
  <action>
    Add Deno tests: (1) helpdesk-reply passes validateBody (was previously category_invalid) — assert via __internal.validateBody with a helpdesk-reply body. (2) The web-only filter: extend the existing mock admin so its push_subscriptions query records the .eq('platform','web') call (or returns only web rows), and assert fanOutPush does not attempt delivery to a native row. Reuse the existing setPushFnForTest mock pattern. Keep the existing T1-T8 tests passing (do not regress the clinic-alerts urgency / PHI gate tests).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/notification-send/index.test.ts 2>&1 | grep -Eq "ok \(|passed" && grep -q "helpdesk-reply" supabase/functions/notification-send/index.test.ts && echo PASS</automated>
  </verify>
  <done>New tests for helpdesk-reply acceptance + web-only filter pass; existing notification-send suite still GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller → notification-send | service-role bearer (existing); category enum gate |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-04-01 | Tampering | category set drift | mitigate | helpdesk-reply added to VALID_CATEGORIES in same plan the DB CHECK (54-01) accepts it (Pitfall 4) |
| T-54-04-02 | Repudiation | double-send native rows | mitigate | platform='web' filter scopes notification-send to web only; push-dispatch owns native (no overlap) |
| T-54-04-SC | Tampering | npm/Deno installs | accept | no installs in this plan |
</threat_model>

<verification>
- `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/notification-send/index.test.ts` — all GREEN incl. new cases.
- Existing T1-T8 (PHI gate, urgency=high) unchanged.
</verification>

<success_criteria>
fanOutPush delivers only platform='web' rows; helpdesk-reply accepted; no circular Fn calls; existing notification-send behavior preserved.
</success_criteria>

<output>
Create `.planning/phases/54-push-notifications/54-04-SUMMARY.md` when done.
</output>
