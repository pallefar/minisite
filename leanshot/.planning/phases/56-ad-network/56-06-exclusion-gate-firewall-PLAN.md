---
phase: 56-ad-network
plan: 06
type: execute
wave: 3
depends_on: [56-01, 56-03]
files_modified:
  - leanshot/scripts/check-no-ads-on-excluded-surfaces.sh
  - leanshot/scripts/check-no-ads-on-excluded-surfaces.test.sh
  - leanshot/src/lib/native/healthAssert.test.ts
  - .github/workflows/ci.yml
autonomous: true
requirements: [AD-03, AD-11]
must_haves:
  truths:
    - "A CI grep gate fails if any clinic / share / admin / dose-log / patient surface file imports an ad component (AdRenderer / AdSlot / canShowAds)"
    - "The grep gate is comment-stripped so eslint-disable / commented imports cannot hide a violation"
    - "The HealthKit firewall (Phase 55) stays green after ad-serving code lands — regression assert via check-no-health-in-ad-context.sh"
    - "assertNoHealthData throws on a health-shaped object at the ad boundary (runtime layer test)"
    - "Both gates run in ci.yml on every push"
  artifacts:
    - path: "leanshot/scripts/check-no-ads-on-excluded-surfaces.sh"
      provides: "Layer-3 CI grep: ad components never reach excluded surfaces"
      contains: "EXCLUDED"
    - path: "leanshot/src/lib/native/healthAssert.test.ts"
      provides: "Runtime firewall regression test for ad boundary"
      contains: "assertNoHealthData"
    - path: ".github/workflows/ci.yml"
      provides: "wiring for the new exclusion gate + existing firewall gate"
      contains: "check-no-ads-on-excluded-surfaces.sh"
  key_links:
    - from: "leanshot/scripts/check-no-ads-on-excluded-surfaces.sh"
      to: "src/components/clinic, src/components/admin, share/patient/dose-log surfaces"
      via: "comment-stripped grep for ad-component imports"
      pattern: "AdRenderer|AdSlot|canShowAds"
    - from: ".github/workflows/ci.yml"
      to: "both firewall gates"
      via: "bash run steps"
      pattern: "check-no-ads-on-excluded-surfaces"
---

<objective>
Ship the surface-exclusion MUST-NEVER enforcement (AD-03) and the HealthKit firewall regression (AD-11) as a real guard + test, not convention: a comment-stripped CI grep gate `check-no-ads-on-excluded-surfaces.sh` (parallel to the Phase 55 `check-no-health-in-ad-context.sh`) that fails if any excluded-surface file imports an ad component, a self-test for that gate, an `assertNoHealthData` runtime regression test at the ad boundary, and ci.yml wiring for both.

Purpose: Clinic-zero-ads + share/patient/dose-log exclusion is a trust + compliance invariant (Apple §5.1.3 + PHI). Mirroring the 3-layer firewall discipline (runtime canShowAds from 56-01 + CI grep here), this proves ad components structurally cannot reach excluded surfaces, and proves the Phase 55 health firewall stays green now that ad-serving code (56-03) exists. This is the LAST wave because the grep must run against the real ad component files created in 56-03.
Output: exclusion grep gate + gate self-test + healthAssert regression test + ci.yml steps.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/56-ad-network/56-RESEARCH.md
@.planning/phases/56-ad-network/56-01-SUMMARY.md
@.planning/phases/56-ad-network/56-03-SUMMARY.md
@leanshot/scripts/check-no-health-in-ad-context.sh

<interfaces>
<!-- Verified from codebase. Mirror the Phase 55 firewall script + its ci.yml wiring exactly. -->

Phase 55 firewall script (COPY its structure): leanshot/scripts/check-no-health-in-ad-context.sh
- set -euo pipefail; resolves SRC_ROOT (leanshot/src, src, or script-relative ../src).
- find over target dirs; perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' to strip comments; grep -qE the forbidden pattern.
- Excludes *.test.ts/tsx and __tests__ (legitimate fixture references).
- Exit 0 pass / 1 violation / 2 src-root-not-found, with ::error:: annotation.

ci.yml (verified) runs the existing gate as: `bash scripts/check-no-health-in-ad-context.sh src` (from leanshot/ cwd, under the lint/gates job). Add the new gate as a sibling step in the same job.

Excluded surfaces → source dirs (from RESEARCH §7):
- clinic: src/components/clinic/ (clinic, clinic-settings, clinic-drill-in/patient)
- share / doctor-share: src/components/dashboard/share/ + the #/share view
- admin: src/components/admin/
- dose-log / patient / medication PHI: src/components/dashboard/tabs/MedicationTab.tsx + any /dose-log, /patient surfaces

Ad component import symbols to forbid in those dirs (from 56-03-SUMMARY.md): AdRenderer, EmbedAdSlot, PlatformAdSlot, HouseAdSlot, and the @/lib/ads/ or @/components/ads/ import paths. NOTE: the admin REVENUE dashboard (src/components/admin/growth/AdRevenueDashboardPage) legitimately lives under admin/ but does NOT import ad-serving components — it reads the revenue RPC. The gate must target ad-SERVING component imports (AdRenderer/AdSlot/canShowAds from @/components/ads or @/lib/ads), which the dashboard does not use, so it passes cleanly. Confirm by reading 56-05-SUMMARY before finalizing the grep pattern.

assertNoHealthData (src/lib/native/healthAssert.ts): throws when value has health-shaped keys (bodyMass, weight, steps, etc.). It is the Layer-2 runtime guard ads.ts calls.

Negation-grep trap (project memory): keep rejected/competitor ad-SDK names and GLP-1 brand strings OUT of committed source where they'd defeat a grep gate — the GLP-1 list lives in DB rows (56-02), not source.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Surface-exclusion CI grep gate + self-test (AD-03)</name>
  <files>leanshot/scripts/check-no-ads-on-excluded-surfaces.sh, leanshot/scripts/check-no-ads-on-excluded-surfaces.test.sh</files>
  <action>Create scripts/check-no-ads-on-excluded-surfaces.sh by copying the structure of check-no-health-in-ad-context.sh. Target dirs: src/components/clinic, src/components/admin, src/components/dashboard/share, plus MedicationTab.tsx and any dose-log/patient surface files. For each (comment-stripped, excluding *.test.* and __tests__), fail if it imports an ad-SERVING component: pattern matching from ['"]@/components/ads or from ['"]@/lib/ads/canShowAds or the identifiers AdRenderer|EmbedAdSlot|PlatformAdSlot|HouseAdSlot. Exit 0 pass / 1 violation (with ::error:: annotation) / 2 src-root-not-found. Use grep -v '^#'-equivalent comment stripping via the same perl one-liner (grep-c hygiene). IMPORTANT carveout: the admin growth revenue dashboard reads the RPC and does NOT import ad-serving components, so it must NOT trip the gate — verify the pattern targets ad-serving imports only (read 56-05-SUMMARY to confirm the dashboard's imports). Also create scripts/check-no-ads-on-excluded-surfaces.test.sh: a self-test that (a) runs the gate against current src and asserts exit 0, and (b) creates a temp clinic-like file importing AdRenderer in a throwaway dir, runs the gate against it, and asserts exit 1 — proving the gate actually catches violations (not a no-op). Keep competitor ad-SDK names out of the script body except as the forbidden-pattern tokens (document intent in comments).</action>
  <verify>
    <automated>cd leanshot && bash scripts/check-no-ads-on-excluded-surfaces.sh src && bash scripts/check-no-ads-on-excluded-surfaces.test.sh</automated>
  </verify>
  <done>Gate passes against current src (no excluded-surface file imports ad-serving components, including the admin revenue dashboard which only reads the RPC); the self-test proves the gate returns exit 1 on a planted violation.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: HealthKit firewall regression — runtime test + grep assert (AD-11)</name>
  <files>leanshot/src/lib/native/healthAssert.test.ts</files>
  <behavior>
    - assertNoHealthData throws when passed an object with a health-shaped key (e.g. { weight: 80 } or { bodyMass: 80 } or { steps: 1000 }).
    - assertNoHealthData does NOT throw on a non-health object (e.g. { adUnitId: 'x' }) — the shape ads.ts passes.
    - The test documents that ads.ts calls assertNoHealthData at every ad-SDK boundary (regression intent comment referencing 56-03).
  </behavior>
  <action>Create (or extend if it exists) src/lib/native/healthAssert.test.ts asserting the behavior cases above. This is the Layer-2 runtime regression proving the firewall still throws on PHI-shaped targeting objects now that ad-serving code (56-03) calls it. If the file already exists, ADD the ad-boundary cases without duplicating existing coverage. Run with the vite.config.ts config (vitest projects trap).</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/native/healthAssert.test.ts --config vite.config.ts && bash scripts/check-no-health-in-ad-context.sh src</automated>
  </verify>
  <done>Runtime guard throws on health-shaped objects and passes ad-shaped objects; the Phase 55 comment-stripped firewall grep is green with all 56-03 ad files present.</done>
</task>

<task type="auto">
  <name>Task 3: Wire both gates into ci.yml</name>
  <files>.github/workflows/ci.yml</files>
  <action>In the same job that runs `bash scripts/check-no-health-in-ad-context.sh src`, add a sibling step `Ad surface-exclusion gate (AD-03)` running `bash scripts/check-no-ads-on-excluded-surfaces.sh src` (from leanshot/ cwd — match the existing step's working directory). Keep the existing health firewall step (do NOT remove it — AD-11 regression depends on it staying in CI). Add a comment noting AD-03 + AD-11 enforcement. Use a name/run block identical in style to the existing firewall step.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "check-no-ads-on-excluded-surfaces.sh" .github/workflows/ci.yml && grep -q "check-no-health-in-ad-context.sh" .github/workflows/ci.yml && echo OK</automated>
  </verify>
  <done>ci.yml runs BOTH the surface-exclusion gate and the (preserved) health firewall gate on every push.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| ad component import → excluded surface | a developer accidentally placing ads on a clinical/PHI surface |
| health.ts → ad-context file | PHI reaching ad targeting (Apple §5.1.3) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-56-16 | Elevation of Privilege / Trust | excluded-surface files | mitigate | comment-stripped CI grep fails on any ad-serving import in clinic/share/admin/dose-log/patient; self-test proves the gate is not a no-op |
| T-56-17 | Information Disclosure | ad-context files | mitigate | Phase 55 health firewall grep kept in CI; runtime assertNoHealthData regression test added |
| T-56-18 | Tampering | grep gate evasion via comments | mitigate | comment-stripped (perl) so eslint-disable/commented imports cannot hide a violation (negation-grep trap) |
</threat_model>

<verification>
- Task verify commands (gate run + self-test + runtime test + ci.yml grep).
- `cd leanshot && bash scripts/check-no-ads-on-excluded-surfaces.sh src && bash scripts/check-no-health-in-ad-context.sh src` — BOTH gates green against the full post-56-03 tree.
</verification>

<success_criteria>
A comment-stripped CI grep gate (proven non-trivial by its self-test) guarantees ad components never reach excluded surfaces (AD-03), and the Phase 55 HealthKit firewall is proven preserved against ad-serving code via a runtime regression test + green grep (AD-11), both wired into ci.yml.
</success_criteria>

<output>
Create `.planning/phases/56-ad-network/56-06-SUMMARY.md` when done. Record the exact forbidden-import pattern and confirm the admin revenue dashboard does not trip the gate.
</output>
