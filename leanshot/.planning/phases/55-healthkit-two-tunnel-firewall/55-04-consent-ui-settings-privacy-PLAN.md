---
phase: 55-healthkit-two-tunnel-firewall
plan: 04
type: execute
wave: 4
depends_on: [55-03]
files_modified:
  - leanshot/src/components/healthkit/HealthKitConsentModal.tsx
  - leanshot/src/components/healthkit/HealthKitSettingsSection.tsx
  - leanshot/src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx
  - leanshot/src/components/healthkit/__tests__/HealthKitSettingsSection.test.tsx
  - leanshot/src/components/dashboard/settings/SettingsPage.tsx
  - leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy
autonomous: true
requirements: [HEALTH-02, HEALTH-05, HEALTH-07]
must_haves:
  truths:
    - "Consent modal renders the full HIPAA disclosure, defaults the acknowledgement checkbox to UNCHECKED, and disables the Connect CTA until checked"
    - "On non-iOS the consent surface shows the unavailable state — no consent modal, no interactive controls"
    - "Settings HealthKit section renders connected / revoked / not-connected states with revoke + purge controls"
    - "Revoke and purge actions go through a confirmation gate (useConfirm) before calling health.ts revoke/purge"
    - "PrivacyInfo.xcprivacy Health entry drops the Analytics purpose (Apple §5.1.3) and sets Linked: true"
  artifacts:
    - path: "leanshot/src/components/healthkit/HealthKitConsentModal.tsx"
      provides: "OPT-IN consent modal per UI-SPEC Screen 1"
      min_lines: 80
    - path: "leanshot/src/components/healthkit/HealthKitSettingsSection.tsx"
      provides: "Settings card — connected/revoked/not-connected + revoke/purge (UI-SPEC Screens 2-4)"
      min_lines: 80
    - path: "leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy"
      provides: "Health data type: AppFunctionality-only purpose, Linked true"
      contains: "NSPrivacyCollectedDataTypeHealth"
  key_links:
    - from: "leanshot/src/components/healthkit/HealthKitSettingsSection.tsx"
      to: "leanshot/src/lib/native/health.ts"
      via: "revokeAccess / purgeImportedData / syncNow / isEnabled"
      pattern: "revokeAccess|purgeImportedData"
    - from: "leanshot/src/components/dashboard/settings/SettingsPage.tsx"
      to: "HealthKitSettingsSection"
      via: "new 'healthkit' Section enum + NAV entry + render branch"
      pattern: "healthkit"
    - from: "leanshot/src/components/healthkit/HealthKitConsentModal.tsx"
      to: "leanshot/src/lib/native/platform.ts"
      via: "detectPlatform iOS-guard"
      pattern: "detectPlatform"
---

<objective>
Ship the consumer-facing HealthKit consent + Settings surface (HEALTH-02 opt-in, HEALTH-07 revoke/purge UI) per the approved 55-UI-SPEC, and fix the iOS privacy manifest (HEALTH-05) so an App Store reviewer can verify the read types and the §5.1.3-compliant purpose.

Purpose: this is the only surface where the user grants, manages, and revokes HealthKit access. It is HIPAA-consent-critical: explicit opt-in (default OFF, full disclosure, firewall guarantee, revoke path) and fully keyboard/screen-reader accessible.
Output: HealthKitConsentModal + HealthKitSettingsSection + their tests, SettingsPage wiring, PrivacyInfo.xcprivacy correction.

DEPENDS ON: 55-03 (health.ts public API: isHealthKitAvailable, requestHealthKitAuthorization, syncNow, revokeAccess, isEnabled, purgeImportedData). On-device permission grant + Apple privacy-manifest review → Phase 70.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# The approved UI contract — the single source of truth for copy/states/composition:
@.planning/phases/55-healthkit-two-tunnel-firewall/55-UI-SPEC.md

# DS-primitive precedents to model on (verbatim composition patterns):
@leanshot/src/components/dashboard/settings/SettingsPage.tsx

# health.ts public API this surface consumes:
@.planning/phases/55-healthkit-two-tunnel-firewall/55-03-SUMMARY.md

<interfaces>
<!-- health.ts public API (from 55-03) — call directly, no exploration -->
  isHealthKitAvailable(): Promise<boolean>
  requestHealthKitAuthorization(): Promise<boolean>
  syncNow(start: Date, end: Date): Promise<{ [metric: string]: number }>
  isEnabled(): Promise<boolean>
  revokeAccess(): Promise<void>
  purgeImportedData(): Promise<void>

<!-- platform guard -->
  detectPlatform(): 'web' | 'ios' | 'android' | 'capacitor-web'   // from src/lib/native/platform.ts

<!-- SettingsPage.tsx wiring contract (Phase precedent: section enum widening lives with first writer) -->
  type Section = 'account' | 'profile' | ... ;   // ADD 'healthkit' to this union
  const NAV: { id: Section; label: string; Icon }[] = [ ... ];  // ADD { id:'healthkit', label:'HealthKit', Icon: Heart }
  // render: add `{section === 'healthkit' && <HealthKitSettingsSection />}` in the section-render block

<!-- DS primitives (UI-SPEC §Design System) — all from src/components/ui/ -->
  Modal (size="md", mobileFullscreen, dismissible=false, hideClose=true)  // consent gate: no ambient dismiss
  Card (variant="default"), Button (primary|ghost|tonal|destructive), Badge, Pill (toggle), useConfirm, useToast
  Icons: Heart, Shield, Loader2 (lucide-react)
  Acknowledgement checkbox: native <input type="checkbox"> default UNCHECKED, accent-[var(--color-primary)]

<!-- Accent reservation (UI-SPEC §Color) -->
  --color-primary is reserved for: the "Connect Apple Health" primary CTA + the consent checkbox accent ONLY.
  Sync now=tonal, Cancel/Not now=ghost, Revoke/Purge=destructive. ≤4 type sizes, ≤2 weights (DS-02).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: HealthKitConsentModal + test (UI-SPEC Screen 1)</name>
  <files>leanshot/src/components/healthkit/HealthKitConsentModal.tsx, leanshot/src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx</files>
  <behavior>
    - Renders modal title "Connect Apple Health", lead paragraph, firewall-guarantee card, the 7 data-type disclosure rows, retention + revoke-path disclosure, acknowledgement checkbox, "Not now" + "Connect Apple Health" buttons.
    - Acknowledgement checkbox is UNCHECKED by default.
    - "Connect Apple Health" CTA is disabled (disabled + aria-disabled) until the checkbox is checked.
    - Checking the box enables the CTA; clicking it calls requestHealthKitAuthorization.
    - On non-iOS (detectPlatform mocked to 'web'): the modal is not rendered / shows the unavailable message (no consent flow).
    - Modal is dismissible=false + hideClose=true (consent gate — no ESC/backdrop dismiss).
  </behavior>
  <action>Create `HealthKitConsentModal.tsx` exactly per UI-SPEC §Component Composition Detail (Consent Modal) and §Copywriting Contract Screen 1. Compose with DS primitives only (Modal/Card/Button/checkbox). Props: `open: boolean`, `onClose: () => void`, `onConnected?: () => void`. Use ALL copy strings verbatim from the UI-SPEC copy table (title, lead, firewall guarantee with bold **never**, 7 data-type rows, retention disclosure, revoke-path disclosure, acknowledgement label, CTA labels). Checkbox unchecked default; CTA disabled until checked; on Connect, call `requestHealthKitAuthorization()` from health.ts → on true fire success toast "Apple Health connected. Syncing your data..." + onConnected; on false fire error toast "Apple Health access was denied. Grant access in iOS Settings > Privacy > Health > LeanShot." Platform guard: if detectPlatform() !== 'ios', render the unavailable message (no consent gate) per UI-SPEC §Platform Guard / §Empty/Unavailable State. Accessibility per UI-SPEC §Accessibility Contract (focus trap via Modal, aria-hidden decorative icons, aria-disabled on the gated CTA, 44px tap targets). Accent token only on the primary CTA + checkbox. Create the vitest+RTL test covering every `<behavior>` case (mock health.ts + detectPlatform + useToast).</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx && npm run typecheck</automated>
  </verify>
  <done>Modal renders all UI-SPEC copy; checkbox default-unchecked gates the CTA; Connect calls auth; non-iOS shows unavailable; test green; typecheck pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: HealthKitSettingsSection + SettingsPage wiring + test (UI-SPEC Screens 2-4)</name>
  <files>leanshot/src/components/healthkit/HealthKitSettingsSection.tsx, leanshot/src/components/healthkit/__tests__/HealthKitSettingsSection.test.tsx, leanshot/src/components/dashboard/settings/SettingsPage.tsx</files>
  <behavior>
    - not-connected state: shows "Connect Apple Health" primary CTA → opens HealthKitConsentModal.
    - connected state: "Connected" success badge, last-sync caption, "Auto-sync enabled" Pill toggle, "Sync now" tonal button (→ "Syncing..." while in-flight), Revoke destructive button.
    - revoked state: "Access revoked" danger badge, status line, "Reconnect" + "Delete imported Apple Health data" purge button.
    - Revoke goes through a useConfirm gate ("Revoke Apple Health access?") → on confirm calls revokeAccess() → success toast.
    - Purge goes through a useConfirm gate ("Delete imported Apple Health data?") → on confirm calls purgeImportedData() → success toast.
    - non-iOS: shows only the unavailable message ("Apple Health sync is only available on iPhone."), no interactive controls.
  </behavior>
  <action>Create `HealthKitSettingsSection.tsx` per UI-SPEC §Component Composition Detail (Settings HealthKit Card) + §Copywriting Contract Screens 2-4 + §Confirmation Dialogs + §Toast Messages, modeling on the SettingsPage section-card pattern. State derives from health.ts `isEnabled()` + the sync-state (connected / revoked / not-connected). Use Badge tones: Connected→success, Access revoked→danger. Auto-sync Pill toggle OFF triggers the Revoke confirmation flow. "Sync now" disabled + Loader2 + "Syncing..." while in-flight; on done show "Sync complete." toast. Revoke + Purge use `useConfirm` with the exact UI-SPEC confirmation copy (no typed-confirm; single explicit destructive button is the gate) → call revokeAccess()/purgeImportedData() → success/error toasts verbatim. Destructive zone separated by a `border-t` divider. Platform guard: non-iOS renders only the unavailable card. Wire into SettingsPage.tsx: add `'healthkit'` to the `Section` union (with first-writer comment), add `{ id:'healthkit', label:'HealthKit', Icon: Heart }` to the NAV array (import Heart from lucide-react), and add the `{section === 'healthkit' && <HealthKitSettingsSection />}` render branch. Create the vitest+RTL test covering every `<behavior>` state + both confirmation gates (mock health.ts, useConfirm, useToast, detectPlatform).</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/components/healthkit/__tests__/HealthKitSettingsSection.test.tsx && npm run lint && npm run typecheck</automated>
  </verify>
  <done>All three states render with correct badges/controls; revoke+purge gated by confirmation then call the right health.ts fns; SettingsPage shows the new HealthKit nav section; non-iOS unavailable-only; tests + lint + typecheck green.</done>
</task>

<task type="auto">
  <name>Task 3: PrivacyInfo.xcprivacy Health-entry correction (HEALTH-05)</name>
  <files>leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy</files>
  <action>Edit the existing `NSPrivacyCollectedDataTypeHealth` dict entry (Health data type already present from Phase 53). Two corrections per RESEARCH / Pitfall 6: (1) REMOVE `NSPrivacyCollectedDataTypePurposeAnalytics` from its `NSPrivacyCollectedDataTypePurposes` array — Apple §5.1.3 bans HealthKit data for analytics; leave ONLY `NSPrivacyCollectedDataTypePurposeAppFunctionality`. (2) Change `NSPrivacyCollectedDataTypeLinked` from `<false/>` to `<true/>` — imported health data IS linked to the user account. Do NOT add an `NSPrivacyAccessedAPITypes` entry for HealthKit — it is not a Required-Reason API (RESEARCH A5). Leave the existing email/userID/photos entries untouched. The manifest must remain valid XML the existing `audit-privacy-manifest.mjs` accepts.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && node leanshot/scripts/audit-privacy-manifest.mjs 2>/dev/null; grep -A8 "NSPrivacyCollectedDataTypeHealth" leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy | grep -q "AppFunctionality" && ! (grep -A8 "NSPrivacyCollectedDataTypeHealth" leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy | grep -q "Analytics")</automated>
  </verify>
  <done>Health entry has AppFunctionality-only purpose (Analytics removed), Linked=true; manifest is valid XML; existing audit script passes; other data-type entries unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user → consent gate | explicit opt-in must be the only path to enabling HealthKit reads |
| client UI → health.ts revoke/purge | destructive actions must require explicit confirmation |
| app → App Store reviewer | privacy manifest must truthfully declare health usage + §5.1.3 purpose |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-55-04-01 | Repudiation | silent default-on HealthKit | mitigate | checkbox unchecked default + CTA disabled until checked (HIPAA opt-in gate) |
| T-55-04-02 | Tampering | accidental data purge | mitigate | useConfirm gate before purgeImportedData (UI-SPEC confirmation copy) |
| T-55-04-03 | Repudiation / App-Store rejection | manifest claims analytics use of health | mitigate | remove Analytics purpose from Health entry; Linked=true; audit-privacy-manifest.mjs gate |
| T-55-04-04 | Information Disclosure | consent UI on non-iOS implying availability | mitigate | detectPlatform()!=='ios' → unavailable state, no controls |
</threat_model>

<verification>
- `npx vitest run src/components/healthkit/` — consent + settings tests green
- `npm run lint && npm run typecheck` — clean (incl. firewall rules; consent UI imports platform.ts not @capacitor/core)
- `node leanshot/scripts/audit-privacy-manifest.mjs` — passes; Health entry AppFunctionality-only + Linked true
- SettingsPage shows a 'healthkit' nav entry rendering HealthKitSettingsSection
- Accent token (--color-primary) used only on the primary CTA + consent checkbox (UI-SPEC §Color)
</verification>

<success_criteria>
- OPT-IN consent modal with full HIPAA disclosure, default-OFF checkbox gating the CTA, firewall guarantee, revoke-path copy (HEALTH-02).
- Settings revoke + optional purge with confirmation gates wired to health.ts (HEALTH-07 UI).
- PrivacyInfo.xcprivacy §5.1.3-compliant Health entry (HEALTH-05).
- Non-iOS graceful unavailable state throughout.
- On-device permission grant + Apple manifest review → Phase 70 HUMAN-UAT.
</success_criteria>

<output>
Create `.planning/phases/55-healthkit-two-tunnel-firewall/55-04-SUMMARY.md` when done.
Note in SUMMARY the Phase 70 device-gated items: live iOS permission prompt, real consent→read flow, App Store reviewer manifest verification.
</output>
