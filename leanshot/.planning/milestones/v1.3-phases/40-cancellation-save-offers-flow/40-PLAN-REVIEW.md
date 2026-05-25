# Phase 40 — Plan Review (iter-1)

**Reviewed:** 2026-05-21
**Plans reviewed:** 40-01..40-07 (7 plans across 3 waves)
**Reviewer:** gsd-plan-checker (goal-backward, 8 dimensions)
**Verdict:** **CHECK PASS** — 0 BLOCKERs · 7 FLAGs · 5 NITs

---

## Coverage Matrix

### ROADMAP Success Criteria → Plan Mapping

| SC | Description | Plan(s) | Status |
|----|-------------|---------|--------|
| SC1 | User clicks Cancel → modal offers one of 4 save offers based on eligibility (cohort × tenure); offer-take logged | 40-01 T1 + 40-03 T1 + 40-04 T1 + 40-04 T2 | COVERED |
| SC2 | Pause subscription 1/2/3 months returns user to active billing on resume via Stripe `pause_collection` | 40-02 (T1+T2+T3) + 40-03 T2 + **40-07 T1+T2 (D-07)** | COVERED |
| SC3 | Discount save-offer (20-30% for 2-3 months) applies as Stripe coupon at next invoice | 40-01 T3 (coupon seed) + 40-03 T2 (applyDiscount via `discounts[]` append + D-15 clamp) | COVERED |
| SC4 | Admin sees offer-take ROI dashboard per cohort and can A/B different offer copy/rules | 40-05 T1+T2 + 40-06 T1+T2 | COVERED |

### REQ-ID Mapping (POLISH-01..04)

| REQ | Plans | Status |
|-----|-------|--------|
| POLISH-01 | 40-01, 40-03, 40-04, 40-05 | COVERED |
| POLISH-02 | 40-01, 40-06 | COVERED |
| POLISH-03 | 40-02, 40-03, 40-07 | COVERED |
| POLISH-04 | 40-01, 40-03, 40-05 | COVERED |

---

## Locked-Decision Coverage (D-01..D-22)

All 22 decisions honored. Highlights:

- **D-07 read-only during pause** — closed by NEW Plan 40-07 (audit gap surfaced post-planning; 40-07 ships hard backstop via Zustand store throws + visible PausedBanner)
- **D-11 webhook events** — RESEARCH override honored: 40-02 extends `events/subscription-updated.ts` (NO new case arms in `index.ts` — verify block grep-gates)
- **D-15 stacking abuse mitigation** — option (b) picked: server clamp combined effective at 35% via `clampSavePct` helper in 40-03
- **D-22 PostHog Ship-Winner** — partial (scaffold only); see F-40-02 — variant column persisted, lookup ready to flip in v1.4

---

## Open-Question Resolution

All 5 RESEARCH open questions resolved via Recommendation prose + plan implementation:

| OQ | Recommended | Plan resolution | Status |
|----|-------------|-----------------|--------|
| Q1 split decide/accept | YES | 40-03 ships both Fns | RESOLVED |
| Q2 T-7d dedup | idempotent | 40-02 adds `reminded_t7` + partial index | RESOLVED |
| Q3 ROI clinic-org excluded | YES | 40-06 view `WHERE org_id IS NULL` | RESOLVED |
| Q4 non-Stripe payments | out of scope | deferred-ideas | RESOLVED |
| Q5 D-15 clamp on `discount` only | YES | 40-03 anti-gaming.ts asserts | RESOLVED |

---

## Pitfall Mitigation (12 catalogued)

All 12 pitfalls have explicit verify-block grep gates or test-file coverage:

| # | Pitfall | Plan | Evidence |
|---|---------|------|----------|
| P1 | Stripe webhook arms (EXTEND not new case) | 40-02 | verify greps `case 'customer.subscription.paused'` → 0 |
| P2 | `discounts[]` array not singular `discount:` | 40-03 | verify greps singular `discount:` (excluding `discounts:`) → 0 |
| P3 | Dollar-quote nesting in cron body | 40-02 | named tags `$cron$`/`$invoke$`/`$unschedule$`; bare `$$` → 0 |
| P4 | Helpdesk ticket-create requires user JWT | 40-04 | T3 forwards user JWT; verify asserts no `SUPABASE_SERVICE_ROLE_KEY` |
| P5 | subscriptions.id TEXT not UUID | 40-01 | `<interfaces>` declares `subscription_id text references` |
| P6 | Enum CHECK widening at creation | 40-01 | ALL values declared at CREATE-time; `p40_enum_check.sql` pgTAP asserts |
| P7 | pg_cron + vault.decrypted_secrets | 40-02 | uses `vault.decrypted_secrets` not GUC |
| P8 | Append-only ledger absence of UPDATE/DELETE | 40-01 | block triggers + `revoke insert,update,delete from authenticated` |
| P9 | A3 auto-resume reconcile fail-safe | 40-02 | `p40-pause-autoresume-reconcile` cron every 4h |
| P10 | `cancellation` chunk ≤ 13 kB gz | 40-04 | bundle-budget entry added |
| P11 | Admin module manifest AND router-branch | 40-05 | adds router branch if hardcoded switch |
| P12 | Idempotent Stripe coupon seed | 40-01 | try/catch on `resource_already_exists` + idempotency-key |

---

## Wave + Dependency Graph

| Plan | Wave | depends_on | files_modified overlap |
|------|------|------------|------------------------|
| 40-01 | 1 | [] | None |
| 40-02 | 1 | [] | None (disjoint from 40-01) |
| 40-03 | 2 | [40-01] | None |
| 40-04 | 2 | [40-01] | None (parallel types: Deno-side vs client-side, explicitly disjoint) |
| 40-05 | 3 | [40-01, 40-03] | None |
| 40-06 | 3 | [40-01..05] | Coordinated with 40-05 via stub-fallback |
| 40-07 | 3 | [40-02] | None |

Wave 3 sibling overlap check (40-05/06/07): zero file overlap.

---

## Memory Red-Flag Audit

| Anti-pattern | Present? |
|---|---|
| Shared-file choreography | NO — each shared-file claim has documented single-writer rule |
| Hedge instructions | NO — task actions are definitive |
| VALIDATION flag flip-timing | N/A |
| Defensive jsonb contracts | NO — `offer_config jsonb` is opaque in plpgsql; shape in single-writer types file |
| ALTER TYPE in own tx | N/A — Phase 40 uses CHECK constraints, all values at creation |
| Counter bare-UPDATE | NO — `cancellation_offers_log` append-only; counter via SELECT count(*) |
| Cron-callable Fn with auth.uid() RPC | NO — pause-reminder uses admin client directly |
| Status enum widening at creation | YES (correctly done) |

---

## Findings

### BLOCKER

**None.**

### FLAGs (7 — warnings, fix recommended)

#### F-40-01 — Open Questions heading missing `(RESOLVED)` suffix
- **Plan:** 40-RESEARCH.md
- **Issue:** Each Q has prose-level Recommendation + plans implement them, but heading-suffix convention is missing
- **Fix hint:** Rename heading to `## Open Questions (RESOLVED)` OR append `RESOLVED:` inline at each item. Low-effort doc fix.

#### F-40-02 — D-22 PostHog Ship-Winner ships as scaffold only
- **Plan:** 40-06
- **Issue:** `lib/cancellation/posthog-variants.ts` returns null cold-start; `cancellation_offers_log.posthog_variant_id` column persisted but never written
- **Rationale:** Defensible because A/B variants test framings/threshold tuning — none need to fire on first ship. Column + lookup wire are in place for v1.4 follow-up.
- **Fix hint:** Document as "v1.3-scaffold; v1.4-activates" in 40-06 SUMMARY (NOT as deferred-ideas).

#### F-40-03 — 40-03 has 18 files (boundary case)
- **Plan:** 40-03
- **Issue:** 2 tasks with 18 files_modified (10 production + 9 test files). Boundary of "files/plan target ≤ 10" threshold.
- **Fix hint:** No split required — decide + accept are contract-coupled (offer_id flows decide → accept). Monitor at execute-time for context exhaustion.

#### F-40-04 — Worktree commit-leak guard not explicitly verified
- **Plans:** all 7
- **Issue:** PATTERNS §"Worktree commit safety" documents the per-commit `git rev-parse --show-toplevel` guard, but no plan's `<verify>` block invokes it
- **Fix hint:** Add a phase-level executor hook (or 40-01 Task 1 anchor) asserting `test "$(git rev-parse --show-toplevel)" = expected-worktree-path`. Phase 25 W1 had 3/5 agents leak without it.

#### F-40-05 — Parallel type definitions in supabase + leanshot/ (silent drift risk)
- **Plans:** 40-03 + 40-04
- **Issue:** `supabase/functions/_shared/cancellation-types.ts` (Deno) and `leanshot/src/types/cancellation.ts` (client) declare the SAME shape with NO cross-import. Future revision changing one side without the other silently drifts.
- **Fix hint:** Acceptable for v1.3 (API surface is JSON-over-HTTP). v1.4 could add a CI sweep that grep-diffs union members + CHECK constraints. Document in 40-04 SUMMARY as known drift risk.

#### F-40-06 — Auto-verify items in 40-06 close-out lack discrete pass/fail accounting
- **Plan:** 40-06 Task 3
- **Issue:** 7 CLI auto-verify items inside a single checkpoint task; multi-signal pattern used for human-verify branches A-G but NOT auto-verify items 1-7
- **Fix hint:** Executor should commit intermediate state after each auto-verify item (db push, deploy, seed) so a failure at item N leaves N-1 confirmed in git history. Acceptable per `feedback_orchestrator_inline_completes_returned_executor`.

#### F-40-07 — 40-07 → 40-02 schema dependency requires DEPLOYED not just merged
- **Plan:** 40-07
- **Issue:** billing-sync.ts runtime SELECT on `subscriptions.is_paused/paused_until` requires the schema to be live on the linked project, not just merged to main
- **Fix hint:** Verify 40-06 Task 3 (close-out) `supabase db push --linked` lands BEFORE 40-07 is exercised in browser UAT. 40-07 already defensively defaults to false when columns don't exist. Acceptable.

### NITs (5 — informational)

- N-1: 40-01 Task 3 marker migration uses `do $migration_marker$` named tag — good. Consider whether a no-op migration is the right vehicle (vs deploy-time script).
- N-2: 40-02 cron slots `0 * * * *` (T-7d) + `15 */4 * * *` (reconcile) — verified unclaimed per PATTERNS §7.
- N-3: 40-03 catalog-rounding rule ("when clamped=true, decide-offer chooses CLOSEST catalog coupon ≤ finalSavePct") — worth surfacing in 40-03 SUMMARY.
- N-4: 40-04 bundle-budget script may report MISSING on first build (chunk not emitted yet) — acceptable per PATTERNS §10.
- N-5: 40-07 absorbed original Task 3 (FAB/tab-CTA disabled state) into Task 2 deferral with documented rationale (store throw + banner = complete coverage; soft-disabled state is v1.4 UX polish).

---

## Validation Alignment

- 40-VALIDATION.md rows: 24 (21 original + 3 new for 40-07)
- All rows map to automated commands
- Wave 0 requirements: 13 test files all owned by named tasks
- Manual-only verifications routed to 40-06 Task 3 HUMAN-UAT signals A-G

---

## Threat Model Coverage

All 7 plans have `<threat_model>` blocks with Trust Boundaries + STRIDE Register. Threat IDs follow `T-40-XX-NN` convention. Security_enforcement defaulting enabled per RESEARCH §Security Domain. ASVS V2/V3/V4/V5/V7/V8/V11/V13/V14 covered.

---

## Verdict

**CHECK PASS** — execution may proceed.

The plan set is structurally sound: full requirement coverage, all 22 locked decisions honored (D-22 as v1.3-scaffold per F-40-02), all 5 open questions resolved, all 12 pitfalls explicitly mitigated, no circular dependencies, no shared-file choreography, no defensive jsonb anti-patterns, D-15 stacking abuse mitigated via option (b) 35% server clamp, new 40-07 plan correctly closes the D-07 audit gap with both hard backstop AND visible affordance.

The 7 FLAGs are calibration/discipline concerns, not goal-achievement risks. The 5 NITs are documentation polish.

---

## CHECK PASS
