# 07-PLAN-CHECK — Phase 7 pre-execution review

**Reviewer:** gsd-plan-checker (Claude Opus 4.7, 1M context)
**Date:** 2026-05-12
**Phase:** 07-compliance-foundations-legal-counsel-led
**Plans reviewed:** 07-{01..10}-PLAN.md (10 plans, 3 waves)
**Companions reviewed:** 07-CONTEXT.md, 07-RESEARCH.md, 07-VALIDATION.md, 07-PLAN-OUTLINE.md
**Stance:** adversarial / goal-backward

---

## Goal-backward analysis: do the 10 plans collectively deliver the 5 Phase 7 success criteria?

| ROADMAP §"Phase 7" Success Criteria | Covering plan(s) | Verdict |
|---|---|---|
| SC#1 — Privacy Policy published, references every data category, reachable from app + landing footer | 07-04 (content, all 19 categories enumerated) + 07-02 (footer wiring + AppShell footer + hosting) | **MET.** Plan 04 SC#1 wording correction handles the "reviewed by privacy-law counsel" → "founder-reviewed" supersession (D-01 LOCKED). |
| SC#2 — WMHMDA CHDP published with 5 structural anchors, linked conspicuously from homepage | 07-03 (CHDP content, 5 H2 anchors + DATA_CATEGORIES manifest + content-grep test) + 07-02 (Landing footer + AppShell footer wiring, both conspicuous) | **MET.** Cross-tenant link-rot defended by shared `LEGAL_LINKS` constant. |
| SC#3 — FTC HBNR runbook + 60-day clock + decision tree + on-call escalation; KF#6: no real FTC registration (reduced to runbook + ack) | 07-05 (`.planning/runbooks/hbnr-incident-response.md` + `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md` + Vitest content-grep test + ROADMAP SC#3 wording correction) | **MET.** Plan explicitly addresses KF#6 misnomer in ROADMAP. |
| SC#4 — Settings → Export all my data + Settings → Delete my account end-to-end | 07-06 (export: JSON + lazy PDF + audit summary + whitelist guarantee) + 07-07 (delete: typed-confirmation modal + T+0 admin RPC + T+30 pg_cron + Storage shred + audit skeleton + `leanshot_v4_pre_cloud_backup` wipe) | **MET (with one nuance).** "Per-user encryption key destroyed" SC literal is implemented as "object bytes hard-deleted under locked prefix" per D-02 (free-tier Storage, no envelope encryption). 07-07 line 967 + RESEARCH §6 lines 405-411 explicitly document the equivalence; plan stays internally consistent with the LOCKED D-02 + D-03 interpretation. → MEDIUM concern (literal-text drift; semantically delivered). |
| SC#5 — Account-deletion CI smoke test asserts zero rows post-finalize | 07-07 Task 5 (e2e/account-delete.spec.ts) iterates 12 child tables + 2 Storage prefixes + admin `getUserById` returns null + 2 skeleton rows survive with user_id=NULL | **MET.** Idempotent finalize + back-dated `initiated_at` + `run_finalize_account_deletions_cron_now()` test hook makes the 30-day clock simulable in CI. |

**Verdict on phase-goal coverage:** 5/5 SCs covered by the 10 plans.

---

## Required-ID coverage in `requirements` frontmatter

| Phase requirement | Plans listing it in `requirements:` | Verdict |
|---|---|---|
| COMPL-01 | 07-02, 07-04 | ✓ |
| COMPL-02 | 07-02, 07-03 | ✓ |
| COMPL-03 | 07-05 | ✓ |
| COMPL-06 | 07-06, 07-07 | ✓ |

All 4 phase requirement IDs appear in ≥1 plan's `requirements` field.

---

## Decision coverage (CONTEXT D-01..D-07, all LOCKED)

| Decision | Honored by | Verdict |
|---|---|---|
| D-01 (no counsel; self-draft only) | 07-03 (Termly/iubenda/RCW cross-ref + decision log) + 07-04 (no "counsel review" tasks, explicit DO-NOT list of covered-entity language) | ✓ |
| D-02 (free-tier Storage; upgrade trigger only) | 07-07 (Storage move + hard-delete, no envelope encryption, no pgsodium per RESEARCH §6) | ✓ |
| D-03 (30d soft-delete + crypto-shred + audit skeleton forever) | 07-07 (pending_account_deletions + initiate RPC + 30d cron finalize + skeleton inserted before cascade; user_id on delete set null in audit_logs) | ✓ |
| D-04 (full cloud-write audit log, server-side, 13-month retention + skeleton indefinite) | 07-08 (audit_logs table + 10 SECURITY DEFINER triggers + cleanup-audit-logs cron with `action not like 'account_deleted_%'` exclusion) | ✓ |
| D-05 (restore-from-backup UI in Settings → Recovery) | 07-10 (Recovery section + typed-confirm modal + setState(...,true) + signOut() chain) | ✓ |
| D-06 (codebase-wide `s.user!` sweep, one commit per file) | 07-09 (verified 14-occurrence inventory + nullable-selector + early-return-after-hooks pattern from MedLevelChart D-12 template + 13 atomic commits) | ✓ |
| D-07 (re-enable 7 deferred e2e specs as plan 07-01, CI gate prerequisite) | 07-01 (Wave 1, no deps; family A/B/C/D batched fixes; ROADMAP entry-condition mark-as-satisfied; deferred-tests.md frontmatter close) | ✓ |

All 7 LOCKED decisions honored. No deferred-ideas leakage detected.

---

## Threat-model presence

Per phase rule, every plan must have a `<threat_model>` block. Verified inline reads:

| Plan | `<threat_model>` block? | Threat count | STRIDE coverage |
|---|---|---|---|
| 07-01 | ✓ | 5 (T-07-01..05) | T (CI signal tampering, reporter regression, alt-skip mechanisms) |
| 07-02 | ✓ | 7 (T-07-02-01..07) | T/I/D/R/S (Markdown injection rejected; CSP unchanged; lazy-chunk integrity) |
| 07-03 | ✓ | 5 (T-07-03-01..05) | I/I/I/R/I (manifest-policy drift gate, Termly contradiction, processor identity) |
| 07-04 | ✓ | 8 (T1..T8-LEGAL) | I/I/I/I/R/I/I/R (covered-entity-language exclusion, manifest enumeration, governing law, conditional PostHog) |
| 07-05 | ✓ | 6 (T-07-05-01..06) | T/R/I/R/D/E (statutory drift, sole-founder bus-factor accepted, PII canary, under-notification) |
| 07-06 | ✓ | 7 (T-07-06-01..07) | I/I/I/D/D/T/R (raw-localStorage whitelist guarantee, photo bytes never in PDF, audit-row scoping, bundle bloat blocked) |
| 07-07 | ✓ | **11** (T-07-07-S1/S2/T1/T2/R1/I1/I2/D1/D2/E1/E2) | S/S/T/T/R/I/I/D/D/E/E — most comprehensive of the 10 |
| 07-08 | ✓ | 9 (T-07-08-01..09) | T/T/R/I/I/D/D/E/E (deny-write-by-omission, SECURITY DEFINER search_path hardening, indefinite skeleton retention) |
| 07-09 | ✓ | 5 (T-07-09-01..05) | T/R/T/R/T (rules-of-hooks lint gate, per-file commit cadence, future-regression guard recommendation) |
| 07-10 | ✓ | 6 (T-07-10-01..06) | T/T/T/D/E/R (typed-confirm gate, partialized-replace boundary, post-restore signOut LWW resolution) |

**Verdict:** 10/10 plans carry threat models. STRIDE coverage is appropriate per surface; security-sensitive plans (07-07, 07-08) get the deepest registers, as expected.

---

## RLS-proof presence (project rule: every new RLS surface gets a live cross-tenant impersonation proof)

| Plan | New RLS surface | Live cross-tenant proof? | File |
|---|---|---|---|
| 07-08 | `audit_logs` table | ✓ | `leanshot/e2e/rls-audit-logs.test.ts` (Task 6, 3+ assertions including user-B-sees-empty + direct-INSERT-rejected + service-role-bypass) |
| 07-07 | `pending_account_deletions` table + `photos-pending-shred/` Storage prefix | ✓ | `leanshot/e2e/rls-pending-account-deletions.test.ts` (Task 6, 6 assertions: 3 table-level + 3 Storage-level, including "even own-uid pending-shred read denied") |

Both new RLS surfaces have live impersonation tests. Project rule satisfied.

---

## Schema-push presence (`[BLOCKING] supabase db push`)

| Plan | Schema migrations | BLOCKING `supabase db push` task? |
|---|---|---|
| 07-08 | 3 migrations (audit_logs, triggers, retention cron) | ✓ Task 4 (`checkpoint:human-action` gate=blocking) |
| 07-07 | 5 migrations (pending table + initiate RPC + finalize fn + cron + Storage RLS) | ✓ Task 4 (`checkpoint:human-verify` gate=blocking) |

Both schema-touching plans gate on `supabase db push` before downstream verification can run. The 07-08 push must complete before 07-07's downstream e2e (which depends_on: [07-08]) can prove the audit-skeleton trigger fires. Wave 2/3 split makes this temporally correct.

---

## Anti-shallow-execution audit

Spot-checks for `<read_first>`, `<acceptance_criteria>` (or `<done>`), and concrete `<action>`:

| Plan | Per-task `<read_first>` | `<acceptance_criteria>` or `<done>` | `<action>` concrete (code-block-grade)? |
|---|---|---|---|
| 07-01 | ✓ all 5 tasks | ✓ explicit `<acceptance_criteria>` per task | ✓ literal grep/test commands embedded |
| 07-02 | ✗ at task level (uses top-level `@file:` context); inline reads explicit | ✓ `<done>` per task | ✓ literal JSX skeletons + code blocks |
| 07-03 | ✗ per task; `<context>` block covers reads | ✓ `<done>` per task | ✓ full component skeleton + DATA_CATEGORIES enumerated inline |
| 07-04 | ✓ all 2 tasks | ✓ `<done>` per task with grep gates | ✓ section-by-section content spec inline |
| 07-05 | ✗ per task; `<context>` block covers reads | ✓ `<done>` per task | ✓ full runbook + acknowledgement + Vitest skeletons inline |
| 07-06 | ✓ all 3 tasks | ✓ `<done>` per task | ✓ TypeScript skeletons + bash assertions inline |
| 07-07 | ✗ per task; top-level `<read_first>` block covers all | ✓ `<done>` per task | ✓ 5 SQL migrations inline verbatim + TS skeletons + e2e step-by-step |
| 07-08 | ✓ all 6 tasks | ✓ `<done>` per task | ✓ full SQL + Vitest test bodies inline |
| 07-09 | ✓ all 3 tasks | ✓ `<done>` per task with commit-cadence verification | ✓ refactor procedure + anti-pattern list inline |
| 07-10 | ✗ per task; `<context>` block covers reads | ✓ `<done>` per task | ✓ full JSX + Vitest skeleton + Playwright skeleton inline |

**Verdict:** Mixed pattern on `<read_first>` placement — 4 plans use per-task, 6 use top-level `<context>` + inline reads. The latter is the project's prior convention (Phase 5/6). Functionally equivalent for the executor; not a blocker.

**Action concreteness:** All 10 plans embed verbatim code/SQL/test skeletons; no plan defers a task to "research at execution time" or "decide later". Past-phase anti-pattern of vague `<action>` blocks is absent.

---

## Wave + dependency consistency

Outline says: Wave 1 = 07-01 + 07-09. Wave 2 = 07-02, 07-08, 07-05. Wave 3 = 07-03, 07-04, 07-10, 07-06, 07-07.

| Plan | Frontmatter `wave` | `depends_on` | Wave-vs-deps consistent? |
|---|---|---|---|
| 07-01 | 1 | `[]` | ✓ |
| 07-02 | 2 | `[01]` | ✓ |
| 07-03 | 3 | `[07-02]` | ✓ (format inconsistency: `07-02` vs `01` — see below) |
| 07-04 | 3 | `[07-02]` | ✓ (format inconsistency) |
| 07-05 | 2 | `[07-01]` | ✓ (format inconsistency) |
| 07-06 | 3 | `[07-01]` | ✓ (format inconsistency) |
| 07-07 | 3 | `[07-08]` | ✓ (matches outline; 07-07 needs audit-skeleton trigger from 07-08) |
| 07-08 | 2 | `[07-01]` | ✓ (format inconsistency) |
| 07-09 | 1 | `[]` | ✓ |
| 07-10 | 3 | `['07-01']` | ✓ (quoted-string format) |

**Critical edges (outline lines 13-23):**
- 07-01 has no dependencies (CI gate prerequisite). ✓
- 07-07 depends on 07-08 (account-delete needs audit-skeleton trigger). ✓
- 07-02 hosts the surface that 07-03 + 07-04 fill. ✓
- 07-06 + 07-10 only depend on 07-01 (CI green). ✓

No cycles. No forward references. Wave numbers consistent with `max(deps) + 1`.

---

## Concerns (severity-classified)

### HIGH — block execute-phase

_None._

### MEDIUM — should fix before or during execution

**MED-1 — `depends_on` format inconsistency (cosmetic but worth normalizing).**

Plans use three different `depends_on` value formats:
- 07-02: `[01]` (numeric, unquoted)
- 07-03/04/05/06/07/08: `[07-02]` (prefixed, unquoted)
- 07-10: `['07-01']` (prefixed, single-quoted)
- 07-01/09: `[]`

The GSD SDK plan-dependency resolver may or may not handle all three. Phase 6 used the short-numeric form (`[01]`) consistently. **Recommend** normalizing to `[01]`-style numeric to match Phase 5/6 prior art before kicking off Wave 2. Non-blocking because the executor reads `wave:` directly and the human orchestrator can resolve ambiguity, but the next `gsd-sdk query plan.list-plans` call may surface this as a warning.

**MED-2 — `files_modified` path-prefix inconsistency.**

Plans 01, 02, 06, 08, 09, 10 use `leanshot/src/...` paths. Plans 03, 04, 05, 07 use bare `src/...` (or in 07's case, absolute `/Users/karstenhaldan/...` for SQL paths and bare `leanshot/...` for TS). Both work because the executor's cwd is documented per task, but the inconsistency means a `gsd-sdk query frontmatter.get files_modified` call returns mixed-prefix arrays. Non-blocking for execution; cosmetic.

**MED-3 — 07-VALIDATION.md per-requirement plan mapping is STALE (drift from authoritative PLAN frontmatter).**

VALIDATION.md (lines 41-50) maps:
- COMPL-03 → 07-04 (actual: 07-05)
- COMPL-06 export → 07-05 (actual: 07-06)
- COMPL-06 delete → 07-06 (actual: 07-07)
- D-04 → 07-07 (actual: 07-08)
- D-05 → 07-08 (actual: 07-10)
- D-06 → 07-09 ✓
- D-07 → 07-01 ✓

The PLAN.md frontmatter `requirements:` fields are authoritative (and correct). VALIDATION.md is an informational pre-Wave-0 contract used by downstream verifiers. Mid-execution, a verifier reading VALIDATION.md to find "which plan ships COMPL-03's test?" will land on 07-04 (wrong) instead of 07-05 (right). Nyquist gate 8e checks file presence only, not internal mapping correctness, so this passes the existence check. **Recommend** patching VALIDATION.md table before Wave 2 starts. Non-blocking because the test files themselves are reachable via the PLAN frontmatter, but the next verifier pass will surface drift.

**MED-4 — ROADMAP SC#4 literal "per-user encryption key is destroyed" vs. 07-07's free-tier-equivalent ("Storage object bytes hard-deleted under locked prefix").**

D-02 LOCKED says free-tier Supabase Storage (no envelope encryption); D-03 LOCKED says "crypto-shred". RESEARCH §6 lines 405-411 reconciles: on free-tier, "crypto-shred" reduces to hard-delete of bytes that were encrypted at rest by Supabase's per-bucket AES-256 key — bytes become unrecoverable because they are deleted, not because a per-user key was destroyed. 07-07 implements the equivalent and documents it in plan SC#967.

ROADMAP SC#4 literal text was written before D-02 was locked. The actual delivered semantics match the spirit (data unrecoverable after T+30) but not the literal letter (no per-user key to destroy on free tier). **Recommend** patching ROADMAP SC#4 verbatim alongside the SC#1 + SC#3 corrections (which 07-04 + 07-05 already make) — propose: "...all rows in Postgres are deleted, all photos in Supabase Storage are deleted under the photos-pending-shred/ prefix (rendering the at-rest-encrypted bytes unrecoverable per D-02 free-tier posture), and `leanshot_v4_pre_cloud_backup` (if any) is wiped from local storage."

This is a documentation drift, not a behavior drift. Non-blocking but worth surfacing now so the post-merge ROADMAP reads consistently.

**MED-5 — 07-09 D-06 inventory drift risk.**

Plan 07-09 line 232 says `grep -rn "s\.user!" src/` should return 15 matches at start (14 code + 1 doc-comment). If Phase 7 plans 07-02/04/06/07 (Wave 2/3 — all written in parallel) introduce new `s.user!` patterns before 07-09 commits land, the inventory drifts. 07-09 is Wave 1 (no deps), so it kicks off in parallel with 07-01 — this is the right wave. But the executor of 07-09 should snapshot the inventory at task-start (`/tmp/07-09-inventory-before.txt`) and re-verify before Task 3 final acceptance.

Plans 07-07 + 07-10 explicitly forbid new `s.user!` introductions (07-07 line 660 grep gate, 07-10 implicitly through type-strict refactor). 07-04/06 don't have an explicit "no new s.user!" guard. **Recommend** Wave 2/3 executor checklists include `grep -c "s\.user!"` before committing — covered implicitly by per-file `npm run lint` + `npm run typecheck` already.

Non-blocking; risk-managed by the per-file gate cadence.

### LOW — nice-to-have

**LOW-1 — VALIDATION.md `Plan(s)` column staleness propagates to the validation-architecture summary at the bottom of RESEARCH.md (§Validation Architecture lines 761-803).** Same fix as MED-3 — update both in one pass.

**LOW-2 — 07-04's threat T5-LEGAL flags that Settings UI labels (`Settings → Data → Export JSON`, `Settings → Privacy → Delete account`) are coupled across 07-04/06/07.** Plan 07-06 lands "Export JSON" + "Export PDF rollup" labels; plan 07-07 lands "Delete my account…" label. Both match 07-04's PrivacyPolicy text. ✓ Coupling honored; flag is informational.

**LOW-3 — 07-09 lists `MedicationTab.test.tsx:25` as a doc-comment scrub but the file path is `src/components/dashboard/tabs/MedicationTab.test.tsx`** — note the test sits under `tabs/`, not under a `__tests__/` or `test/` sibling. Confirm this co-location matches existing project convention. (Yes, per existing Vitest pattern in the repo.)

**LOW-4 — 07-07 Task 5 stretches across both happy-path AND same-email-pending re-signup AND re-auth-gate negative case in a single Playwright `test()`.** Single-test risk is that a single failure surfaces multi-step provenance unclearly. Plan does use `test.describe.serial` for re-signup. Acceptable for the e2e budget; consider splitting if flake emerges.

**LOW-5 — 07-06's `assert-bundle-budget.sh` introduces a NEW CI guard but doesn't add a corresponding lint rule preventing static `import jsPDF from 'jspdf'`.** The negative grep in Task 2 verify is a per-task gate, not a recurring CI guard. Recommend adding an ESLint `no-restricted-imports` rule for `jspdf` in a follow-up plan or in 07-06's Task 3. Non-blocking.

---

## Cross-plan invariants verified

- **Bundle ceiling (50 kB index gz):** 07-02 (lazy legal chunks), 07-06 (lazy jsPDF), 07-10 (no heavy deps), 07-07 (no client-side bundle delta from SQL migrations). All within budget.
- **`s.user!` discipline:** 07-09 sweeps the existing 14 occurrences; 07-07 + 07-10 explicitly forbid reintroduction; 07-04/06 are content-only or wrap existing patterns. Verified.
- **TypeScript strict + lint gate:** Every plan's `<verify>` blocks include `npm run typecheck` + `npm run lint`. ✓
- **Audit-trigger ordering:** 07-08 ships the trigger BEFORE 07-07 ships pending_account_deletions; 07-07 depends_on: [07-08]; audit-skeleton row from 07-08 trigger fires on pending row INSERT — wired through `audit_logs(action='account_deleted_initiated')`. ✓
- **Cron staggering (24h cadence, sequential UTC windows):** anon-cleanup at 03:00 (Phase 4) → finalize-account-deletions at 04:00 (07-07) → cleanup-audit-logs at 05:00 (07-08). ✓ One-hour gaps avoid overlap.
- **CONTEXT decisions D-01..D-07:** All 7 honored. No deferred-ideas leakage. No "v1/v2" silent scope reduction language detected.

---

## CONTEXT compliance

| CONTEXT element | Plan honoring | Evidence |
|---|---|---|
| D-01 (no counsel) | 07-03, 07-04 | No "counsel review" task strings; decision logs explicit (07-03 `.planning/decisions/COMPL-02-TEMPLATE-COMPARISON.md`); 07-04 SC#1 ROADMAP correction |
| D-02 (free-tier Storage) | 07-07 | No pgsodium imports; Storage move via `update storage.objects.name`; no envelope-encryption migration |
| D-03 (30d soft-delete) | 07-07 | All 6 state-machine steps from CONTEXT lines 30-35 implemented; same-email re-signup language in SignUpForm |
| D-04 (cloud-write audit, 13mo) | 07-08 | `cleanup-audit-logs` cron with skeleton-exclusion predicate |
| D-05 (restore UI) | 07-10 | Settings → Recovery section with typed-confirm modal |
| D-06 (s.user! sweep, one commit/file) | 07-09 | 13 atomic commits enumerated; "anti-pattern refused" list explicit |
| D-07 (first plan = 07-01) | 07-01 | Wave 1 + no deps + 7-spec batch fix |

No tasks contradict locked decisions. No deferred-ideas (HIPAA BAA upgrade, attorney review, GDPR FHIR portability, audit-log UI, envelope encryption) are present in any plan.

---

## Architectural Tier Compliance (RESEARCH §Architectural Responsibility Map)

Spot-check of three load-bearing surfaces:

| Capability | Expected tier (RESEARCH) | Actual placement | Compliant? |
|---|---|---|---|
| Audit-log writes | Database (SECURITY DEFINER trigger inside Postgres) | 07-08 Task 2 — function in plpgsql, attached as trigger | ✓ |
| Account-delete re-auth gate | Database (RPC checks `auth.users.last_sign_in_at`) | 07-07 Task 1B — server-side `interval '5 minutes'` check, sqlstate P0007 returned | ✓ |
| Legal-page rendering | Browser SPA (lazy chunks, no SSR) | 07-02/03/04 — `React.lazy()` hash-route, no Vercel-rewrite Markdown viewer | ✓ |
| PDF generation | Browser (dynamic-import on click; deferred-init pattern) | 07-06 — `await import('jspdf')` inside handler; bundle guard pins separation | ✓ |
| Photo crypto-shred | Database (Storage rename → DELETE under locked prefix) | 07-07 Tasks 1B + 1C — server-side `update storage.objects.name`, then T+30 `delete from storage.objects` | ✓ |

No tier mismatches. Security-sensitive capabilities live in the correct tier per the Responsibility Map.

---

## Final verdict

**0 HIGH concerns. 5 MEDIUM concerns. 5 LOW concerns.**

The 10 plans collectively deliver all 5 Phase 7 success criteria. All 4 phase requirement IDs (COMPL-01/02/03/06) and all 7 LOCKED CONTEXT decisions (D-01..D-07) have at least one implementing plan. Every plan carries a threat model. Both new RLS surfaces (`audit_logs`, `pending_account_deletions` + `photos-pending-shred/`) have live cross-tenant impersonation proofs. Both schema-touching plans gate on `[BLOCKING] supabase db push`. Wave + dependency graph is acyclic and correctly ordered. No scope-reduction language ("v1", "simplified", "static for now") detected. No deferred-ideas leakage.

The MEDIUM concerns are all documentation drift (VALIDATION.md, ROADMAP SC#4 wording) or cosmetic frontmatter inconsistency (`depends_on` format, `files_modified` path-prefix). None block execute-phase. The LOW concerns are post-merge cleanup recommendations.

**Plans approved for `/gsd-execute-phase 7`. Recommend patching MED-3 + MED-4 (VALIDATION.md + ROADMAP SC#4 wording) either before kickoff or as part of 07-04's ROADMAP-edit task.**

## CHECK COMPLETE

0 HIGH concerns — plans approved for execute-phase (5 MEDIUM concerns are documentation/cosmetic drift; patch VALIDATION.md + ROADMAP SC#4 wording before or during execution).
