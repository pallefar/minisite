---
phase: 55-healthkit-two-tunnel-firewall
plan: "04"
subsystem: healthkit-ui
tags: [healthkit, consent, privacy, settings, ios, hipaa]
dependency_graph:
  requires: [55-03]
  provides: [HealthKitConsentModal, HealthKitSettingsSection, SettingsPage-healthkit-section]
  affects: [leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy, leanshot/src/components/dashboard/settings/SettingsPage.tsx]
tech_stack:
  added: []
  patterns: [TDD-RED-GREEN, useConfirm-gate, detectPlatform-guard, Modal-consent-gate]
key_files:
  created:
    - leanshot/src/components/healthkit/HealthKitConsentModal.tsx
    - leanshot/src/components/healthkit/HealthKitSettingsSection.tsx
    - leanshot/src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx
    - leanshot/src/components/healthkit/__tests__/HealthKitSettingsSection.test.tsx
  modified:
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx
    - leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy
    - leanshot/scripts/audit-privacy-manifest.mjs
decisions:
  - "detectPlatform() guard used in both components (not @capacitor/core directly) per two-tunnel firewall rule"
  - "Consent modal dismissible=false+hideClose=true — HIPAA opt-in gate, no ambient dismiss path"
  - "audit-privacy-manifest.mjs updated: Health rule now enforces Linked=true (not false) per HEALTH-05"
  - "SettingsPage NAV entry shows HealthKit section to all users; non-iOS gets unavailable message in component"
metrics:
  duration_minutes: 35
  completed: "2026-05-25T13:16:29Z"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 7
---

# Phase 55 Plan 04: HealthKit Consent UI + Settings + PrivacyInfo Fix Summary

HIPAA opt-in consent modal (HealthKitConsentModal), Settings revoke/purge controls (HealthKitSettingsSection), SettingsPage wiring, and Apple §5.1.3-compliant PrivacyInfo.xcprivacy Health-entry correction.

## What Was Built

### Task 1: HealthKitConsentModal (HEALTH-02, UI-SPEC Screen 1)

`leanshot/src/components/healthkit/HealthKitConsentModal.tsx` — 140 lines

HIPAA-consent-critical modal per UI-SPEC Screen 1:
- Full HIPAA disclosure: lead paragraph, 7 data-type rows with icons, firewall guarantee card (Shield icon, `--color-primary-soft` background), retention + revoke-path disclosures
- Acknowledgement checkbox unchecked by default; primary CTA disabled + `aria-disabled` until checked
- On "Connect Apple Health": calls `requestHealthKitAuthorization()` → success toast ("Apple Health connected. Syncing your data...") + `onConnected`; or error toast ("Apple Health access was denied. Grant access in iOS Settings > Privacy > Health > LeanShot.")
- Dismissible=false, hideClose=true — no ESC/backdrop dismiss path (consent gate)
- Platform guard: non-iOS shows "Apple Health sync is only available on iPhone." message only; no consent controls
- Accent (`--color-primary`) reserved for primary CTA + checkbox only per UI-SPEC §Color
- 21 vitest+RTL tests — all green

### Task 2: HealthKitSettingsSection + SettingsPage wiring (HEALTH-07, UI-SPEC Screens 2-4)

`leanshot/src/components/healthkit/HealthKitSettingsSection.tsx` — 230 lines

Three-state settings card:
- **connected**: "Connected" success badge, last-sync caption, Auto-sync Pill toggle (active), "Sync now" tonal button (Loader2 + "Syncing..." in-flight), "Revoke HealthKit access" destructive button
- **revoked**: "Access revoked" danger badge, status line, "Reconnect" tonal button, "Delete imported Apple Health data" destructive button + purge copy
- **not-connected**: "Connect Apple Health" primary CTA → opens HealthKitConsentModal

Revoke gated by useConfirm (title: "Revoke Apple Health access?", confirmLabel: "Revoke access", cancelLabel: "Keep connected", destructive: true) → `revokeAccess()` → success toast verbatim from UI-SPEC.

Purge gated by useConfirm (title: "Delete imported Apple Health data?", confirmLabel: "Delete imported data", cancelLabel: **"Keep my data"**, destructive: true) → `purgeImportedData()` → success toast verbatim.

Non-iOS: unavailable message only ("Apple Health sync is only available on iPhone."), no interactive controls.

`leanshot/src/components/dashboard/settings/SettingsPage.tsx` — widened `Section` union with `'healthkit'`, added `{ id: 'healthkit', label: 'HealthKit', Icon: Heart }` NAV entry, render branch with `<HealthKitSettingsSection />`.

16 vitest+RTL tests — all green.

### Task 3: PrivacyInfo.xcprivacy §5.1.3 correction (HEALTH-05)

`leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy`:
- `NSPrivacyCollectedDataTypeLinked`: `<false/>` → `<true/>` — imported health data IS linked to the user account (hk_source='apple_health' rows in weights/sleep/workouts tables)
- `NSPrivacyCollectedDataTypePurposeAnalytics` removed — Apple §5.1.3 bans HealthKit data for analytics
- AppFunctionality-only purpose is §5.1.3-compliant

`leanshot/scripts/audit-privacy-manifest.mjs` updated (Rule 1 auto-fix — outdated D-18 rule):
- Health Linked rule updated: false→true
- New check: Analytics must be ABSENT for Health entry
- New check: AppFunctionality must be PRESENT for Health entry
- `node audit-privacy-manifest.mjs` passes cleanly

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run ... src/components/healthkit/` | 37 tests / 2 files PASS |
| `npm run typecheck` | PASS (clean) |
| `node scripts/audit-privacy-manifest.mjs` | PASS — 0 warnings |
| Health entry AppFunctionality present | YES |
| Health entry Analytics absent | YES |
| Health entry Linked=true | YES |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated audit-privacy-manifest.mjs to allow Linked=true for Health entry**
- **Found during:** Task 3 verification
- **Issue:** The audit script had a Phase 16 D-18 rule requiring `NSPrivacyCollectedDataTypeLinked=<false/>` for Health — directly contradicting the plan's HEALTH-05 requirement to set `<true/>`. The original rule was wrong because health data imported from Apple Health IS linked to the user's account.
- **Fix:** Updated the Health check in `audit-privacy-manifest.mjs` from `linked !== 'false'` to `linked !== 'true'`, and added §5.1.3 analytics-absence + AppFunctionality-presence checks.
- **Files modified:** `leanshot/scripts/audit-privacy-manifest.mjs`
- **Commit:** db718b68 (included in Task 3 commit)

**2. [Rule 1 - Bug] Fixed test import ordering to satisfy eslint import-x/order**
- **Found during:** Task 2 lint check
- **Issue:** Test files had `@/lib/*` imports before `@/hooks/*`, violating alphabetical import-group ordering.
- **Fix:** Reordered imports in both test files to `@/hooks/*` before `@/lib/*`.
- **Files modified:** Both test files

## Known Stubs

None — all 7 data-type disclosure rows are real (per UI-SPEC copy table), all state transitions wire to real health.ts functions, last-sync label shows "Never" on first load (correct initial state, updates after `syncNow`).

## Phase 70 Device-Gated Items (Deferred)

The following items require a real iOS device and App Store context — deferred to Phase 70 HUMAN-UAT:

1. **Live iOS permission prompt** — `requestHealthKitAuthorization()` must be tested on a real device to verify the iOS system permission dialog appears correctly.
2. **Consent → read flow** — end-to-end: consent modal → auth → background sync → verify data appears in logs.
3. **Apple manifest review** — App Store Connect submitting updated PrivacyInfo.xcprivacy and verifying the reviewer can see Health/AppFunctionality correctly in the Privacy Nutrition Label.
4. **Auto-sync Pill toggle** → Revoke confirmation — verified in tests with mocks; live device walkthrough needed.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| a4b22fd3 | test | add failing test for HealthKitConsentModal (RED) |
| b3c9bcac | feat | implement HealthKitConsentModal (HEALTH-02, UI-SPEC Screen 1) |
| e7ac8d48 | test | add failing test for HealthKitSettingsSection (RED) |
| 8637e4a3 | feat | implement HealthKitSettingsSection + SettingsPage wiring (HEALTH-07) |
| db718b68 | fix | PrivacyInfo.xcprivacy Health-entry §5.1.3 correction (HEALTH-05) |

## Self-Check: PASSED

- [x] `leanshot/src/components/healthkit/HealthKitConsentModal.tsx` — EXISTS (created)
- [x] `leanshot/src/components/healthkit/HealthKitSettingsSection.tsx` — EXISTS (created)
- [x] `leanshot/src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx` — EXISTS (created)
- [x] `leanshot/src/components/healthkit/__tests__/HealthKitSettingsSection.test.tsx` — EXISTS (created)
- [x] `leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy` — MODIFIED (Analytics removed, Linked=true)
- [x] All commits exist: a4b22fd3, b3c9bcac, e7ac8d48, 8637e4a3, db718b68
- [x] 37 tests green, tsc clean, audit script passes
