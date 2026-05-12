---
phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
plans_checked: 5
checked: 2026-05-12
checker: gsd-plan-checker (opus 4.7 1M)
verdict: CONCERNS
blockers: 1
warnings: 8
---

# Phase 6 — Plan Check

## Verdict: CONCERNS (1 blocker, 8 warnings)

Goal-backward analysis: the 5 plans collectively trace every Phase 6 SC and every D-01..D-14 decision to at least one task. Coverage is solid, threat models are present on all 5 plans, the 12-scenario migration matrix is real and itemized, the 9-table RLS proof is parameterized, the D-12 CI hardening is explicitly the wave-1 prerequisite, and M4 ordering preservation is asserted in 4 of 5 plans. **One blocker**: cross-tenant Storage RLS (T-06-04-01) is acknowledged but only "verified by Task 1 schema push" — the actual cross-user `storage.from('photos').download(otherUserPath)` test is marked "stretch goal", which leaves the photo Storage tenancy boundary unproven by a live test. The remaining 8 warnings are quality concerns the planner should fold in before execute.

---

## Per-Plan Verdict

| Plan | Wave | Verdict | One-liner |
|------|------|---------|-----------|
| 06-01 | 1 | PASS | D-12 sync-defer + format + Toast.durationMs + Skeleton RM + MedLevelChart null-guard — all three D-12 subtasks landed; bundle-size assertion gated explicitly |
| 06-02 | 2 | PASS w/ minor | Migration framework + 12-scenario matrix + MigrationModal + resume + 90-day backup — M8 photos stub intentional handoff to 06-04; M4/M5 LWW assertions partially deferred to 06-05 (acceptable) |
| 06-03 | 3 | PASS w/ minor | 9 SQL migrations + sync.ts generalization + parameterized RLS — large plan (5 tasks) at scope-sanity ceiling; per-user-table dropOps generalization is load-bearing for back-compat |
| 06-04 | 4 | CONCERNS | Photos table + Storage bucket + photo-queue/compress/signed-url + BodyTab + photo migration loop — BLOCKER on missing live cross-tenant Storage RLS proof; otherwise structurally correct |
| 06-05 | 5 | PASS | LWW conflict toast — narrow, well-scoped, 3-condition heuristic explicit, e2e proof shipped |

---

## Goal Coverage (SC → Plan Trace)

| SC | Plans | Trace |
|----|-------|-------|
| SC#1 (migration UX + 90d backup) | 06-02, 06-03, 06-04 | 06-02 ships MigrationModal + backup snapshot + resume + cleanup + corruption detection. 06-03 + 06-04 fill in entity-specific migration loops via `migrateEntity` extension contracts established in 06-02. e2e `migrate-resume.spec.ts` asserts SC#1 directly. ✅ |
| SC#2 (12-scenario matrix in CI) | 06-02 (M1..M12 stubs + 5 unit), 06-03 (M1/M2 upgraded), 06-04 (M8 upgraded) | The matrix is authored in 06-02 with explicit one-test-per-scenario contract; 06-03 + 06-04 each upgrade the relevant stubs to live assertions. Total ≥ 19 cases at plan close. ✅ |
| SC#3 (photos → Storage; signed URL <5s cross-device) | 06-04 | `photo-cross-device.spec.ts` asserts 5s budget end-to-end; signed-URL cache + 30s pre-expiry + refresh-on-401 wired. ⚠️ See BL-1: cross-tenant Storage RLS not proven by live test. |
| SC#4 (offline edit + LWW + toast on loser) | 06-04 (photo queue + serial drain), 06-05 (toast on loser) | `offline-conflict-toast.spec.ts` asserts the toast text + visibility on the losing device after 2-context offline-edit + reconnect. ✅ |
| SC#5 (RLS over 9 tables, parameterized) | 06-03 Task 5 | `rls-multi-table.test.ts` with `it.each(TABLES_WITH_COMPOSITE_PK)` over 7 tables + 2 standalone tests for supplements + settings = 9 tables. Impersonation 42501 assertion checked per table. ✅ |

**Phase goal — every remaining patient-owned table syncs + migration + photos to Storage + offline queue + LWW**: every clause maps to ≥ 1 plan. No requirement orphaned. PROJECT.md requirements SYNC-02/03/04/06 each have ≥ 1 plan declaring it in `requirements:` frontmatter.

---

## D-01..D-14 LOCKED Decision Compliance

| Decision | Plan(s) | Status | Notes |
|---|---|---|---|
| D-01 (foreground modal + per-entity progress, size-descending) | 06-02 Task 2 | ✅ | MigrationModal copy + entity-row anatomy + size-descending order spelled out; `computeRunOrder` stub uses static ENTITIES order with TODO marker for dynamic count-based sort |
| D-02 (resumable via migration_state slice) | 06-02 Task 1+2 | ✅ | `migration_state` slice + partialize allow-list bump + resume-title test (M7) + corruption detection (M9) all wired |
| D-03 (90-day backup retention + cleanup) | 06-02 Task 1 | ✅ | `snapshotPreCloudBackup` + `cleanupExpiredBackup` + M11 test (95-day expired snapshot cleaned before fresh migration); cleanup trigger documented as on-sign-in (Open Q #8 resolved) |
| D-04 (Storage path `{userId}/photos/{photoId}.jpg`) | 06-04 Task 1+3 | ✅ | `storage_path` field stamped on photo + `storage.foldername(name)[1]` policy SQL spelled out verbatim |
| D-05 (signed-URL cache with refresh-on-401 + 5min TTL) | 06-04 Task 2 | ✅ | `signed-url-cache.ts` Pattern 5 verbatim — TTL 5 min, 30s pre-expiry refresh, refresh-on-401 |
| D-06 (canvas compression: 1600px maxEdge, 0.85 quality, JPEG) | 06-04 Task 2 | ✅ | `photo-compress.ts` Pattern 4 verbatim; Web Worker deferred per Open Q #2 (researcher recommendation, planner accepted) |
| D-07 (hard-delete on row delete; cascade Storage object) | 06-04 Task 3 | ✅ | `removePhoto` enqueues `'delete'` op; `flushPhotoOps` deletes table row THEN Storage object; orphan handled with log-and-continue per researcher rec |
| D-08 (hybrid substrate: localStorage ops + IDB blobs) | 06-04 Task 2+3 | ✅ | `photo-queue.ts` IDB store + `PendingOp.blob_ref` extension + `'upload'` op kind; localStorage pendingOps unchanged |
| D-09 (serial photo upload) | 06-04 Task 3 | ✅ | `flushPhotoOps` explicitly uses `for (const op of photoOps)` serial drain; comment cites D-09 |
| D-10 (eager base64 migration during initial migration) | 06-04 Task 4 | ✅ | Photo migration loop in `migration.ts` decodes base64 → compress → put IDB → enqueue upload with Pitfall 4 backpressure cap + Pitfall 8 yield; M8 test upgrades 06-02 stub to live |
| D-11 (non-blocking info toast, "We kept your most recent edit.") | 06-05 Task 1 | ✅ | Toast kind=info, durationMs=5000 (from 06-01's Toast.tsx extension), exact copy literal asserted in tests + e2e |
| D-12 (CI hardening = 06-01 with 3 explicit subtasks) | 06-01 Tasks 1-4 | ✅ | All three D-12 subtasks landed: (1) sync-defer.ts + App.tsx eager-import strip + 50 kB CI assertion green; (2) `npm run format -- --write`; (3) MedLevelChart null-guard. `depends_on: ['06-01']` declared on 06-02 and (transitively) all others |
| D-13 (schema delegation: 8 composite-PK + settings singleton + supplements flattened) | 06-03 Task 1 | ✅ | settings = `primary key (user_id)` + no listing index + no DELETE policy; supplements flattened per Option A (row-per-`{date, supplement_name, taken}`); CHECK constraints on mood/severity/workouts.type |
| D-14 (one channel per table, 9 channels total) | 06-03 Task 3 | ✅ | 9 `subscribeXXX` exports + `Map<TableName, RealtimeChannel>` + `unsubscribeAll` iterates all; channel filter is string-form `user_id=eq.${userId}` per Pitfall 10 |

**Verdict**: 14 of 14 LOCKED decisions implemented. No contradictions. No deferred ideas leaked into plans (audit log, doctor share, photo trash-bin, GDPR delete — all absent).

---

## UI-CHECK Fold-In Audit

| Finding | Disposition | Trace |
|---------|-------------|-------|
| N1 (`--duration-deliberate` vs `duration-500`) | Acknowledged in spec; non-blocking | No plan task addresses; non-blocking nit, can defer |
| N2 (`--color-warning-soft` = rose-soft, not amber-soft) | Non-blocking | Spec narrative cosmetic; not actioned by plans, acceptable |
| **N3 (Badge `tone` not `variant`)** | ⚠️ Partial | 06-04 explicitly fixes for the photo "Queued" badge inline-compose. **06-02 MigrationModal uses `variant="primary"` / `variant="ghost"` on `Button`** — those ARE the correct Button props (Button uses `variant`); Badge is not used in 06-02. ✅ Correctly applied |
| **N4 (Toast `durationMs?: number` extension)** | ✅ Landed in 06-01 Task 3 | Explicit `durationMs?: number` on toast state + `showToast(message, kind, durationMs)` signature extension + 3 new unit tests |
| **N5 (Skeleton prefers-reduced-motion)** | ✅ Landed in 06-01 Task 3 | `skeleton-shimmer` class + `@media (prefers-reduced-motion: reduce) { animation: none; }` rule in index.css |
| N6 (AvatarMenu sync-dot — optional) | ⚠️ See W-2 | **NEITHER explicitly deferred in CONTEXT NOR shipped in any plan.** UI-SPEC says default INCLUDE; RESEARCH §Open Q #7 also says SHIP (~30 LoC). The user prompt asserts "explicitly deferred (CONTEXT confirms)" — CONTEXT.md does NOT confirm this. See W-2. |

---

## Wave Sequencing Analysis (user's targeted question)

**User's question:** Should the planner's sequential 1→5 ordering stay, or can 06-03 / 06-05 be re-parallelized via task-level splits?

**Findings:**

Files modified across plans (overlap matrix):

| File | 01 | 02 | 03 | 04 | 05 |
|------|----|----|----|----|----|
| `src/App.tsx` | ✓ | ✓ | — | ✓ | — |
| `src/lib/store.ts` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `src/lib/store.test.ts` | ✓ | ✓ | ✓ | — | ✓ |
| `src/lib/sync.ts` | — | — | ✓ | ✓ | ✓ |
| `src/lib/sync.test.ts` | — | — | ✓ | ✓ | ✓ |
| `src/lib/sync-defer.ts` | ✓ | ✓ | — | — | — |
| `src/lib/migration.ts` | — | ✓ | ✓ | ✓ | — |
| `src/lib/storage.ts` | — | ✓ | — | ✓ | — |

**Verdict on sequential ordering**: ✅ **CORRECT, KEEP AS IS.**

Five files have ≥ 3 plan touches (store.ts touches all 5; sync.ts/sync.test.ts/migration.ts touch 3). The dependency edges are real:

- **06-02 → 06-03**: 06-02 ships `migration.ts:migrateEntity` with `TODO(06-03)` stubs for the 8 mechanical entities. 06-03 fills those in. Cannot parallelize — 06-02 must land first or 06-03 lacks the surface to extend.
- **06-03 → 06-04**: 06-04's photo migration loop extends `migrateEntity` again (the photos branch). 06-04 also extends `sync.ts:flushSyncQueue` after 06-03 added 8 other table branches. Sequential merge order matters.
- **06-04 → 06-05**: 06-05 wires loss-detection into all 10 `applyXRealtimePayload` reducers — 9 of which are authored in 06-03 and 1 (`applyPhotoRealtimePayload`) is authored in 06-04. 06-05 cannot wire the surface until both prerequisite plans land.

**Could task-level parallelization help?** Marginally. 06-03 Task 1 (9 SQL files) and 06-04 Task 1 (photos.sql + bucket.sql) are pure-additive SQL with disjoint file targets — these could be parallelized if the orchestrator supports intra-plan task-level wave assignment. But the TS surface modifications in 06-03 Task 3 and 06-04 Task 3 both touch sync.ts/store.ts and would conflict at merge time. **Recommendation: keep sequential 1→5.** The planner's call is correct.

---

## Threat Model Coverage

All 5 plans ship `<threat_model>` blocks per the user's request. Counts of T-06-NN-XX threat IDs:

| Plan | Threats | Coverage |
|------|---------|----------|
| 06-01 | T-06-01-01, 02, 03 | Buffer DoS + tampering + info disclosure on Toast durationMs — minimal surface, appropriate |
| 06-02 | T-06-02-01, 02, 03, 04 | Backup tampering + concurrent cross-tab + retention + repudiation — covers migration-in-flight degraded view explicitly |
| 06-03 | T-06-03-01, 02, 03 | Cross-tenant RLS (parameterized live proof in Task 5) + client `updated_at` tampering + Realtime channel flood |
| 06-04 | T-06-04-01, 02, 03, 04 | Cross-tenant Storage RLS + size/mime bypass + signed URL exposure + IndexedDB cross-account isolation (T-06-04-04 cited as carry from T-05-04) |
| 06-05 | T-06-05-01 | Toast metadata leakage — narrow surface, appropriate |

**T-05-03 (cross-account IndexedDB) carry-forward**: T-06-04-04 explicitly cites it and wires `clearAllPhotoBlobs()` in `sync-defer.ts:onSignedOut` drain before `clearUserDataSlices`. ✅
**T-05-04 (Storage cleanup on SIGNED_OUT) carry-forward**: T-06-04-03 (signed URL TTL = 5min) addresses the loose URL forwarding; explicit cleanup is via `clearSignedUrlCache()` paired with `clearAllPhotoBlobs()`. ✅

---

## Nyquist Dimension 8 (Validation Sampling)

| Plan | Wave 0 stubs accounted | Per-task automated verify | Suite latency |
|------|------------------------|---------------------------|---------------|
| 06-01 | sync-defer.ts, sync-defer.test.ts ✅ | ✅ all 4 tasks have `<automated>` runnable commands | ~5s unit |
| 06-02 | migration.ts, migration.test.ts, migrate-resume.spec.ts ✅ | ✅ all 4 tasks | ~5s unit + 90s e2e (skip-gated) |
| 06-03 | rls-multi-table.test.ts ✅ | ✅ Task 2 is BLOCKING `[human-verify]` checkpoint (correct gate type for live DB push) | ~30s RLS integration |
| 06-04 | photo-queue.ts, photo-queue.test.ts ✅ | ✅ all 5 tasks | ~5s unit + 90s e2e |
| 06-05 | — (extends existing surfaces) | ✅ both tasks | ~5s unit + 90s e2e |

Wave 0 stub list from 06-VALIDATION.md ✅ fully accounted across the 5 plans. Every load-bearing test has a runnable `<automated>` command. No `MISSING` references; no `--watchAll`. Sampling continuity holds (no 3-consecutive-without-verify window).

---

## Pattern Compliance (06-PATTERNS.md)

| File | Analog cited in plan | Pattern referenced |
|------|----------------------|---------------------|
| `src/lib/sync-defer.ts` | telemetry-defer.ts | ✅ 06-01 Task 1 cites verbatim |
| `src/lib/migration.ts` | auth-migration.ts | ✅ 06-02 Task 1 cites pattern + module-level flag |
| `src/lib/photo-queue.ts` | (no analog — partial) | ✅ 06-04 Task 2 follows RESEARCH §Pattern 3 verbatim |
| `src/lib/photo-compress.ts` | (no analog — partial) | ✅ 06-04 Task 2 cites RESEARCH §Pattern 4 |
| `src/lib/signed-url-cache.ts` | sync.ts singleton | ✅ 06-04 Task 2 cites RESEARCH §Pattern 5 |
| 9 SQL migrations | injections.sql | ✅ 06-03 Task 1 + 06-04 Task 1 cite template; `do $$ ... end$$` idempotency present |
| RLS multi-table | rls-injections.test.ts | ✅ 06-03 Task 5 cites parameterization pattern |
| MigrationModal | PostSignupSent.tsx + Modal | ✅ 06-02 Task 2 cites blocking-card pattern |
| Shared Pattern A (idempotent install) | sync.ts module-level | ✅ Applied via `migrationInFlight` flag, channels Map |
| Shared Pattern B (defensive try/catch) | storage.ts | ✅ photo-queue.ts wraps every IDB op; snapshotPreCloudBackup wraps localStorage |
| Shared Pattern C (server-authoritative updated_at) | sync.ts upserts | ✅ Parameterized test asserts omission across all 10 tables |
| Shared Pattern D (skip-gated live tests) | rls-injections.test.ts | ✅ All 3 e2e specs include `test.skip(!HAS_LIVE_AUTH, ...)` |
| Shared Pattern E (CSS vars only) | EmailVerificationBanner.tsx | ✅ MigrationEntityRow + queued badge inline-compose use only `var(--color-*)` |
| Shared Pattern F (aria-live polite, transition-only) | Toast.tsx | ✅ MigrationModal Task 2 cites the "DO NOT announce every count tick" invariant |

12 of 12 file-classification entries from PATTERNS.md have analog references in the plans that create/modify them. ✅

---

## CI Gate Carry-Forward

| Plan | Bundle 50 kB | format:check | RLS gate | M4 ordering |
|------|--------------|--------------|----------|-------------|
| 06-01 | ✅ load-bearing | ✅ explicit format pass | n/a | ✅ asserted |
| 06-02 | ✅ asserted post-add | ✅ asserted | n/a | ✅ asserted |
| 06-03 | ✅ asserted | ✅ asserted | ✅ extended for 9 tables | ✅ asserted |
| 06-04 | ✅ asserted (lazy chunks) | ✅ asserted | n/a | ✅ asserted |
| 06-05 | ✅ asserted | ✅ asserted | n/a | ✅ explicit `npx vitest run -t "deletes universal key"` |

Schema-push worktree caveat: 06-03 Task 2 (the blocking checkpoint) cites `project_worktree_supabase_cli.md` and includes the dual-write fallback explicitly. 06-04 Task 1 references "same worktree caveat as Plan 06-03 Task 2" — could be more explicit but the cross-reference is unambiguous.

---

## Findings

### BLOCKER

**BL-1 [security / context_compliance]** — Cross-tenant Storage RLS proof is "stretch goal" in 06-04, not a required test.

```yaml
issue:
  dimension: security_proof
  severity: blocker
  description: |
    06-04 T-06-04-01 mitigation states: "RLS test via Task 1 schema push verifies
    policy presence; full live cross-tenant proof deferred to a future plan (could
    parameterize the rls-multi-table.test.ts to also try cross-user
    storage.from('photos').download(otherUserPath) — recommend doing so in Plan
    06-04 Task 5 as a stretch goal)."

    The 9 Postgres tables (06-03) get a parameterized cross-tenant proof in
    rls-multi-table.test.ts. The Storage bucket — which carries patient body
    photos, a more sensitive data class than the metadata tables — gets NO
    equivalent live tenancy test. Policy SQL is shipped, but unproven against
    impersonation. Phase 5 set the precedent: every RLS surface gets a live
    "user B reads ZERO" + "impersonation INSERT rejected" test.
  plan: "06-04"
  decision_ref: "D-04 (Storage path convention + folder-prefix RLS)"
  fix_hint: |
    Extend rls-multi-table.test.ts (06-03 Task 5) OR add to photo-cross-device.spec.ts
    (06-04 Task 5) a sub-test:
      1. User A uploads a photo via Storage → row + object exist
      2. User B (authenticated, different uid) attempts:
         a. storage.from('photos').download('${userA.id}/photos/${photo_id}.jpg') → expect error / 0 bytes
         b. storage.from('photos').list('${userA.id}/photos') → expect [] (folder enumeration also blocked)
         c. storage.from('photos').upload('${userA.id}/photos/impersonation.jpg', blob) → expect 403 / RLS reject
      3. Cleanup via admin client
    ~30 LoC; same trust-boundary class as the 9-table RLS proof. Folder-prefix RLS
    is the load-bearing tenancy mechanism for Storage; not proving it ships the most
    sensitive data class on policy SQL alone.
```

This is a BLOCKER because Phase 5 established the contract that every RLS surface gets a live impersonation test, and the body-photo Storage surface is the most sensitive new surface in Phase 6. The plan author flagged this themselves as a "stretch goal" but kept it out of the success criteria — that elevates it to a BLOCKER per the adversarial-stance rules.

---

### WARNINGS

**W-1 [scope_sanity]** — 06-03 has 5 tasks; 06-04 has 5 tasks. Both at the upper threshold.

- 06-03 Tasks: SQL migrations / db push checkpoint / sync.ts+store.ts extension / migration.ts entity fill-in / RLS parameterized test
- 06-04 Tasks: photos+bucket SQL / 3 net-new TS modules / Photo type+sync+store+SIGNED_OUT / migration photo loop+BodyTab / Playwright e2e

Both exceed the 2-3 target and hit the 4 = warning threshold (5 = blocker per scope-sanity dimension). Suggested split (if planner wants to reduce context risk):
- 06-03a: SQL (Tasks 1+2) + RLS test (Task 5) → wave 3 in parallel with…
- 06-03b: sync.ts + store.ts + migration.ts extension (Tasks 3+4) → wave 3 (Postgres-side has no JS dependency)
- 06-04a: photos.sql + bucket + 3 TS modules (Tasks 1+2)
- 06-04b: Photo type + runtime wiring + BodyTab + Playwright (Tasks 3+4+5)

This is a quality concern, not a blocker. The planner's choice to keep them as single plans is defensible (vertical-slice cohesion) but means each execute-phase invocation runs near max context.

**W-2 [ui_check_fold_in]** — N6 AvatarMenu sync-dot disposition is ambiguous.

The user prompt asserts "N6: AvatarMenu sync-dot is optional — explicitly deferred (CONTEXT confirms)." Checking the actual CONTEXT.md: **AvatarMenu is NOT mentioned in any of D-01..D-14 or the "Deferred Ideas" section.** UI-SPEC §Open Q #5 says "Default: INCLUDE in Phase 6." RESEARCH §Open Q #7 says "Recommendation: SHIP. ~30 LoC." None of the 5 plans ship it.

Either:
- (a) Add a 1-2-line ADDENDUM to 06-CONTEXT.md explicitly deferring AvatarMenu sync-status to Phase 7 (matches the user's stated assumption), OR
- (b) Add a small task to 06-01 or 06-05 to ship the 30 LoC AvatarMenu state-machine + sync-pulse keyframe.

No SC depends on this, so leaving as-is is acceptable — but the documentation drift between UI-SPEC ("INCLUDE"), RESEARCH ("SHIP"), and actual plan output ("absent") should be reconciled.

**W-3 [deep_work_rules]** — 06-03 Task 3 is the most under-specified task in the phase.

Tasks 1, 2, 4, 5 of 06-03 are tight. Task 3 ("Extend sync.ts with 9 per-table subscribe helpers + generalized flushTableOps; extend store.ts with 8 entity action sets") describes ~25 new actions across 9 entities — the file diff will be ~500-800 lines. The action block is detailed but the `<acceptance_criteria>` is grep-count based (e.g., `grep -cE "addWeight|addMeal..." ≥ 8`), which can be satisfied by stub functions that don't actually enqueue. Recommend: add an acceptance criterion that for each of the 7 mechanical entities, a unit test asserts the full `add → enqueueOp → flushSyncQueue → pendingOps drained` round-trip (not just "the action exists").

**W-4 [task_completeness]** — `dropOps` signature change in 06-03 Task 3 is back-compat-load-bearing but not isolated.

06-03 Task 3 Step 6 generalizes `dropOps(keys)` → `dropOps(keys, table?)`. This is a public API change touching Phase 5's existing call sites (`flushInjections` calls `state.dropOps(...)`). The plan asserts "preserves Phase 5 callers" but doesn't list which call sites need updating or how the back-compat is tested. Recommend: add an explicit acceptance criterion: "all Phase 5 sync.test.ts tests pass unchanged (the existing dropOps calls in flushInjections continue to work)."

**W-5 [context_compliance]** — D-03 cleanup trigger ambiguity.

D-03 says "After 90 days, a periodic cleanup (Claude's discretion on trigger)…" — the planner correctly resolved this via RESEARCH Open Q #8 (on-sign-in, in `maybeStartMigration`). Plan 06-02 implements this. ✅ But M11 test ("backup exists 95 days old") asserts `cleanupExpiredBackup` fires "FIRST" — the actual `maybeStartMigration` body calls it on entry, then proceeds to detect/snapshot. The test should also assert the SECOND-snapshot has `snapshotAt = now()` (not the 95-day-old timestamp) to prove fresh snapshot taken AFTER cleanup, not BEFORE. Subtle but matters for the retention contract.

**W-6 [interaction_contract]** — Photo migration backpressure assumption.

06-04 Task 4 photo loop:
```typescript
while (pendingOps.filter((op) => op.table === 'photos' && op.op === 'upload').length >= MAX_INFLIGHT) {
  await sync.flushSyncQueue();
  await new Promise((r) => setTimeout(r, 100));
}
```

This polls `pendingOps.length` after `flushSyncQueue()` returns. But `flushPhotoOps` drains serially within a single `flushSyncQueue` call — if it processes all queued photos, the queue could empty AND THEN refill from the migration loop's next iteration. Verify: does the loop correctly enforce MAX_INFLIGHT = 5 in-flight, or does it actually serialize 1-at-a-time (which D-09 already mandates anyway)? With D-09 already requiring serial photo uploads, MAX_INFLIGHT=5 is redundant — the queue can never exceed 1 in-flight. Recommend: remove the in-loop backpressure (D-09 serializes it) OR clarify that MAX_INFLIGHT bounds the *queued* count (pre-flush) and not in-flight, in which case the threshold name is misleading.

**W-7 [validation_completeness]** — 06-04 Task 4 M8 photo migration test is asserted in 06-04, but 06-02's M8 stub language ("the stub can `markStatus('photos', 'pending')` and a TODO comment for 06-04") is too permissive.

When 06-02 ships before 06-04 in wave 2, M8 will be a no-op test. Recommend: 06-02's M8 stub should at minimum assert that `ENTITIES[0] === 'photos'` AND that the photos branch is reached (e.g., by spy-mocking the photos handler). Currently the plan says "the stub can `markStatus('photos', 'pending')`" — this can pass with zero photo migration logic shipped. Move the M8 LIVE assertion contract explicitly to 06-04 Task 4 acceptance criteria (it's there in `<action>`, just confirm it's a hard pass-criterion).

**W-8 [decision_traceability]** — `migrationInFlight` flag re-entry semantics.

06-02 Task 1 ships `migrationInFlight` as a module-level boolean — set on entry, cleared in `finally`. But the M9 corruption path (`isMigrationStateCorrupted` returns true) returns BEFORE setting `migrationInFlight = true`. If a corrupted state is encountered and the user clicks "Retry migration" CTA, the retry calls `maybeStartMigration` again — the corruption check runs FIRST and clears the slice, then control falls through to "Fresh — check if there's actually v4 data to migrate". This is the intent, but the `migrationInFlight` guard doesn't protect the cleanup-and-retry path against concurrent SIGNED_IN re-fires (e.g., user clicks retry just as token refresh re-emits SIGNED_IN). Recommend: gate the entire `maybeStartMigration` body with `migrationInFlight` guard, not just the resume + fresh paths. Minor correctness concern.

---

## What's Solid (preserve in execute)

- **D-12 carry-forward is bulletproof**: every plan (02-05) asserts `bash scripts/assert-vendor-react-size.sh` exits 0 + format:check exits 0. The 50 kB IDX_CEILING is named explicitly.
- **M4 ordering preservation**: 4 of 5 plans assert `npx vitest run -t "deletes universal key"`. 06-04 is the one plan that only asserts "M4 ordering contract test still passes" without the explicit test name — minor doc nit, behavior is correct.
- **Threat models per plan**: all 5 plans have `<threat_model>` blocks with STRIDE classifications + explicit T-NN-NN IDs + Phase 5 carry-forward references. T-05-03 and T-05-04 are correctly carried.
- **Skip-gated e2e**: all 3 live-DB Playwright specs (migrate-resume / photo-cross-device / offline-conflict-toast) use the canonical `test.skip(!HAS_LIVE_AUTH, ...)` pattern. Fork-PR CI safety preserved.
- **Worktree caveat documented**: 06-03 Task 2 explicitly cites `project_worktree_supabase_cli.md` and provides the dual-write workaround.
- **12-scenario matrix**: M1..M12 itemized with one-line behavioral asserts; 5 unit-level cases on top. SC#2's "failure of any scenario blocks merge" is enforceable.
- **Per-table parameterized RLS**: 7 mechanical tables via `it.each`, plus 2 explicit tests for supplements + settings (composite-PK and singleton variants). Impersonation 42501 asserted per table.
- **Patterns map honored**: every file in PATTERNS.md's classification table has its analog cited in the plan that creates/modifies it.
- **Open Questions resolution**: RESEARCH §Open Questions (8 items) each have a Recommendation; the plans implement the recommended path for each.

---

## Recommendation

**Verdict: CONCERNS (1 blocker + 8 warnings)**

**Recommended next step**: REVISE 06-04 to fix BL-1 (cross-tenant Storage RLS live proof). The fix is small — ~30 LoC added to either `rls-multi-table.test.ts` or `photo-cross-device.spec.ts`. Once that lands, the phase is execute-ready. The 8 warnings can be addressed during execute (most are documentation tightenings; W-2 needs a CONTEXT addendum or no action depending on user preference; W-6 is an in-code clarification the executor will surface naturally).

Do NOT re-plan from scratch — the plans are structurally sound, decision-compliant, and SC-traceable. Revision scope is narrow: 06-04 Task 5 (or new Task 6) adding 3 sub-assertions to the photo-cross-device spec covering the cross-tenant Storage download/list/upload impersonation cases.

Sequential 1→5 wave ordering is correct — KEEP. Task-level intra-plan parallelization is possible (06-03a/b, 06-04a/b) but not necessary unless context budget concerns arise during execute.

---

*Phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos*
*Plans checked: 5 (06-01..06-05)*
*Goal-backward verification: 5/5 SCs traced; 14/14 D-XX decisions implemented*
*BLOCKER count: 1 — fix before /gsd-execute-phase 6*
*Warning count: 8 — recommended fix during execute*
