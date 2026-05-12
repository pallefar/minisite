---
phase: 05-patient-cloud-sync-slice-1-auth-injections
type: plan-check
mode: gap_closure
plans_reviewed: ["05-04-PLAN.md", "05-05-PLAN.md", "05-06-PLAN.md"]
gaps_targeted: [G1, G2, G3]
checked: 2026-05-12
verdict: CONCERNS
---

# Phase 5 Gap-Closure Plan Check

## Summary

| Plan | Gap | Severity | Verdict |
|------|-----|----------|---------|
| 05-04 | G1 — Supabase auth allowlist | blocker | **PASS** with 1 warning |
| 05-05 | G2 — per-user storage adapter | major | **CONCERNS** (2 warnings, 1 borderline-blocker) |
| 05-06 | G3 — MedicationTab null-guard | minor | **PASS** |

No outright BLOCKERs that prevent `/gsd-execute-phase 5 --gaps-only` from starting, but the borderline-blocker on 05-05 (anon-path semantics around `renameStorageNamespace` deleting the universal key) deserves an explicit acknowledgement in the executor's path before merge, OR a deliberate planner answer that the existing behavior is intended.

---

## Goal-Backward Trace (does each plan close its gap?)

### G1 — Auth redirect URL allowlist (05-04)

Gap truth (UAT): "Auth redirect URL allowlist contains leanshot URLs so email links work end-to-end."

Plan 05-04 acceptance chain:
1. Both `supabase/config.toml` files (worktree + main tree) carry `site_url = "https://leanshot-app.vercel.app"` + 4-entry `additional_redirect_urls`. ✅ concrete, grep-asserted.
2. `supabase config push --linked` exits 0 with two-key diff. ✅ asserted, with drift-stop on additional keys.
3. Live `/auth/v1/settings` returns new `site_url`. ✅ asserted via curl+jq.
4. `generate_link` admin call preserves `redirect_to`. ✅ asserted via URL-encoded grep on `action_link`.
5. 05-UAT.md Test 9 re-runs `result: pass`; G1 marked `status: closed`. ✅ asserted via grep + counter.

**Goal-backward verdict: gap CLOSES** when all acceptance criteria pass. The verification is testable and not subjective.

### G2 — Per-user storage adapter (05-05)

Gap truth (UAT): "Per-user localStorage isolation (D-12, T-05-03 mitigation) — each signed-in user's data is namespaced and isolated."

Plan 05-05 acceptance chain:
1. New exports in storage.ts: `setActiveStorageUserId`, `createNamespacedStorage`, `removeUserNamespace`. ✅ grep-asserted.
2. Zustand persist now uses `createNamespacedStorage()`, no `createJSONStorage` import remains. ✅ grep-asserted.
3. App.tsx onAuthStateChange wires the adapter via `setActiveStorageUserId` in INITIAL_SESSION + SIGNED_IN; SIGNED_OUT removes prior user's namespace. ✅ grep-asserted.
4. **Multi-account regression test M1**: A signs in, logs 3, signs out → B signs in → B's `injections.length === 0`. ✅ The headline T-05-03 re-mitigation test. Concrete + scoped to the actual leak path.
5. **Realtime test M2**: post-SIGNED_IN INSERT lands in namespaced key, NOT universal. ✅ Replays the exact UAT Test 5 failure mode in unit form.
6. **Anon-path test M3**: pre-signin writes still land in universal `STORAGE_KEY`. ✅ Anon regression coverage.

**Goal-backward verdict: gap CLOSES** assuming the borderline-blocker below (renameStorageNamespace anon-path) is either fixed or formally accepted.

### G3 — MedicationTab null-guard (05-06)

Gap truth (UAT): "MedicationTab guards against user=null during SIGNED_OUT view transition."

Plan 05-06 acceptance chain:
1. `useStore((s) => s.user!)` non-null assertion removed. ✅ grep-asserted (`grep -c 's\.user!' returns 0`).
2. `if (!user) return null` early return added after hooks. ✅ grep-asserted.
3. RTL test G3-1: store has `user=null`, render produces empty DOM + zero matching console.error calls. ✅ Concrete + replays UAT failure mode.
4. RTL test G3-2: happy-path render unchanged — "Current dose" / "Log new injection" / "Half-life" visible. ✅ regression guard.
5. UAT Test 7 `issues:` block updated; G3 gap closed. ✅ grep-asserted.

**Goal-backward verdict: gap CLOSES.** This is the cleanest plan of the three.

---

## Dimension Scoring (calibrated against checker.md dimensions)

### Dimension 1: Requirement Coverage

| Plan | Requirements claimed | Tasks address them? |
|------|---------------------|---------------------|
| 05-04 | AUTH-02, AUTH-04 | Yes — both depend on email-link `redirect_to` working; Task 1 fixes both via single config push. |
| 05-05 | AUTH-05, SYNC-05 | AUTH-05 (signout clears caches) is satisfied by namespace removal on SIGNED_OUT (Task 2). SYNC-05 (RLS-style isolation) is reframed as client-storage isolation here — a mild stretch but defensible since T-05-03 is the same threat class as cross-tenant RLS. |
| 05-06 | AUTH-05 | Yes — signout transition triggers the bug; the guard ensures the signout-cache-clear path produces zero console noise. |

PASS on all three.

### Dimension 2: Task Completeness

All tasks have `<read_first>`, `<files>`, `<action>`, `<verify><automated>`, `<acceptance_criteria>`, `<done>`. TDD tasks (05-05-T1, 05-05-T2, 05-06-T1) have `<behavior>` blocks listing the RED-phase test cases verbatim.

PASS.

### Dimension 3: Dependency Correctness

All three plans declare `wave: 1` + `depends_on: []`. `files_modified` overlap analysis:
- 05-04: `supabase/config.toml` only.
- 05-05: `src/lib/storage.ts`, `src/lib/store.ts`, `src/lib/store.test.ts`, `src/lib/storage.test.ts`, `src/App.tsx`.
- 05-06: `src/components/dashboard/tabs/MedicationTab.tsx`, `src/components/dashboard/tabs/MedicationTab.test.tsx`.

**Disjoint files confirmed.** Parallel-safe.

PASS.

### Dimension 4: Key Links Planned

05-05 `key_links` block is exemplary: it pins the three load-bearing wirings (App.tsx → setActiveStorageUserId, persist config → createNamespacedStorage, adapter routing semantics). Pattern regexes are present and grep-friendly.

05-04 + 05-06 key_links are simpler (single hop each) and adequate.

PASS.

### Dimension 5: Scope Sanity

| Plan | Tasks | Files | Verdict |
|------|-------|-------|---------|
| 05-04 | 2 | 2 | within target |
| 05-05 | 3 | 5 | within target (large per-task action but well-scoped) |
| 05-06 | 2 | 2 | within target |

PASS.

### Dimension 6: must_haves Derivation

`truths` are user-observable across all three plans:
- 05-04: "live /auth/v1/settings reports site_url = X" (user impact: email links land on the right host).
- 05-05: "After SIGNED_IN, ALL subsequent persist writes land in the per-user namespaced key" (user impact: Account A's data doesn't leak to B's view).
- 05-06: "Signing out from a dashboard view that has MedicationTab mounted produces ZERO console errors" (user impact: clean signout, no Sentry noise).

PASS.

### Dimension 7: Context Compliance

CONTEXT.md decisions referenced:
- D-04 (avatar menu — not touched by gap plans; out of scope, correct).
- D-09 (single Realtime subscription — 05-05 plan's threat model T-05-05-03 references this; not contradicted).
- **D-11 (signout preserves theme + onboarded + tour_seen flags + acknowledgedDisclaimer per CONF-2)** — 05-05 Task 2 SIGNED_OUT restructure preserves the existing `clearUserDataSlices()` call which honors CONF-2/CONF-3. The plan does NOT touch the `acknowledgedDisclaimer` preservation logic in store.ts. PASS.
- **D-12 (localStorage re-key by user_id hash)** — 05-05 implements the missing half. The plan correctly notes that `renameStorageNamespace` was a one-shot migration; the adapter completes the design.

No deferred-ideas leak into the gap plans.

PASS.

### Dimension 7c: Architectural Tier Compliance

No tier mismatches. Storage adapter lives in browser/client tier (correct — localStorage is client-side). Auth config in Supabase (correct — server-side allowlist). MedicationTab guard in component tier (correct).

PASS.

### Dimension 8: Nyquist Compliance

VALIDATION.md exists. Per-task automated verify commands:

| Task | Plan | Automated Command | Status |
|------|------|-------------------|--------|
| T1 | 05-04 | grep + curl + jq + admin generateLink | ✅ |
| T2 | 05-04 | grep on UAT artifact + curl probes | ✅ |
| T1 | 05-05 | `vitest run src/lib/storage.test.ts` + `tsc -b` | ✅ |
| T2 | 05-05 | `vitest run` (full) + `tsc -b` + `eslint` | ✅ |
| T3 | 05-05 | `vitest -t "Plan 05-05"` + grep on UAT | ✅ |
| T1 | 05-06 | `vitest run MedicationTab.test.tsx` + `tsc` + `eslint` + full vitest | ✅ |
| T2 | 05-06 | `vitest run MedicationTab.test.tsx` + grep UAT | ✅ |

All sub-30-second feedback paths. No watch flags. Wave 0 not applicable (these are gap-closure plans on already-shipped infrastructure).

PASS.

### Dimension 9: Cross-Plan Data Contracts

05-05's adapter and 05-06's null-guard both touch the `user` slice indirectly. No contract conflict: 05-05's `setActiveStorageUserId(session.user.id)` runs on auth events; 05-06's `if (!user) return null` runs on render. Independent surfaces.

PASS.

### Dimension 10: CLAUDE.md Compliance

CLAUDE.md project rules honored:
- **No router** — no plan introduces routing.
- **Single Zustand store** — preserved.
- **localStorage-only persistence** — preserved; 05-05 enhances per-user routing within localStorage.
- **Lazy-loaded route equivalents** — unchanged.
- **`prefers-reduced-motion`** — N/A for these plans.
- **Strict TypeScript** — all plans run `tsc -b --noEmit` as part of verify.
- **GSD workflow enforcement** — these plans were authored via `/gsd-plan-phase 5` re-entry (gap_closure mode). PASS.
- **Test runner: vitest** — all unit tests use vitest, not Jest. PASS.
- **Lint: eslint flat config** — verify commands invoke `npx eslint`. PASS.

PASS.

### Dimension 11: Research Resolution

RESEARCH.md present but not gap-driven (gap plans are post-execution; RESEARCH.md was authored at planning time). No open questions block these plans.

SKIPPED (n/a for gap closure).

### Dimension 12: Pattern Compliance

PATTERNS.md present. 05-05 closely mirrors the existing `namespacedKey` / `renameStorageNamespace` pattern. 05-06 mirrors the function-component + `useStore` selector pattern in sibling tabs.

PASS.

---

## Concerns (detail)

### C1 [WARNING — 05-04] — `additional_redirect_urls` not exposed by `/auth/v1/settings`

**Severity:** WARNING (not blocker).

**Where:** Plan 05-04 Task 1 verify block lines 211-219 + Task 2 Probe 1.

**Concern:** Plan 05-04's Task 1 verify step #3 says "Live remote assertion: `/auth/v1/settings` reflects the new site_url" and the executor will run:
```
curl -s https://...supabase.co/auth/v1/settings | jq -r '.site_url'
```
The plan correctly notes (in a comment) that `/auth/v1/settings` does NOT list `additional_redirect_urls` (Supabase intentionally hides the allowlist from the public settings endpoint). The plan compensates by asserting allowlist behavior via the `generate_link` probe (verify step #4).

This is acceptable, but worth flagging: if Supabase has changed their `/auth/v1/settings` shape (the field could be under `external` or absent entirely), the `jq -r '.site_url // .external_url.email // empty'` chain may return empty even on a successful push. The fallback grep does protect against this, but the executor should not panic if the first jq path is empty.

**Fix hint:** No change needed; flag here so executor doesn't escalate a benign jq miss.

### C2 [BORDERLINE-BLOCKER — 05-05] — Anon flow + `renameStorageNamespace` interaction with the new adapter

**Severity:** BORDERLINE-BLOCKER. Recommend the planner add an explicit decision in the plan body, OR the executor flag this when implementing.

**Where:** Plan 05-05 `<implementation_design>` step 6 ("No behavioral change for anon users").

**Concern:** The plan claims anon writes continue to land in the universal key because `setActiveStorageUserId` is only called when `!session.user.is_anonymous && session.user.email_confirmed_at` is true. That much is correct.

But consider the FULL sequence on the first verified SIGNED_IN of an anon-promoted user:
1. App boots. `activeNamespaceKey = null`. User makes a few injection logs as anon. Persist writes go to `STORAGE_KEY` (universal `leanshot_v4`) — correct.
2. User signs up; email is verified; SIGNED_IN fires.
3. The plan inserts `await setActiveStorageUserId(session.user.id)` BEFORE `await renameStorageNamespace(session.user.id)`.
4. `setActiveStorageUserId` sets `activeNamespaceKey = leanshot_v4:<hash>`. **From this point on, every persist write goes to the namespaced key.**
5. `renameStorageNamespace` then reads `localStorage[STORAGE_KEY]` (the anon writes), if the target namespaced key has no data yet, copies the universal blob over, and ALWAYS deletes the universal key.
6. SUBSEQUENTLY: `runAnonPromotionMigrationIfNeeded`, `enqueueLocalInjectionsForSync`, `pullInitialInjections`, `subscribeInjections`, `flushSyncQueue` — every state mutation in those functions triggers persist setItem writes that now correctly land in the namespaced key.

This actually works. But there's a subtlety the plan does not explicitly call out: between steps 4 and 5, if Zustand persist re-hydrates the store from `localStorage[activeNamespaceKey]` (which doesn't exist yet — it's null), the adapter's `getItem` will return `null`, and the store could RESET to `initialState`. The plan relies on the existing behavior that persist does NOT re-hydrate after the initial mount — but the executor should verify this. If persist DOES re-fetch (e.g., if `useStore.persist.rehydrate()` is called anywhere — and it IS called in `hydrate()` at store.ts line 640 — under specific v3→v4 migration paths), the namespaced key being empty WOULD cause a data loss.

**Why this is borderline:** Empirical evidence from UAT Test 4 ("Sign in on Browser B (verified user)") shows the anon-promoted path worked: "Bonus: the anon injection from Test 2 propagated to public.injections cloud rows via the cross-tab flushSyncQueue triggered by SIGNED_IN — proves the anon→permanent migration end-to-end." So the existing renameStorageNamespace + post-SIGNED_IN persist path is functional. The plan preserves the call order. But the NEW adapter introduces an intermediate state (steps 4-5 above) where the adapter routes to a key that doesn't exist yet, BEFORE renameStorageNamespace migrates the universal blob over.

**Concrete failure mode to test:** what if a Zustand-internal persist call fires between line 3 (the new `setActiveStorageUserId`) and line 5 (`renameStorageNamespace`)? The plan asserts in T-05-05-03 that "the only code that could trigger a persist setItem in that gap is a Zustand `set(...)` call — none happens" — verified by reading App.tsx lines 134-170. **This claim is correct for the SIGNED_IN branch** (no `set(...)` between `setSession` at line 156 and `renameStorageNamespace` at line 162; `setLastWasAnon` is a module-level function, not a store action). But the INITIAL_SESSION branch (lines 135-153) also has only `setSession` + `setLastWasAnon` before `renameStorageNamespace`. So the claim holds.

**Recommended fix:** Add ONE explicit test case to 05-05 Task 2's `<behavior>` block: **M4 — anon-promoted SIGNED_IN preserves data**:
```
localStorage.clear();
// 1. Anon writes go to universal:
useStore.getState().addInjection({ ... });
useStore.getState().addInjection({ ... });
expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.injections.length).toBe(2);
// 2. Simulate first verified SIGNED_IN (matching App.tsx order):
await setActiveStorageUserId('anon-promoted-uid');
await renameStorageNamespace('anon-promoted-uid');
// 3. Universal key gone, namespaced key has the 2 injections:
expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
const keyA = await namespacedKey('anon-promoted-uid');
expect(JSON.parse(localStorage.getItem(keyA)!).state.injections.length).toBe(2);
// 4. Subsequent write also lands in namespaced key:
useStore.getState().addInjection({ ... });
expect(JSON.parse(localStorage.getItem(keyA)!).state.injections.length).toBe(3);
expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
```

Without M4, the plan's M3 only proves anon-WITHOUT-promotion works; the M1 + M2 cases assume `setActiveStorageUserId` is called from a clean slate. M4 covers the actual production anon-promotion path observed in UAT Test 4. This is the test case the plan-checker would consider load-bearing for "T-05-03 stays mitigated AND anon data is preserved across promotion."

### C3 [WARNING — 05-05] — Persist `name: STORAGE_KEY` retention may confuse future maintainers

**Severity:** WARNING.

**Where:** Plan 05-05 Task 2 Edit 1 acceptance criteria + comment block.

**Concern:** The plan keeps `name: STORAGE_KEY` in the persist config (justified as "persist's storage-event key is separate from adapter routing"). However, in zustand v5 the `name` is also used for the BroadcastChannel-style cross-tab notification key (when `partialize` results change). If two distinct users on the same browser have different persist payloads (Account A's data in `leanshot_v4:hashA`, Account B's data in `leanshot_v4:hashB`), but persist's cross-tab signal still fires on `name === STORAGE_KEY`, an unrelated tab change in Account B's tab could trigger a re-hydrate signal in Account A's tab — and the re-hydrate would route through the adapter to whichever namespace is active in THAT tab.

In practice this is probably fine (each tab has its own `activeNamespaceKey` module state, and each tab's adapter routes accordingly). But it's an undocumented edge.

**Fix hint:** Add ONE line of comment in the persist config noting that cross-tab persist sync may be noisy in multi-account scenarios. No code change needed; this is a heads-up for Phase 6.

### C4 [WARNING — 05-04] — Worktree caveat assumes worktree execution

**Severity:** WARNING.

**Where:** Plan 05-04 `<worktree_caveat>` block.

**Concern:** The plan explicitly briefs the worktree caveat (good!) per project memory `project_worktree_supabase_cli.md`. But the current working directory is `/Users/karstenhaldan/minisite/leanshot` and `git rev-parse --show-toplevel` returns the same path — meaning **execution may be happening on the main tree, not a worktree**. The plan's instructions to write to BOTH the main tree and the worktree become a no-op (or worse, a confusing self-reference) when the executor is already on the main tree.

**Verification:** Confirmed via `ls /Users/karstenhaldan/minisite/.claude/worktrees/` does not show an active worktree for this task (the agent appears to be running directly in the main tree per the gitStatus block in the system context).

**Fix hint:** Add ONE conditional at the start of Task 1's action block:
```bash
# Detect worktree vs main tree:
IS_WORKTREE=$([ "$(git rev-parse --show-toplevel)" = "$(git rev-parse --git-common-dir | xargs dirname)" ] && echo "no" || echo "yes")
# If "no", edit ONLY /Users/karstenhaldan/minisite/supabase/config.toml (which IS the canonical copy).
# If "yes", apply the dual-write per the worktree_caveat block.
```

This is a 5-line addition. Without it, an executor running on main tree may write to `supabase/config.toml` only once (which is correct!) but then get confused by the plan's emphatic "edit BOTH locations" instruction and panic.

### C5 [INFO — 05-06] — User type fixture in G3-2 may need maintenance

**Severity:** INFO (not blocking).

**Where:** Plan 05-06 Task 1 `<behavior>` block test G3-2.

**Concern:** The test fixture lists `User` fields explicitly. The plan acknowledges "(any other required fields per `src/types/index.ts` User interface)" — but if a future Phase 6 change adds a required field to `User`, this test will fail until the fixture is updated.

**Fix hint:** Use `Object.assign(initialState.user ?? {}, { medication: 'tirzepatide', dose: '2.5', ... } as Partial<User>)` style construction, OR import a shared `mockUser` helper from `src/lib/test-utils.ts` if one exists. Defer to executor; this is style-level.

---

## Per-Plan Verdicts

### 05-04-PLAN.md — PASS (1 warning: C1, C4)

Both warnings are environment-aware nits, not goal-blockers. The plan does close G1 conclusively via the four-probe verification chain.

### 05-05-PLAN.md — CONCERNS (1 borderline-blocker C2, 2 warnings C3)

The borderline-blocker (C2 — anon-promotion data preservation) is the load-bearing one. Without M4, the planner is taking it on faith that the new adapter ordering (setActiveStorageUserId BEFORE renameStorageNamespace) preserves anon data through the promotion path. Empirical UAT Test 4 evidence suggests it works, but the unit test should LOCK that behavior so future refactors don't silently break it.

Recommend the planner add the M4 test case (or the executor proactively adds it) before merge. If skipped, /gsd-verify-work 5 has a non-trivial chance of finding a regression in the anon-promotion path that UAT Test 4 previously proved working.

### 05-06-PLAN.md — PASS

Cleanest plan. Single-file fix with RED-test-first discipline. Low blast radius. C5 is style.

---

## Cross-Plan Concerns

### Parallel-safety

All three plans claim wave 1 + `depends_on: []`. Confirmed disjoint file sets (config.toml; storage.ts/store.ts/App.tsx; MedicationTab.tsx). Safe to run in parallel.

BUT the three plans all update `05-UAT.md` in their Task 2/Task 3 (the "[BLOCKING]" UAT artifact update). This is a write-write race if they run truly in parallel:
- 05-04 Task 2 changes Test 9 + Summary + closes G1 in `## Gaps`.
- 05-05 Task 3 ADDS Test 10 + updates Summary + closes G2 in `## Gaps`.
- 05-06 Task 2 modifies Test 7 + closes G3 in `## Gaps`.

The plans handle this with "last-writer-wins is fine as long as the counter is correct at end-of-wave" (05-05 Task 3 explicit). But this requires careful merge ordering or sequencing.

**Recommended fix:** Either (a) serialize the three UAT updates as a checkpoint:human-verify pass after all 3 implementation tasks land, or (b) explicitly run the plans sequentially (05-04 → 05-05 → 05-06) and have each plan re-read 05-UAT.md before writing.

**Severity:** WARNING. Not a blocker because the markdown merge conflict is recoverable, but if the orchestrator parallelizes via worktrees, the UAT updates will conflict.

---

## PLAN CHECK COMPLETE — verdict: CONCERNS

### Blocking items (zero) — none of the issues prevent `/gsd-execute-phase 5 --gaps-only` from starting.

### Recommended fixes before execution (non-blocking but high-value)

- **05-05 C2 — add M4 anon-promotion data-preservation test** to Task 2 `<behavior>` block. This locks the load-bearing claim that the new adapter ordering preserves anon-promoted data. Without M4, regression risk is non-trivial.
- **05-04 C4 — detect worktree vs main tree** at start of Task 1 action. Five lines of bash. Without it, executor on the main tree may be confused by the "edit BOTH locations" instruction.
- **Cross-plan UAT race** — either serialize the three plans, OR have each plan re-read 05-UAT.md before writing its updates. Markdown merge conflicts are recoverable but waste a verification cycle.

### Lower-priority warnings

- **05-04 C1** — `/auth/v1/settings` jq miss is harmless; executor should not escalate.
- **05-05 C3** — comment-only documentation of cross-tab persist edge in multi-account scenarios.
- **05-06 C5** — User fixture in G3-2 may need future maintenance; style-level.

### What's good (worth calling out explicitly)

- 05-04's `generate_link` redirect_to probe is a strong allowlist-behavior assertion (proves the FIX works, not just the config push).
- 05-05's M1 multi-account regression test is well-designed: it replays the exact T-05-03 leak path in unit form, not just structurally similar code.
- 05-05's M2 Realtime test replays UAT Test 5's failure mode in unit form ("namespaced key reflects the new row, universal stays null") — this is the kind of test that locks down a UAT-discovered bug class.
- 05-06's G3-1 test is correctly designed: it spies on console.error AND filters by the exact UAT-reported error string. No false negatives.
- All three plans honor the parallel-safe-files contract via disjoint `files_modified` lists. Wave 1 / depends_on: [] is correct.
- CONTEXT.md decisions D-11 / D-12 / CONF-2 / CONF-3 are preserved across all three plans (verified by inspection of `clearUserDataSlices` retention in 05-05).

---

*Plan check author: gsd-plan-checker*
*Mode: gap_closure (post-`/gsd-verify-work 5`)*
*Date: 2026-05-12*
