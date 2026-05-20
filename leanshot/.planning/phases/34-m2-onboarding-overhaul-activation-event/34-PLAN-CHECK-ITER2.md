# Phase 34 Plan Check — M2 Onboarding Overhaul + Activation Event
# Iter-2 (Re-verification after iter-1 fixes)

**Checked:** 2026-05-20
**Plans verified:** 10 (34-01 through 34-10)
**Iter-1 fixes reviewed:** B-01, B-02, B-03, W-02, W-04
**Overall status:** ISSUES FOUND — 0 blockers, 2 warnings (1 new, 1 promoted)

---

## Iter-1 Blocker Resolution — Confirmed Closed

### B-01: RESEARCH.md Open Questions RESOLVED marker

**File checked:** `34-RESEARCH.md` line 660.

Heading is now `## Open Questions (RESOLVED)`. Each question has an inline resolution marker:

- Q1: "RESOLVED in Plan 34-04 Task 1" — PKCE callback route added as path branch in App.tsx.
- Q2: "RESOLVED in Plan 34-06" — RPC polling chosen over Realtime.
- Q3: "RESOLVED in Plan 34-08 / 34-09" — superadmin check at Edge Fn level.

**Verdict: CLOSED.**

---

### B-02: 34-03 files_modified missing migration 000006

**File checked:** `34-03-PLAN.md` frontmatter line 14.

`supabase/migrations/20270706000006_p34_record_activation_rpc.sql` now appears in `files_modified`.
Declared file list is now 7 entries (matches all files created in Task 1 + Task 2 actions).

**Verdict: CLOSED.**

---

### B-03: 34-04 `isAppleEnabled` not exported

**File checked:** `34-04-PLAN.md` Task 1 action (line 125) and frontmatter artifacts (line 27).

Action code now shows `export function isAppleEnabled(): boolean { … }` (line 125).
Artifacts exports list now includes `"isAppleEnabled"` (line 27).

Downstream: `34-06-PLAN.md` line 384 imports `{ isAppleEnabled } from '@/lib/auth'` directly.
The residual comment on line 385–386 of 34-06 ("Plan 34-04 must export isAppleEnabled") is now
accurate documentation, not a warning — the export is in place.

The fallback shim text on 34-06 line 404 ("if Plan 34-04 does NOT export…") is dead-branch
documentation; executor will correctly use the real export. Not a defect.

**Verdict: CLOSED.**

---

## Iter-1 Warning Resolution — Confirmed Satisfied

### W-02: 34-06 files_modified undercount

**File checked:** `34-06-PLAN.md` frontmatter lines 7–22.

Now declares 15 files (previously 11). Added files:
- `leanshot/src/components/onboarding/AnonymousPreviewView.tsx` (line 18)
- `supabase/functions/update-anon-session/index.ts` (line 19)
- `supabase/functions/update-anon-session/index.test.ts` (line 20)
- `supabase/functions/update-anon-session/deno.json` (line 21)

Scope threshold: 15 files / 3 tasks — borderline. Still within blocker ceiling (>15). Plan
rationale documented (avoids cross-plan stub-and-replace). Accepted.

**Verdict: SATISFIED.**

### W-04: VALIDATION.md missing

**File checked:** `34-VALIDATION.md` — exists in the phase directory.

Generated inline per memory `feedback_validation_md_inline_generation_when_missing`. All 5 waves
covered with automated commands. Phase-level acceptance gate documented. Threat-coverage
cross-ref present.

**Verdict: SATISFIED.**

---

## Carried Warnings — Confirmed Not Escalated

### W-01: ONBOARD-10 Lighthouse ≥90 — no explicit optimization task

Status unchanged from iter-1. 34-10 Task 2 owns the Lighthouse measurement gate. The design
choices in 34-06 (no heavy SDK on the onboard route, React.lazy, RPC polling instead of
Realtime) are the implementation path. If the score misses, the plan contains an explicit
`feedback_defer_then_batch_fix_pattern` instruction (34-10 Task 1 line 274).

**Verdict: CARRY (deliberate, operator accepts the risk).**

### W-03: D-14 "Goal editable in Settings" — no owning task

Status unchanged from iter-1. `profiles.primary_goal` column ships in 34-01; the Settings UI
edit is unowned in Phase 34. Operator chose to defer. Column is writable so future patch is
additive.

**Verdict: CARRY (deliberate).**

---

## New Issues Found in Iter-2

### NEW-W-01 [claude_md_compliance] lighthouse-onboarding.js uses CommonJS `require` in an ESM package

**Plan:** 34-10
**Task:** Task 1
**Severity:** WARNING
**Description:** `leanshot/scripts/lighthouse-onboarding.js` (planned in the 34-10 Task 1 action
body, lines 110-111) uses:

```javascript
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
```

`leanshot/package.json` has `"type": "module"` (confirmed). When Node.js encounters a `.js` file
in an ESM package it treats it as ESM — `require` is not defined, and the script will crash at
runtime with `ReferenceError: require is not defined in ES module scope`.

This will break `npm run test:lighthouse:onboarding` and the Playwright spec that invokes it via
`execSync`.

**Fix hint:** Either (a) rename to `lighthouse-onboarding.cjs` so Node treats it as CommonJS, OR
(b) convert to ESM syntax (`import lighthouse from 'lighthouse'; import chromeLauncher from
'chrome-launcher';`). ESM conversion is preferred since all other project scripts will follow the
`"type":"module"` convention. Update the `execSync` call in the Playwright spec to match the new
filename if renamed.

---

### NEW-W-02 [task_completeness] 34-10 activation e2e uses `page.waitForTimeout(2_000)` — timing-based assertion

**Plan:** 34-10
**Task:** Task 1 (`onboarding-activation-e2e.spec.ts` action, line 249)
**Severity:** WARNING
**Description:** The activation e2e spec uses:

```typescript
await page.waitForTimeout(2_000);
expect(activationPosted).toBe(true);
```

This is a timing-based assertion: it passes if the Edge Fn responds within 2 seconds and fails
(or worse, produces a false-positive if `activationPosted` was never reset between test runs)
under slow CI. The correct Playwright pattern for network interception is a Promise-based
`waitForRequest` or `waitForResponse`:

```typescript
const activationReq = page.waitForRequest('**/functions/v1/record-activation');
await page.getByRole('button', …).click();
await activationReq;
```

A `waitForTimeout` in a Playwright e2e spec is a reliability signal not a blocker for plans
passing, but the executor should be aware of the flake risk.

**Fix hint:** Replace `waitForTimeout(2_000)` with a `page.waitForRequest` or `page.waitForResponse`
call that resolves when the activation request completes. This makes the spec deterministic.

---

## Full Dimension Re-Scan Summary

All dimensions from iter-1 that passed STILL PASS. Re-checking only affected areas:

| Dimension | Iter-1 Result | Iter-2 Result | Change |
|-----------|---------------|---------------|--------|
| 1: Requirement Coverage | PASS | PASS | No change |
| 2: Task Completeness | PASS | PASS (NEW-W-02 noted) | Minor quality issue |
| 3: Dependency Correctness | PASS | PASS | No change |
| 4: Key Links Planned | B-03 BLOCKER | PASS | Resolved |
| 5: Scope Sanity | W-02 WARN | WARN (15 files, borderline, justified) | Resolved to accepted |
| 6: Verification Derivation | PASS | PASS | No change |
| 7: Context Compliance | W-03 WARN | W-03 WARN | Carry |
| 7b: Scope Reduction | PASS | PASS | No change |
| 7c: Architectural Tier | PASS | PASS | No change |
| 8: Nyquist / VALIDATION.md | W-04 WARN | PASS | Resolved |
| 9: Cross-Plan Data Contracts | PASS | PASS | No change |
| 10: CLAUDE.md Compliance | PASS | NEW-W-01 WARN | New issue |
| 11: Research Resolution | B-01 BLOCKER | PASS | Resolved |
| 12: Pattern Compliance | PASS | PASS | No change |

---

## Migration Timestamp Audit (new landmine check)

Phase 34 uses the `20270706000001` – `20270706000008` series. No files with this prefix exist
in `supabase/migrations/` yet (confirmed by `ls` against live repo). Phase 38 uses
`20270705*`; Phase 19/22/23/31 use earlier dates. No collision risk.

Internal within Phase 34:

| Migration file | Owner plan | Slot |
|---|---|---|
| `20270706000001_p34_anonymous_sessions.sql` | 34-01 | 001 |
| `20270706000002_p34_onboarding_flows_consumer.sql` | 34-01 | 002 |
| `20270706000003_p34_profiles_primary_goal.sql` | 34-01 | 003 |
| `20270706000004_p34_activation_events_alter.sql` | 34-01 | 004 |
| `20270706000005_p34_anon_session_ttl_cron.sql` | 34-02 | 005 |
| `20270706000006_p34_record_activation_rpc.sql` | 34-03 | 006 (added by B-02 fix) |
| `20270706000007_p34_merge_anon_session_rpc.sql` | 34-05 | 007 |
| `20270706000008_p34_get_rolling_signup_count_rpc.sql` | 34-06 | 008 |

No duplicate slots. Sequential, no gaps. PASS.

---

## Additional Landmine Scan (memory-derived, iter-2 only)

| Landmine | Check | Result |
|----------|-------|--------|
| `lighthouse-onboarding.js` uses `require` in ESM package | `"type":"module"` in package.json confirmed; `require()` calls present | WARN (NEW-W-01) |
| `page.waitForTimeout` flake in e2e | Line 249 of 34-10 action | WARN (NEW-W-02) |
| `supabase.auth.session()` deprecated API (v2 uses `getSession()`) | 34-06 line 432 explicitly notes this and instructs executor to use `getSession()` | PASS (self-corrected) |
| `34-04 depends_on: []` — Wave 2 plan with empty deps | 34-04 only touches `src/lib/auth.ts` + `AuthCallbackView.tsx` + `App.tsx`; all created fresh (no Wave 1 plan output required) | PASS (no cross-wave dep needed) |
| Worktree executor npm-install leak | No new devDep installs are part of any Wave 1–4 plan; `lighthouse`+`chrome-launcher` in 34-10 (Wave 5, runs after all merges) | PASS |
| family-supporter "stub" scope-reduction | 34-07 line 77–87: "v1.3 stub card" is user-specified "Coming soon — join waitlist" behavior per CONTEXT.md D-13 specifics; not a planner-invented reduction | PASS |
| isAppleEnabled shim fallback in 34-06 line 404 | Shim now dead-branch doc (B-03 fix exports isAppleEnabled from 34-04); executor reads the export | PASS |
| TabPlaceholder seam: 34-08 creates it, 34-09 replaces it | 34-09 verify command explicitly asserts `TabPlaceholder` is absent post-execution | PASS |
| `supabase functions deploy` without `--linked` | All Edge Fn deploy references omit the flag | PASS |
| Dollar-quote nesting in cron | 34-02 verified in iter-1; unchanged | PASS |

---

## Structured Issues (YAML)

```yaml
issues:

  - plan: "34-10"
    dimension: claude_md_compliance
    severity: warning
    task: 1
    description: "lighthouse-onboarding.js uses CommonJS require() (lines 110-111 of Task 1 action), but leanshot/package.json has \"type\": \"module\". Node will throw ReferenceError at runtime."
    fix_hint: "Either rename to .cjs extension, or rewrite using ESM imports (import lighthouse from 'lighthouse'; import chromeLauncher from 'chrome-launcher';). ESM preferred. Update execSync path in Playwright spec if renamed."

  - plan: "34-10"
    dimension: task_completeness
    severity: warning
    task: 1
    description: "onboarding-activation-e2e.spec.ts uses page.waitForTimeout(2_000) before expect(activationPosted). Timing-based assertion is flake-prone in CI."
    fix_hint: "Replace waitForTimeout with page.waitForRequest('**/functions/v1/record-activation') awaited after the card tap. Deterministic and no fixed delay."
```

---

## Overall Verdict

**READY FOR EXECUTE** — subject to the 2 warnings above (both are fixable by the executor
inline during plan execution; neither blocks functional correctness of any plan goal).

- **Blockers:** 0 (all 3 iter-1 blockers resolved)
- **Warnings:** 2 (W-01, W-03 deliberate carry-overs; NEW-W-01, NEW-W-02 new items)
  - NEW-W-01 (lighthouse `require`) — executor should fix at time of writing the script
  - NEW-W-02 (waitForTimeout flake) — executor should use waitForRequest instead
- All 13 ONBOARD-* requirements covered.
- All 20 D-01..D-20 decisions implemented.
- Dependency DAG valid, no cycles.
- Migration timestamps clean, no collisions.
- VALIDATION.md present and complete.
- RESEARCH.md open questions formally marked RESOLVED.

Run `/gsd-execute-phase 34` to proceed.
