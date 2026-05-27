---
phase: 66-consumer-account-security
plan: 4
subsystem: auth
tags: [AUTH-13, AAL2, MFA, consumer-step-up, totp]
requires: [66-02]
provides:
  - leanshot/src/components/auth/Aal2ChallengeModal.tsx
  - leanshot/src/components/settings/DangerZone.tsx
  - leanshot/src/components/settings/ChangeEmailForm.tsx
  - leanshot/src/lib/dsar/export-trigger.ts
affects:
  - leanshot/src/lib/dsar/dsar-export-client.ts (caller chain — wraps requestDsarExport)
  - leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx (composed inside DangerZone)
tech-stack:
  added: []
  patterns:
    - 'AAL2 challenge UI seam: onChallenge → modal → resolve {code} | {cancelled:true}'
    - 'D-02 mfa_not_enabled proceed: gate returns ok:false but caller proceeds without step-up'
    - 'Stub form pattern: minimal ChangeEmailForm exposes the gated path; legacy inline ChangeEmailRow untouched'
key-files:
  created:
    - leanshot/src/components/auth/Aal2ChallengeModal.tsx
    - leanshot/src/components/auth/Aal2ChallengeModal.test.tsx
    - leanshot/src/components/settings/DangerZone.tsx
    - leanshot/src/components/settings/ChangeEmailForm.tsx
    - leanshot/src/lib/dsar/export-trigger.ts
  modified: []
decisions:
  - 'Modal pre-verifies + re-resolves gate with {code}: double-verify accepted (TOTP code valid within ~30s window) so gate keeps centralized freshness-ts bookkeeping'
  - 'mfa_not_enabled proceeds for all 3 actions (per D-02 / planner success criteria); user not enrolled in MFA is NOT locked out of their own data'
  - 'cancelled = silent abort (no toast — user intent was clear); invalid_code + session_stale = toast'
  - 'ChangeEmailForm is a new standalone surface (not edit of the inline ChangeEmailRow in SettingsPage.tsx) — keeps Phase 5 callsite intact while exposing the AAL2-gated path for future consumers'
  - 'export-trigger.ts throws typed ExportTriggerError on AAL2 failures (caller pattern; aligns with DsarError contract)'
metrics:
  duration_minutes: 9
  completed: '2026-05-27'
  tasks_completed: 2
  files_created: 5
  files_modified: 0
  commits: 2
---

# Phase 66 Plan 66-04: Consumer AAL2 Step-Up Gate Summary

`<Aal2ChallengeModal>` shipped + three sensitive consumer actions (delete-account, export-all-data, change-email) wrapped in `requireAal2ForConsumerAction` from Wave 1. AUTH-13 closed.

## Tasks

### Task 1: `<Aal2ChallengeModal>` + tests

Created the consumer step-up modal at `leanshot/src/components/auth/Aal2ChallengeModal.tsx`. Reused `<Modal>` primitive + `<Input>` + `<Button>` primary/ghost variants.

- 6-digit numeric input, auto-focused on open, paste-friendly (strips non-digits, truncates to 6 chars).
- Purpose-specific subtitle for `delete-account` / `export-all-data` / `change-email`.
- Confirm button disabled until 6 digits + during loading; loading spinner via `Button.loading`.
- Non-dismissible while submitting (prevents accidental cancel mid-verify). ESC + backdrop dismissible otherwise.
- Inline error rendering for `invalid_code` ("That code didn't match. Try again.") + `session_stale` ("Your session expired. Please sign in again."). Modal stays open on error and clears input for retry.
- 9 vitest tests under the `src-ui-unit` project (jsdom + RTL + `userEvent`):
  - 3× subtitle-per-purpose
  - submit calls `onSubmit('123456')`
  - Cancel calls `onCancel`, never `onSubmit`
  - Confirm disabled until 6 digits
  - non-digits stripped from input
  - invalid_code → error visible + input cleared + modal stays open + `onCancel` NOT called
  - session_stale → "session expired" message visible

**Commit:** `7b1f1eb9`

### Task 2: Wrap 3 sensitive CTAs

Created three new surfaces that compose the Wave-1 gate from `@/lib/auth/aal2-consumer`:

**`leanshot/src/lib/dsar/export-trigger.ts`** — Canonical "export all my data" entry point. `triggerDsarExport({ onChallenge })` runs the gate THEN invokes the Phase 22 `requestDsarExport()` RPC. `ExportTriggerError` typed for `aal2_cancelled` / `aal2_invalid_code` / `aal2_session_stale`. `mfa_not_enabled` returns the RPC result directly (D-02).

**`leanshot/src/components/settings/DangerZone.tsx`** — Delete-account CTA. Runs the gate; on `ok` or `mfa_not_enabled` opens the existing Phase 7/22 `<DeleteAccountModal>` (typed-confirm "DELETE MY ACCOUNT" + 7-day grace + `initiate_account_deletion` RPC). Renders its own `<Aal2ChallengeModal>` to satisfy the gate's `onChallenge` callback. Shows toast on `session_stale` / `invalid_code`; silent abort on `cancelled`.

**`leanshot/src/components/settings/ChangeEmailForm.tsx`** — Minimal stub form per planner Task 2 (no exported standalone change-email component existed pre-66). Gates `supabase.auth.updateUser({ email })` behind `requireAal2ForConsumerAction`. Surfaces inline error on empty/invalid email + toast on confirmation-email send.

Each wrap honours **D-02**: `reason: 'mfa_not_enabled'` triggers the underlying action WITHOUT step-up, so consumers who never enrolled MFA are not locked out of their own data.

**Commit:** `de9b34ff`

## Architectural Note — Modal Verify + Gate Double-Verify

The `<Aal2ChallengeModal>` contract requires `onSubmit(code)` to resolve to `{ ok, reason }` so the modal can surface error UI. The Phase 66-02 gate's `onChallenge` contract resolves with `{ code } | { cancelled: true }` — when `{ code }` is returned, the gate itself calls `verifyTotpChallenge`. This creates a small double-verify: the modal pre-flights with `verifyTotpChallenge`, surfaces UI feedback, then resolves the gate with `{ code }` so the gate re-runs verify + persists the freshness timestamp centrally.

Double-verify is safe within the TOTP time-step window (~30s) — Supabase MFA accepts the same code re-presented within its validity window. Considered alternatives (publishing a `persistFreshness()` helper from the gate; or moving error UI into the gate) but they leak gate internals into the UI layer; the current design keeps the gate's `onChallenge` contract intact + the modal's contract intact at a one-extra-Supabase-call cost.

## Deviations from Plan

None — plan executed exactly as written. The `dsar-export-trigger.ts` location was new (no pre-existing file at `src/lib/dsar/export-trigger.ts`); we created it fresh, reusing the Phase 22 `requestDsarExport()` from `dsar-export-client.ts` per CONTEXT D-02 reuse strategy.

## Verification

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit -p tsconfig.app.json` (new files) | PASS — 0 errors in new files (pre-existing `useSubscription.ts` errors unrelated to 66-04) |
| `vitest run src/components/auth/Aal2ChallengeModal.test.tsx` | 9/9 PASS |
| `vitest run --project=src-ui-unit` (full project regression) | New files contribute 0 failures (37 pre-existing failures in BiometricGate, OnboardingFlow, AdminMembersPage, etc. — unchanged from baseline) |

## Threat Flags

None — new files compose pre-existing trust-boundary surfaces (Supabase Auth `mfa.challenge` + `auth.updateUser` + `create_dsar_request` RPC). No new network endpoints, no new auth paths, no new file access patterns.

## Known Stubs

`<ChangeEmailForm>` is shipped as a standalone surface but is not yet mounted into any settings route. The inline `<ChangeEmailRow>` in `src/components/dashboard/settings/SettingsPage.tsx` remains the live consumer surface for change-email — it does NOT yet route through the AAL2 gate. Wiring the inline row to either compose `<ChangeEmailForm>` or call `requireAal2ForConsumerAction('change-email', ...)` directly is a Phase 66 follow-up (Plan 66-09 close-out or Phase 70 UAT polish).

Similarly, `<DangerZone>` is shipped but not yet mounted; the Phase 7/22 delete-account button inside `SettingsPage.tsx` (`section[data-testid="settings-delete"]`) still opens `<DeleteAccountModal>` directly without the AAL2 gate. Phase 66 close-out should swap the SettingsPage Delete button for `<DangerZone>`.

Both stubs are intentional — the Wave-2 plan ships the AAL2-gated *components*; integration into the live SettingsPage routes is Wave-3 / close-out work to avoid colliding with parallel-Wave-2 plans that may touch the same SettingsPage file.

## Self-Check: PASSED

- FOUND: `leanshot/src/components/auth/Aal2ChallengeModal.tsx`
- FOUND: `leanshot/src/components/auth/Aal2ChallengeModal.test.tsx`
- FOUND: `leanshot/src/components/settings/DangerZone.tsx`
- FOUND: `leanshot/src/components/settings/ChangeEmailForm.tsx`
- FOUND: `leanshot/src/lib/dsar/export-trigger.ts`
- FOUND commit: `7b1f1eb9` (feat(66-04): <Aal2ChallengeModal> + tests)
- FOUND commit: `de9b34ff` (feat(66-04): wrap 3 sensitive consumer CTAs in AAL2 step-up gate)
