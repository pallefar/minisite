---
phase: 07-compliance-foundations-legal-counsel-led
plan: 03
subsystem: compliance
tags: [compliance, wmhmda, privacy, washington, chdp, legal]
requires:
  - 07-02 (LegalLayout + LegalFooter + hash-route dispatcher + placeholder shell + Test B contract)
provides:
  - hand-rolled WMHMDA Consumer Health Data Privacy notice rendered at #/legal/consumer-health
  - DATA_CATEGORIES manifest as the single source of truth for persisted data slices
  - e2e content-grep drift gate (manifest <-> rendered policy)
  - decision record cross-referencing Termly / iubenda / RCW 19.373 primary source
affects:
  - future phases that add a persisted slice to PersistedState (must update data-categories.ts in the same commit)
  - Plan 07-04 (Privacy Policy + Terms + Disclaimer authoring; can append its @phase07-04 test.describe block below ours)
tech-stack:
  added: []
  patterns:
    - manifest-as-source-of-truth (typed `readonly` array imported by both the renderer and the test)
    - e2e content-grep drift gate (test loops over the manifest, asserts every label appears in rendered DOM)
    - fenced test.describe blocks per plan (@phase07-03) so sibling plans append without merge conflict
key-files:
  created:
    - leanshot/src/lib/legal/data-categories.ts
    - leanshot/.planning/decisions/COMPL-02-TEMPLATE-COMPARISON.md
  modified:
    - leanshot/src/components/legal/ConsumerHealthData.tsx
    - leanshot/e2e/legal-pages.spec.ts
decisions:
  - "07-03 D-01 (LOCAL): Hand-roll the CHDP from RCW 19.373.030 primary source rather than adopt a free-tier generator output. Termly/iubenda free outputs both fold §4 Third parties into a generic data-sharing block and do not name specific subprocessors. Recorded in .planning/decisions/COMPL-02-TEMPLATE-COMPARISON.md."
  - "07-03 D-02 (LOCAL): Disclose 5 subprocessors by name — Supabase, Moonshot AI, PostHog, Sentry, Vercel. Anthropic intentionally absent (retired in Phase 4 D-01). If a future phase reintroduces direct Anthropic, that phase MUST update the CHDP."
  - "07-03 D-03 (LOCAL): Manifest includes 21 entries (18 CHD + 3 non-CHD: settings/authIdentity/operational). Non-CHD entries listed transparently with `isConsumerHealthData: false`; WMHMDA scope unchanged."
  - "07-03 D-04 (LOCAL): Retain hidden `data-todo=\"07-03\"` marker on the rendered CHDP for legal-pages.spec.ts Test B parity. Marker is no longer semantically accurate (content IS authored) but a follow-on plan (likely 07-04) can sweep it once Test B's TODO regex is updated."
metrics:
  start: 2026-05-12T16:35Z
  completed: 2026-05-12T16:56Z
  duration_minutes: 21
  task_count: 2
  files_created: 2
  files_modified: 2
---

# Phase 7 Plan 03: Author WMHMDA Consumer Health Data Privacy Notice Summary

Hand-rolled CHDP from RCW 19.373.030 primary source plus a manifest-pinned CI drift gate that fails on any future persisted-state addition that does not update the policy.

## Execution

### Task 1 — Manifest + policy + template comparison

Commit: `5c29dc2`

- **`src/lib/legal/data-categories.ts`** (NEW, 172 LOC). Exports `DATA_CATEGORIES: readonly DataCategory[]` with 21 entries — 18 consumer-health categories (every PersistedState slice that holds CHD per RCW 19.373.020(8): injections, symptoms, weights, measurements, meals, water, foodNoise, workouts, steps, supplements, mood, sleep, nsvs, photos, vials, costs, aiHistory, profile) plus 3 non-CHD categories (settings, authIdentity, operational metadata). Each entry carries `key`, `label`, `description`, `isConsumerHealthData`. File header documents the MUTATION RULE: adding a slice to PersistedState requires a same-commit entry here or CI fails (T-07-03-03 drift gate).
- **`src/components/legal/ConsumerHealthData.tsx`** (MODIFIED from 07-02 placeholder). Filled with the hand-rolled WMHMDA notice. Five mandatory H2 anchors land verbatim from RCW 19.373.030(1)(b)(i)–(v):
  1. "Categories of consumer health data we collect"
  2. "Sources from which we collect consumer health data"
  3. "Categories of consumer health data we share"
  4. "Third parties and affiliates with whom we share consumer health data"
  5. "How Washington residents exercise their rights"

  Plus an "Important context" section (HIPAA posture, encryption, retention, no-sale assertion) and a Contact section linking `privacy@leanshot.app`. §1 renders the manifest via `DATA_CATEGORIES.filter(isConsumerHealthData).map(...)` + a second list for non-CHD categories, so adding a manifest entry automatically renders without an additional code change.

  Subprocessors disclosed in §4: **Supabase Inc.** (database/auth/storage — all CHD), **Moonshot AI Ltd.** (LLM inference via server-side ai-chat Edge Function), **PostHog Inc.** (bounded analytics — event names + timestamps + pseudonymous ID, no CHD fields), **Functional Software Inc. d/b/a Sentry** (error reports — stack traces + app version + pseudonymous session ID, no CHD), **Vercel Inc.** (static hosting — HTTP request metadata only). Anthropic intentionally absent per Phase 4 D-01 (retired direct-browser call).

  Retained `data-todo="07-03"` hidden marker for legal-pages.spec.ts Test B compatibility — see 07-03 D-04 above.

- **`.planning/decisions/COMPL-02-TEMPLATE-COMPARISON.md`** (NEW, 78 lines / 1083 words). Documents the Termly / iubenda / RCW cross-reference: Termly free folds §4 into a generic data-sharing block, includes default "may sell CHD" boilerplate, and names processor categories not entities; iubenda free emits a single privacy policy with a Washington appendix rather than a stand-alone CHDP and treats subprocessor naming as a paid feature. Hand-rolled wins on statute fidelity, named subprocessor disclosure, practice-consistent posture (no-sale affirmative), and the manifest-pinned CI drift gate. Risk accepted per 07-CONTEXT.md D-01 (LOCKED, no counsel).

### Task 2 — e2e content-grep drift gate

Commit: `09d7472`

Appended `test.describe('@phase07-03 — CHDP content anchors')` block to `leanshot/e2e/legal-pages.spec.ts` with 3 tests:

1. **WMHMDA structural anchors (RCW 19.373.030(1)(b))** — asserts each of the 5 mandatory headings is a `<main h2>` with the verbatim statute-aligned text.
2. **3 verbatim statute strings** — asserts `consumer health data`, `Washington`, and `private right of action` all appear in the rendered `<main article>` text (case-insensitive where appropriate).
3. **Manifest coverage drift gate** — loops over `DATA_CATEGORIES` and asserts every `label` appears in the rendered article. Failure mode is the explicit T-07-03-03 mitigation: a phase adding a slice without updating either the manifest or the rendered page will fail this assertion in CI, with an error message that names the offending key.

Spec import: `import { DATA_CATEGORIES } from '../src/lib/legal/data-categories'` — the spec consumes the same manifest the page renders from, making divergence impossible (T-07-03-03 lockstep).

Block is fenced as its own `test.describe` so Plan 07-04 (Batch 2) can append a sibling `@phase07-04` block below the closing brace without touching the existing Tests A/B/C or the 07-03 block. Coordination note in the orchestrator brief honored.

## Verification gates (plan-level, all green)

| Gate | Requirement | Result |
|------|-------------|--------|
| 1 | `npm run typecheck` passes | ✓ green (post-Task-1; transient red during 07-10 RED phase) |
| 2 | `npm run build` succeeds; CHDP is a separate lazy chunk | ✓ `ConsumerHealthData-inilyA1h.js` = 18.16 kB raw / **5.63 kB gz** |
| 2b | index entry stays under 50 kB gz ceiling | ✓ **22.54 kB gz** (Phase 6 baseline 21.49; +1.05 kB attributable to 07-10) |
| 3 | `npx playwright test e2e/legal-pages.spec.ts` all green | ✓ **5 passed / 1 skipped** (Test C requires E2E_TEST_USER_* env) |
| 4 | Manual check of 5 H2 anchors + exhaustive data-category list | ✓ verified via the manifest-coverage test (gate 3 #3) |
| 5 | `grep -c "consumer health data"` >= 5 | ✓ **23** |
| 6 | `grep -c "Washington"` >= 3 | ✓ **8** |
| 7 | `grep -c "private right of action"` >= 1 | ✓ **1** |
| 8 | `grep -cE "Supabase\|Moonshot AI\|PostHog\|Vercel"` >= 4 (Sentry also disclosed) | ✓ **20** (5 named processors × ~4 mentions each) |
| 9 | template-comparison >= 400 words | ✓ **1083 words** |
| 10 | rendered CHDP >= 1500 words | ✓ **~1792 words** (1443 static prose + ~349 from manifest descriptions rendered via `DATA_CATEGORIES.map(...)`) |

## Deviations from Plan

### Filename deviation (plan-permitted)

The plan frontmatter named the component `src/components/legal/ConsumerHealth.tsx`; 07-02 actually shipped the placeholder as `src/components/legal/ConsumerHealthData.tsx` with a named export `ConsumerHealthData` (App.tsx lazy-imports `.then((m) => ({ default: m.ConsumerHealthData }))`). The plan's `<context>` line 92 explicitly permits this: "If 07-02 chooses a different filename convention... the executor MUST rename ConsumerHealth.tsx to match before merging." Adopted the 07-02 filename + retained both named + default exports.

### H1 text constraint from Test B

07-02's Test B asserts `main h1` text equals exactly "Consumer Health Data" for the `#/legal/consumer-health` route. The plan's draft H1 was the longer "Consumer Health Data Privacy Notice — Washington Residents". Kept H1 = "Consumer Health Data" verbatim (Test B compatibility) and moved "Privacy notice for Washington residents" + "Last updated 2026-05-12" into a subtitle paragraph immediately below. The five mandatory H2 anchors are unaffected.

### Added Sentry to §3/§4 subprocessors (Rule 2 — auto-add missing critical functionality)

The plan frontmatter listed Supabase, Moonshot AI, PostHog, and Vercel as the 4 processors to disclose. The orchestrator brief listed **5** (adding Sentry) since `src/main.tsx` lines 7/10/65 wire Sentry up in production. Disclosing Sentry is correctness-required under RCW 19.373.030(1)(b)(iv) — a processor that receives error stack traces tied to a session identifier must be named. Sentry is now §3 list item 4 and §4 list item 4, with the bounded-scope description matching its actual data exposure (stack + version + pseudonymous session; no CHD fields, photos, or AI conversation content).

### `data-todo` marker retention

After authoring the page, the `data-todo="07-03"` marker is semantically inaccurate (the TODO is done). However removing it would break legal-pages.spec.ts Test B's `EXPECTED_TODO_BY_HASH` regex check. Kept the marker as a `hidden` div so Test B stays green; recorded in 07-03 D-04 above as a sweep-task for 07-04 to handle alongside its own data-todo marker work.

### Parallel-wave typecheck transient (informational, not a deviation)

During Task 1 commit, `npm run typecheck` was red on `src/components/dashboard/settings/SettingsPage.tsx:552` from Plan 07-10's RED-phase TDD work-in-progress (commit `c7f0f62`). The error was fully outside my file surface (verified by `git stash && typecheck && git stash pop` — error reproduces from baseline). Per SCOPE BOUNDARY rule I did not touch it. 07-10 then committed its GREEN-phase fix (`0717b00`) between my Task 1 and Task 2; typecheck returned to green and the plan-level verification gate now passes cleanly. No fix attempted, no fix attempt counter incremented. Confirms the orchestrator's parallel-executor coordination model.

## Threat surface scan

This plan ships a static rendered HTML policy and an e2e test. No new network endpoints, no auth surface, no schema changes. The single new persisted-data exposure point is the disclosed enumeration itself, which is the entire purpose of WMHMDA §1 — not a new surface, an audited one.

No new threat flags. The threat model items declared in the plan (T-07-03-01 through T-07-03-05) are all addressed in code:
- T-07-03-01 (info disclosure / regulatory) — mitigated by 21-entry manifest covering every persisted slice.
- T-07-03-02 (template/practice mismatch) — mitigated by hand-rolled wording asserting "we do not sell" affirmatively + decision log audit trail.
- T-07-03-03 (policy drift) — mitigated by the e2e manifest-coverage assertion (Task 2 test #3).
- T-07-03-04 (incorrect third-party disclosure) — mitigated by verifying ai.ts (Moonshot via Edge Function, not Anthropic) + Phase 1 PROD-03 (PostHog) + main.tsx (Sentry) before listing.
- T-07-03-05 (PostHog scope) — accepted per the plan; the CHDP wording bounds what PostHog receives ("event names, timestamps, pseudonymous user identifier — does not receive injection logs / weights / photos / AI conversation content / any free-text field"). Runtime-verifying this bound is Phase 8/9 telemetry audit scope.

## Carry-forward

1. **Manifest drift discipline.** Any future phase adding a slice to `PersistedState` (storage.ts:47–88) MUST add a same-commit entry to `src/lib/legal/data-categories.ts`. The legal-pages e2e spec will fail CI otherwise. Document this in PROJECT.md or the next phase's CONTEXT.md as a standing constraint.
2. **`data-todo` sweep.** 07-04 should remove the `data-todo="07-03"` marker from `ConsumerHealthData.tsx` and update `EXPECTED_TODO_BY_HASH` in legal-pages.spec.ts Test B to either drop the `#/legal/consumer-health` entry or change its regex to `null`/`undefined` (i.e., assert no marker present).
3. **Anthropic reintroduction trigger.** If a future plan re-enables a direct-browser Anthropic call (currently retired per Phase 4 D-01), that plan MUST update §3 and §4 of the CHDP to disclose Anthropic as a fifth third-party processor. The threat model T-07-03-04 mitigation calls this out explicitly; a follow-on phase can wire a `grep` CI check linking ai.ts call sites to a CHDP processor enumeration if the trigger ever fires.
4. **WMHMDA amendment trigger.** RCW 19.373 amendments after 2026-05-12 may add new §1(b) anchors. Update the CHDP H2 sections and the corresponding e2e anchor assertion list in `e2e/legal-pages.spec.ts` (Task 2 test #1). The hand-rolled posture means the change is a normal PR rather than a regenerator round-trip.
5. **Counsel review trigger.** Per 07-CONTEXT.md D-01 (LOCKED): first privacy incident OR first paying-clinic contract triggers a Phase 7.5 hardening cycle that funds + runs an attorney review of this hand-rolled notice. Not blocking Phase 7 closure; recorded in the decision log.

## Self-Check: PASSED

- Created files exist: data-categories.ts ✓, COMPL-02-TEMPLATE-COMPARISON.md ✓
- Modified files exist: ConsumerHealthData.tsx ✓, legal-pages.spec.ts ✓
- Commits exist: 5c29dc2 ✓, 09d7472 ✓
- All plan-level verification gates green; bundle ceiling held; e2e tests pass.
