# Phase 55: HealthKit + Two-Tunnel Firewall - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Apple Health read-only import path (iOS-only) with explicit OPT-IN consent and an architectural **two-tunnel firewall** that MUST NEVER let HealthKit/PHI data reach ad-targeting surfaces (Apple §5.1.3). Imports map to the EXISTING weight/meal/workout/sleep tables.

**Already in place:** `src/lib/native/health.ts` (stub, like push/ads/iap from P12/16) — full impl this phase; `src/lib/native/ads.ts` (the ad surface the firewall must isolate from); PHI audit infra (`phi_access_log`, `log_phi_access` RPC, audit triggers); `eslint.config.js` with 13 `no-restricted` rules (firewall ESLint layer hooks here); `PrivacyInfo.xcprivacy` (from P53). No Capacitor health plugin installed yet.

**Net-new this phase:** Capacitor HealthKit plugin + full `health.ts`; import pipeline → existing tables; **3-layer two-tunnel firewall** (ESLint AST rule + runtime guard helper + CI grep gate); OPT-IN consent screen (UI-SPEC); Settings revoke + optional historical purge; battery-aware background sync; `PrivacyInfo.xcprivacy` read-type declarations.

Per D-08: on-device HealthKit read/sync/background (needs real iOS device + approved entitlement, both pending) defers to Phase 70. Build + unit-test the firewall, import-mapping (mock HealthKit data), consent UI, revoke/purge logic now.
</domain>

<decisions>
## Implementation Decisions

### HealthKit native + read scope
- Use a maintained Capacitor HealthKit plugin (research selects; fallback custom Swift bridge). Replace the `health.ts` stub with a full read-only implementation.
- Read types: bodyMass, stepCount, sleepAnalysis, heartRate → map to the EXISTING weight/steps/sleep tables (no new domain tables for the imported metrics; reuse the v2 schema).
- Sync: background at admin-configured interval + battery-aware skip on low-battery + a manual "sync now".

### Two-tunnel firewall (3-layer MUST-NEVER invariant)
- 3 INDEPENDENT enforcement layers (per `feedback_3_layer_must_never_invariant_pattern`, Phase 39 PHARMA-02 precedent): (1) ESLint AST rule, (2) runtime guard helper, (3) CI grep gate. Each catches what the others miss.
- Blocks: any `health-*` module/Edge-Fn importing ad/marketing modules (`ads.ts`, admob, adsense, marketing surfaces); no health signal in any ad-targeting payload.
- Carveout pattern: legitimate cross-reads extracted into sibling helpers (keep rejected-alternative names OUT of committed files — negation-grep trap).

### Consent, revoke, purge, privacy manifest, UI
- Explicit OPT-IN consent screen, default OFF, full disclosure (what is read, why, the firewall guarantee, the revoke path). Generate a UI-SPEC for this net-new HIPAA consent surface.
- Revoke: Settings toggle OFF blocks future syncs; historical imported data optionally purgeable (user choice).
- `PrivacyInfo.xcprivacy` lists every HealthKit read type so an App Store reviewer can verify.

### Defer posture
- "Done" = 3-layer firewall (CI-enforced + tests) + full health.ts + import-mapping (mock-tested) + consent UI + revoke/purge + privacy manifest. On-device HealthKit read/sync/background → Phase 70 HUMAN-UAT.

### UI design contract
- **Generate UI-SPEC** for the OPT-IN consent screen (disclosure copy + toggle/enabled/revoked states). Reuse DS primitives.

### Claude's Discretion
- Plugin selection, exact firewall AST-rule shape, import-mapping transforms, sync interval defaults, and migration shapes (opt-in flag, sync state) are at Claude's discretion within the above + HIPAA posture.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `leanshot/src/lib/native/health.ts` (stub to replace), `ads.ts` (firewall counterpart), `platform.ts` (detectPlatform — firewall-safe platform detection).
- Existing domain tables: weight/meal/workout/sleep (import target) — see src/lib/store.ts + storage.ts.
- PHI audit: `supabase/migrations/20270702000004_phi_access_log.sql`, `20270702000005_log_phi_access_rpc.sql`, `20270601000030_audit_phi_table_triggers.sql`.
- `leanshot/eslint.config.js` — 13 `no-restricted-syntax` rules; the firewall ESLint AST rule extends this pattern.
- `20270703000004_ad_etl_health.sql` — existing ad-ETL-health migration; review for firewall relevance.
- `PrivacyInfo.xcprivacy` (privacy manifest from Phase 53).
- Existing consent infra: `src/components/consent/consent-config.ts` (model the HealthKit consent on consent patterns, but it is a distinct net-new screen).

### Established Patterns
- 3-layer MUST-NEVER: ESLint AST + runtime helper + CI grep, with carveout via sibling helpers (Phase 39 39-02).
- Capacitor native: import detectPlatform from platform.ts NOT @capacitor/core (firewall); `npm install --legacy-peer-deps` (sentry sibling-check); iOS SPM (no cocoapods); native dirs at leanshot/apps/ios + apps/android.
- HealthKit is iOS-ONLY — Android/web must no-op gracefully.

### Integration Points
- New: HealthKit plugin in package.json; firewall ESLint rule (eslint-rules/ or inline), runtime guard helper (src/lib/native/ or src/lib/), CI grep gate (.github/workflows/ or existing); consent screen component; migration for opt-in flag + sync state.

</code_context>

<specifics>
## Specific Ideas

- HealthKit entitlement is pending-provisioning (Phase 52 smoke-tracked; approval can take Apple days) → on-device verification at P70.
- The firewall is the patient-trust + App-Store-compliance centerpiece — the 3 layers must be genuinely independent and individually tested (one test that proves ESLint blocks a violating import; one that proves the runtime helper throws; one that proves the CI grep gate fails the build).
- Ad-targeting must never receive: health metrics, HealthKit-derived signals, or PHI. (Apple §5.1.3; CLAUDE.md "Ad targeting using HealthKit data — never".)
</specifics>

<deferred>
## Deferred Ideas
- On-device HealthKit permission grant, real metric read, background sync on device, battery-state behavior on device → Phase 70 HUMAN-UAT.
- HealthKit entitlement provisioning + Apple review verification of PrivacyInfo.xcprivacy → Phase 70.
- Android Health Connect parity → out of scope (iOS-only this phase per ROADMAP).
</deferred>
