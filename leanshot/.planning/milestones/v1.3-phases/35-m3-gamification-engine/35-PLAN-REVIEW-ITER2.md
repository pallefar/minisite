# Phase 35 — Plan Re-Review (iter-2)

**Reviewed:** 2026-05-21
**Reviewer:** gsd-plan-checker (targeted closure re-check)
**Scope:** Targeted re-check of iter-1 BLOCKER fixes (B-1, B-2, B-3) + 3 FLAGs (F-3, F-5, F-6) + 1 NIT (N-2) per commit `84c78c8`
**Verdict:** PASS

---

## Inputs

- iter-1 findings reference: `35-PLAN-REVIEW.md`
- Surgical fix commit: `84c78c8df71dea9d83d0223dc7d4c5787f36aec2` — 6 plans touched, +160 / −16 LOC.
- Plans inspected (deltas only): 35-01, 35-03, 35-05, 35-07, 35-09, 35-10.

Out-of-scope for this iter (FLAGs F-1, F-2, F-4 + NITs N-1, N-3, N-4) — documentation polish, non-blocking; deferred to execute-time SUMMARY notes.

---

## Iter-1 Closure Check

| ID | Type | Claim | Status | Notes |
|----|------|-------|--------|-------|
| B-1 | BLOCKER | Plan 35-03 Task 5 pgTAP — 5th assertion exercises challenge+level-up 3-level call stack | **CLOSED** | Test 5 seeded at XP=2400, streak=10. `grant_xp_for_action(uid, 250, 'challenge_complete', ...)` lands user at 2650 → level 5 (compute_level: 5²·100=2500). Combo trigger writes `combo-cross-streak`; level-up branch writes `level-5`. Assertion counts both badges = 2. Both badge IDs present in Plan 35-01 seed (lines 325, 329). `grant_xp_for_action` documented as writing level-up `badge_unlocks` (35-03 line 208, 216). Math correct (2400+250+50=2700). `select plan(5)` matches assertion count. |
| B-2 | BLOCKER | Plan 35-09 Task 3 pgTAP — 5th assertion `lives_ok` on notified_kickoff_at UPDATE with pre-existing completed_at | **CLOSED** | Test 5 inserts challenge_progress row with `completed_at = now() - interval '1 hour'` at INSERT time (not via UPDATE — avoids the monotonic trigger raising at seed). Then `update set notified_kickoff_at = now() where ...` wrapped in `lives_ok($sql$...$sql$, '...')`. Syntactic shape matches Test 4's `throws_ok` (named dollar-quote tag, single SQL stmt, label). `select plan(5)` matches. Both `set_config` GUCs (`p35_test.uid_kickoff`, `p35_test.cid_kickoff`) properly scoped via `current_setting`. |
| B-3 | BLOCKER | Plan 35-10 Task 1 vault check split into per-secret PRESENT/MISSING + PAT requirement documented | **CLOSED** | Step 5a (`share_token_secret`) + 5b (`service_role_key`) each emit a single-row label `'<name>: PRESENT'` or `'<name>: MISSING'`. PAT requirement (NOT service-role JWT) called out at step-5 preamble + DEPLOY-NOTES §8 Vault Access section. Downstream `<verify><automated>` grep at line 236 targets `cron.job` count (unchanged) — split does not break the parseable line. |
| F-3 | FLAG | mint_share_token base64url mirrors Vercel verifier exactly | **CLOSED** | `replace(replace(replace(replace(encode(...,'base64'), E'\n', ''), '=', ''), '+', '-'), '/', '_')` applied to BOTH `v_body_b64` and `v_sig`. Order: strip `\n` → strip `=` → map `+→-` → map `/→_`. Output is IDENTICAL to Vercel verifier's `btoa(...).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')` per line-by-line trace (lines 281-287 vs 177-179). Round-trip Playwright integration test requirement now documented (lines 300-303). |
| F-5 | FLAG | active_cohort CTE tiebreak now `cd.name asc, c.created_at desc` | **CLOSED** | JOIN added: `join public.cohort_definitions cd on cd.id = c.cohort_id` (line 404). `order by cd.name asc, c.created_at desc limit 1` (line 410). Plan body D-18 documentation at line 380 matches the SQL. REVIEW-F-5 comment block (lines 403-405) explains the contract. |
| F-6 | FLAG | DEPLOY-NOTES §8 — PAT requirement + 6-step rotation procedure | **CLOSED** | §8 added at 35-10 line 456+ with 6 numbered steps: (1) `openssl rand -hex 32`; (2) `vault.update_secret`; (3) `vercel env rm` + `vercel env add`; (4) `vercel --prod`; (5) user communication template; (6) audit Playwright. PAT revoke guidance follows memory `feedback_bootstrap_token_revoke_pattern`. |
| N-2 | NIT | Plan 35-01 "16 badges" → "17 badges" consistency | **CLOSED** | All 9 instances of badge count in 35-01 now say "17" (must_haves truths, artifact provides, objective prose, Task 3 header, comment-on-table, checklist). One occurrence of "16-badge seed" remains at line 321 — but it is a deliberate Research-quoted phrase explaining the original 16 → "Adding 1 social-proof per Research lines 785 to total 17; trim to 16 by collapsing one streak tier OR keep 17 — planner chooses 17"; the prose explicitly arrives at 17. Acceptable. |

**All 3 BLOCKERs CLOSED. All 3 FLAGs CLOSED. NIT-2 CLOSED.**

---

## Side-effects detected

Side-effect scans against the targeted-change set:

1. **`select plan(N)` consistency** — 35-03 Test file: `plan(5)` at line 596 + 5 distinct test blocks (1=streak, 2=non-challenge, 3=non-challenge+streak, 4=ON CONFLICT idempotency, 5=challenge+level-up). 35-09 Test file: `plan(5)` at line 433 + 5 distinct test blocks (1=table exists, 2=UPSERT, 3=notify-flag, 4=throws_ok monotonic, 5=lives_ok kickoff-on-completed). Match. **No mismatch.**

2. **lives_ok / throws_ok shape parity in 35-09 Test 5** — Test 4 uses `throws_ok($sql$...$sql$, null, 'msg', 'descr')` shape; Test 5 uses `lives_ok($sql$...$sql$, 'descr')` — pgTAP lives_ok signature is `lives_ok(sql_text [, description])`, which matches. **Syntactically valid.**

3. **35-10 Task 1 verify line still parseable** — `<automated>...grep "4"</automated>` at line 236 unchanged; the vault-check additions (steps 5a/5b) are bash comments + SQL emit-label lines, not affecting cron.job count grep. **No break.**

4. **35-07 mint_share_token round-trip Playwright test requirement** — F-3 fix note (lines 300-303) explicitly states the test "must exist in Task 4 Playwright suite: client calls `mint_share_token(5)` → passes the resulting string to `/api/og/level-up.png?token=<...>` → asserts 200 + image/png." This is now a documented Task 4 contract. **Coverage added.**

5. **35-05 F-5 JOIN correctness** — `join public.cohort_definitions cd on cd.id = c.cohort_id`. `c` is `weekly_challenges`, which has `cohort_id` FK. `cohort_definitions.id` is the cohort PK (per Phase 36 / pre-existing schema). JOIN is correct (no missing FK; row-multiplier safe since each weekly_challenges row has at most one cohort_id and cohort_definitions.id is unique). Composite ORDER BY `cd.name asc, c.created_at desc` is deterministic (name is unique per Phase 36 schema; created_at desc breaks any name-collision). **Sound.**

6. **Plan 35-01 docs-internal "16-badge" occurrence at line 321** — read in context, it is the planner's explanation of the OQ-5 trade-off ("5+7+3+1=16 base, +1 social proof from Research line 785 = 17"). Not a stale "16" reference; not a contradiction. **Acceptable.**

7. **Newly-introduced stragger candidates outside fix scope** — scanned 35-07 for any leftover "translate" prose: lines 358 (`<done>` block) and 835 (HUMAN-UAT checklist) STILL say "base64url translate" describing the implementation. The MIGRATION BODY (lines 286-287) is correctly using `replace()`. The two prose references are docs-only stale; they describe the OLD approach but do not generate code. **NIT — not blocking.** Suggest cleanup at execute-time SUMMARY step (cheap one-line Edit each). Documenting here so it does not surprise the verifier.

**No regressions or hidden breakage introduced by the iter-1 surgical fixes.**

---

## Out-of-scope reminders (carry to execute-phase)

Per iter-1 review, the following remain OPEN as documentation-polish recommendations only (do NOT block execute-phase):

- **F-1** — 35-09 streak-warn helper RPC documentation (executor's choice)
- **F-2** — 35-04 matview staleness comment (cosmetic SQL comment)
- **F-4** — 35-09 SUMMARY step adding `auth.uid()` grep verification (post-execution audit)
- **N-1** — 35-RESEARCH §Open Questions header `(RESOLVED)` suffix
- **N-3** — 35-06 GamificationCard placement (executor's discretion)
- **N-4** — 35-03 trigger graceful-degradation truth wording
- **Iter-2 new NIT** — 35-07 lines 358 + 835 prose still say "base64url translate" (migration body is fine)

---

## Verdict

PASS — All 3 BLOCKERs from iter-1 are closed with surgical, syntactically valid edits. All 3 in-scope FLAGs are closed. NIT-2 (badge count) is closed. No regressions detected in `select plan(N)` counts, pgTAP block shape, downstream `<automated>` grep parseability, or cross-plan referential integrity (badge IDs, cohort_definitions JOIN, grant_xp_for_action level-up write).

The single stragger detected (two leftover "base64url translate" prose mentions in 35-07 outside the migration body) is documentation-only and does NOT affect generated SQL. Suggest execute-time SUMMARY note rather than a third revision loop.

Plan set is ready for execute-phase dispatch.

---

## CHECK PASS
