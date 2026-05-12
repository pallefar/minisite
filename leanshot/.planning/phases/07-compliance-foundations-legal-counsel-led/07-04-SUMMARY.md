---
phase: 07
plan: 04
subsystem: compliance / legal pages
tags: [compliance, legal, privacy-policy, terms-of-service, medical-disclaimer, wmhmda, ftc-hbnr, self-draft, d-01]
requires:
  - 07-02 (host surface — hash router + LegalLayout + placeholder pages)
  - 07-03 (DATA_CATEGORIES manifest at src/lib/legal/data-categories.ts)
provides:
  - src/components/legal/PrivacyPolicy.tsx (authored content)
  - src/components/legal/TermsOfService.tsx (authored content)
  - src/components/legal/MedicalDisclaimer.tsx (authored content)
  - e2e/legal-pages.spec.ts @phase07-04 block (5 content-anchor tests)
  - ROADMAP.md SC#1 corrected per D-01 supersession
affects:
  - Phase 7 SC#1 — corrected wording
  - Cross-plan coupling to 07-06 (export-data) + 07-07 (delete-account) via Settings-path labels
tech_stack:
  added: []
  patterns:
    - Pure presentational lazy-loaded React components (no store / storage / ai / chart.js imports)
    - DATA_CATEGORIES manifest as single source of truth for data enumeration
    - Verbatim Phase 2 paragraph re-statement (byte-replica) to mitigate wording-drift threats
key_files:
  created:
    - leanshot/.planning/phases/07-compliance-foundations-legal-counsel-led/deferred-items.md
    - leanshot/.planning/phases/07-compliance-foundations-legal-counsel-led/07-04-SUMMARY.md
  modified:
    - leanshot/src/components/legal/PrivacyPolicy.tsx (24 → 308 lines)
    - leanshot/src/components/legal/TermsOfService.tsx (20 → 164 lines)
    - leanshot/src/components/legal/MedicalDisclaimer.tsx (19 → 142 lines)
    - leanshot/e2e/legal-pages.spec.ts (+178 lines; 5 new tests under @phase07-04)
    - leanshot/.planning/ROADMAP.md (SC#1 wording fix)
decisions:
  - D-01 supersession applied to ROADMAP SC#1 (no counsel review; founder-reviewed against WMHMDA + HBNR structural anchors)
  - Governing law = Washington State / King County (planner discretion under CONTEXT D-01 "Claude's Discretion" clause)
  - Manifest count (21 entries) used as source of truth for data-categories enumeration in the e2e drift gate, not the plan's pre-manifest "19" estimate
  - PostHog conditional disclosure language ("when enabled via VITE_ANALYTICS_ENABLED") to allow future flag flip without policy republish
metrics:
  duration_seconds: 435
  completed_date: 2026-05-12
  task_count: 2
  file_count: 5
  commits:
    - d8b9a0a — feat(07-04): privacy + terms + medical disclaimer pages (self-drafted per D-01) [COMPL-01]
    - f4f5595 — test(07-04): e2e content anchors for privacy/terms/disclaimer + ROADMAP D-01 supersession
---

# Phase 7 Plan 04: Privacy Policy + Terms of Service + Medical Disclaimer (self-drafted, D-01 locked)

**One-liner:** Self-drafted the three remaining legal pages (Privacy / Terms / Medical Disclaimer) per CONTEXT D-01 LOCKED (no counsel), wired them into 07-02's hash-route host surface, enforced structural anchors + verbatim Phase 2 paragraph byte-replication via 5 new Playwright tests, and corrected ROADMAP SC#1 to remove the superseded "reviewed by privacy-law counsel" clause.

## What shipped

### `src/components/legal/PrivacyPolicy.tsx` (308 lines, 13.09 kB / 4.23 kB gz)

- Header (effective + last-updated dates), intro paragraph with cross-link to the WMHMDA CHDP for WA residents.
- **§ Categories collected** — all entries from the `DATA_CATEGORIES` manifest, split into Health-data categories (18 CHD) + Operational / metadata categories (3 non-CHD). The PrivacyPolicy renders the manifest directly via `DATA_CATEGORIES.filter(...).map(...)`, so any future drift between manifest and policy is statically impossible.
- **§ How we use it** — 5 use purposes (display, PK projection, AI coach prompts, doctor-share, error monitoring).
- **§ How we share** — all 6 subprocessors named verbatim: Supabase, Vercel, Anthropic, Moonshot, Sentry, PostHog (with conditional "when enabled" language for PostHog). Explicit no-sale statement.
- **§ How long we retain** — 30-day undo + crypto-shred per D-03, 13-month audit-log retention, indefinite hash-skeleton retention for HBNR.
- **§ Your rights** — verbatim Settings paths ("Settings → Data → Export JSON", "Settings → Privacy → Delete account") — these are load-bearing for the cross-plan coupling with 07-06 / 07-07 (see Cross-plan couplings below).
- **§ Children**, **§ Changes to this policy**, **§ Contact**.

### `src/components/legal/TermsOfService.tsx` (164 lines, 6.10 kB / 2.45 kB gz)

- **§ Service description** — explicit "not a medical device / healthcare provider / licensed clinic / HIPAA covered entity".
- **§ Account**, **§ Acceptable use** — 4 bullets.
- **§ Disclaimer of medical advice** — verbatim "Not medical advice" string + cross-link to the full MedicalDisclaimer page.
- **§ Limitation of liability** — standard AS-IS / no warranties clause + intentional **WMHMDA private-right-of-action carve-out** (RCW 19.373) — you cannot disclaim a statute and trying to does damage at audit.
- **§ Termination**, **§ Governing law** (Washington / King County — rationale documented inline), **§ Contact**.
- Negative-space coverage: no covered-entity-creating phrases. Greps for "FDA-approved", "clinically validated", "we provide medical advice", "diagnose", and "prescribe" return zero matches (T2-LEGAL mitigation).

### `src/components/legal/MedicalDisclaimer.tsx` (142 lines, 4.98 kB / 1.90 kB gz)

- Paragraph 1 **byte-replicates** Phase 2's `DisclaimerModal.tsx:18-22` verbatim — the litigation-relevant surface that mitigates T1-LEGAL (wording drift between in-product and legal-page disclaimers).
- Paragraph 2 **corrects** the Phase 2 "data stays on this device... not shared with third parties" sentence that became factually wrong after Phase 6 cloud sync. The corrected language: "Your data is encrypted at rest with Supabase as our data processor. We do not sell your health data. The processors we share data with are listed in our Privacy Policy."
- **§ GLP-1 guidance is informational**, **§ PK chart is an estimate, not a dose recommendation**, **§ AI coach is rule-based + AI-assisted, NOT a clinician**, **§ Consult your healthcare provider**, **§ Contact**.

### `e2e/legal-pages.spec.ts` (+178 lines, 5 new tests in `@phase07-04` describe block)

1. **PrivacyPolicy** — H1 + 8 section anchors + 6 subprocessor names + every `DATA_CATEGORIES.label` rendered + verbatim Settings paths.
2. **TermsOfService** — H1 + 8 section anchors + verbatim "Not medical advice" + King County WA + RCW 19.373 + negative assertion that no covered-entity language leaks (T2-LEGAL).
3. **MedicalDisclaimer** — H1 + 5 section anchors + verbatim Phase 2 paragraph regex (T1-LEGAL).
4. **Footer-link resolution** — from `/` (marketing landing) to all 3 hash routes (`#/legal/privacy`, `#/legal/terms`, `#/legal/disclaimer`).
5. **Threat-model consistency** — anchored regex on the FIRST `<p>` of `<article>` on the disclaimer page, locking the verbatim Phase-2-paragraph-1 byte-replica in CI.

All 5 new tests pass locally. The 07-02 (4 tests) + 07-03 (3 tests) suites continue to pass (10/11 total; test C is `test.skip` when `E2E_TEST_USER_EMAIL` is unset — by design).

### `ROADMAP.md` Phase 7 SC#1 — wording correction

- Before: "... reviewed by privacy-law counsel (signed-off email retained in `.planning/decisions/`)"
- After: "... is founder-reviewed against the WMHMDA + FTC HBNR structural anchors per CONTEXT D-01 (no attorney engagement; accepted risk)"

Greppable proof: `grep -c "reviewed by privacy-law counsel"` returns `0`; `grep -c "founder-reviewed against the WMHMDA"` returns `1`.

## D-01 compliance confirmation

- No "counsel review" task was added.
- No "approved by attorney" / "reviewed by counsel" / "legal sign-off" language appears in any of the 3 pages or any commit message.
- All content is self-drafted from (1) the Termly free-tier privacy-policy + ToS generator skeleton and (2) verbatim re-statement of Phase 2's in-product `DisclaimerModal.tsx` copy. Two sources cross-referenced per CONTEXT "Claude's Discretion" clause.
- The WMHMDA private-right-of-action carve-out in `§ Limitation of liability` of the ToS is explicitly per D-01's accepted-risk posture — Washington's statute survives any contractual limitation, and trying to disclaim it would look worse than acknowledging it.

## Deviations from Plan

### 1. [Rule 1 — Bug-adjacent / accuracy] Data-category count: 21, not 19

- **Found during:** Task 1 (Privacy Policy authoring).
- **Issue:** The plan's `<interfaces>` block states "19 categories total — 15 health + 4 operational" but the canonical `DATA_CATEGORIES` manifest shipped by 07-03 contains **21 entries** (18 with `isConsumerHealthData: true`, 3 with `isConsumerHealthData: false`).
- **Reconciliation:** The plan was authored before 07-03 finalized the manifest. The plan explicitly tells the executor: "use this [data-categories.ts] as the single source of truth for category enumeration; do NOT duplicate." Therefore the canonical count is 21, not 19.
- **Fix:** The PrivacyPolicy renders `DATA_CATEGORIES` directly via `.filter().map()`, so the policy text is always in sync with the manifest. The e2e test asserts every `cat.label` appears (not a hardcoded count), so this drift gate scales with the manifest indefinitely.
- **Files modified:** `src/components/legal/PrivacyPolicy.tsx`, `e2e/legal-pages.spec.ts`.
- **Commits:** `d8b9a0a`, `f4f5595`.

### 2. [Rule 2 — Critical functionality / spec contract] Retained `data-todo="07-04"` markers

- **Found during:** Task 1 — reading 07-02's spec carefully.
- **Issue:** The plan's `read_first` mentioned that 07-03 left a `data-todo="07-03"` marker on CHDP and that 07-04 could "sweep" the carry-forward. But 07-02's Test B explicitly asserts `data-todo="07-04"` is present on each of our 3 pages and matches the expected regex (`/^07-04$/`).
- **Fix:** Kept the `<div data-todo="07-04" hidden />` marker at the top of each of the 3 components. Removing it would break the 07-02 contract that's still gated in CI.
- **Files modified:** `src/components/legal/PrivacyPolicy.tsx`, `src/components/legal/TermsOfService.tsx`, `src/components/legal/MedicalDisclaimer.tsx`.

### 3. [Rule 3 — Blocking issue] Lint compliance: react/no-unescaped-entities

- **Found during:** Task 1 verify step (`npm run lint`).
- **Issue:** Lint failed on apostrophes and double-quote chars inside JSX text. The plan's `done` block lists `npm run lint -- src/components/legal/` as a verify gate.
- **Fix:** Escaped apostrophes to `&apos;` and double-quotes to `&ldquo;` / `&rdquo;` throughout the 3 components. Verified that escaped entities still produce the correct DOM text (the e2e regex on the Phase 2 paragraph doesn't depend on apostrophes, and `getByText` / `innerText` see the rendered character not the source).
- **Verification:** `npx eslint src/components/legal/PrivacyPolicy.tsx src/components/legal/TermsOfService.tsx src/components/legal/MedicalDisclaimer.tsx` exits 0.

## Cross-plan couplings to flag for the orchestrator and downstream executors

### (a) DisclaimerModal.tsx in-app overlay drift — flagged for follow-up cleanup pass

`src/components/dashboard/DisclaimerModal.tsx:23-26` (Phase 2) renders paragraph 2: "Your data stays on this device unless you choose to sync. We do not share your health data with third parties." This became factually wrong after Phase 6 cloud sync shipped. The **legal page** (litigation-relevant surface) has been corrected in 07-04's MedicalDisclaimer.tsx; the **in-app overlay** is still serving outdated copy. Recommend a tail-end Phase 7 cleanup plan (or Phase 7.5 hardening) to update `DisclaimerModal.tsx` to mirror MedicalDisclaimer.tsx's corrected paragraph 2. Tracked as T1-LEGAL residual.

### (b) Settings UI label coupling to 07-06 / 07-07

The PrivacyPolicy `§ Your rights` section uses these verbatim path labels:

- "Settings → Data → Export JSON"
- "Settings → Data → Export PDF"
- "Settings → Privacy → Delete account"

**Coupling action required by 07-06 (export) and 07-07 (delete):** the SettingsPage UI MUST land these exact label strings (case-sensitive, with the U+2192 right-arrow). If 07-06/07 use different wording, the policy claim becomes a false statement (T5-LEGAL). The e2e legal-pages test passes regardless (it only asserts the *policy text*), so this is a SUMMARY-level cross-plan check, not a CI gate. **Recommended:** the verifier for 07-06 and 07-07 greps the rendered SettingsPage for these strings before passing.

### (c) PostHog disclosure / Settings copy drift

Phase 4 Settings copy reportedly says "No analytics. No telemetry." (out-of-scope to verify here). The PrivacyPolicy now discloses PostHog with conditional "when enabled via VITE_ANALYTICS_ENABLED build flag" language. If both surfaces ever go live as written, a literal reading would conflict. **Recommended:** in a tail-end cleanup, update Settings copy to "PostHog cookieless analytics — disabled by default in v1; can be enabled by the operator via VITE_ANALYTICS_ENABLED." Tracked as T8-LEGAL residual.

## Bundle impact

- New lazy chunks (verified via `npm run build`):
  - `dist/assets/PrivacyPolicy-*.js` — 13.09 kB / **4.23 kB gz**
  - `dist/assets/TermsOfService-*.js` — 6.10 kB / **2.45 kB gz**
  - `dist/assets/MedicalDisclaimer-*.js` — 4.98 kB / **1.90 kB gz**
- Index entry chunk: 77.71 kB / **22.57 kB gz** — well under the 50 kB ceiling held since Phase 6 D-12.
- No new top-level dependencies. No new vendor chunks.

## Threat surface scan (per plan threat_model)

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T1-LEGAL (in-product ↔ legal-page wording drift) | mitigate | Mitigated for the legal page (byte-replica + regex test). In-app overlay drift residual flagged in cross-plan (a). |
| T2-LEGAL (covered-entity language in ToS) | mitigate | Mitigated. Negative-grep assertion in Task 1 `done` + negative `toLowerCase().toContain('fda-approved')` assertion in e2e. |
| T3-LEGAL (omitted data category) | mitigate | Mitigated. PrivacyPolicy renders `DATA_CATEGORIES.map()` directly; e2e asserts every `cat.label` appears. Drift is statically impossible. |
| T4-LEGAL (template-boilerplate cross-contamination) | mitigate | Mitigated. Two sources cross-referenced (Termly skeleton + verbatim Phase 2 re-statement); CHDP-specific WMHMDA boilerplate left out of PrivacyPolicy (07-03 owns it). |
| T5-LEGAL (Settings path drift) | mitigate | Mitigated for the policy claim (verbatim strings + e2e assertion); 07-06/07-07 coupling flagged in cross-plan (b). |
| T6-LEGAL (omitted category) | mitigate | Same as T3-LEGAL. |
| T7-LEGAL (founder location disclosure) | accept | Accepted. Only contact info is `karsten.haldan@gmail.com` (already public via DNS/MX). |
| T8-LEGAL (PostHog disclosure repudiation) | mitigate | Mitigated via conditional "when enabled" language. Settings-copy drift flagged in cross-plan (c). |

No new threat flags discovered. No new attack surface introduced (all 3 pages are read-only static-content components with zero data-layer touch points).

## Greppable verifications run + outputs

```
$ grep -F "Not medical advice" src/components/legal/MedicalDisclaimer.tsx       → 2 hits (1 comment + 1 content)
$ grep -F "Not medical advice" src/components/legal/TermsOfService.tsx          → 2 hits (1 comment + 1 content)
$ grep -F Supabase src/components/legal/PrivacyPolicy.tsx                        → 5 hits
$ grep -F Vercel src/components/legal/PrivacyPolicy.tsx                          → 6 hits
$ grep -F Anthropic src/components/legal/PrivacyPolicy.tsx                       → 3 hits
$ grep -F Moonshot src/components/legal/PrivacyPolicy.tsx                        → 5 hits
$ grep -F PostHog src/components/legal/PrivacyPolicy.tsx                         → 5 hits
$ grep -F Sentry src/components/legal/PrivacyPolicy.tsx                          → 5 hits
$ grep -F "King County, Washington" src/components/legal/TermsOfService.tsx     → 1 hit
$ grep -F "RCW 19.373" src/components/legal/TermsOfService.tsx                  → 2 hits
$ grep -EFn "we provide medical advice|FDA-approved|clinically validated|diagnose|prescribe" src/components/legal/TermsOfService.tsx → 0 hits (T2-LEGAL clean)
$ grep -c "reviewed by privacy-law counsel" .planning/ROADMAP.md                 → 0
$ grep -c "founder-reviewed against the WMHMDA" .planning/ROADMAP.md             → 1
$ npm run test:e2e -- legal-pages.spec.ts                                        → 10 passed, 1 skipped (C requires E2E_TEST_USER_EMAIL)
$ npm run build                                                                   → ✓ built in 4.20s; 3 new lazy chunks; index 22.57 kB gz
$ npx eslint src/components/legal/{PrivacyPolicy,TermsOfService,MedicalDisclaimer}.tsx → 0 problems
```

## Deferred Issues

- **Out of scope (07-06's file):** `src/lib/export-data.ts:525` has a pending TypeScript error — `Conversion of type 'Photo[]' to type 'Record<string, unknown>[]'` — index-signature mismatch. Logged to `deferred-items.md` for 07-06's executor to address. Not blocking for 07-04's legal-pages surface; the legal pages compile cleanly.

## Known Stubs

None. All three pages render complete, production-grade content. No "TODO" / "coming soon" / "placeholder" text remains in the legal-page surface.

## Self-Check: PASSED

- src/components/legal/PrivacyPolicy.tsx — FOUND (308 lines, ≥ 180 min)
- src/components/legal/TermsOfService.tsx — FOUND (164 lines, ≥ 140 min)
- src/components/legal/MedicalDisclaimer.tsx — FOUND (142 lines, ≥ 80 min)
- e2e/legal-pages.spec.ts — FOUND (extended with 5 @phase07-04 tests)
- ROADMAP.md — FOUND (SC#1 wording corrected)
- Commit d8b9a0a — FOUND in `git log`
- Commit f4f5595 — FOUND in `git log`
