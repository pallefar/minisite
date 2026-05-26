---
phase: 61-admin-protocol-creator
plan: 08
type: execute
wave: 2
depends_on:
  - 61-01-db-tables-rls
  - 61-02-secdef-rpcs
  - 61-03-protocol-ai-assist-fn
  - 61-04-admin-core-ui
  - 61-05-admin-editor-ui
  - 61-06-clinic-adopt-flow
  - 61-07-patient-kb-public
files_modified:
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - .planning/phases/61-admin-protocol-creator/61-CARRY-OVER.md
autonomous: true
requirements:
  - PROTOCOL-01
  - PROTOCOL-02
  - PROTOCOL-03
  - PROTOCOL-04
  - PROTOCOL-05
  - PROTOCOL-06
  - PROTOCOL-07
  - PROTOCOL-08
must_haves:
  truths:
    - "`supabase db push --linked --project-ref ytnsipxxmzgaebkqmokp` succeeds: 3 migrations (20260526000001, 20260526000002, 20260526000003) applied to remote"
    - "`supabase functions deploy protocol-ai-assist --import-map supabase/functions/_shared/deno.json --project-ref ytnsipxxmzgaebkqmokp` succeeds; Fn appears ACTIVE in list"
    - "`npm test` full suite passes (or, if FLAKY EnvironmentTeardownError per execution_lesson, own-tests green + no-net-new failures vs baseline)"
    - "All Phase 61 Vitest suites (protocols admin + clinic + Edge Fn handler + markdown shortcode + public route) green"
    - "ROADMAP.md Phase 61 checkbox flipped to `- [x]`; Phase 61 PROTOCOL-01..08 rows in Requirements table → 'Complete'"
    - "STATE.md updated: completed_phases = 10 (was 9 after Phase 60), completed_plans += 8, percent recomputed"
    - "CARRY-OVER.md lists items deferred to Phase 70 (HUMAN-UAT: 2-person review with second admin account, clinician-adopt → patient-prefill end-to-end, KB shortcode in live article)"
  artifacts:
    - path: ".planning/phases/61-admin-protocol-creator/61-CARRY-OVER.md"
      provides: "Per-plan push-status matrix + Phase 70 UAT signals roll-up"
      contains: "HUMAN-UAT deferred"
    - path: ".planning/ROADMAP.md"
      provides: "Phase 61 entry flipped to complete"
      contains: "- [x] **Phase 61: Admin Protocol Creator**"
  key_links:
    - from: "Phase 61 SUMMARY rollup"
      to: ".planning/STATE.md milestone progress"
      via: "state.complete-phase or manual sed (per reference_state_complete_phase_writes_wrong_counters)"
      pattern: "completed_phases: 10"
---

<objective>
Close out Phase 61: push DB migrations, deploy Edge Fn, run full test sweep, update ROADMAP + STATE, and roll up HUMAN-UAT signals to Phase 70.

Purpose: Final commit/deploy step per `feedback_phase_close_out_db_push_verification`. This plan is the only one that touches remote infra; all prior plans are file-system only.

Output: 3 migrations + 1 Fn applied to remote project `ytnsipxxmzgaebkqmokp`; ROADMAP + STATE updated; CARRY-OVER documents Phase 70 deferrals.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/STATE.md
@/Users/karstenhaldan/minisite/leanshot/.planning/ROADMAP.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-RESEARCH.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-VALIDATION.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run full test sweep + tsc gate</name>
  <files></files>
  <action>
Step 1 — Run TypeScript gate:
```bash
cd /Users/karstenhaldan/minisite/leanshot
npx tsc -p tsconfig.app.json --noEmit 2>&1 | tee /tmp/61-tsc.log
```

Expected: 0 errors attributable to Phase 61 paths (`src/components/admin/protocols/`, `src/components/clinic/protocols/`, `src/components/protocols/`, `src/lib/markdown/protocol-shortcode-plugin.ts`, `src/lib/hooks/useActiveProtocolAssignment.ts`, `src/types/protocols.ts`, `src/App.tsx`, `src/index.css`).

If pre-existing TS errors elsewhere in the repo: document baseline and ensure Phase 61 introduced ZERO new errors.

Step 2 — Run Phase 61 targeted Vitest suites:
```bash
npx vitest run --config vite.config.ts \
  src/components/admin/protocols/__tests__/ \
  src/components/clinic/protocols/__tests__/ \
  src/components/protocols/__tests__/ \
  src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts \
  2>&1 | tee /tmp/61-vitest.log
```

Expected: all Phase 61 tests green. Count the assertions and verify against `.planning/phases/61-admin-protocol-creator/61-VALIDATION.md` plan-by-plan matrix.

Step 3 — Run Edge Fn handler tests:
```bash
npx vitest run --config vite.config.ts ../supabase/functions/protocol-ai-assist/__tests__/handler.test.ts 2>&1 | tee /tmp/61-fn-vitest.log
```

Expected: all 6 handler tests green.

Step 4 — Run baseline full suite (with the FLAKY caveat per STATE.md execution_lesson):
```bash
npm test 2>&1 | tee /tmp/61-full-vitest.log
```

Gate per `reference_vitest_4_projects_config_masks_default`: if `npm test` reports 0 collected, retry as `npx vitest run --config vite.config.ts`.

Acceptance: own-tests green + no NET-NEW failures vs baseline (per execution_lesson "FLAKY EnvironmentTeardownError"). If new failures appear, identify them — Phase 61 must NOT introduce regressions.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && (grep -c "error TS" /tmp/61-tsc.log 2>/dev/null || echo 0) | head -1 && grep -E "Test Files.*passed|✓" /tmp/61-vitest.log 2>/dev/null | tail -3</automated>
  </verify>
  <done>tsc clean for Phase 61 paths; all Phase 61 Vitest suites green; Edge Fn handler tests green; full suite no net-new failures.</done>
</task>

<task type="auto">
  <name>Task 2: Push migrations + deploy Edge Fn to Supabase</name>
  <files></files>
  <action>
Step 1 — Pre-flight migration check per `reference_supabase_back_dated_migration_blocks_push`:

```bash
cd /Users/karstenhaldan/minisite
ls supabase/migrations/2026* 2>/dev/null  # Verify Phase 61's 20260526000001/2/3 are present
supabase migration list --linked --project-ref ytnsipxxmzgaebkqmokp 2>&1 | tail -20
```

If the remote shows any 20281201XXXXXX migrations as applied AND our local 20260526XXXXXX files are NEWER, no back-dating issue. If a back-dated file is detected, follow the recipe in `reference_supabase_back_dated_migration_blocks_push`: `mv` offender to /tmp, push, restore.

Step 2 — Apply migrations:
```bash
cd /Users/karstenhaldan/minisite
supabase db push --linked --project-ref ytnsipxxmzgaebkqmokp 2>&1 | tee /tmp/61-db-push.log
```

Expected output: 3 migrations applied (`20260526000001_protocol_tables`, `20260526000002_protocol_secdef_rpcs`, `20260526000003_protocol_seed_data`). Verify by `grep -E "Applying|applied" /tmp/61-db-push.log`.

If failure: read the error. Common: missing `is_staff()` helper (already exists from Phase 60), or `gen_random_uuid()` extension (already enabled). If Postgres version doesn't support `generated always as` (RESEARCH.md A4), implement the slug via a trigger inline and re-push.

Step 3 — Deploy Edge Fn per `reference_supabase_functions_deploy_import_map_flag` v2.101.0 silent-ignore note:
```bash
cd /Users/karstenhaldan/minisite
supabase functions deploy protocol-ai-assist \
  --project-ref ytnsipxxmzgaebkqmokp \
  2>&1 | tee /tmp/61-fn-deploy.log
```

Per the reference: v2.101.0 silently ignores `--import-map` flag. The per-Fn `deno.json` at `supabase/functions/protocol-ai-assist/deno.json` (created in Plan 03) provides the import map natively — deployment should succeed.

Verify:
```bash
supabase functions list --project-ref ytnsipxxmzgaebkqmokp 2>&1 | grep protocol-ai-assist
```

Expected: row showing `protocol-ai-assist` with status `ACTIVE`.

Step 4 — Smoke test the deployed Fn (curl with admin JWT skipped — deferred to Phase 70 HUMAN-UAT). Document deploy time + version in CARRY-OVER.md.

Constraints:
  - Working directory is `/Users/karstenhaldan/minisite` (git root, NOT `/leanshot/`) per `reference_minisite_monorepo_layout`
  - Project ref is hardcoded `ytnsipxxmzgaebkqmokp` per `reference_leanshot_supabase_project_ref`
  - If `SUPABASE_ACCESS_TOKEN` is required and missing, the CLI ambient-auth works in interactive Claude Code sessions (per the reference) — if spawned as background Agent and 401 occurs, surface as auth gate
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -E "Applying|migration|applied" /tmp/61-db-push.log 2>/dev/null | head -5 && supabase functions list --project-ref ytnsipxxmzgaebkqmokp 2>/dev/null | grep -E "protocol-ai-assist.*ACTIVE"</automated>
  </verify>
  <done>3 migrations applied to remote; protocol-ai-assist Fn ACTIVE; logs captured for SUMMARY.</done>
</task>

<task type="auto">
  <name>Task 3: Update ROADMAP, STATE, write CARRY-OVER, write Phase SUMMARY</name>
  <files>.planning/ROADMAP.md, .planning/STATE.md, .planning/phases/61-admin-protocol-creator/61-CARRY-OVER.md, .planning/phases/61-admin-protocol-creator/61-SUMMARY.md</files>
  <action>
Step 1 — Update `.planning/ROADMAP.md`:
- Find line `- [ ] **Phase 61: Admin Protocol Creator**` (line 22) and flip to `- [x]`
- Find the Phase 61 detailed section (line 328+) and update `**Plans**: TBD` to `**Plans**: 8 plans (see .planning/phases/61-admin-protocol-creator/)`
- Find the Requirements table (line 420+) and flip PROTOCOL-01..08 status from `Pending` to `Complete`

Use `sed -i ''` for precise edits BUT first check format with `grep -c "^- \\[ \\] \\*\\*Phase 61"` per `feedback_roadmap_format_variance_close_out_check` — if 0 matches, the format differs and direct Edit tool is required.

Step 2 — Update `.planning/STATE.md` per `reference_state_complete_phase_writes_wrong_counters` — do NOT use `state.complete-phase` (it writes wrong counters). Edit directly:

- Frontmatter: `completed_phases: 9` → `10`; `completed_plans: 48` → `56`; recompute `percent = round(56 / total_plans * 100)` (note: total_plans may also need incrementing if Phase 61 added net-new plans — STATE.md tracks the total)
- "Current Position" section: replace "Phase 60 COMPLETE" with brief Phase 61 summary; document Phase 61 deliverables (8 plans, 3 migrations, 1 Fn, 13+ React components)
- Add Phase 62 resume notes section (mirror Phase 61 resume notes style from current STATE.md)

Step 3 — Write `.planning/phases/61-admin-protocol-creator/61-CARRY-OVER.md`:

```markdown
# Phase 61 — Carry-Over

**Status:** Complete (autonomous-verify-only)
**Date:** <today>
**Plans shipped:** 8 / 8

## Per-Plan Push Status Matrix

| Plan | Migrations Created | Migrations Pushed (db push) | Fn Created | Fn Deployed |
|------|--------------------|-----------------------------|------------|-------------|
| 61-01 | 20260526000001 + 20260526000003 | ✅ Plan 08 | — | — |
| 61-02 | 20260526000002 | ✅ Plan 08 | — | — |
| 61-03 | — | — | protocol-ai-assist | ✅ Plan 08 |
| 61-04..07 | — | — | — | — |

## Deferred to Phase 70 (HUMAN-UAT)

- **2-person review walkthrough**: requires a second admin account; cannot self-verify in single-user dev session. Test: Admin A submits draft → Admin B reviews + publishes (or rejects with SELF_REVIEW_REJECTED if Admin A attempts publish).
- **Clinician adopt → patient prefill end-to-end**: requires a clinician account + roster patient; Phase 70 will exercise the adopt flow against a live patient and verify MedicationTab Expected/Logged row appears next week.
- **KB shortcode in live article**: requires Phase 37 KB editor to insert `[protocol:<uuid>]` into an article body and verify inline ProtocolSummaryCard renders.
- **Public `/protocols/<slug>` route**: requires auth'd browser session; Phase 70 confirms noindex header present + 404 EmptyState for unpublished slugs.
- **AI-assist Suggest live call**: requires OPENROUTER_API_KEY set (already done in Phase 60.5) + admin draft + step row; Phase 70 verifies refusal flag triggers for non-RAG-cited responses.

## Deferred to Phase 63 (Tech Debt)

- Layer 1 UPDATE-immutability for `review_state='published'` rows. Current state allows direct UPDATE (RLS staff-only); UI flow uses INSERT-new-version. Future: add Postgres trigger preventing UPDATE on published rows except via SECDEF RPCs.
- Org-scoping check inside `assign_protocol_to_patient` RPC (currently trusts Phase 30 roster RLS).

## Carry-Over to Phase 67 (Operational Runbooks)

- Vendor secret audit for `OPENROUTER_API_KEY` — confirm Phase 60.5 set value is non-placeholder + has sufficient credit balance for the 50/day/admin allowance.
- Add Phase 61 surfaces to admin-action-token plan (currently no admin-token requirement; deferred).

## Test Artifact References

- TS gate: `/tmp/61-tsc.log`
- Vitest Phase 61: `/tmp/61-vitest.log`
- Edge Fn handler tests: `/tmp/61-fn-vitest.log`
- Full suite baseline: `/tmp/61-full-vitest.log`
- DB push: `/tmp/61-db-push.log`
- Fn deploy: `/tmp/61-fn-deploy.log`
```

Step 4 — Write phase SUMMARY at `.planning/phases/61-admin-protocol-creator/61-SUMMARY.md` aggregating per-plan summaries.

Step 5 — Final commit (the orchestrator handles the commit; this task only writes files).

Constraints:
  - Per `reference_state_complete_phase_writes_wrong_counters`: do NOT use `gsd-sdk query state.complete-phase` — write STATE.md manually
  - Per `reference_gsd_sdk_state_complete_phase_cwd_sensitivity`: any state SDK invocation must be from `/Users/karstenhaldan/minisite/leanshot` (relative path-aware)
  - Per `feedback_roadmap_format_variance_close_out_check`: grep BEFORE sed
  - Per `feedback_phase_close_out_db_push_verification`: this plan owns the phase-level db push verification per-plan matrix
  - All HUMAN-UAT signals rolled up to Phase 70 per `D-08` milestone contract; this phase remains `autonomous: true`
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -q "^- \\[x\\] \\*\\*Phase 61:" .planning/ROADMAP.md && grep -q "completed_phases: 10" .planning/STATE.md && test -f .planning/phases/61-admin-protocol-creator/61-CARRY-OVER.md && test -f .planning/phases/61-admin-protocol-creator/61-SUMMARY.md</automated>
  </verify>
  <done>ROADMAP Phase 61 checked off; STATE counters incremented; CARRY-OVER documents 5 Phase 70 deferrals + 2 Phase 63 + 2 Phase 67; SUMMARY exists.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Local CLI → Supabase remote | Authenticated via `SUPABASE_ACCESS_TOKEN` or ambient auth; project-ref scopes operations |
| Local CLI → npm registry | No new packages installed in Phase 61 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-08-01 | Tampering | Migration applied to wrong project | mitigate | `--project-ref ytnsipxxmzgaebkqmokp` explicitly pinned per `reference_leanshot_supabase_project_ref` |
| T-61-08-02 | Information disclosure | OPENROUTER_API_KEY exposed in deploy logs | accept | Supabase CLI redacts secrets in deploy output; secret was set during Phase 60.5 not this plan |
| T-61-08-03 | Repudiation | STATE.md counters drift over multiple close-outs | mitigate | Per reference_state_complete_phase_writes_wrong_counters: manual edit only, never the SDK verb |
| T-61-08-SC | Tampering | Supply-chain via npm install | accept | No npm install in this plan; all dependencies pre-installed in main and verified in Phase 60 |
</threat_model>

<verification>
- `grep "^- \\[x\\] \\*\\*Phase 61:" .planning/ROADMAP.md` returns 1 match
- `grep "completed_phases: 10" .planning/STATE.md` returns 1 match
- All Phase 61 test suites green (per Task 1)
- `supabase migration list --linked --project-ref ytnsipxxmzgaebkqmokp` shows 3 new applied
- `supabase functions list --project-ref ytnsipxxmzgaebkqmokp | grep protocol-ai-assist` shows ACTIVE
- CARRY-OVER.md enumerates Phase 70 deferrals
</verification>

<success_criteria>
- [ ] tsc gate passes for Phase 61 paths
- [ ] Phase 61 Vitest suites all green
- [ ] 3 migrations applied to remote
- [ ] protocol-ai-assist Fn deployed ACTIVE
- [ ] ROADMAP + STATE updated
- [ ] CARRY-OVER.md documents Phase 70 HUMAN-UAT roll-up
- [ ] Phase 61 SUMMARY synthesizes per-plan deliverables
</success_criteria>

<output>
Phase 61 close-out complete. Final SUMMARY at `.planning/phases/61-admin-protocol-creator/61-SUMMARY.md`. Orchestrator commits all changes per `commit_docs: true`.
</output>
