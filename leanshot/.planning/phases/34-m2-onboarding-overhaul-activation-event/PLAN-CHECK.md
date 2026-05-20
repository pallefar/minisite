# Phase 34 Plan Check — M2 Onboarding Overhaul + Activation Event
# Iter-1

**Checked:** 2026-05-20
**Plans verified:** 10 (34-01 through 34-10)
**Overall status:** ISSUES FOUND — 3 blockers, 4 warnings

---

## Quick Reference: Per-Plan Verdict

| Plan | Wave | Status | Notes |
|------|------|--------|-------|
| 34-01 | 1 | PASS | Schema foundation solid; all SECDEFs + RLS correct |
| 34-02 | 1 | PASS | Named dollar-quote tags correct; cookie helper well-specified |
| 34-03 | 1 | BLOCK | Migration `20270706000006` absent from `files_modified` frontmatter; `isAppleEnabled` not exported |
| 34-04 | 2 | BLOCK | `isAppleEnabled` defined as non-exported private function; breaks 34-06 consumer |
| 34-05 | 2 | PASS | Race-safe SECDEF + PostHog alias helper correctly planned |
| 34-06 | 3 | WARN | `files_modified` undercounts by ~4 files (update-anon-session + AnonymousPreviewView); scope on high side |
| 34-07 | 4 | PASS | Goal→action map + fire-once + store extension all correct |
| 34-08 | 3 | PASS | Superadmin gate, dnd-kit chunk isolation, and TabPlaceholder seam all correct |
| 34-09 | 4 | WARN | HogQL injection via `time_range_days` interpolation not sanitised; minor severity |
| 34-10 | 5 | WARN | ONBOARD-10 performance implementation relies on inherent design choices with no explicit optimization task |

---

## Dimension 1: Requirement Coverage

All 13 ONBOARD-* requirements are covered:

| Requirement | Plans | Status |
|-------------|-------|--------|
| ONBOARD-01 | 34-01, 34-02, 34-05, 34-06 | Covered |
| ONBOARD-02 | 34-04, 34-06, 34-10 | Covered |
| ONBOARD-03 | 34-01, 34-06 | Covered |
| ONBOARD-04 | 34-06 | Covered |
| ONBOARD-05 | 34-01, 34-03, 34-07, 34-10 | Covered |
| ONBOARD-06 | 34-01, 34-03 | Covered |
| ONBOARD-07 | 34-01, 34-08 | Covered |
| ONBOARD-08 | 34-09, 34-10 | Covered |
| ONBOARD-09 | 34-09 | Covered |
| ONBOARD-10 | 34-10 | Covered (see Warning W-01) |
| ONBOARD-11 | 34-01, 34-05 | Covered |
| ONBOARD-12 | 34-06 | Covered |
| ONBOARD-13 | 34-01, 34-06, 34-07 | Covered |

Verdict: PASS — no requirement ID missing from all plans' `requirements` fields.

---

## Dimension 2: Task Completeness

All tasks in all plans have `<files>`, `<action>`, `<verify>`, and `<done>` elements. The
`checkpoint:human-action` and `checkpoint:human-verify` tasks in 34-08 (Task 3), 34-10
(Tasks 2, 3, 4) are structurally correct (no required fields for that type).

Verdict: PASS — no missing required task elements detected.

---

## Dimension 3: Dependency Correctness

Dependency graph:

```
Wave 1: 34-01[], 34-02[], 34-03[]
Wave 2: 34-04[], 34-05[34-01,34-02]
Wave 3: 34-06[34-01,34-02,34-04], 34-08[34-01]
Wave 4: 34-07[34-03,34-06], 34-09[34-08]
Wave 5: 34-10[34-04,34-06,34-07,34-09]
```

No cycles detected. All referenced plans exist. Wave assignments are consistent with dependency DAG.

One documentation concern: 34-05 edits `_shared/posthog-server.ts` (adds `aliasServerSide`), and
34-03 also edits `posthog-server.ts` (adds Phase38Event member). 34-05 is Wave 2 and does NOT
list 34-03 in `depends_on`. This is safe because all Wave 1 plans merge before Wave 2 starts, so
34-05 reads the post-34-03 version of the file. No structural fix required.

Verdict: PASS — no cycles, no missing references, wave assignments correct.

---

## Dimension 4: Key Links Planned

Key links across plans are well-specified with pattern hints. The integration seams below are
verified as owned:

- `OnboardingBuilderModule.tsx` (34-08) → A/B + funnel tabs (34-09) — ownership via TabPlaceholder seam. CLEAR.
- `useConsumerOnboardingFlow` (34-06) → activation hook (34-07) — import path declared. CLEAR.
- `record-activation` Edge Fn (34-03) → `activation-hooks.ts` (34-07) — fetch path declared. CLEAR.
- App.tsx co-edits: 34-04 adds `/auth/callback` (Wave 2), 34-06 adds `/onboard` (Wave 3). Serialized. CLEAR.
- `anonymous_sessions.merged_user_id` NULL→UUID transition owned by `merge_anon_session` SECDEF in 34-05. CLEAR.

Verdict: PASS — wiring seams declared in all critical pairs.

---

## Dimension 5: Scope Sanity

| Plan | Tasks | Declared Files | Effective Files | Status |
|------|-------|----------------|-----------------|--------|
| 34-01 | 2 | 4 | 4 | OK |
| 34-02 | 2 | 6 | 6 | OK |
| 34-03 | 2 | 6 | **7** (migration 000006 in action) | Warn |
| 34-04 | 2 | 5 | 5 | OK |
| 34-05 | 2 | 5 | 5 | OK |
| 34-06 | 3 | 11 | **~15** (+update-anon-session ×3 + AnonymousPreviewView) | Warn |
| 34-07 | 2 | 7 | 7 | OK |
| 34-08 | 3 | 10 | 10 | OK |
| 34-09 | 2 | 11 | 11 | OK |
| 34-10 | 4 | 5 | 5 | OK |

34-06 is the largest single plan. With 3 tasks + ~15 effective files, it is at the threshold.
The complexity is warranted (the browser onboarding surface is inherently broad), and the
`objective` block explicitly acknowledges the surface area with a justification referencing
the avoid-cross-plan-stub-and-replace rationale. Acceptable but noted.

Verdict: WARNING (W-02) — 34-06 effective file count is ~15 (above the 10-warning / 15-blocker threshold); borderline but justified given the plan's rationale.

---

## Dimension 6: Verification Derivation

All `must_haves.truths` are user-observable or test-observable behaviors. Artifacts map to
truths. Key links connect artifacts. No implementation-detail truths detected ("bcrypt
installed" etc.).

One note on 34-03: the `v_did_fire` self-comparison in the SECDEF (line 357 of the action body)
is logically redundant but functionally correct — the advisory lock + early-return guarantee
guarantees any surviving path has a non-null activated_at post-upsert. Not a correctness issue.

Verdict: PASS

---

## Dimension 7: Context Compliance

All 20 locked decisions (D-01..D-20) are implemented by at least one plan's action or must_haves:

| Decision | Implementing Plan(s) | Coverage |
|----------|---------------------|----------|
| D-01 Goal-dependent activation | 34-03, 34-07 | Covered |
| D-02 7-day window | 34-03 (SECDEF + Edge Fn) | Covered |
| D-03 Single event + property shape | 34-03 | Covered |
| D-04 Fire-once | 34-03 (advisory lock + DB guard), 34-07 (browser guard) | Covered |
| D-05 Server-side capture | 34-03 | Covered |
| D-06 Cookie-keyed anonymous_sessions | 34-01, 34-02 | Covered |
| D-07 Richest-data wins | 34-05 (merge SECDEF) | Covered |
| D-08 4-bucket merge | 34-05 (preferences + drafts + PostHog alias + aff_code) | Covered |
| D-09 30-day TTL | 34-02 (pg_cron) | Covered |
| D-10 PII posture + RLS | 34-01 (deny-all RLS) | Covered |
| D-11 8-goal catalog | 34-01 (CHECK constraint), 34-06 (UI), 34-07 (action map) | Covered |
| D-12 Hybrid 3-card UI | 34-07 (FirstActionSurface) | Covered |
| D-13 Goal→action mapping | 34-07 (GOAL_ACTION_MAP) | Covered |
| D-14 Goal editable post-signup | Noted in 34-07 (Settings handles this; no explicit task but is additive Settings work) | Partial |
| D-15 Activation never re-fires | 34-03 (DB guard), 34-07 (store guard) | Covered |
| D-16 Step builder MVP types | 34-01 (_validate_onboarding_steps), 34-08 (StepPalette) | Covered |
| D-17 Ship Winner = new version + flag flip | 34-09 | Covered |
| D-18 Superadmin-only ship | 34-08 (UI gate), 34-09 (Edge Fn server gate) | Covered |
| D-19 50/50 default A/B split | 34-09 (noted in OnboardingABPanel design) | Covered |
| D-20 PostHog Experiments | 34-09 | Covered |

D-14 (Goal editable in Settings) has no explicit task in Phase 34. The `primary_goal` column
is added to `profiles` (34-01) and is writable, but the Settings UI edit is not explicitly planned.
This is a WARNING, not a blocker — the column lands in this phase; the Settings edit is deferred
or implicitly handled in the existing Settings surface.

No deferred ideas are implemented. No contradictions of locked decisions detected.

Verdict: WARNING (W-03) — D-14 "Goal editable later in Settings" has no explicit implementing task; the column infrastructure ships but the Settings UI edit path is unowned.

---

## Dimension 7b: Scope Reduction Detection

No scope-reduction language detected ("v1", "static for now", "hardcoded", "future
enhancement") that contradicts any locked decision. All decisions are delivered in full
for this phase.

The `family-supporter` goal ships with a "Coming soon — join waitlist" card per CONTEXT
Specifics section (not a hidden reduction — it was user-specified).

Verdict: PASS

---

## Dimension 7c: Architectural Tier Compliance

RESEARCH.md Architectural Responsibility Map is present. Cross-checking all plan tasks:

- Anonymous session creation: Edge Fn (service-role INSERT) with browser cookie → correct (API tier owns).
- Activation event capture: Edge Fn `record-activation` → correct (API tier owns; D-05).
- Ship Winner flag-flip: Edge Fn → correct (API tier; personal API key never in browser).
- Fire-once activation guard: `activation_events.activated_at IS NOT NULL` check in Edge Fn + DB → correct.
- Step builder drag-reorder: Browser / Client (Admin) → correct per responsibility map.
- A/B variant resolution: Browser (`getFeatureFlagPayload`) → correct per responsibility map.
- Goal-aware first-action UI: Browser / Client → correct.
- PostHog personal API key access: only in Edge Fn (never VITE_ var) → correct.

Verdict: PASS — all capabilities assigned to correct tiers.

---

## Dimension 8: Nyquist Compliance

RESEARCH.md has a `## Validation Architecture` section, so Nyquist applies.

### Check 8e: VALIDATION.md Existence
No `34-VALIDATION.md` file exists in the phase directory.

Per memory `feedback_validation_md_inline_generation_when_missing`: the orchestrator can
generate VALIDATION.md inline from per-plan `<verify><automated>` blocks instead of
re-spawning the researcher. This is the recommended recovery path.

Extracting automated verify commands from each plan:

| Task | Plan | Wave | Automated Command | Status |
|------|------|------|-------------------|--------|
| Task 1 | 34-01 | 1 | `node -e "..."` — checks 3 migration files for content | Present |
| Task 2 | 34-01 | 1 | `node -e "..."` — checks activation_events ALTER file | Present |
| Task 1 | 34-02 | 1 | `node -e "..."` — checks cron migration content | Present |
| Task 2 | 34-02 | 1 | `cd leanshot && npm run test:unit ... && deno test ...` | Present |
| Task 1 | 34-03 | 1 | `cd leanshot && npm run test:unit ... && npm run lint ...` | Present |
| Task 2 | 34-03 | 1 | `deno test ... && node -e "..."` — union check + RPC check | Present |
| Task 1 | 34-04 | 2 | `cd leanshot && npm run test:unit -- --run src/lib/auth.test.ts` | Present |
| Task 2 | 34-04 | 2 | `cd leanshot && npm run test:unit ... && npm run lint ...` | Present |
| Task 1 | 34-05 | 2 | `node -e "..."` — migration + alias helper check | Present |
| Task 2 | 34-05 | 2 | `deno test ... && cd leanshot && npm run test:unit ...` | Present |
| Task 1 | 34-06 | 3 | `cd leanshot && npm run test:unit ... && node -e "..."` | Present |
| Task 2 | 34-06 | 3 | `cd leanshot && npm run test:unit ...` | Present |
| Task 3 | 34-06 | 3 | `cd leanshot && npm run test:unit ... && node -e "..."` | Present |
| Task 1 | 34-07 | 4 | `cd leanshot && npm run test:unit ... && node -e "..."` | Present |
| Task 2 | 34-07 | 4 | `cd leanshot && npm run test:unit ...` | Present |
| Task 1 | 34-08 | 3 | `cd leanshot && npm run test:unit ... && node -e "..."` | Present |
| Task 2 | 34-08 | 3 | `cd leanshot && npm run test:unit ... && npm run build ...` | Present |
| Task 1 | 34-09 | 4 | `deno test ...` | Present |
| Task 2 | 34-09 | 4 | `cd leanshot && npm run test:unit ... && node -e "..."` | Present |
| Task 1 | 34-10 | 5 | `cd leanshot && npx playwright test --grep ...` | Present |

Sampling: All waves have sufficient automated coverage (≥2 of every 3 consecutive tasks).

Wave 0 gaps listed in RESEARCH.md are owned by plans that create the test files:
- `use-consumer-onboarding-flow.test.ts` → 34-06 Task 1
- `anon-merge.test.ts` → 34-05 Task 2
- `record-activation/index.test.ts` → 34-03 Task 2
- `FirstActionSurface.test.tsx` → 34-07 Task 2
- `ship-winner.test.ts` → 34-09 Task 2

**VALIDATION.md is missing — must be generated inline before execution.**

Verdict: WARNING (W-04) — VALIDATION.md does not exist. Recovery: orchestrator generates inline from the automated verify blocks above (~3k tokens). All verify commands are present in plans; this is a documentation gap, not a coverage gap.

---

## Dimension 9: Cross-Plan Data Contracts

Key shared data flows verified:

- `posthog-server.ts` modified by both 34-03 (Wave 1, Phase38Event union) and 34-05 (Wave 2, aliasServerSide). No conflict — additive changes in serialized waves.
- `anonymous_sessions.preferences` JSONB written by `create-anon-session` (34-02), `update-anon-session` (34-06), and `merge_anon_session` (34-05). All use INSERT/UPDATE + last_activity_at reset. No destructive transforms on shared data.
- `activation_events` table: Phase 38 shell is ALTERed by 34-01 (adds columns) and written by 34-03 `record-activation`. No conflict.
- `OnboardingBuilderModule.tsx` co-edited: 34-08 creates with TabPlaceholder, 34-09 replaces TabPlaceholder. 34-09 depends on 34-08 → serialized. No conflict.
- `events.ts` co-edited only by 34-03. No conflict.

Verdict: PASS

---

## Dimension 10: CLAUDE.md Compliance

Project CLAUDE.md reviewed. Key rules verified against plans:

- **No dynamic `import.meta.env[...]`**: 34-04 explicitly uses literal `import.meta.env.VITE_AUTH_APPLE_ENABLED` per the memory rule. 34-06 uses literal `VITE_SUPABASE_URL`. PASS.
- **Lazy-loaded code-split**: All new route-equivalents (AnonymousPreviewView, AuthCallbackView, OnboardingBuilderModule) use `React.lazy()`. PASS.
- **Single Zustand store — no slices**: 34-07 adds flat actions to the existing store. PASS.
- **TypeScript strict**: New files use TypeScript with explicit types. PASS.
- **dnd-kit in admin-shell chunk only**: 34-08 verifies via `npm run build` CI guard. PASS.
- **`supabase functions deploy` without `--linked`**: All Edge Fn deploy notes omit the flag. PASS.
- **Supabase migration filename regex (`<14-digits>_name.sql`)**: All migration filenames use `20270706*` series with 14-digit prefix. PASS.
- **Dollar-quote nesting in cron**: 34-02 uses `$cron$...$cron$` outer and `$anon_ttl$...$anon_ttl$` inner. PASS.
- **SECDEF `set search_path`**: All new SECDEF functions include `set search_path = pg_catalog, public, extensions`. PASS.

Verdict: PASS

---

## Dimension 11: Research Resolution

RESEARCH.md has a `## Open Questions` section at line 660. The section heading is:
```
## Open Questions
```

This does NOT have the `(RESOLVED)` suffix. No inline `RESOLVED:` markers appear on any of the 3 questions.

The 3 questions and their resolution status in the plans:
1. PKCE callback route: Addressed in 34-04 with full implementation.
2. Social proof counter: Addressed in 34-06 (RPC polling chosen per recommendation).
3. `onboarding.ship_winner` scope: Addressed in 34-08/34-09 (`admin_role = 'superadmin'` in Edge Fn).

All questions are functionally resolved by plan decisions, but the formal resolution markers
required by Dimension 11 are absent.

Verdict: BLOCKER (B-01) — RESEARCH.md `## Open Questions` section lacks `(RESOLVED)` suffix and individual `RESOLVED:` markers. Fix: Add `(RESOLVED)` to the section heading and inline `RESOLVED:` annotation to each question before execution.

---

## Dimension 12: Pattern Compliance

PATTERNS.md is present. Spot-checking key analog mappings:

- `anonymous_sessions.sql` → affiliates schema analog: CREATE TABLE pattern + RLS deny-all + partial index — referenced in 34-01 action. PASS.
- `onboarding_flows_consumer.sql` → org_onboarding_flows exact analog: SECDEF copy + advisory lock — referenced in 34-01 action. PASS.
- `create-anon-session/index.ts` → plan-personalize analog: CORS helpers + lazy admin singleton + __internal export — referenced in 34-02 action. PASS.
- `record-activation/index.ts` → posthog capture pattern with try/finally shutdownPostHog — referenced in 34-03 action. PASS.
- `use-consumer-onboarding-flow.ts` → exact use-org-onboarding-flow analog — referenced in 34-06 action. PASS.
- `OnboardingBuilderModule.tsx` → SortableTreePanel<OnboardingStepNode> usage — referenced in 34-08 action. PASS.
- Shared patterns: SECDEF search_path, PostHog try/finally, dnd-kit lazy isolation — all referenced in applicable plans. PASS.

Verdict: PASS

---

## Blockers (must fix before execution)

### B-01 [research_resolution] RESEARCH.md Open Questions section not marked RESOLVED

**Plan:** n/a (RESEARCH.md artifact)
**Description:** `34-RESEARCH.md` has `## Open Questions` at line 660 with 3 listed questions.
Neither the section heading nor the individual questions have `RESOLVED` markers. All 3 questions
are functionally answered by plan decisions, but the formal gate requires explicit markers.
**Fix hint:** Change heading to `## Open Questions (RESOLVED)`. Add `RESOLVED: <decision summary>`
under each question (e.g., Q1: "RESOLVED: Added /auth/callback path branch in 34-04"; Q2:
"RESOLVED: RPC polling chosen per recommendation in 34-06"; Q3: "RESOLVED: admin_role=superadmin
check in Edge Fn per 34-08/34-09").

---

### B-02 [task_completeness] 34-03 files_modified frontmatter omits migration 20270706000006

**Plan:** 34-03
**Task:** Task 2
**Description:** The action body explicitly creates `supabase/migrations/20270706000006_p34_record_activation_rpc.sql` (the `record_activation_event` SECDEF with advisory lock). The file is mentioned in the action body and the `<verify>` command checks for it, but it is absent from the `files_modified` frontmatter. This means:
(a) The SDK / GSD tooling may not track the file as owned by this plan.
(b) Parallel-wave collision detection (memory `feedback_parallel_executor_git_isolation`) cannot pre-screen the migration timestamp.
(c) The frontmatter is the ground truth for executor isolation — if the migration is not declared, the worktree executor may omit it from its commit pathspec.
**Fix hint:** Add `supabase/migrations/20270706000006_p34_record_activation_rpc.sql` to the `files_modified` list in 34-03's YAML frontmatter.

---

### B-03 [key_links_planned] 34-04 defines `isAppleEnabled` as non-exported; 34-06 requires it as an import

**Plan:** 34-04 (defect), 34-06 (consumer)
**Task:** 34-04 Task 1
**Description:** Plan 34-04 action code defines `isAppleEnabled()` as a local `function` without an `export` keyword. The 34-04 must_haves and exports list do NOT include `isAppleEnabled`. Plan 34-06 Task 2 explicitly imports `import { isAppleEnabled } from '@/lib/auth'` and notes "Plan 34-04 must export isAppleEnabled." If 34-04 ships without the export, 34-06 falls back to a shim, which means:
(a) Two implementations exist (CLAUDE.md anti-pattern).
(b) The must_haves truth in 34-06 ("shows 'Continue with Apple' button only when isAppleEnabled() is true") depends on the export that 34-04 does not declare.
This is a cross-plan wiring gap — the artifact is partially created but the seam is broken.
**Fix hint:** In 34-04 Task 1 action, change `function isAppleEnabled()` to `export function isAppleEnabled()`. Add `isAppleEnabled` to the `exports` list in the 34-04 artifacts frontmatter. Verify that 34-06 imports it directly without the shim.

---

## Warnings (should fix; execution can proceed with care)

### W-01 [requirement_coverage] ONBOARD-10 Lighthouse ≥90 has no explicit performance optimization task

**Plan:** 34-10 (verification), 34-06 (implementation)
**Description:** ONBOARD-10 requires Mobile Lighthouse ≥90 on `/onboard`. 34-10 Task 1 ships the Playwright Lighthouse gate but no plan has an explicit task for performance optimization of the route (deferred-init, image preload posture, bundle budget assertion for the onboard chunk). The score is assumed to be met by the clean route design in 34-06 (React.lazy, no heavy deps). If the score comes in below 90, the `feedback_defer_then_batch_fix_pattern` memory applies (document + batch fix). This is a risk, not a guaranteed failure.
**Fix hint:** Either (a) add a task in 34-10 or 34-06 that explicitly verifies the onboard chunk does not include heavy SDKs (posthog-js loads lazily? check via bundle analyzer), or (b) accept the risk and trust the design, documenting the contingency in 34-10-SUMMARY.md.

### W-02 [scope_sanity] 34-06 effective file count ~15, above the 10-warning threshold

**Plan:** 34-06
**Description:** `files_modified` declares 11 files, but the Task 2 action instructs the executor to create 3 additional `update-anon-session` Edge Fn files and Task 1 instructs creation of `AnonymousPreviewView.tsx` (~30 lines wrapper). Effective file count is ~15. The plan's objective block acknowledges this and provides justification (avoiding cross-plan stub-and-replace). The 3-task structure is within limits.
**Fix hint:** Either (a) add the 4 implicit files to `files_modified` for accurate tracking (recommended), or (b) split `update-anon-session` Edge Fn into plan 34-02 as an additive Task 3. Adding to `files_modified` is the lighter fix.

### W-03 [context_compliance] D-14 "Goal editable in Settings" has no owning task

**Plan:** None
**Description:** CONTEXT.md D-14 states "Goal editable later in Settings. Users can change `primary_goal` post-signup (recommender + content adapts)." The `primary_goal` column ships in 34-01 and is written in 34-06. However, no plan ships the Settings UI edit for `primary_goal`. The CONTEXT.md language "Goal editable later in Settings" implies this is in-scope for Phase 34, not deferred.
**Fix hint:** Either (a) add a task in 34-07 or 34-06 to wire `primary_goal` editing into the existing Settings surface (single `<select>` or `<Pill>` group in SettingsPage.tsx), or (b) clarify with the user whether "later" means a future phase, and mark it as a deferred item in CONTEXT.md with an explicit note.

### W-04 [nyquist_compliance] VALIDATION.md does not exist for Phase 34

**Plan:** n/a (phase artifact)
**Description:** RESEARCH.md has a `## Validation Architecture` section, making VALIDATION.md mandatory per Dimension 8e. The file is absent.
**Fix hint:** Generate VALIDATION.md inline from the per-plan `<verify><automated>` blocks (per memory `feedback_validation_md_inline_generation_when_missing`). All automated verify commands are present in plans. Estimated cost: ~3k tokens / 2min vs ~200k tokens to re-spawn researcher.

---

## Structured Issues (YAML)

```yaml
issues:

  - plan: null
    dimension: research_resolution
    severity: blocker
    description: "RESEARCH.md has '## Open Questions' section without (RESOLVED) suffix; 3 questions lack inline RESOLVED markers. All 3 are functionally answered by plan decisions."
    fix_hint: "Add '(RESOLVED)' to section heading; add 'RESOLVED: <decision>' annotation under each question in 34-RESEARCH.md."

  - plan: "34-03"
    dimension: task_completeness
    severity: blocker
    task: 2
    description: "supabase/migrations/20270706000006_p34_record_activation_rpc.sql is created in Task 2 action body but is absent from the files_modified frontmatter. SDK tooling and parallel-execution guards cannot pre-screen this file."
    fix_hint: "Add 'supabase/migrations/20270706000006_p34_record_activation_rpc.sql' to 34-03 files_modified YAML list."

  - plan: "34-04"
    dimension: key_links_planned
    severity: blocker
    task: 1
    description: "isAppleEnabled() is defined as a private non-exported function in 34-04 action. Plan 34-06 Task 2 imports it from '@/lib/auth' and its must_haves truth depends on the export. The seam is broken."
    artifacts:
      - "leanshot/src/lib/auth.ts"
      - "leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx"
    fix_hint: "Change 'function isAppleEnabled()' to 'export function isAppleEnabled()' in 34-04 Task 1 action. Add isAppleEnabled to 34-04 artifacts exports list."

  - plan: "34-10"
    dimension: requirement_coverage
    severity: warning
    description: "ONBOARD-10 (Lighthouse ≥90) has no explicit performance optimization task. The gate is in 34-10 but the implementation relies on inherent clean-route design in 34-06 with no enforcement mechanism before the Lighthouse audit."
    fix_hint: "Add a bundle-check task or accept the risk and document the contingency (defer-then-batch-fix per memory feedback_defer_then_batch_fix_pattern)."

  - plan: "34-06"
    dimension: scope_sanity
    severity: warning
    description: "files_modified declares 11 files but action instructs creation of ~4 additional files (update-anon-session Edge Fn ×3 + AnonymousPreviewView.tsx). Effective count ~15."
    metrics:
      declared_files: 11
      effective_files: 15
    fix_hint: "Add the 4 implicit files to files_modified frontmatter, OR split update-anon-session into 34-02 Task 3."

  - plan: null
    dimension: context_compliance
    severity: warning
    description: "D-14 'Goal editable later in Settings' has no owning task in Phase 34. profiles.primary_goal column ships but the Settings UI edit path is unowned."
    fix_hint: "Add a Settings edit task to 34-06 or 34-07, OR explicitly defer D-14 to a follow-up phase with user agreement."

  - plan: null
    dimension: nyquist_compliance
    severity: warning
    description: "34-VALIDATION.md does not exist. RESEARCH.md has a '## Validation Architecture' section making VALIDATION.md mandatory per Dimension 8e."
    fix_hint: "Generate VALIDATION.md inline from per-plan <verify><automated> blocks (memory feedback_validation_md_inline_generation_when_missing, ~3k tokens)."
```

---

## Landmine Verification Results (from prompt)

| Landmine | Status | Evidence |
|----------|--------|---------|
| Phase38Event union widening same-plan as Edge Fn | PASS | 34-03 Task 1 widens union; Task 2 ships Edge Fn; same plan. |
| activation_events ALTER not CREATE | PASS | 34-01 Task 2 uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS; verify command explicitly checks `create table public\.activation_events` is absent. |
| Dollar-quote nesting in cron | PASS | 34-02 Task 1 uses `$cron$...$cron$` outer + `$anon_ttl$...$anon_ttl$` inner; verify command checks for bare `$$` absence. |
| Migration filename regex | PASS | All Phase 34 migrations use `20270706*` 14-digit prefix with underscore + name. |
| Migration timestamp collision | PASS | Phase 34 uses `20270706*` series; Phase 38 uses `20270705*`; no internal collisions across the 8 declared migrations (000001–000008). Note: 34-03 adds 000006 in action without frontmatter declaration (B-02). |
| Integration seam blindspots | PASS | All A→B seams verified in Dimension 4 above. |
| status-machine transition owner | PASS | anonymous_sessions.merged_user_id transition owned by merge_anon_session SECDEF in 34-05. |
| Planner iter-1 anti-patterns | PASS | No shared-file choreography or hedge instructions detected. |
| vendor-gated send health check | PASS | 34-09 ship-winner-flag and onboarding-funnel-query both implement vendorHealthCheck() returning 503 when POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID missing. |
| Deno test discovery glob | PASS | All Edge Fn test files use `<name>.test.ts` pattern (create-anon-session/index.test.ts, record-activation/index.test.ts, etc.). |
| RLS per-file slug prefix | PASS | 34-10 Playwright specs use per-file slug prefixes (TEST_SLUG_PREFIX = `p34_anon_merge_${Date.now()}_...`). |
| Vite static env inlining | PASS | 34-04 uses literal `import.meta.env.VITE_AUTH_APPLE_ENABLED`; 34-06 uses literal `VITE_SUPABASE_URL`. No dynamic template literals. |
| Phase 34-04 Apple OAuth + Phase 31 path-based theming coexistence | PASS | `/auth/callback` path does not overlap with `/<clinic-slug>/...` paths; App.tsx routing handles `/auth/callback` before the `/clinic/` branch. |
| OnboardingFlow.tsx replacement vs additive | PASS | 34-06 rewrites with render-branch preserving org path (useOrgOnboardingFlow unchanged); CONTEXT.md confirms REWRITE strategy. |

---

## Recommendation

3 blockers require revision:

**B-01** (RESEARCH.md open questions): Lightweight fix — add `(RESOLVED)` to heading + inline markers. ~5 min.
**B-02** (34-03 files_modified): Lightweight fix — add one line to frontmatter YAML. ~1 min.
**B-03** (34-04 isAppleEnabled not exported): Surgical fix — add `export` keyword + update artifacts exports. ~5 min.

Recommended path: apply all 3 fixes inline (per memory `feedback_inline_fix_over_replan`) rather than re-spawning the planner. The 4 warnings are either risk-acknowledgment items (W-01, W-03) or housekeeping (W-02, W-04).

After fixes, re-verify Dimensions 11, 2, and 4 to confirm blockers are closed.
